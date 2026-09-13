/**
 * Domain types.
 * See split_bill_app_spec.md sections 5 (item structure) and 8 (extraction schema).
 *
 * Money is integer rupiah everywhere. Rupiah has no minor unit in practice, so
 * a float appearing in this file is a bug, except inside computeSplit's
 * intermediate arithmetic (section 6), which rounds before anything leaves.
 */

/** Raw output of the vision model. Nothing here is trusted until the gates pass. */
export interface Extraction {
  place: string | null
  /** ISO YYYY-MM-DD, or null if not visible on the receipt. Never defaulted to today. */
  date: string | null
  items: ExtractedItem[]
  subtotal: number | null
  discount: number
  tax: number
  service_charge: number
  /** Can be negative. Only set when the receipt explicitly prints a rounding line. */
  rounding_adjustment: number
  total: number
  confidence_notes: string | null
}

export interface ExtractedItem {
  name: string
  qty: number
  /** Already multiplied by qty. The unit price is deliberately not stored. */
  line_total: number
}

/** An item after the operator has assigned it. Lives only during processing. */
export interface AssignedItem extends ExtractedItem {
  /** 1-based, matches the receipt's own ordering. Used to match assignments on commit. */
  position: number
  /** Person names. One or more; more than one means shared, split evenly. */
  assigned_to: string[]
}

/** What one person owes. This is what gets written to bill_participants. */
/**
 * How round a share has to be. 0 means no rounding at all, which is the
 * default: a share of Rp 33.333 is awkward to ask a friend for, but silently
 * changing someone's number is worse unless the operator asked for it.
 */
export type RoundingMode = 0 | 100 | 500

export interface ParticipantShare {
  person: string
  item_subtotal: number
  discount_share: number
  tax_share: number
  service_share: number
  amount_owed: number
  /**
   * The rupiah moved onto this person by the rounding rule, relative to their
   * exact share. Zero when rounding is off. Held separately from amount_owed so
   * the shift is visible in the books instead of looking like a share that was
   * simply computed that way.
   */
  rounding_share?: number
}

export interface SplitResult {
  participants: ParticipantShare[]
  /** The reconciliation amount applied in step 3 of the rounding rule. Usually 0. */
  residual: number
  /** Whoever absorbed the residual, or null when it was already zero. */
  residual_applied_to: string | null
}

export type GateId = 0 | 1 | 2 | 3 | 4

export interface GateFailure {
  gate: GateId
  message: string
  /**
   * True when this failure means "not done yet" rather than "wrong".
   *
   * An empty roster and an unassigned item are both work the operator has not
   * got to, not mistakes they made. The screen already shows them as states —
   * an unassigned item renders in warning colour, an empty roster renders as an
   * empty roster — so a summary that repeats them is noise, and shouting at
   * someone in red for not having finished yet is worse than saying nothing.
   *
   * A summary should carry the next step for these, and reserve its alarm for
   * failures that mean something is actually incorrect: a date that will not
   * parse, arithmetic that does not balance, items that do not sum.
   */
  pending?: boolean
}

export interface GateReport {
  passed: boolean
  failures: GateFailure[]
}
