/**
 * Tests for the detailed export.
 *
 * The one that matters is the reconciliation: the rows for a person on a bill
 * must add up to exactly what that person owes. Everything else here is
 * plumbing; that one is the difference between an export somebody trusts and an
 * export somebody has to check.
 */

import { describe, expect, test } from 'bun:test'
import { allocate, allocateBill, buildExportRows, toCsv, type ExportBill } from './export'

describe('allocate', () => {
  test('parts add up to the total exactly', () => {
    expect(allocate(100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100)
    expect(allocate(999, [5, 3, 2]).reduce((a, b) => a + b, 0)).toBe(999)
    expect(allocate(1, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(1)
  })

  test('an amount that divides evenly does not invent a remainder', () => {
    expect(allocate(30000, [1, 1, 1])).toEqual([10000, 10000, 10000])
  })

  test('an amount that does not divide evenly still adds up', () => {
    const parts = allocate(100000, [1, 1, 1])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100000)
    // 33333 + 33333 + 33334, in that order: the leftover goes to the earliest
    // position rather than somewhere that depends on iteration order.
    expect(parts).toEqual([33334, 33333, 33333])
  })

  test('handles a negative total, which a discount produces', () => {
    const parts = allocate(-5000, [1, 1, 1])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(-5000)
  })

  test('falls back to an even split when every weight is zero', () => {
    const parts = allocate(100, [0, 0])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100)
  })
})

/** Warung Bu Siti, with the items assigned the way the spec example splits them. */
const bill: ExportBill = {
  ref_code: 'QH82NKVD',
  bill_date: '2026-09-12',
  place: 'Warung Bu Siti',
  total: 75900,
  bank_name: 'BCA',
  account_number: '1234567890',
  account_holder: 'Alee',
  paid_by_person: null,
  qris_path: null,
  payment_method: 'bank',
  items: [
    { name: 'Nasi Goreng', qty: 1, line_total: 25000, assigned_to: ['Budi'] },
    { name: 'Es Teh', qty: 2, line_total: 16000, assigned_to: ['Budi', 'Sarah'] },
    { name: 'Kentang Goreng Gede', qty: 1, line_total: 30000, assigned_to: ['Sarah'] },
  ],
  shares: [
    {
      pay_token: null,
      amount_paid: 0,
      payments: [],
      person: 'Budi',
      discount_share: 2817,
      tax_share: 3718,
      service_share: 1859,
      rounding_share: 0,
      amount_owed: 42760,
      status: 'lunas',
      paid_date: '2026-09-14',
    },
    {
      pay_token: null,
      amount_paid: 0,
      payments: [],
      person: 'Sarah',
      discount_share: 2183,
      tax_share: 2882,
      service_share: 1441,
      rounding_share: 0,
      amount_owed: 33140,
      status: 'belum lunas',
      paid_date: null,
    },
  ],
}

describe('buildExportRows', () => {
  test('one row per item per person', () => {
    const rows = buildExportRows([bill])
    // Nasi Goreng -> Budi, Es Teh -> both, Kentang -> Sarah
    expect(rows.length).toBe(4)
  })

  // The invariant the whole file exists to guarantee.
  test('a person rows add up to exactly what they owe', () => {
    const rows = buildExportRows([bill])

    for (const [person, expected] of [
      ['Budi', 42760],
      ['Sarah', 33140],
    ] as const) {
      const sum = rows
        .filter((r) => r.person_name === person)
        .reduce((acc, r) => acc + r.person_share_amount, 0)
      expect(sum).toBe(expected)
    }
  })

  test('every row across the bill adds up to the bill total', () => {
    const sum = buildExportRows([bill]).reduce((acc, r) => acc + r.person_share_amount, 0)
    expect(sum).toBe(75900)
  })

  test('item_subtotal is the item, person_share_amount is the slice', () => {
    const rows = buildExportRows([bill])
    const esTeh = rows.filter((r) => r.item_name === 'Es Teh')
    // The item's own total appears on both of its rows...
    expect(esTeh.map((r) => r.item_subtotal)).toEqual([16000, 16000])
    // ...while the per-person column is a slice of it, and those slices add up.
    expect(esTeh.reduce((acc, r) => acc + r.person_share_amount, 0)).toBeGreaterThan(0)
  })

  test('carries the destination and the payment state', () => {
    const rows = buildExportRows([bill])
    expect(rows[0].bank_name).toBe('BCA')
    expect(rows[0].account_number).toBe('1234567890')
    expect(rows[0].recipient_name).toBe('Alee')
    expect(rows.find((r) => r.person_name === 'Budi')!.payment_status).toBe('paid')
    expect(rows.find((r) => r.person_name === 'Budi')!.paid_at).toBe('2026-09-14')
    expect(rows.find((r) => r.person_name === 'Sarah')!.payment_status).toBe('unpaid')
  })

  test('an unassigned item is skipped rather than crashing the export', () => {
    const broken: ExportBill = {
      ...bill,
      items: [...bill.items, { name: 'Mystery', qty: 1, line_total: 0, assigned_to: [] }],
    }
    expect(() => buildExportRows([broken])).not.toThrow()
  })
})

/**
 * The itemised breakdown behind the WhatsApp message.
 *
 * The whole point of printing item lines is that people check them, so the
 * arithmetic on screen has to work: the items, plus the charges that are not
 * items, must equal the number being asked for. If they do not, the message
 * invites an argument it cannot win.
 */
describe('allocateBill', () => {
  test('the item lines plus the charges equal the total', () => {
    for (const person of allocateBill(bill)) {
      const items = person.items.reduce((acc, i) => acc + i.amount, 0)
      expect(items + person.extra).toBe(person.total)
    }
  })

  test('the named charges add up to the extra, with nothing unaccounted for', () => {
    for (const person of allocateBill(bill)) {
      const components = person.components.reduce((acc, c) => acc + c.amount, 0)
      expect(components).toBe(person.extra)
    }
  })

  test('a shared item records how many ways it was split', () => {
    const budi = allocateBill(bill).find((p) => p.person === 'Budi')!
    const esTeh = budi.items.find((i) => i.name === 'Es Teh')!
    expect(esTeh.shared).toBe(2)
    // 16000 split two ways
    expect(esTeh.amount).toBe(8000)
    expect(esTeh.lineTotal).toBe(16000)
    // and the other half lands on the other person, not lost
    const sarah = allocateBill(bill).find((p) => p.person === 'Sarah')!
    expect(sarah.items.find((i) => i.name === 'Es Teh')!.amount).toBe(8000)
  })

  /*
   * The organiser is in the split because they ate and the shares have to sum
   * to the bill — but their share is not a debt to anyone, and the document has
   * to say so rather than showing them as having paid for no stated reason.
   */
  describe('the organiser', () => {
    test('marks their own row and no other', () => {
      const withPayer: ExportBill = { ...bill, paid_by_person: 'Budi' }
      const rows = allocateBill(withPayer)

      expect(rows.find((p) => p.person === 'Budi')!.is_payer).toBe(true)
      expect(rows.find((p) => p.person === 'Sarah')!.is_payer).toBe(false)
    })

    test('nobody is marked when the bill names no one', () => {
      expect(allocateBill(bill).some((p) => p.is_payer)).toBe(false)
    })

    test('a name that is not in the split marks nobody', () => {
      // What a stale name looks like — somebody was removed from the roster
      // after the marker was set. Marking the wrong person would silently
      // settle a real debt, so an unknown name has to mark nothing.
      expect(allocateBill({ ...bill, paid_by_person: 'Tono' }).some((p) => p.is_payer)).toBe(false)
    })

    test('their share still counts toward the bill total', () => {
      // The marker says the share is not owed; it does not say the share is
      // not there. Dropping it would break the reconciliation at the foot.
      const summed = allocateBill({ ...bill, paid_by_person: 'Budi' }).reduce(
        (acc, p) => acc + p.total,
        0,
      )
      expect(summed).toBe(75900)
    })
  })

  test('the breakdown adds up to the bill total', () => {
    const summed = allocateBill(bill).reduce((acc, p) => acc + p.total, 0)
    expect(summed).toBe(75900)
  })

  // The residue is a real possibility — the four components are each rounded on
  // their own — and it has to be named rather than dropped, or the printed
  // lines do not add up to the printed total.
  test('a residue the components cannot explain is named, not swallowed', () => {
    const awkward: ExportBill = {
      ...bill,
      // amount_owed deliberately one rupiah away from what the components imply
      shares: [{ ...bill.shares[0], amount_owed: bill.shares[0].amount_owed + 1 }, bill.shares[1]],
    }
    const budi = allocateBill(awkward).find((p) => p.person === 'Budi')!
    const components = budi.components.reduce((acc, c) => acc + c.amount, 0)
    expect(components).toBe(budi.extra)
    expect(budi.components.some((c) => c.label === 'Penyesuaian')).toBe(true)
  })
})

/**
 * The payment columns.
 *
 * The PRD asks for all of them "terisi konsisten, gak ada yang kosong tanpa
 * alasan jelas", and three of them shipped hardcoded empty with a comment
 * saying the payment feature did not exist yet. It does now.
 */
describe('payment columns', () => {
  const proof = (patch: Partial<ExportBill['shares'][number]['payments'][number]> = {}) => ({
    amount_read: 42760,
    amount_due: 42760,
    recipient_ok: true,
    verdict: 'matched' as const,
    image_path: 'uid/bukti-1.jpg',
    created_at: '2026-09-13T10:00:00Z',
    ...patch,
  })

  // Returns an array, not a bill: every caller feeds it straight to
  // buildExportRows, and a helper that returns the wrong shape is a helper that
  // gets wrapped by hand at nine call sites and missed at one.
  const withPayments = (patch: Partial<ExportBill['shares'][number]>): ExportBill[] => [
    { ...bill, shares: [{ ...bill.shares[0], ...patch }, bill.shares[1]] },
  ]

  test('a share with no proof reads unpaid and carries nothing', () => {
    const row = buildExportRows([bill]).find((r) => r.person_name === 'Sarah')!
    expect(row.payment_status).toBe('unpaid')
    expect(row.proof_of_payment_url).toBe('')
    expect(row.validation_status).toBe('')
    expect(row.discrepancy_amount).toBe('')
    expect(row.amount_paid).toBe(0)
  })

  test('a settled share reports the proof behind it', () => {
    const row = buildExportRows(withPayments({ status: 'lunas', payments: [proof()] })).find(
      (r) => r.person_name === 'Budi',
    )!
    expect(row.payment_status).toBe('paid')
    expect(row.proof_of_payment_url).toBe('uid/bukti-1.jpg')
    expect(row.validation_status).toBe('matched')
    // 42760 read against 42760 due.
    expect(row.discrepancy_amount).toBe('0')
  })

  test('a part payment is neither paid nor unpaid', () => {
    // The state the PRD's two-value column could not express, and the reason
    // this one changed. Calling it `unpaid` puts the full amount back into an
    // outstanding total that already has half of it.
    const row = buildExportRows(
      withPayments({ status: 'belum lunas', amount_paid: 10000, payments: [proof({ amount_read: 10000 })] }),
    ).find((r) => r.person_name === 'Budi')!
    expect(row.payment_status).toBe('partial')
  })

  test('a short proof reports the gap against what was due, not against the bill', () => {
    // The whole reason amount_due is stored. On an instalment, subtracting the
    // share total would report a discrepancy for a transfer that was exact.
    const row = buildExportRows(
      withPayments({
        amount_paid: 42760,
        payments: [proof({ amount_read: 30000, amount_due: 30000, verdict: 'mismatch' })],
      }),
    ).find((r) => r.person_name === 'Budi')!
    expect(row.discrepancy_amount).toBe('0')
  })

  test('a proof with no amount read leaves the discrepancy blank, not NaN', () => {
    const row = buildExportRows(
      withPayments({ payments: [proof({ amount_read: null, verdict: 'unclear' })] }),
    ).find((r) => r.person_name === 'Budi')!
    expect(row.discrepancy_amount).toBe('')
    expect(row.validation_status).toBe('unclear')
  })

  test('the newest proof is the one reported', () => {
    const row = buildExportRows(
      withPayments({
        payments: [proof({ image_path: 'old.jpg' }), proof({ image_path: 'new.jpg' })],
      }),
    ).find((r) => r.person_name === 'Budi')!
    expect(row.proof_of_payment_url).toBe('new.jpg')
  })

  /*
   * The trap that makes an export worse than no export: a share-level figure
   * copied onto every one of a person's rows is counted once per item.
   */
  test('amount_paid sums down a person rows to their share paid total', () => {
    const rows = buildExportRows(withPayments({ amount_paid: 10000, payments: [proof()] }))
    const sum = rows.filter((r) => r.person_name === 'Budi').reduce((a, r) => a + r.amount_paid, 0)
    expect(sum).toBe(10000)
  })

  test('a person with several items still has one paid total, not one per item', () => {
    const rows = buildExportRows(withPayments({ amount_paid: 9999 }))
    const budi = rows.filter((r) => r.person_name === 'Budi')
    expect(budi.length).toBeGreaterThan(1)
    expect(budi.reduce((a, r) => a + r.amount_paid, 0)).toBe(9999)
  })

  test('payment_method knows about QRIS', () => {
    const method = (patch: Partial<ExportBill>) =>
      buildExportRows([{ ...bill, ...patch }])[0].payment_method

    expect(method({ qris_path: null, payment_method: 'bank' })).toBe('transfer')
    expect(method({ qris_path: 'q.jpg', payment_method: 'qris' })).toBe('qris')
    expect(method({ qris_path: 'q.jpg', payment_method: 'both' })).toBe('transfer+qris')
    // A method naming a code that was never uploaded offers nothing, and the
    // column says so rather than claiming a QRIS that is not there.
    expect(method({ qris_path: null, payment_method: 'qris' })).toBe('')
  })

  test('the column survives a round trip through the CSV', () => {
    const csv = toCsv(buildExportRows(withPayments({ amount_paid: 10000, payments: [proof()] })))
    const [header, first] = csv.slice(1).split(String.fromCharCode(13, 10))
    expect(header.split(',')).toContain('amount_paid')
    expect(first.split(',')[header.split(',').indexOf('amount_paid')]).toBeTruthy()
  })
})

describe('toCsv', () => {
  test('starts with a BOM so Excel reads it as UTF-8', () => {
    expect(toCsv(buildExportRows([bill])).charCodeAt(0)).toBe(0xfeff)
  })

  test('uses CRLF line endings, which RFC 4180 asks for', () => {
    expect(toCsv(buildExportRows([bill]))).toContain('\r\n')
  })

  test('quotes a value containing a comma instead of splitting the row', () => {
    const rows = buildExportRows([{ ...bill, place: 'Kopi, Teh & Co' }])
    const csv = toCsv(rows)
    expect(csv).toContain('"Kopi, Teh & Co"')
  })
})
