/**
 * The detailed export: one row per item per person.
 *
 * The purpose is a table you can drop into Excel and pivot without cleaning
 * anything first, which sets the hard requirement here — the rows for one
 * person on one bill must add up to exactly what that person owes, to the
 * rupiah. A single lost rupiah turns into a discrepancy somebody has to go and
 * hunt down by hand, which is the work this export exists to remove.
 *
 * That is what `allocate` is for, and why nothing here uses plain division.
 */

/**
 * Split an integer total across weights so the parts are whole numbers that add
 * back up to the total exactly.
 *
 * Largest remainder: give everyone their floor, then hand the leftover rupiah
 * out one at a time to whoever was rounded down hardest, ties broken by
 * position so the result is stable rather than dependent on sort order.
 * Rounding each part independently would be simpler and would lose rupiah.
 *
 * Handles a negative total, which happens for discount shares: the floors are
 * still at or below the exact values, so the leftover is still non-negative and
 * still less than the number of parts.
 */
export function allocate(total: number, weights: number[]): number[] {
  const n = weights.length
  if (n === 0) return []

  const usable = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0))
  const totalWeight = usable.reduce((a, b) => a + b, 0)

  if (totalWeight === 0) {
    // No weight to go on — split as evenly as whole rupiah allows rather than
    // dropping the whole amount on whoever happens to be first.
    const base = Math.floor(total / n)
    const out = new Array<number>(n).fill(base)
    for (let i = 0; i < total - base * n; i++) out[i] += 1
    return out
  }

  const exact = usable.map((w) => (total * w) / totalWeight)
  const out = exact.map((x) => Math.floor(x))
  let leftover = total - out.reduce((a, b) => a + b, 0)

  const byRemainder = exact
    .map((x, i) => ({ i, remainder: x - Math.floor(x) }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i)

  for (let k = 0; k < byRemainder.length && leftover > 0; k++) {
    out[byRemainder[k].i] += 1
    leftover--
  }

  return out
}

/** One bill, with everything the export needs. Shaped to match the database. */
export interface ExportBill {
  ref_code: string
  bill_date: string
  place: string
  /**
   * The printed total, read from the bill rather than summed from the shares.
   *
   * That distinction is the whole point of the reconciliation line on the nota:
   * if this were derived from the same shares it is being checked against, the
   * check would be a tautology and would pass on a bill that does not balance.
   */
  total: number
  bank_name: string | null
  account_number: string | null
  account_holder: string | null
  /** The participant who paid the vendor, or null if nobody was marked. */
  paid_by_person: string | null
  items: {
    name: string
    qty: number
    line_total: number
    assigned_to: string[]
  }[]
  shares: {
    person: string
    /**
     * This person's private link token, for the page where they upload proof.
     *
     * It is read here so the nota screen can hand each person their own link,
     * and it is deliberately NOT written to the PDF. One document goes to the
     * whole group, and a token in it would let anyone mark anyone paid.
     */
    pay_token: string | null
    /** Part of this share already settled by a proof of payment. */
    amount_paid: number
    discount_share: number
    tax_share: number
    service_share: number
    rounding_share: number
    amount_owed: number
    status: string
    paid_date: string | null
  }[]
}

/** A row of the CSV, in the column order the PRD specifies. */
export interface ExportRow {
  ref_code: string
  bill_date: string
  merchant_name: string
  item_name: string
  item_qty: number
  item_unit_price: number
  item_subtotal: number
  person_name: string
  person_share_amount: number
  payment_status: string
  payment_method: string
  bank_name: string
  account_number: string
  recipient_name: string
  paid_at: string
  proof_of_payment_url: string
  validation_status: string
  discrepancy_amount: string
}

export const EXPORT_COLUMNS: (keyof ExportRow)[] = [
  'ref_code',
  'bill_date',
  'merchant_name',
  'item_name',
  'item_qty',
  'item_unit_price',
  'item_subtotal',
  'person_name',
  'person_share_amount',
  'payment_status',
  'payment_method',
  'bank_name',
  'account_number',
  'recipient_name',
  'paid_at',
  'proof_of_payment_url',
  'validation_status',
  'discrepancy_amount',
]

/**
 * Flatten bills into item-per-person rows.
 *
 * Every amount comes from what was committed, never recomputed from the items.
 * Recomputing would look tidier and would be wrong: `amount_owed` is a snapshot
 * that the operator may have corrected by hand on the review screen, and an
 * export that quietly disagrees with the app is worse than no export.
 *
 * So the per-item figures are an *allocation* of the committed numbers, not a
 * recalculation of them. Each person's share of an item is their slice of that
 * item's line total; their tax, service, discount and rounding shares are then
 * spread across their own rows in proportion to those slices. The last rupiah
 * of each is placed by largest remainder, so the column adds up.
 */
export interface BreakdownItem {
  name: string
  qty: number
  /** The item's own total on the bill, repeated on each person who shared it. */
  lineTotal: number
  /** How many people this item was split between, for "(bagi 2)" in a message. */
  shared: number
  /** This person's slice of the item. */
  amount: number
}

export interface PersonBreakdown {
  person: string
  items: BreakdownItem[]
  /**
   * Tax, service, discount and rounding — everything that is not tied to one
   * item — itemised so a message can explain the number rather than just
   * assert it. These always sum to `extra`.
   */
  components: { label: string; amount: number }[]
  /**
   * The same amount as the sum of `components`, derived from `amount_owed`.
   * Discount may push this negative.
   */
  extra: number
  total: number
  status: string
  /**
   * What has already landed against this share.
   *
   * On the document because a nota is re-sent as often as it is first sent,
   * and one that still demands the full amount from somebody who has paid half
   * is worse than no document at all.
   */
  amount_paid: number
  /**
   * True for the one person who settled with the vendor.
   *
   * They are in the split because they ate and the shares have to sum to the
   * bill, but their share is not a debt. The document says so, rather than
   * showing them as having paid for no stated reason.
   */
  is_payer: boolean
  paid_date: string | null
}

/**
 * Work out, per person, their slice of every item and of everything that is
 * not an item.
 *
 * The single source of truth behind both the CSV export and the WhatsApp
 * message. They have to agree — a message that disagrees with the spreadsheet
 * is worse than having only one of them — and sharing this function is what
 * guarantees that, rather than two implementations that happen to stay in step
 * until one of them is edited.
 */
export function allocateBill(bill: ExportBill): PersonBreakdown[] {
  const shares = new Map(bill.shares.map((s) => [s.person, s]))

  // item index -> each person's slice, and the running raw total per person
  const perItem: { index: number; total: number; shared: number; shares: Map<string, number> }[] = []
  const rawByPerson = new Map<string, number>()

  for (const [index, item] of bill.items.entries()) {
    // A bill committed through commit_bill() cannot have an unassigned item —
    // gate 3 rejects it — but a defensively skipped line is better than a
    // crash on data that predates the gate.
    const people = item.assigned_to.filter((p) => shares.has(p))
    if (people.length === 0) continue

    const parts = allocate(
      item.line_total,
      people.map(() => 1),
    )
    const byPerson = new Map<string, number>()
    people.forEach((person, i) => {
      byPerson.set(person, parts[i])
      rawByPerson.set(person, (rawByPerson.get(person) ?? 0) + parts[i])
    })
    perItem.push({ index, total: item.line_total, shared: people.length, shares: byPerson })
  }

  const result: PersonBreakdown[] = []

  for (const [person, share] of shares) {
    const own = perItem.filter((it) => it.shares.has(person))
    if (own.length === 0) continue

    // The extra is derived from `amount_owed` rather than rebuilt from
    // discount/tax/service/rounding. Those components are each rounded
    // independently when the split is computed, so rebuilding the total from
    // them can land a rupiah away from what was committed — and `amount_owed`
    // is what appears in the app, on the bill, and in the outstanding total.
    // Taking it as the source of truth makes the column tie out by
    // construction instead of by arithmetic that has to agree.
    const extra =
      share.amount_owed - (rawByPerson.get(person) ?? 0)

    const components: { label: string; amount: number }[] = []
    if (share.discount_share) components.push({ label: 'Diskon', amount: -share.discount_share })
    if (share.tax_share) components.push({ label: 'PPN', amount: share.tax_share })
    if (share.service_share) components.push({ label: 'Service', amount: share.service_share })
    if (share.rounding_share) {
      components.push({ label: 'Pembulatan', amount: share.rounding_share })
    }

    // The four components are each rounded independently when the split is
    // computed, so their sum can sit a rupiah or two away from the difference
    // above. Naming that residue rather than hiding it keeps the itemised lines
    // adding up to the total on screen — which is the entire point of printing
    // them — and the alternative would be a message where the arithmetic
    // visibly does not work.
    const componentSum = components.reduce((acc, c) => acc + c.amount, 0)
    if (extra - componentSum !== 0) {
      components.push({ label: 'Penyesuaian', amount: extra - componentSum })
    }

    result.push({
      person,
      items: own.map((it) => ({
        name: bill.items[it.index].name,
        qty: bill.items[it.index].qty,
        lineTotal: it.total,
        shared: it.shared,
        amount: it.shares.get(person)!,
      })),
      components,
      extra,
      total: share.amount_owed,
      status: share.status,
      amount_paid: share.amount_paid,
      is_payer: bill.paid_by_person === person,
      paid_date: share.paid_date,
    })
  }

  return result
}

export function buildExportRows(bills: ExportBill[]): ExportRow[] {
  const rows: ExportRow[] = []

  for (const bill of bills) {
    for (const person of allocateBill(bill)) {
      // The charges that are not tied to an item are spread across this
      // person's own rows in proportion to how much of the bill they took, so
      // that summing their rows gives their total rather than landing a rupiah
      // short of it.
      const extras = allocate(
        person.extra,
        person.items.map((i) => i.amount),
      )

      person.items.forEach((item, i) => {
        rows.push({
          ref_code: bill.ref_code,
          bill_date: bill.bill_date,
          merchant_name: bill.place,
          item_name: item.name,
          item_qty: item.qty,
          item_unit_price:
            item.qty > 0 ? Math.round(item.lineTotal / item.qty) : item.lineTotal,
          // The item's own total on the bill, not this person's slice of it.
          item_subtotal: item.lineTotal,
          person_name: person.person,
          // This person's slice, carrying their share of everything that is not
          // tied to an item. Summed down a person's rows this equals amount_owed.
          person_share_amount: item.amount + extras[i],
          payment_status: person.status === 'lunas' ? 'paid' : 'unpaid',
          payment_method: bill.account_number ? 'transfer' : '',
          bank_name: bill.bank_name ?? '',
          account_number: bill.account_number ?? '',
          recipient_name: bill.account_holder ?? '',
          paid_at: person.paid_date ?? '',
          // Not built yet. Present because the column set is what the PRD asks
          // for and what an existing spreadsheet will be pointed at; empty
          // because there is nothing honest to put here until the payment link
          // feature exists.
          proof_of_payment_url: '',
          validation_status: '',
          discrepancy_amount: '',
        })
      })
    }
  }

  return rows
}

/**
 * RFC 4180 quoting, plus a BOM.
 *
 * The BOM is not decoration: Excel on Windows reads a CSV without one as the
 * system codepage, so any non-ASCII name arrives as mojibake, and Indonesian
 * names and menu items hit that immediately.
 */
export function toCsv(rows: ExportRow[]): string {
  const escape = (value: unknown): string => {
    const s = value === null || value === undefined ? '' : String(value)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const header = EXPORT_COLUMNS.join(',')
  const body = rows.map((row) => EXPORT_COLUMNS.map((c) => escape(row[c])).join(','))

  return '﻿' + [header, ...body].join('\r\n') + '\r\n'
}
