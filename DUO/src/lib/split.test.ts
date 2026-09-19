/**
 * Tests for the split core, built around the worked example in
 * split_bill_app_spec.md section 6 and the gates in section 9.
 *
 * The worked example is the most valuable test in this repo: it is the one
 * case where the spec states the expected answer explicitly (Budi 42760,
 * Sarah 33140, summing to the printed total of 75900), and it is the case that
 * a draft of the spec got wrong by omitting the discount entirely.
 */

import { describe, expect, test } from 'bun:test'
import { checkGate1, checkGate2, checkGate3, checkGates, computeSplit } from './split'
import type { AssignedItem, Extraction } from './types'

/** The receipt from the spec appendix: Warung Bu Siti, 12/09/2026. */
const receipt: Extraction = {
  place: 'Warung Bu Siti',
  date: '2026-09-12',
  items: [
    { name: 'Nasi Goreng', qty: 1, line_total: 25000 },
    { name: 'Es Teh', qty: 2, line_total: 16000 },
    { name: 'Kentang Goreng Gede', qty: 1, line_total: 30000 },
  ],
  subtotal: 71000,
  discount: 5000,
  tax: 6600,
  tax_inclusive: false,
  service_charge: 3300,
  rounding_adjustment: 0,
  total: 75900,
  confidence_notes: null,
}

const assignedItems: AssignedItem[] = [
  { position: 1, name: 'Nasi Goreng', qty: 1, line_total: 25000, assigned_to: ['Budi'] },
  { position: 2, name: 'Es Teh', qty: 2, line_total: 16000, assigned_to: ['Sarah'] },
  {
    position: 3,
    name: 'Kentang Goreng Gede',
    qty: 1,
    line_total: 30000,
    assigned_to: ['Budi', 'Sarah'],
  },
]

const roster = ['Budi', 'Sarah']

describe('computeSplit — the worked example', () => {
  const result = computeSplit(
    assignedItems,
    receipt.subtotal!,
    receipt.discount,
    receipt.tax,
    receipt.service_charge,
    receipt.total,
    roster,
  )

  const byName = (p: string) => result.participants.find((x) => x.person === p)!

  test('Budi owes 42760', () => {
    expect(byName('Budi')).toEqual({
      person: 'Budi',
      item_subtotal: 40000,
      discount_share: 2817,
      tax_share: 3718,
      service_share: 1859,
      amount_owed: 42760,
      rounding_share: 0,
    })
  })

  test('Sarah owes 33140', () => {
    expect(byName('Sarah')).toEqual({
      person: 'Sarah',
      item_subtotal: 31000,
      discount_share: 2183,
      tax_share: 2882,
      service_share: 1441,
      amount_owed: 33140,
      rounding_share: 0,
    })
  })

  test('shares sum to the printed total exactly, with no residual', () => {
    const sum = result.participants.reduce((acc, p) => acc + p.amount_owed, 0)
    expect(sum).toBe(75900)
    expect(sum).toBe(receipt.total)
    expect(result.residual).toBe(0)
    expect(result.residual_applied_to).toBeNull()
  })

  test('regression: omitting the discount would overcharge by exactly 5000', () => {
    // This is the bug the spec appendix preserves. If discount_share ever
    // disappears from the formula again, this test shows what it costs.
    const sumWithoutDiscount = result.participants.reduce(
      (acc, p) => acc + p.item_subtotal + p.tax_share + p.service_share,
      0,
    )
    expect(sumWithoutDiscount).toBe(80900)
    expect(sumWithoutDiscount - receipt.total!).toBe(receipt.discount)
  })

  test('each person\'s rounded components rebuild their amount_owed', () => {
    // The rounding rule rounds components, not just the final total, so every
    // number is self-consistent when a human checks it by hand.
    for (const p of result.participants) {
      expect(p.item_subtotal - p.discount_share + p.tax_share + p.service_share).toBe(
        p.amount_owed,
      )
    }
  })
})

describe('computeSplit — rounding and reconciliation', () => {
  test('an indivisible split puts the residual on one person, not on everyone', () => {
    const items: AssignedItem[] = [
      {
        position: 1,
        name: 'Shared Platter',
        qty: 1,
        line_total: 10000,
        assigned_to: ['A', 'B', 'C'],
      },
    ]

    const result = computeSplit(items, 10000, 0, 0, 0, 10000, ['A', 'B', 'C'])

    // 10000 / 3 = 3333.33 each, which rounds to 9999 across the three.
    expect(result.residual).toBe(1)
    expect(result.residual_applied_to).toBe('A') // tie broken by roster order

    const sum = result.participants.reduce((acc, p) => acc + p.amount_owed, 0)
    expect(sum).toBe(10000)
  })

  test('a tie for highest is broken by roster order, deterministically', () => {
    const items: AssignedItem[] = [
      { position: 1, name: 'X', qty: 1, line_total: 5000, assigned_to: ['A', 'B'] },
    ]
    // 5000 / 2 = 2500 each, no rounding needed, so force a residual via total.
    const result = computeSplit(items, 5000, 0, 0, 0, 5001, ['A', 'B'])
    expect(result.residual).toBe(1)
    expect(result.residual_applied_to).toBe('A')
  })

  test('absorbs a gap rounding can explain, and refuses one it cannot', () => {
    const items: AssignedItem[] = [
      { position: 1, name: 'X', qty: 1, line_total: 5000, assigned_to: ['A', 'B'] },
    ]

    // 2 rupiah across 2 people is within what rounding can explain, so it is
    // absorbed by the highest share (a tie, broken by roster order).
    const absorbed = computeSplit(items, 5000, 0, 0, 0, 4998, ['A', 'B'])
    expect(absorbed.residual).toBe(-2)
    expect(absorbed.residual_applied_to).toBe('A')
    expect(absorbed.participants.reduce((a, p) => a + p.amount_owed, 0)).toBe(4998)

    // 5 rupiah across 2 people is not. Silently unloading that on one person
    // is exactly the failure mode this bound exists to prevent.
    expect(() => computeSplit(items, 5000, 0, 0, 0, 4995, ['A', 'B'])).toThrow(/gate 4/)
  })

  test('rejects a zero subtotal instead of dividing by zero', () => {
    const items: AssignedItem[] = [
      { position: 1, name: 'X', qty: 1, line_total: 0, assigned_to: ['A'] },
    ]
    expect(() => computeSplit(items, 0, 0, 0, 0, 0, ['A'])).toThrow(/subtotal must be positive/)
  })
})

describe('gate 1 — receipt arithmetic', () => {
  test('passes on the worked example', () => {
    expect(checkGate1(receipt)).toEqual([])
  })

  test('catches a misread digit', () => {
    const failures = checkGate1({ ...receipt, total: 79500 })
    expect(failures).toHaveLength(1)
    expect(failures[0].gate).toBe(1)
  })

  test('does not flag a rounding line that makes the receipt balance', () => {
    // 71000 - 5000 + 6600 + 3300 - 400 = 75500, so the arithmetic holds.
    const withRounding: Extraction = {
      ...receipt,
      rounding_adjustment: -400,
      total: 75500,
    }
    expect(checkGate1(withRounding)).toEqual([])
  })
})

/**
 * The Guardian slip that forced the second convention: total 59.000 with the
 * VAT 5.847 already inside it, broken out underneath as Purchase 53.153 and
 * VAT Amount 5.847. Same numbers test-extract.ts asserts against a live scan.
 */
const guardian: Extraction = {
  place: 'GUARD WTC 2',
  date: null,
  items: [
    { name: 'FRESHCARESMASHMATCHA', qty: 2, line_total: 37000 },
    { name: 'SALONPAS EXTRAHOT10S', qty: 2, line_total: 22000 },
  ],
  subtotal: 59000,
  discount: 0,
  tax: 5847,
  tax_inclusive: true,
  service_charge: 0,
  rounding_adjustment: 0,
  total: 59000,
  confidence_notes: null,
}

describe('tax-inclusive receipts', () => {
  test('gate 1 drops the tax from the identity when it is already inside', () => {
    expect(checkGate1(guardian)).toEqual([])
  })

  test('the same numbers flagged exclusive name the switch that fixes them', () => {
    const failures = checkGate1({ ...guardian, tax_inclusive: false })
    expect(failures).toHaveLength(1)
    expect(failures[0].message).toContain('PPN sudah termasuk')
  })

  test('a share reports the contained VAT without adding it to what is owed', () => {
    const items: AssignedItem[] = guardian.items.map((item, i) => ({
      ...item,
      position: i + 1,
      assigned_to: ['A'],
    }))
    const split = computeSplit(
      items,
      guardian.subtotal!,
      guardian.discount,
      guardian.tax,
      guardian.service_charge,
      guardian.total,
      ['A'],
      0,
      guardian.tax_inclusive,
    )
    expect(split.participants[0].amount_owed).toBe(59000)
    expect(split.participants[0].tax_share).toBe(5847)
  })
})

describe('gate 2 — item coverage', () => {
  test('passes on the worked example', () => {
    expect(checkGate2(assignedItems, 71000)).toEqual([])
  })

  test('catches a dropped line item', () => {
    const dropped = assignedItems.slice(0, 2) // Kentang Goreng Gede missing
    const failures = checkGate2(dropped, 71000)
    expect(failures).toHaveLength(1)
    expect(failures[0].gate).toBe(2)
    expect(failures[0].message).toContain('41000')
  })

  test('catches a line read as unit price instead of line total', () => {
    // "2x Es Teh 16.000" read as 8000 would leave the items short by 8000.
    const misread = assignedItems.map((i) =>
      i.position === 2 ? { ...i, line_total: 8000 } : i,
    )
    expect(checkGate2(misread, 71000)).toHaveLength(1)
  })

  test('catches a duplicated line item', () => {
    const duplicated = [...assignedItems, { ...assignedItems[0], position: 4 }]
    expect(checkGate2(duplicated, 71000)).toHaveLength(1)
  })
})

describe('gate 3 — assignment coverage', () => {
  test('passes on the worked example', () => {
    expect(checkGate3(assignedItems, roster)).toEqual([])
  })

  test('catches an unassigned item', () => {
    const unassigned = assignedItems.map((i) =>
      i.position === 3 ? { ...i, assigned_to: [] } : i,
    )
    const failures = checkGate3(unassigned, roster)
    expect(failures).toHaveLength(1)
    expect(failures[0].message).toContain('Kentang Goreng Gede')
  })

  test('catches a roster entry with no items', () => {
    const failures = checkGate3(assignedItems, ['Budi', 'Sarah', 'Andi'])
    expect(failures).toHaveLength(1)
    expect(failures[0].message).toContain('Andi')
  })

  test('marks an unassigned item as pending, but not a stray roster entry', () => {
    // The distinction drives the whole commit bar. An unassigned item is work
    // not yet done — the screen shows it and the button says what to do about
    // it. A person with no items is a state with no row of its own, so that one
    // has to be said out loud or it is invisible everywhere.
    const unassigned = assignedItems.map((i) =>
      i.position === 3 ? { ...i, assigned_to: [] } : i,
    )
    expect(checkGate3(unassigned, roster)[0].pending).toBe(true)

    const stray = checkGate3(assignedItems, ['Budi', 'Sarah', 'Andi'])
    expect(stray[0].pending).toBeUndefined()
  })
})

describe('gate 0 — pending vs wrong', () => {
  test('an empty roster is pending, not an error', () => {
    // Nothing is wrong; the operator has simply not added anyone yet.
    const report = checkGates(receipt, assignedItems, [])
    const rosterFailure = report.failures.find((f) => f.message.includes('Daftar orang'))
    expect(rosterFailure?.pending).toBe(true)
  })

  test('an unreadable date is NOT pending — it is a real problem', () => {
    const report = checkGates({ ...receipt, date: null }, assignedItems, roster)
    const dateFailure = report.failures.find((f) => f.message.includes('Tanggal'))
    expect(dateFailure?.pending).toBeUndefined()
  })
})

describe('checkGates — gate 0', () => {
  test('passes end to end on the worked example', () => {
    expect(checkGates(receipt, assignedItems, roster)).toEqual({ passed: true, failures: [] })
  })

  test('requires a date rather than silently defaulting to today', () => {
    const report = checkGates({ ...receipt, date: null }, assignedItems, roster)
    expect(report.passed).toBe(false)
    expect(report.failures.some((f) => f.gate === 0 && f.message.includes('Tanggal'))).toBe(true)
  })

  test('requires a place', () => {
    const report = checkGates({ ...receipt, place: null }, assignedItems, roster)
    expect(report.failures.some((f) => f.gate === 0 && f.message.includes('tempat'))).toBe(true)
  })

  test('derives subtotal from the items when the receipt does not print one', () => {
    // subtotal is null but the items are complete, so gate 2 must not fire.
    const report = checkGates({ ...receipt, subtotal: null }, assignedItems, roster)
    expect(report.failures.some((f) => f.gate === 2)).toBe(false)
  })
})

/**
 * The rounding rule: round each share to a round number of rupiah, and put the
 * difference on one person rather than spreading it back (which would undo the
 * rounding it just applied).
 *
 * 100.000 split three ways is the case this exists for: it produces 33.333,
 * which is a real number to owe and an absurd one to ask a friend to transfer.
 */
describe('rounding', () => {
  const threeWays: AssignedItem[] = [
    { position: 1, name: 'Sepiring', qty: 1, line_total: 100000, assigned_to: ['A', 'B', 'C'] },
  ]
  const people = ['A', 'B', 'C']

  const split = (rounding: 0 | 100 | 500) =>
    computeSplit(threeWays, 100000, 0, 0, 0, 100000, people, rounding)

  test('is off by default, so nothing moves unless it was asked for', () => {
    const result = split(0)
    expect(result.participants.every((p) => p.rounding_share === 0)).toBe(true)
    // 33333 x 3 is 99999, so one person carries the odd rupiah.
    expect(result.participants.map((p) => p.amount_owed).sort()).toEqual([33333, 33333, 33334])
  })

  test('to 500 makes every share a multiple of 500', () => {
    const result = split(500)
    for (const p of result.participants) {
      expect(p.amount_owed % 500).toBe(0)
    }
  })

  test('to 100 makes every share a multiple of 100', () => {
    const result = split(100)
    for (const p of result.participants) {
      expect(p.amount_owed % 100).toBe(0)
    }
  })

  // The invariant the whole feature rests on. Rounding may move money between
  // people, but it may not invent or destroy any, and gate 4 would reject the
  // commit server side if this were ever violated.
  test('the shares still add up to the printed total', () => {
    for (const mode of [100, 500] as const) {
      const result = split(mode)
      const sum = result.participants.reduce((acc, p) => acc + p.amount_owed, 0)
      expect(sum).toBe(100000)
    }
  })

  // If this ever fails, the rounding is quietly changing the bill rather than
  // redistributing it, which is the one thing it must never do.
  test('the rounding shifts cancel out across the group', () => {
    for (const mode of [100, 500] as const) {
      const result = split(mode)
      const netShift = result.participants.reduce((acc, p) => acc + (p.rounding_share ?? 0), 0)
      expect(netShift).toBe(0)
    }
  })

  test('the shift is recorded against the person who absorbed it, not hidden', () => {
    const result = split(500)
    const moved = result.participants.filter((p) => p.rounding_share !== 0)
    expect(moved.length).toBeGreaterThan(0)

    // Everyone's shift is at most half a step, because that is all rounding to
    // the nearest 500 can move them. One person carries more than that, and
    // that extra is the drift plain rounding left behind, deliberately placed
    // rather than spread back (which would undo the rounding).
    const shifts = result.participants.map((p) => Math.abs(p.rounding_share ?? 0))
    expect(Math.max(...shifts)).toBeGreaterThan(250)
    expect(shifts.filter((s) => s <= 250).length).toBe(result.participants.length - 1)
  })

  // The residual bound exists to catch a receipt whose numbers do not
  // reconcile. Rounding had to be applied after that check, not inside it, or
  // the bound would have had to be widened and the check would have stopped
  // catching anything.
  test('rounding does not blunt the check for genuinely broken numbers', () => {
    expect(() => computeSplit(threeWays, 100000, 0, 0, 0, 900000, people, 500)).toThrow(
      /gate 4 failed/,
    )
  })
})
