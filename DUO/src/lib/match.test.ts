/**
 * Tests for the payment judgement.
 *
 * This is the money path: a 'matched' verdict settles someone's share on its
 * own, with nobody looking. So the tests that matter are the ones asserting it
 * does NOT say matched — a short transfer, a failed transaction, a transfer to
 * the wrong account, and a screenshot too blurry to read.
 *
 * The logic lives in the Edge Function's folder because that is where it runs,
 * but it is pure and dependency-free so it can be tested from here.
 */

import { describe, expect, test } from 'bun:test'
import { judge, type Expected, type ReadProof } from '../../supabase/functions/validate-payment/match'

const expected: Expected = {
  amountDue: 127050,
  accountHolder: 'Alee',
  accountNumber: '1234567890',
}

const proof = (patch: Partial<ReadProof> = {}): ReadProof => ({
  amount: 127050,
  recipient_name: 'ALEE',
  recipient_account: '1234567890',
  status_text: 'Berhasil',
  confidence_notes: null,
  ...patch,
})

describe('judge', () => {
  test('accepts a payment that matches on both amount and destination', () => {
    expect(judge(proof(), expected).verdict).toBe('matched')
  })

  test('a short transfer is never matched', () => {
    const result = judge(proof({ amount: 100000 }), expected)
    expect(result.verdict).toBe('mismatch')
    expect(result.note).toContain('Kurang')
    expect(result.note).toContain('27.050')
  })

  test('an overpayment is surfaced rather than silently accepted', () => {
    const result = judge(proof({ amount: 130000 }), expected)
    expect(result.verdict).toBe('mismatch')
    expect(result.note).toContain('Lebih')
  })

  /*
   * The one this whole file exists for. The amount is exactly right, so an
   * amount-only check marks it paid — and the money went to a stranger.
   */
  test('the right amount to the wrong account is not matched', () => {
    const result = judge(proof({ recipient_account: '9999999999', recipient_name: 'BUDI' }), expected)
    expect(result.verdict).toBe('mismatch')
    expect(result.note).toContain('salah rekening')
  })

  test('a masked account number is accepted when its visible digits are the tail', () => {
    expect(judge(proof({ recipient_account: '****7890' }), expected).verdict).toBe('matched')
  })

  test('a name alone is enough when no account number is legible', () => {
    const result = judge(proof({ recipient_account: null, recipient_name: 'Alee Fikri' }), expected)
    expect(result.verdict).toBe('matched')
  })

  test('a wrong name with no account number is not matched', () => {
    const result = judge(proof({ recipient_account: null, recipient_name: 'Budi Santoso' }), expected)
    expect(result.verdict).toBe('mismatch')
  })

  // Unreadable is a different thing from wrong, and the operator should be told
  // which one they are looking at.
  test('a right amount with an unreadable recipient needs a human', () => {
    const result = judge(proof({ recipient_account: null, recipient_name: null }), expected)
    expect(result.verdict).toBe('unclear')
  })

  test('an unreadable amount needs a human', () => {
    expect(judge(proof({ amount: null }), expected).verdict).toBe('unclear')
  })

  test('a screenshot of a failed transfer never matches, whatever the amount says', () => {
    for (const status of ['Gagal', 'PENDING', 'Menunggu Konfirmasi', 'Transaksi Dibatalkan']) {
      expect(judge(proof({ status_text: status }), expected).verdict).toBe('mismatch')
    }
  })

  test('a two-letter name is not treated as a containment match', () => {
    // "Al" would otherwise appear inside most names, and inside none of them
    // meaningfully.
    const result = judge(proof({ recipient_account: null, recipient_name: 'Al' }), expected)
    expect(result.verdict).toBe('unclear')
  })

  test('a missing destination on the bill means the recipient cannot be checked', () => {
    const result = judge(proof(), { ...expected, accountHolder: null, accountNumber: null })
    expect(result.verdict).toBe('unclear')
    expect(result.note).toContain('penerimanya nggak kebaca')
  })
})

/**
 * `recipientOk` is what the running total is summed on, so it is the field that
 * decides how much a person has paid. A wrong answer here does not produce a
 * wrong message, it produces a wrong balance — which is why these get their own
 * block rather than riding along on the verdict assertions above.
 */
describe('recipientOk', () => {
  test('a short transfer to the right account still reached the right account', () => {
    const result = judge(proof({ amount: 50000 }), expected)
    expect(result.verdict).toBe('mismatch')
    expect(result.recipientOk).toBe(true)
  })

  test('the right amount to the wrong account did not', () => {
    const result = judge(proof({ recipient_account: '9999999999', recipient_name: 'BUDI' }), expected)
    expect(result.recipientOk).toBe(false)
  })

  test('a failed transfer is null, not true, whatever account it names', () => {
    // The trap: the recipient is perfectly readable and correct, and no money
    // moved. Summing this would show someone as having paid for a transfer
    // their bank rejected.
    const result = judge(proof({ status_text: 'Gagal' }), expected)
    expect(result.recipientOk).toBeNull()
  })

  test('an unreadable recipient is null rather than a guess either way', () => {
    expect(judge(proof({ recipient_account: null, recipient_name: null }), expected).recipientOk).toBeNull()
  })

  test('a matched payment is true', () => {
    expect(judge(proof(), expected).recipientOk).toBe(true)
  })
})

/**
 * Instalments. The amount compared against is what is still due, so the second
 * transfer of a two-part payment is the one that settles the share — and the
 * first is recorded as paid without settling it.
 */
describe('instalments', () => {
  test('the transfer that finishes a part-paid share is matched', () => {
    // Rp 50.000 already in, so Rp 77.050 due. Against the original 127.050 this
    // would be short and the share would never close.
    const result = judge(proof({ amount: 77050 }), { ...expected, amountDue: 77050 })
    expect(result.verdict).toBe('matched')
  })

  test('a part payment is short against the remainder, and says what is left', () => {
    const result = judge(proof({ amount: 50000 }), expected)
    expect(result.verdict).toBe('mismatch')
    expect(result.note).toContain('sisa')
    expect(result.note).toContain('127.050')
  })

  test('the wrong account is reported as the wrong account, not as short', () => {
    // Both are wrong here: the amount is short AND the account is someone
    // else's. The account is the fact that decides what the money did, so it is
    // the one the operator is told. Calling this "kurang Rp 20.000" would
    // invite them to accept it and mark a stranger's transfer as paid.
    const result = judge(proof({ amount: 107050, recipient_account: '9999999999', recipient_name: 'BUDI' }), expected)
    expect(result.note).toContain('salah rekening')
    expect(result.note).not.toContain('Kurang')
    expect(result.recipientOk).toBe(false)
  })

  test('overpaying the remainder is still surfaced, not auto-accepted', () => {
    const result = judge(proof({ amount: 100000 }), { ...expected, amountDue: 77050 })
    expect(result.verdict).toBe('mismatch')
    expect(result.note).toContain('Lebih')
    expect(result.recipientOk).toBe(true)
  })
})
