/**
 * Tests for the normalizer.
 *
 * The normalizer was born as the replacement for API-level schema enforcement,
 * because the provider at the time had none. Gemini briefly restored that
 * guarantee and made this a backstop. The app is back on DeepSeek, which has no
 * schema mode — so these tests are once more the only thing standing between a
 * malformed model answer and a wrong amount owed by a real person.
 *
 * The tests that matter most are the ugly ones: a missing field, a number sent
 * as a formatted string, a code fence, a wrong sign. Each of those would
 * otherwise become a plausible looking wrong amount owed by a real person.
 */

import { describe, expect, test } from 'bun:test'
import { normalizeExtraction, stripCodeFence } from './normalize'

/** The Warung Bu Siti example from the spec, in the shape a model would send. */
const clean = {
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
  service_charge: 3300,
  rounding_adjustment: 0,
  total: 75900,
  confidence_notes: null,
}

describe('normalizeExtraction — the happy path', () => {
  test('a clean object passes through unchanged', () => {
    expect(normalizeExtraction(clean)).toEqual(clean as never)
  })
})

describe('number coercion', () => {
  test('reads Indonesian thousands separators in strings', () => {
    const result = normalizeExtraction({ ...clean, total: '75.900', subtotal: '71.000' })
    expect(result.total).toBe(75900)
    expect(result.subtotal).toBe(71000)
  })

  test('accepts a bare numeric string', () => {
    expect(normalizeExtraction({ ...clean, total: '75900' }).total).toBe(75900)
  })

  test('accepts a currency prefix', () => {
    expect(normalizeExtraction({ ...clean, total: 'Rp 75.900' }).total).toBe(75900)
  })

  test('rounds a float, because rupiah has no minor unit', () => {
    const result = normalizeExtraction({ ...clean, total: 75900.4, subtotal: 71000.6 })
    expect(result.total).toBe(75900)
    expect(result.subtotal).toBe(71001)
  })

  test('missing numeric fields become 0 rather than NaN', () => {
    const result = normalizeExtraction({ items: clean.items, total: 75900 })
    expect(result.discount).toBe(0)
    expect(result.tax).toBe(0)
    expect(result.service_charge).toBe(0)
    expect(result.rounding_adjustment).toBe(0)
    expect(result.subtotal).toBeNull()
  })

  test('rejects a field that is not a number at all', () => {
    expect(() => normalizeExtraction({ ...clean, tax: 'entah' })).toThrow(/tax/)
  })
})

describe('nullability', () => {
  test('an empty string counts as absent, not as a value', () => {
    const result = normalizeExtraction({ ...clean, place: '   ', confidence_notes: '' })
    expect(result.place).toBeNull()
    expect(result.confidence_notes).toBeNull()
  })

  test('the literal string "null" counts as absent', () => {
    expect(normalizeExtraction({ ...clean, place: 'null' }).place).toBeNull()
  })

  test('subtotal survives as null, which gate 0 then derives from the items', () => {
    expect(normalizeExtraction({ ...clean, subtotal: null }).subtotal).toBeNull()
  })
})

describe('dates', () => {
  test('keeps a real ISO date', () => {
    expect(normalizeExtraction(clean).date).toBe('2026-09-12')
  })

  test('rejects a date that is not ISO, rather than guessing the format', () => {
    // A wrong date misfiles the bill into the wrong day's reference sequence
    // and the wrong month's report. Null makes the operator type it, which is
    // the cheap failure.
    expect(normalizeExtraction({ ...clean, date: '12/09/2026' }).date).toBeNull()
    expect(normalizeExtraction({ ...clean, date: '26-05-2026 23:29' }).date).toBeNull()
  })

  test('rejects a date that looks ISO but is not a real day', () => {
    expect(normalizeExtraction({ ...clean, date: '2026-02-30' }).date).toBeNull()
    expect(normalizeExtraction({ ...clean, date: '2026-13-01' }).date).toBeNull()
  })

  test('accepts a leap day', () => {
    expect(normalizeExtraction({ ...clean, date: '2028-02-29' }).date).toBe('2028-02-29')
  })
})

describe('items', () => {
  test('an item with no price is rejected rather than defaulted to zero', () => {
    // A zero-price line would silently pull every person's share down, and the
    // items would no longer sum to the subtotal.
    const items = [{ name: 'Nasi Goreng', qty: 1 }]
    expect(() => normalizeExtraction({ ...clean, items })).toThrow(/line_total/)
  })

  test('an item with no name is rejected', () => {
    const items = [{ qty: 1, line_total: 25000 }]
    expect(() => normalizeExtraction({ ...clean, items })).toThrow(/nama/)
  })

  test('qty defaults to 1 and never goes below 1', () => {
    const items = [
      { name: 'A', line_total: 1000 },
      { name: 'B', qty: 0, line_total: 1000 },
      { name: 'C', qty: -3, line_total: 1000 },
    ]
    const result = normalizeExtraction({ ...clean, items })
    expect(result.items.map((i) => i.qty)).toEqual([1, 1, 1])
  })

  test('a missing items key becomes an empty array, so gate 0 can say so clearly', () => {
    expect(normalizeExtraction({ ...clean, items: null }).items).toEqual([])
  })

  test('rejects items that are not an array', () => {
    expect(() => normalizeExtraction({ ...clean, items: 'Nasi Goreng 25.000' })).toThrow(/array/)
  })

  test('coerces prices inside items too', () => {
    const items = [{ name: 'Nasi Goreng', qty: '1', line_total: '25.000' }]
    const result = normalizeExtraction({ ...clean, items })
    expect(result.items[0]).toEqual({ name: 'Nasi Goreng', qty: 1, line_total: 25000 })
  })
})

describe('signs and totals', () => {
  test('a negative discount is flipped, because it means the model misread a sign', () => {
    // Left negative it would still balance gate 1 while charging everyone the
    // wrong amount, which is the worst kind of error: one that reconciles.
    expect(normalizeExtraction({ ...clean, discount: -5000 }).discount).toBe(5000)
  })

  test('a negative service charge is flipped', () => {
    expect(normalizeExtraction({ ...clean, service_charge: -3300 }).service_charge).toBe(3300)
  })

  test('a rounding adjustment keeps its sign, because negative is meaningful', () => {
    expect(normalizeExtraction({ ...clean, rounding_adjustment: -400 }).rounding_adjustment).toBe(-400)
  })

  test('a zero or negative total is rejected outright', () => {
    expect(() => normalizeExtraction({ ...clean, total: 0 })).toThrow(/Total struk/)
    expect(() => normalizeExtraction({ ...clean, total: -100 })).toThrow(/Total struk/)
  })

  test('rejects something that is not an object at all', () => {
    expect(() => normalizeExtraction('hello')).toThrow(/object/)
    expect(() => normalizeExtraction(null)).toThrow(/object/)
    expect(() => normalizeExtraction([1, 2, 3])).toThrow(/object/)
  })
})

describe('stripCodeFence', () => {
  test('unwraps a fenced block', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}')
  })

  test('leaves bare JSON alone', () => {
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}')
  })

  test('does not mangle JSON that merely contains backticks', () => {
    expect(stripCodeFence('{"note":"a `b` c"}')).toBe('{"note":"a `b` c"}')
  })
})

describe('the real receipt shape', () => {
  test('a Lucky Cat style response normalizes and reconciles', () => {
    // The fixture photo: 7 priced lines, so "10 Items" on the receipt is a
    // quantity total, not a line count. The three embedded modifier lines
    // must not appear here.
    const raw = {
      place: 'Lucky Cat Coffee & Kitchen',
      date: '2026-06-26',
      items: [
        { name: 'Long Black', qty: 1, line_total: 35000 },
        { name: 'Ice Caramel Latte', qty: 1, line_total: 45000 },
        { name: 'Lychee Tea', qty: 2, line_total: 80000 },
        { name: 'Peach Tea', qty: 3, line_total: 120000 },
        { name: 'Ice Latte', qty: 1, line_total: 45000 },
        { name: 'Japanese', qty: 1, line_total: 35000 },
        { name: 'Aqua Reflections Natural', qty: 1, line_total: 35000 },
      ],
      subtotal: 395000,
      discount: 0,
      tax: 41475,
      service_charge: 19750,
      rounding_adjustment: 0,
      total: 456225,
      confidence_notes: null,
    }

    const result = normalizeExtraction(raw)

    expect(result.items).toHaveLength(7)
    expect(result.items.reduce((acc, i) => acc + i.line_total, 0)).toBe(result.subtotal!)
    expect(
      result.subtotal! - result.discount + result.tax + result.service_charge + result.rounding_adjustment,
    ).toBe(result.total)
  })
})
