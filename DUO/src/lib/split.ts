/**
 * Split calculation and the validation gates.
 * Implements split_bill_app_spec.md sections 6 (split logic) and 9 (gates).
 *
 * This is the deterministic core of the app. It has no dependency on Supabase,
 * on the browser, or on any network call, which is why it is the first thing
 * written and the first thing tested.
 */

import type {
  AssignedItem,
  Extraction,
  GateFailure,
  GateReport,
  ParticipantShare,
  RoundingMode,
  SplitResult,
} from './types'

/** Gate 1 tolerates a single rupiah of float noise and nothing more. */
const GATE1_TOLERANCE = 1

/**
 * Per person share of each item: an item assigned to N people contributes
 * line_total / N to each of them. Shared items are split evenly because there
 * is no reliable way to know who ate how much of a shared plate (section 6).
 */
function accumulateItemSubtotals(items: AssignedItem[]): Map<string, number> {
  const totals = new Map<string, number>()

  for (const item of items) {
    if (item.assigned_to.length === 0) {
      throw new Error(`item "${item.name}" has no assignee; gate 3 should have caught this`)
    }
    const share = item.line_total / item.assigned_to.length
    for (const person of item.assigned_to) {
      totals.set(person, (totals.get(person) ?? 0) + share)
    }
  }

  return totals
}

/**
 * Compute what each person owes (section 6).
 *
 * @param roster Person order, used only to break ties when absorbing the
 *   rounding residual. Pass the operator's roster so the outcome is stable and
 *   explainable rather than dependent on map iteration order. Any person found
 *   in the items but missing from the roster is appended in first-appearance
 *   order so a forgotten roster entry cannot silently drop someone.
 */
export function computeSplit(
  items: AssignedItem[],
  subtotal: number,
  discount: number,
  tax: number,
  serviceCharge: number,
  total: number,
  roster: string[] = [],
  rounding: RoundingMode = 0,
): SplitResult {
  if (subtotal <= 0) {
    throw new Error('subtotal must be positive; cannot allocate shares against zero')
  }

  const itemSubtotals = accumulateItemSubtotals(items)

  const order = [...roster.filter((p) => itemSubtotals.has(p))]
  for (const person of itemSubtotals.keys()) {
    if (!order.includes(person)) order.push(person)
  }

  // Round each component to whole rupiah (rounding rule, step 2), then rebuild
  // amount_owed from the rounded values. Rebuilding rather than rounding a
  // separate final value is deliberate: every number shown to a human then adds
  // up on its own when checked by hand.
  const participants: ParticipantShare[] = order.map((person) => {
    const exactItemSubtotal = itemSubtotals.get(person)!
    const fraction = exactItemSubtotal / subtotal

    const item_subtotal = Math.round(exactItemSubtotal)
    const discount_share = Math.round(discount * fraction)
    const tax_share = Math.round(tax * fraction)
    const service_share = Math.round(serviceCharge * fraction)

    return {
      person,
      item_subtotal,
      discount_share,
      tax_share,
      service_share,
      amount_owed: item_subtotal - discount_share + tax_share + service_share,
      rounding_share: 0,
    }
  })

  // Reconciliation (rounding rule, step 3). The person with the highest
  // amount_owed absorbs the difference, ties broken by roster order so the
  // choice is deterministic rather than case by case.
  const sum = participants.reduce((acc, p) => acc + p.amount_owed, 0)
  const residual = total - sum
  let residual_applied_to: string | null = null

  // The residual exists to absorb rounding, nothing more. With four components
  // each rounded to the nearest rupiah, one person's share can be at most 2
  // rupiah away from its exact value, so the total drift cannot exceed
  // 2 * n. A larger gap means the inputs do not reconcile at all.
  //
  // Without this bound the gate 4 assertion below would be unreachable: the
  // residual would happily absorb a wildly wrong total and silently unload it
  // onto whoever owes the most, which is exactly the class of silent failure
  // this spec exists to prevent.
  const maxResidual = 2 * participants.length
  if (Math.abs(residual) > maxResidual) {
    throw new Error(
      `gate 4 failed: shares sum to ${sum}, bill total is ${total}. The ${residual} rupiah gap is larger than rounding can explain (max ${maxResidual}), so the numbers do not reconcile. Check the receipt totals against the items.`,
    )
  }

  if (residual !== 0 && participants.length > 0) {
    let highest = 0
    for (let i = 1; i < participants.length; i++) {
      if (participants[i].amount_owed > participants[highest].amount_owed) highest = i
    }
    participants[highest].amount_owed += residual
    residual_applied_to = participants[highest].person
  }

  // Gate 4, step 4: assert, do not tolerate. A failure here is a bug in this
  // file, not a data problem.
  const finalSum = participants.reduce((acc, p) => acc + p.amount_owed, 0)
  if (finalSum !== total) {
    throw new Error(
      `gate 4 failed: shares sum to ${finalSum}, bill total is ${total}. This is a bug in computeSplit.`,
    )
  }

  /*
   * Optional rounding to a round number of rupiah.
   *
   * Applied AFTER the reconciliation above rather than folded into it, and that
   * ordering is the whole point. The residual bound a few lines up exists to
   * catch inputs that do not reconcile at all, and it is only meaningful while
   * the only thing being absorbed is sub-rupiah float noise. Rounding to 500
   * moves up to 250 rupiah per person by design, so folding it in would force
   * that bound open and quietly disable the check that catches a misread
   * receipt.
   *
   * The difference the rounding introduces is not spread back across everyone —
   * that would undo the rounding it just applied. It lands on one person, and
   * is recorded per person in `rounding_share` so the books still add up and
   * the shift is visible rather than buried in someone's total.
   */
  if (rounding > 0) {
    const before = participants.map((p) => p.amount_owed)

    for (const p of participants) {
      p.amount_owed = Math.round(p.amount_owed / rounding) * rounding
    }

    const drift = total - participants.reduce((acc, p) => acc + p.amount_owed, 0)

    if (drift !== 0 && participants.length > 0) {
      let highest = 0
      for (let i = 1; i < participants.length; i++) {
        if (participants[i].amount_owed > participants[highest].amount_owed) highest = i
      }
      participants[highest].amount_owed += drift
    }

    participants.forEach((p, i) => {
      p.rounding_share = p.amount_owed - before[i]
    })

    const roundedSum = participants.reduce((acc, p) => acc + p.amount_owed, 0)
    if (roundedSum !== total) {
      throw new Error(
        `gate 4 failed after rounding: shares sum to ${roundedSum}, bill total is ${total}. This is a bug in computeSplit.`,
      )
    }
  }

  return { participants, residual, residual_applied_to }
}

/**
 * Gate 1: the receipt's own arithmetic.
 *
 * Because rounding_adjustment is captured as its own field, a correct
 * extraction always balances exactly, so this is not a tolerance problem.
 * Anything beyond one rupiah means a digit was misread (section 9).
 */
export function checkGate1(e: Extraction): GateFailure[] {
  const failures: GateFailure[] = []
  const subtotal = e.subtotal ?? 0
  const lhs =
    subtotal - e.discount + e.tax + e.service_charge + e.rounding_adjustment
  const diff = Math.abs(lhs - e.total)

  if (diff > GATE1_TOLERANCE) {
    failures.push({
      gate: 1,
      message: `Struk tidak balance: ${subtotal} - ${e.discount} + ${e.tax} + ${e.service_charge} + ${e.rounding_adjustment} = ${lhs}, tapi total tercetak ${e.total} (selisih ${diff}). Cek angkanya sama foto.`,
    })
  }

  return failures
}

/**
 * Gate 2: item coverage.
 *
 * Catches a dropped line, a duplicated line, and the unit price versus line
 * total misreading. All three leave the receipt's own totals consistent, so
 * gate 1 cannot see them (section 9).
 */
export function checkGate2(items: AssignedItem[], subtotal: number): GateFailure[] {
  const failures: GateFailure[] = []
  const sum = items.reduce((acc, item) => acc + item.line_total, 0)

  if (sum !== subtotal) {
    const diff = subtotal - sum
    const hint =
      sum < subtotal
        ? 'Ada item yang kelewat, atau harga baris kebaca sebagai harga satuan.'
        : 'Ada item yang kedobel.'
    failures.push({
      gate: 2,
      message: `Total item ${sum} tidak sama dengan subtotal ${subtotal} (selisih ${diff}). ${hint}`,
    })
  }

  return failures
}

/**
 * Gate 3: assignment coverage. Every item has at least one assignee, and every
 * person on the roster has at least one item. A person with no items would
 * otherwise get an all-zero row, which is a mistake rather than a legitimate
 * outcome (section 9).
 */
export function checkGate3(items: AssignedItem[], roster: string[]): GateFailure[] {
  const failures: GateFailure[] = []

  for (const item of items) {
    if (item.assigned_to.length === 0) {
      failures.push({
        gate: 3,
        message: `Item "${item.name}" belum di-assign ke siapa pun.`,
        // Not done yet, rather than wrong. The item row shows it in warning
        // colour already, and marking it keeps a fresh extraction from filling
        // the commit bar with one line per item saying the obvious.
        pending: true,
      })
    }
  }

  const peopleWithItems = new Set(items.flatMap((i) => i.assigned_to))
  for (const person of roster) {
    if (!peopleWithItems.has(person)) {
      failures.push({
        gate: 3,
        message: `"${person}" ada di daftar orang tapi nggak punya item satu pun.`,
      })
    }
  }

  return failures
}

/**
 * Gates 0 through 3. Gate 4 lives inside computeSplit, since it can only be
 * evaluated after the split has been computed.
 *
 * Gate 0: required fields. Note that a missing date is a failure rather than a
 * silent fallback to today; misfiling a bill into the wrong day's sequence and
 * the wrong month's report is worse than making the operator type the date.
 */
export function checkGates(
  e: Extraction,
  items: AssignedItem[],
  roster: string[],
): GateReport {
  const failures: GateFailure[] = []

  // Gate 0
  if (!e.date) {
    failures.push({ gate: 0, message: 'Tanggal struk nggak kebaca. Isi manual dulu.' })
  }
  if (!e.place || e.place.trim() === '') {
    failures.push({ gate: 0, message: 'Nama tempat nggak kebaca. Isi manual dulu.' })
  }
  if (items.length === 0) {
    failures.push({ gate: 0, message: 'Nggak ada item sama sekali.' })
  }
  if (roster.length === 0) {
    // Pending, not broken: the roster is empty because the operator has just
    // started, and the roster section is on screen saying so.
    failures.push({ gate: 0, message: 'Daftar orang masih kosong.', pending: true })
  }

  // When subtotal is genuinely unreadable the app derives it from the items,
  // which the Review screen must do before gate 2 can mean anything.
  const subtotal = e.subtotal ?? items.reduce((acc, i) => acc + i.line_total, 0)

  if (failures.length === 0) {
    failures.push(...checkGate1({ ...e, subtotal }))
  }
  if (!failures.some((f) => f.gate === 0)) {
    failures.push(...checkGate2(items, subtotal))
  }
  failures.push(...checkGate3(items, roster))

  return { passed: failures.length === 0, failures }
}
