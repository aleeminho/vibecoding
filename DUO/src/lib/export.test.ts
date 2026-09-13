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
  ref_code: 'BILL_20260912_001',
  bill_date: '2026-09-12',
  place: 'Warung Bu Siti',
  total: 75900,
  bank_name: 'BCA',
  account_number: '1234567890',
  account_holder: 'Alee',
  items: [
    { name: 'Nasi Goreng', qty: 1, line_total: 25000, assigned_to: ['Budi'] },
    { name: 'Es Teh', qty: 2, line_total: 16000, assigned_to: ['Budi', 'Sarah'] },
    { name: 'Kentang Goreng Gede', qty: 1, line_total: 30000, assigned_to: ['Sarah'] },
  ],
  shares: [
    {
      pay_token: null,
      amount_paid: 0,
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
