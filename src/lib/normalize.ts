/**
 * Turn whatever the model returned into a trustworthy `Extraction`.
 *
 * This module was born when the app first ran on DeepSeek, which had no schema
 * enforcement at all: the prompt described the shape and the model was asked
 * nicely. Gemini came next and did enforce a schema at the API level, which
 * briefly made this a backstop. The app is now on DeepSeek again, which has no
 * such mode — so this is once more the ONLY structural defence between the
 * model's answer and the database.
 *
 * That is a promotion, not a formality. The unit tests below are no longer
 * reassurance about a path that mostly cannot be reached; they are the thing
 * standing between a malformed answer and a wrong bill.
 *
 * It is not the same job as the gates in split.ts. The gates check whether the
 * receipt's numbers make sense. This checks whether the object is even shaped
 * like an extraction — whether `tax` is a number rather than undefined, whether
 * `items` is an array rather than a string. Without it, a missing field becomes
 * `NaN` two steps later and surfaces as a nonsense amount owed.
 *
 * Coercion is permissive on inputs that are merely formatted differently, and
 * strict about rejecting anything that cannot be read at all:
 *
 *   "25.000"  -> 25000     (Indonesian thousands separator, never a decimal)
 *   "25000"   -> 25000
 *   "Rp 25.000" -> 25000
 *   25000.4   -> 25000     (rounded; rupiah has no minor unit)
 *   "abc"     -> rejected
 */

import { parseRupiah } from './format'
import type { Extraction, ExtractedItem } from './types'

/**
 * Coerce one money field.
 *
 * Numbers arriving as actual JS numbers are rounded rather than re-parsed: a
 * bare `25000.4` is a float the model produced, not an Indonesian thousands
 * separator. Strings go through parseRupiah, where a period IS a separator,
 * because that is what a period means on an Indonesian receipt.
 */
function money(value: unknown, field: string): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Field "${field}" bukan angka yang valid: ${value}`)
    }
    return Math.round(value)
  }
  if (typeof value === 'string') {
    const parsed = parseRupiah(value)
    if (parsed === null) {
      throw new Error(`Field "${field}" nggak bisa dibaca sebagai angka: ${JSON.stringify(value)}`)
    }
    return parsed
  }
  throw new Error(`Field "${field}" tipenya ${typeof value}, harusnya angka`)
}

/** Like money(), but null is a meaningful value rather than a zero. */
function moneyOrNull(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === '') return null
  return money(value, field)
}

/** Trim a string, and treat an empty or placeholder string as absent. */
function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.toLowerCase() === 'null') return null
  return trimmed
}

/**
 * Accept only a real ISO date.
 *
 * A wrong date is not cosmetic: it selects which day's reference sequence the
 * bill joins, and which month's report it lands in. Anything unparseable
 * becomes null, which gate 0 turns into a prompt for the operator to type it,
 * rather than silently filing the bill under the wrong day.
 */
function isoDateOrNull(value: unknown): string | null {
  const text = textOrNull(value)
  if (!text) return null

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) return null

  const [, year, month, day] = match.map(Number) as unknown as [string, number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day

  return roundTrips ? text : null
}

function normalizeItems(value: unknown): ExtractedItem[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) {
    throw new Error(`Field "items" harusnya array, dapatnya ${typeof value}`)
  }

  const items: ExtractedItem[] = []

  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`Item ke-${index + 1} bukan object`)
    }

    const item = entry as Record<string, unknown>
    const name = textOrNull(item.name)
    if (!name) {
      throw new Error(`Item ke-${index + 1} nggak punya nama`)
    }

    // A line with no readable price is more dangerous than a missing line: it
    // would silently make the items sum short of the subtotal and every share
    // wrong. Better to reject and let the operator enter it by hand.
    if (item.line_total === null || item.line_total === undefined) {
      throw new Error(`Item "${name}" nggak punya line_total`)
    }

    items.push({
      name,
      qty: Math.max(1, Math.round(money(item.qty ?? 1, `${name}.qty`))),
      line_total: money(item.line_total, `${name}.line_total`),
    })
  }

  return items
}

/**
 * @throws if the object cannot be read as an extraction at all. The caller
 *   should surface the message rather than proceeding, because everything
 *   downstream assumes this shape.
 */
export function normalizeExtraction(raw: unknown): Extraction {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Output model bukan object JSON')
  }

  const o = raw as Record<string, unknown>

  const extraction: Extraction = {
    place: textOrNull(o.place),
    date: isoDateOrNull(o.date),
    items: normalizeItems(o.items),
    subtotal: moneyOrNull(o.subtotal, 'subtotal'),
    discount: money(o.discount, 'discount'),
    tax: money(o.tax, 'tax'),
    service_charge: money(o.service_charge, 'service_charge'),
    rounding_adjustment: money(o.rounding_adjustment, 'rounding_adjustment'),
    total: money(o.total, 'total'),
    confidence_notes: textOrNull(o.confidence_notes),
  }

  // A negative discount or service charge would flip the arithmetic in a way
  // that still balances, so it would pass gate 1 while charging people the
  // wrong amount. Negative means the model misread a sign.
  if (extraction.discount < 0) extraction.discount = -extraction.discount
  if (extraction.service_charge < 0) extraction.service_charge = -extraction.service_charge

  if (extraction.total <= 0) {
    throw new Error('Total struk kebaca 0 atau negatif — cek fotonya.')
  }

  return extraction
}

/**
 * Strip a markdown code fence if the model wrapped its JSON in one.
 *
 * DeepSeek's `json_object` mode guarantees valid JSON but says nothing about
 * whether the model wrapped it in a fence anyway — that mode constrains the
 * content of the answer, not the model's habit of annotating it. A fence costs
 * nothing to tolerate and a failed parse costs a whole capture. Only the
 * outermost fence is removed.
 */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i.exec(trimmed)
  return fenced ? fenced[1].trim() : trimmed
}
