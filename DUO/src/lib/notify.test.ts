/**
 * Tests for the notification bundling.
 *
 * The ordering is what these pin: which bill leads the feed, which event leads
 * a bill, and what counts as work still waiting. All three are derived rather
 * than stored, so a wrong answer here shows up as a plausible-looking feed
 * rather than as an error.
 */

import { describe, expect, test } from 'bun:test'
import { bundleByBill, isSettled } from './notify'
import type { NotifItem } from './types'

let seq = 0

function note(patch: Partial<NotifItem>): NotifItem {
  seq += 1
  return {
    id: `n-${seq}`,
    person: 'Budi',
    place: 'Warung Bu Siti',
    ref_code: '9PMXR2KV',
    bill_id: 'bill-1',
    verdict: 'matched',
    amount_read: 42760,
    amount_owed: 42760,
    image_path: 'bukti/x.jpg',
    status: 'lunas',
    created_at: '2026-09-19T10:00:00Z',
    ...patch,
  }
}

describe('isSettled', () => {
  test('a matched proof is settled even before its share says so', () => {
    expect(isSettled(note({ verdict: 'matched', status: 'belum lunas' }))).toBe(true)
  })

  test('a proof the operator accepted by hand is settled despite the verdict', () => {
    expect(isSettled(note({ verdict: 'mismatch', status: 'lunas' }))).toBe(true)
  })

  test('a flagged proof nobody has answered is not settled', () => {
    expect(isSettled(note({ verdict: 'unclear', status: 'belum lunas' }))).toBe(false)
  })
})

describe('bundleByBill', () => {
  test('one bundle per bill, newest bill first', () => {
    const bundles = bundleByBill([
      note({ bill_id: 'older', created_at: '2026-09-19T08:00:00Z' }),
      note({ bill_id: 'newer', created_at: '2026-09-19T09:00:00Z' }),
    ])
    expect(bundles.map((b) => b.bill_id)).toEqual(['newer', 'older'])
  })

  test('events inside a bundle are newest first', () => {
    const bundles = bundleByBill([
      note({ bill_id: 'bill-1', created_at: '2026-09-19T08:00:00Z', person: 'A' }),
      note({ bill_id: 'bill-1', created_at: '2026-09-19T10:00:00Z', person: 'B' }),
      note({ bill_id: 'bill-1', created_at: '2026-09-19T09:00:00Z', person: 'C' }),
    ])
    expect(bundles[0].items.map((n) => n.person)).toEqual(['B', 'C', 'A'])
    expect(bundles[0].newest).toBe('2026-09-19T10:00:00Z')
  })

  test('the headline comes from the newest event', () => {
    const bundles = bundleByBill([
      note({ bill_id: 'bill-1', place: 'Old Place', created_at: '2026-09-19T08:00:00Z' }),
      note({ bill_id: 'bill-1', place: 'New Place', created_at: '2026-09-19T10:00:00Z' }),
    ])
    expect(bundles[0].place).toBe('New Place')
  })

  test('unsettled counts only the proofs nobody has answered', () => {
    const bundles = bundleByBill([
      note({ verdict: 'matched', status: 'lunas' }),
      note({ verdict: 'mismatch', status: 'belum lunas' }),
      note({ verdict: 'mismatch', status: 'lunas' }),
    ])
    expect(bundles[0].items).toHaveLength(3)
    expect(bundles[0].unsettled).toHaveLength(1)
  })

  test('an empty feed is an empty list, not a bundle of nothing', () => {
    expect(bundleByBill([])).toEqual([])
  })
})
