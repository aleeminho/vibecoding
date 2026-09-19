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
  /**
   * True when the printed prices already contain the tax rather than having it
   * added on top.
   *
   * Indonesia prints receipts under two conventions and they need different
   * arithmetic. A warung adds PPN to the food total; a retailer like Guardian
   * prints a shelf price that already includes it and then breaks the VAT out
   * underneath, as a Purchase / DPP / VAT Amount block below the total.
   *
   * It changes what `subtotal` and `total` mean relative to each other, so it is
   * not a display flag: gate 1 drops `tax` from the identity when this is set,
   * and `computeSplit` stops adding `tax_share` to `amount_owed`.
   */
  tax_inclusive: boolean
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

/**
 * One line in the operator's notification feed: a proof of payment that landed
 * on one of their bills.
 *
 * Derived from a `payments` row rather than written by a notifier, which is the
 * whole reason there is no notifications table: the proof already carries who,
 * how much, when and which bill, and row level security already scopes it to the
 * operator. `verdict` is what the reader decided — "matched" means the money
 * arrived and the share settled itself; the other two mean a human should look.
 */
export interface NotifItem {
  id: string
  person: string
  place: string
  ref_code: string
  bill_id: string
  verdict: 'matched' | 'mismatch' | 'unclear'
  /** What the model read off the screenshot. Null when it could not read one. */
  amount_read: number | null
  amount_owed: number
  /** Storage path of the uploaded proof, for opening the evidence. */
  image_path: string
  /**
   * The share's own state, which is not the verdict. A mismatch the operator
   * accepted by hand has verdict 'mismatch' and status 'lunas' — the model was
   * overruled, and the feed has to show the ruling, not the objection.
   */
  status: string
  created_at: string
}
