/**
 * Everything that talks to the server.
 *
 * Four operations, and the order they run in matters (spec section 3):
 *
 *   extractReceipt  photo -> Extraction, via the Edge Function
 *   findOwnerId     who is signed in, needed for the storage path
 *   nextRefCode     reserve the code BEFORE uploading, because the photo's
 *                   object path is named after it
 *   uploadReceipt   the photo lands in Storage before any row exists, so a
 *                   storage failure can never leave a bill without a photo
 *   commitBill      one transaction for the bill, its items, its assignees and
 *                   its per person amounts
 */

import { supabase } from './supabase'
import { looksLikeSamePlace } from './duplicate'
import { normalizeExtraction, stripCodeFence } from './normalize'
import {
  DEMO_AUDIT,
  DEMO_BILLS,
  DEMO_DELETED,
  DEMO_EXPORT_BILLS,
  DEMO_FLAGGED,
  DEMO_MONTHLY,
  DEMO_OUTSTANDING,
  DEMO_PEOPLE,
  demoPaymentPage,
  DEMO_SETTLE_UP,
  isDemo,
} from './demo'
import type { ExportBill } from './export'
import type { AssignedItem, Extraction, ParticipantShare } from './types'

const BUCKET = 'receipts'

/**
 * Call the Edge Function and turn its text into a trustworthy Extraction.
 *
 * The function returns the model's raw text on purpose; the parsing, fence
 * stripping and shape checking all happen here so they live in one tested place
 * (normalize.ts) instead of being split across the wire.
 */
export async function extractReceipt(
  base64: string,
  mediaType = 'image/jpeg',
): Promise<Extraction> {
  const { data, error } = await supabase.functions.invoke<{ text?: string; error?: string }>(
    'extract-receipt',
    { body: { image: base64, media_type: mediaType } },
  )

  if (error) {
    // The function answers with { error } and a non-2xx status. supabase-js
    // wraps that in a FunctionsHttpError and hides the body, so read it back.
    let detail = error.message
    try {
      const context = (error as { context?: Response }).context
      if (context instanceof Response) {
        const body = await context.clone().json()
        if (body?.error) detail = body.error
      }
    } catch {
      // Body was not JSON. The generic message is all we have.
    }
    throw new Error(detail)
  }

  if (!data?.text) {
    throw new Error(data?.error ?? 'Edge Function nggak balikin teks sama sekali.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(data.text))
  } catch {
    throw new Error(
      `Output model bukan JSON yang valid. Yang diterima: ${data.text.slice(0, 200)}`,
    )
  }

  return normalizeExtraction(parsed)
}

/** The signed-in operator's id. Used to build the storage path. */
export async function findOwnerId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) {
    throw new Error('Belum login. Masuk dulu sebelum commit.')
  }
  return data.user.id
}

/**
 * Reserve the next reference code for a date.
 *
 * Called before the upload, because the photo's path is named after the code
 * (spec section 10). This is not a lock: the unique constraint on ref_code is
 * what actually prevents duplicates, and it fails loudly if two commits ever
 * race for the same number.
 */
export async function nextRefCode(billDate: string): Promise<string> {
  const { data, error } = await supabase.rpc('next_ref_code', { p_bill_date: billDate })
  if (error) throw new Error(error.message)
  if (typeof data !== 'string') throw new Error('next_ref_code nggak balikin kode.')
  return data
}

/**
 * Upload the receipt photo and return its object path.
 *
 * Private bucket, path prefixed with the owner id, which is what makes the
 * storage policy a path check rather than a database lookup. upsert is on so
 * that retrying a failed commit overwrites its own orphan instead of leaving a
 * second copy behind.
 */
export async function uploadReceipt(
  ownerId: string,
  refCode: string,
  blob: Blob,
): Promise<string> {
  const path = `${ownerId}/${refCode}.jpg`

  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: true,
  })
  if (error) throw new Error(`Upload foto gagal: ${error.message}`)

  return path
}

/**
 * Upload a static QRIS image and return its object path.
 *
 * A fresh random name every time rather than reusing one. The bucket is public
 * — it has to be, the payer has no session — so the path is the only thing
 * standing between a code and anyone who wants to enumerate codes. Ref codes
 * are sequential and would be walkable; a uuid is not.
 */
export async function uploadQris(ownerId: string, blob: Blob): Promise<string> {
  const path = `${ownerId}/${crypto.randomUUID()}.jpg`

  const { error } = await supabase.storage.from('qris').upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
  })
  if (error) throw new Error(`Upload QRIS gagal: ${error.message}`)

  return path
}

/** The public URL of a QRIS code. The bucket is public, so there is nothing to sign. */
export function qrisUrl(path: string): string {
  // In a demo the paths are fixtures rather than objects, so they resolve
  // against the dev server — otherwise every screenshot of this page would
  // show a broken image and say nothing about the layout.
  if (import.meta.env.DEV && isDemo()) return `/${path}`
  return supabase.storage.from('qris').getPublicUrl(path).data.publicUrl
}

/**
 * Set how a bill can be paid.
 *
 * A separate call from the commit, and that is deliberate rather than lazy:
 * commit_bill is the one path that creates a bill, and widening it would mean
 * dropping and recreating it — a change that stops bills being saved at all if
 * it is wrong. A bill's payment options are not part of what it is, and this
 * way an existing bill can be given a code without being recreated.
 */
export async function setBillPayment(
  billId: string,
  patch: { qrisPath?: string | null; method: PaymentMethod },
): Promise<void> {
  const row: Record<string, unknown> = { payment_method: patch.method }
  if (patch.qrisPath !== undefined) row.qris_path = patch.qrisPath

  const { error } = await supabase.from('bills').update(row).eq('id', billId)
  if (error) throw new Error(error.message)
}

export interface KnownPerson {
  person: string
  bill_count: number
  last_seen: string
}

/**
 * Everyone who has ever appeared in a bill, most recent first.
 *
 * Backed by the v_people view, which is derived from bill_participants rather
 * than stored separately — so it can never disagree with the bills themselves.
 * Used to offer the usual group as suggestions instead of making the operator
 * retype the same names at every outing.
 */
export async function listKnownPeople(): Promise<KnownPerson[]> {
  if (import.meta.env.DEV && isDemo()) return DEMO_PEOPLE

  const { data, error } = await supabase.from('v_people').select('*')
  if (error) throw new Error(error.message)
  return (data ?? []) as KnownPerson[]
}

export interface Outstanding {
  person: string
  outstanding: number
  bills: number
}

/** Who still owes what, across every unsettled bill. */
export async function listOutstanding(): Promise<Outstanding[]> {
  if (import.meta.env.DEV && isDemo()) return DEMO_OUTSTANDING

  const { data, error } = await supabase.from('v_outstanding').select('*')
  if (error) throw new Error(error.message)
  return (data ?? []) as Outstanding[]
}

export interface BillShare {
  person: string
  amount_owed: number
  /**
   * Everything that has reached the right account, summed over the proofs
   * uploaded for this share.
   *
   * Derived from the payments rather than stored, so it cannot disagree with
   * the evidence behind it. `status` is a separate claim — "the operator says
   * this is settled" — which is why a share can be fully covered and still
   * read `belum lunas` until someone looks.
   *
   * Only payments whose recipient matched count. A transfer to the wrong
   * account paid nobody, however much it was for.
   */
  amount_paid: number
  status: 'belum lunas' | 'lunas'
  paid_date: string | null
}

/** What is still owed on a share, never negative. */
export function shareRemaining(share: BillShare): number {
  return Math.max(0, share.amount_owed - share.amount_paid)
}

/**
 * `belum lunas` / `sebagian` / `lunas`, derived.
 *
 * The stored status wins when it says settled, because that is the operator
 * overruling the arithmetic — they saw the cash, or they are writing it off. It
 * is never allowed to say less than the arithmetic does, though: a share whose
 * instalments cover it does not read as unpaid just because nobody ticked it.
 */
export function shareState(share: BillShare): 'belum lunas' | 'sebagian' | 'lunas' {
  if (share.status === 'lunas') return 'lunas'
  if (share.amount_paid <= 0) return 'belum lunas'
  return share.amount_paid >= share.amount_owed ? 'lunas' : 'sebagian'
}

export interface BillWithShares {
  id: string
  ref_code: string
  place: string
  bill_date: string
  total: number
  receipt_path: string | null
  notes: string | null
  bank_name: string | null
  account_number: string | null
  account_holder: string | null
  /** Object path in the `qris` bucket, or null when the bill has no code. */
  qris_path: string | null
  payment_method: PaymentMethod
  /**
   * The participant who paid the vendor, or null if nobody was marked.
   *
   * Their share is not a debt, so it is committed settled and never gets a
   * payment link. Read here so the screens can say *why* that person is not
   * being charged, rather than showing them as having paid for no reason.
   */
  paid_by_person: string | null
  shares: BillShare[]
}

/**
 * Which ways a bill offers to be paid.
 *
 * Stored rather than worked out from whether a QRIS exists, because "I have a
 * code but this one should go to my account" is a real thing to want.
 */
export type PaymentMethod = 'bank' | 'qris' | 'both'

/**
 * Recent bills with their per-person shares, newest first.
 *
 * Fetched as one embedded query rather than through a view: the row count here
 * is small and bounded by the limit, and PostgREST returns the participants
 * nested, so there is nothing for an aggregation view to save. If this ever
 * grows past a few hundred bills, that changes and it becomes a view.
 */
/**
 * The bill columns every read wants.
 *
 * Named once because listBills and the export both select them, and a column
 * added to one and not the other is how two reads of the same table start
 * disagreeing about what a bill is.
 */
const BILL_COLUMNS =
  'id, ref_code, place, bill_date, total, receipt_path, notes, bank_name, account_number, account_holder, qris_path, payment_method, paid_by_person' as const

/** A participant row as the database returns it, before the reduction below. */
type RawShare = Omit<BillShare, 'amount_paid'> & {
  payments?: { amount_read: number | null; recipient_ok: boolean | null }[] | null
}

/**
 * Turn embedded rows into the shares the rest of the app uses.
 *
 * `payments` may be missing entirely — see `withoutPayments` — in which case
 * every share reads as having paid nothing, which is what this screen showed
 * before the column existed.
 */
function toShares(rows: RawShare[] | null | undefined): BillShare[] {
  return (rows ?? []).map(({ payments, ...share }) => ({
    ...share,
    amount_paid: (payments ?? []).reduce(
      (sum, p) => sum + (p.recipient_ok === true && p.amount_read ? p.amount_read : 0),
      0,
    ),
  }))
}

/**
 * Whether this database has the partial-payments migration.
 *
 * A module-level flag, not a probe per query: the answer cannot change while a
 * session is open, and asking again on every read would double the round trips
 * to re-answer a settled question.
 *
 * Why it is needed at all: the embedded `payments(...recipient_ok)` names a
 * column a migration adds. The frontend deploys from CI the moment it is
 * pushed; migrations are applied by hand. In the window between the two, a
 * select naming a column that does not exist fails the ENTIRE request — which
 * would take the bills screen down over one derived figure. So the first
 * failure is remembered and every read after it drops the embed.
 */
let paymentsAvailable = true

/*
 * The two participant embeds, as literal types rather than a function returning
 * `string`. supabase-js parses the select at the type level, and a plain string
 * tells it nothing — every column comes back as `any` and every typo stops
 * being a compile error. The ternaries below pick between these two literals,
 * which keeps that parsing intact through the fallback.
 */
const SHARES_WITH_PAYMENTS =
  'bill_participants(person, amount_owed, status, paid_date, payments(amount_read, amount_due, recipient_ok, verdict, image_path, created_at))' as const
const SHARES_PLAIN = 'bill_participants(person, amount_owed, status, paid_date)' as const

export async function listBills(limit = 60): Promise<BillWithShares[]> {
  if (import.meta.env.DEV && isDemo()) return DEMO_BILLS

  const query = (withPayments: boolean) =>
    supabase
      .from('bills')
      .select(
        withPayments
          ? `${BILL_COLUMNS}, ${SHARES_WITH_PAYMENTS}`
          : `${BILL_COLUMNS}, ${SHARES_PLAIN}`,
      )
      // Deleted bills are hidden, not gone. Every read path filters here rather
      // than relying on the caller to remember.
      .is('deleted_at', null)
      .order('bill_date', { ascending: false })
      .order('ref_code', { ascending: false })
      .limit(limit)

  let { data, error } = await query(paymentsAvailable)

  if (error && paymentsAvailable && error.message.includes('recipient_ok')) {
    paymentsAvailable = false
    ;({ data, error } = await query(false))
  }

  if (error) throw new Error(error.message)

  // The embedded resource arrives under its table name. Reshaping it here keeps
  // the rest of the app from knowing about PostgREST's nesting convention.
  return (data ?? []).map((row) => {
    const { bill_participants, ...bill } = row as Record<string, unknown> & {
      bill_participants?: RawShare[]
    }
    return { ...(bill as unknown as BillWithShares), shares: toShares(bill_participants) }
  })
}

/**
 * The bill id behind a reference code.
 *
 * Needed because `commit_bill` hands back the ref code and the post-commit
 * writes need a uuid. The lookup is exact — `ref_code` is unique, which is what
 * stops two commits racing for the same number — so this cannot pick the wrong
 * bill.
 *
 * A separate call rather than widening `commit_bill`'s return, for the same
 * reason the QRIS and the organiser marker are written after the commit: that
 * function is the one path that creates a bill, and changing its signature
 * means dropping and recreating it, where being wrong stops bills being saved
 * at all.
 */
export async function findBillId(refCode: string): Promise<string> {
  const { data, error } = await supabase
    .from('bills')
    .select('id')
    .eq('ref_code', refCode)
    .single()

  if (error) throw new Error(error.message)
  return (data as { id: string }).id
}

/**
 * Record who settled with the vendor.
 *
 * A separate call after the commit, like the QRIS and for the same reason:
 * commit_bill is the one path that creates a bill, and widening it means
 * dropping and recreating it.
 */
export async function setPaidBy(billId: string, person: string | null): Promise<void> {
  if (import.meta.env.DEV && isDemo()) return

  const { error } = await supabase.from('bills').update({ paid_by_person: person }).eq('id', billId)
  if (error) throw new Error(error.message)
}

export interface DuplicateCandidate {
  id: string
  ref_code: string
  place: string
  bill_date: string
  total: number
}

/**
 * Bills that might already be this one.
 *
 * The query is deliberately narrow — same total, within a day either side —
 * and the judgement about the place happens in `looksLikeSamePlace`, where it
 * can be tested. Doing the name comparison in SQL would mean a pattern that
 * only exists in a query string, with no test that can reach it.
 *
 * The date window is ±1 day rather than exactly the same day: a late dinner
 * gets scanned after midnight often enough that "same day" would miss the
 * duplicate it exists to catch.
 *
 * Returns candidates, not a verdict. What to do with one is a warning on a
 * screen the operator is already reading.
 */
export async function findSimilarBills(
  place: string,
  billDate: string,
  total: number,
): Promise<DuplicateCandidate[]> {
  if (import.meta.env.DEV && isDemo()) {
    return DEMO_BILLS.filter(
      (b) => b.total === total && looksLikeSamePlace(b.place, place),
    ).map((b) => ({
      id: b.id,
      ref_code: b.ref_code,
      place: b.place,
      bill_date: b.bill_date,
      total: b.total,
    }))
  }

  const day = 24 * 60 * 60 * 1000
  const from = new Date(`${billDate}T00:00:00Z`)
  const before = new Date(from.getTime() - day).toISOString().slice(0, 10)
  const after = new Date(from.getTime() + day).toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('bills')
    .select('id, ref_code, place, bill_date, total')
    .eq('total', total)
    .gte('bill_date', before)
    .lte('bill_date', after)
    .is('deleted_at', null)

  if (error) throw new Error(error.message)

  return ((data ?? []) as DuplicateCandidate[]).filter((b) =>
    looksLikeSamePlace(b.place, place),
  )
}

/**
 * Mark one person's share of one bill as paid, or unpaid.
 *
 * This is the granularity people actually settle at: someone transfers their
 * part back and the rest have not, so a bill is routinely half settled for
 * weeks. (bill_id, person) identifies the row, which the unique constraint on
 * the table already guarantees.
 *
 * The status and the paid date move together because a table constraint
 * requires a date exactly when the status is 'lunas'.
 */
export async function setShareStatus(
  billId: string,
  person: string,
  paid: boolean,
): Promise<void> {
  if (import.meta.env.DEV && isDemo()) return

  const { error } = await supabase
    .from('bill_participants')
    .update({
      status: paid ? 'lunas' : 'belum lunas',
      paid_date: paid ? new Date().toISOString().slice(0, 10) : null,
    })
    .eq('bill_id', billId)
    .eq('person', person)

  if (error) throw new Error(error.message)

  // Logged here rather than at each call site, so a new screen that flips this
  // cannot forget to record it. Marking someone paid is a statement about
  // money, which is exactly the kind of change the trail exists for.
  await logAudit(paid ? 'share.paid' : 'share.unpaid', {
    billId,
    detail: { person },
  })
}

/**
 * Mark every share of a bill at once, for the case where the whole group
 * settles together. Kept alongside the per person call because both happen, and
 * looping the per person one would be several round trips that can fail
 * halfway.
 */
export async function setBillStatus(billId: string, paid: boolean): Promise<void> {
  if (import.meta.env.DEV && isDemo()) return

  const { error } = await supabase
    .from('bill_participants')
    .update({
      status: paid ? 'lunas' : 'belum lunas',
      paid_date: paid ? new Date().toISOString().slice(0, 10) : null,
    })
    .eq('bill_id', billId)

  if (error) throw new Error(error.message)
}

export interface MonthlyRow {
  month: string
  person: string
  total: number
  bills: number
}

/** Per person spend by month, for the report. */
export async function listMonthlySpend(): Promise<MonthlyRow[]> {
  if (import.meta.env.DEV && isDemo()) return DEMO_MONTHLY

  const { data, error } = await supabase.from('v_monthly_spend').select('*')
  if (error) throw new Error(error.message)
  return (data ?? []) as MonthlyRow[]
}

/** A short-lived URL for viewing a stored photo. Never persisted. */
export async function signedReceiptUrl(path: string, seconds = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

/**
 * Where the money should go. Required on every new bill — a split nobody can
 * pay is not finished — and stored per bill because one bill is one payment.
 */
export interface Destination {
  bankName: string
  accountNumber: string
  accountHolder: string
}

/**
 * Digits only, so the same account is written the same way every time.
 *
 * Bank apps print account numbers with dots, dashes and spaces depending on the
 * bank, and a CSV where the same account appears three ways is a CSV you cannot
 * group by. Stripping here means the database check can stay strict.
 */
export function normaliseAccountNumber(input: string): string {
  return input.replace(/[^0-9]/g, '')
}

export interface CommitInput {
  refCode: string
  place: string
  billDate: string
  subtotal: number
  discount: number
  tax: number
  serviceCharge: number
  roundingAdjustment: number
  total: number
  items: AssignedItem[]
  participants: ParticipantShare[]
  receiptPath: string | null
  notes: string | null
  extraction: unknown
  destination: Destination | null
}

/**
 * Commit the whole bill in one transaction.
 *
 * The gates run again server side. That is not redundant: the client can be
 * buggy or stale, and these are the invariants that decide what real people
 * owe each other.
 *
 * **Returns nothing, and that is deliberate.** `commit_bill` ends with
 * `return p_ref_code` — the reference code, not the bill id — and it used to be
 * handed straight through as `Promise<string>`. Both values are strings, so
 * using one where the other belongs was a Postgres type error the compiler
 * could not see, and it shipped: the ref code was passed to a `uuid` column and
 * every save with an organiser marked failed with `invalid input syntax for
 * type uuid`.
 *
 * The caller already has the reference code — it generated it and passed it in
 * — so the return value was redundant as well as misleading. Dropping it makes
 * `const billId = await commitBill(...)` a type error rather than a bug, which
 * is a better fix than a comment nobody reads. Use `findBillId` when an id is
 * what you actually need.
 */
export async function commitBill(input: CommitInput): Promise<void> {
  const assignments = input.items.flatMap((item) =>
    item.assigned_to.map((person) => ({ item_position: item.position, person })),
  )

  const { error } = await supabase.rpc('commit_bill', {
    p_ref_code: input.refCode,
    p_place: input.place,
    p_bill_date: input.billDate,
    p_subtotal: input.subtotal,
    p_discount: input.discount,
    p_tax: input.tax,
    p_service_charge: input.serviceCharge,
    p_rounding_adjustment: input.roundingAdjustment,
    p_total: input.total,
    p_items: input.items.map((i) => ({
      position: i.position,
      name: i.name,
      qty: i.qty,
      line_total: i.line_total,
    })),
    p_participants: input.participants,
    p_assignments: assignments,
    p_receipt_path: input.receiptPath,
    p_notes: input.notes,
    p_extraction: input.extraction,
    p_bank_name: input.destination?.bankName ?? null,
    p_account_number: input.destination?.accountNumber ?? null,
    p_account_holder: input.destination?.accountHolder ?? null,
  })

  if (error) throw new Error(error.message)
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

export type AuditAction =
  | 'bill.deleted'
  | 'bill.restored'
  | 'bill.amount_changed'
  | 'share.paid'
  | 'share.unpaid'

/**
 * Record what was done to a bill.
 *
 * Best effort on purpose. The log is a record of an action, not a condition of
 * it: if writing the entry fails, refusing the delete would leave the operator
 * unable to correct a mistake because an audit insert failed. The failure is
 * surfaced in the console rather than swallowed, so it is not invisible.
 */
export async function logAudit(
  action: AuditAction,
  entry: { billId?: string | null; refCode?: string | null; detail?: unknown },
): Promise<void> {
  if (import.meta.env.DEV && isDemo()) return

  try {
    const { error } = await supabase.from('audit_log').insert({
      action,
      bill_id: entry.billId ?? null,
      ref_code: entry.refCode ?? null,
      detail: entry.detail ?? null,
    })
    if (error) console.warn('audit log write failed:', error.message)
  } catch (err) {
    console.warn('audit log write failed:', (err as Error).message)
  }
}

export interface AuditEntry {
  id: string
  action: string
  ref_code: string | null
  detail: unknown
  created_at: string
}

export async function listAuditLog(limit = 100): Promise<AuditEntry[]> {
  if (import.meta.env.DEV && isDemo()) return DEMO_AUDIT

  const { data, error } = await supabase
    .from('audit_log')
    .select('id, action, ref_code, detail, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)
  return data as AuditEntry[]
}

// ---------------------------------------------------------------------------
// Soft delete
// ---------------------------------------------------------------------------

/**
 * Hide a bill.
 *
 * Soft, not hard. A deleted bill keeps every row, so a mis-tap is one update
 * away from being undone, the month stays auditable, and nothing that
 * references the bill has to cope with a hole. `deleted_at` is filtered by
 * every view and by listBills.
 */
export async function deleteBill(billId: string, refCode: string): Promise<void> {
  if (import.meta.env.DEV && isDemo()) return

  const { error } = await supabase
    .from('bills')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', billId)

  if (error) throw new Error(error.message)
  await logAudit('bill.deleted', { billId, refCode })
}

export interface DeletedBill {
  id: string
  ref_code: string
  place: string
  bill_date: string
  total: number
  deleted_at: string
}

/**
 * Bills that were deleted and can still be brought back.
 *
 * Read rather than only written, because until now nothing could: `restoreBill`
 * existed and was unreachable, so the delete confirmation's promise that "the
 * data is still there if you got it wrong" was one the app could not keep.
 */
export async function listDeletedBills(): Promise<DeletedBill[]> {
  if (import.meta.env.DEV && isDemo()) return DEMO_DELETED

  const { data, error } = await supabase
    .from('bills')
    .select('id, ref_code, place, bill_date, total, deleted_at')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as DeletedBill[]
}

export async function restoreBill(billId: string, refCode: string): Promise<void> {
  if (import.meta.env.DEV && isDemo()) return

  const { error } = await supabase.from('bills').update({ deleted_at: null }).eq('id', billId)

  if (error) throw new Error(error.message)
  await logAudit('bill.restored', { billId, refCode })
}

// ---------------------------------------------------------------------------
// Detailed export and settle up
// ---------------------------------------------------------------------------

/**
 * One bill with its items, assignees and shares.
 *
 * The select string and the row mapping live here because two callers need the
 * same shape — the detailed export over a date range, and the nota for a single
 * bill. Written twice they drifted the moment a column was added, which is
 * exactly what happened when `total` was introduced.
 */
const EXPORT_BASE = `total, ref_code, bill_date, place, bank_name, account_number, account_holder, paid_by_person, qris_path, payment_method,
   bill_items (position, name, qty, line_total, bill_item_assignees (bill_participants (person))),
   bill_participants (person, pay_token, discount_share, tax_share, service_share, rounding_share, amount_owed, status, paid_date`

const EXPORT_PLAIN = `${EXPORT_BASE})`
const EXPORT_WITH_PAYMENTS = `${EXPORT_BASE}, payments(amount_read, amount_due, recipient_ok, verdict, image_path, created_at))`

type ExportRow = {
  total: number
  ref_code: string
  bill_date: string
  place: string
  bank_name: string | null
  account_number: string | null
  account_holder: string | null
  paid_by_person: string | null
  qris_path: string | null
  payment_method: 'bank' | 'qris' | 'both'
  bill_items: {
    position: number
    name: string
    qty: number
    line_total: number
    bill_item_assignees: { bill_participants: { person: string } | null }[]
  }[]
  bill_participants: (Omit<ExportBill['shares'][number], 'amount_paid'> & {
    payments: ExportBill['shares'][number]['payments'] | null
  })[]
}

function mapExportBill(bill: ExportRow): ExportBill {
  return {
    ref_code: bill.ref_code,
    bill_date: bill.bill_date,
    place: bill.place,
    total: bill.total,
    bank_name: bill.bank_name,
    account_number: bill.account_number,
    account_holder: bill.account_holder,
    paid_by_person: bill.paid_by_person ?? null,
    qris_path: bill.qris_path ?? null,
    payment_method: bill.payment_method ?? 'bank',
    items: (bill.bill_items ?? [])
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
        name: item.name,
        qty: item.qty,
        line_total: item.line_total,
        assigned_to: (item.bill_item_assignees ?? [])
          .map((a) => a.bill_participants?.person)
          .filter((p): p is string => typeof p === 'string'),
      })),
    shares: (bill.bill_participants ?? []).map(({ payments, ...s }) => ({
      ...s,
      rounding_share: s.rounding_share ?? 0,
      payments: payments ?? [],
      // Summed here for the same reason listBills sums it there: the running
      // total is derived from the proofs, never stored beside them.
      amount_paid: (payments ?? []).reduce(
        (sum, p) => sum + (p.recipient_ok === true && p.amount_read ? p.amount_read : 0),
        0,
      ),
    })),
  }
}

/**
 * Every bill in a date range, for the detailed export.
 *
 * One nested query rather than a view, for the same reason listBills is: the
 * row count is bounded by the range and the embedding is already there. The
 * flattening into item-per-person rows happens in src/lib/export.ts, where it
 * is unit tested — doing it in SQL would put arithmetic that has to be exact
 * somewhere no test can reach.
 */
export async function listExportBills(from: string, to: string): Promise<ExportBill[]> {
  if (import.meta.env.DEV && isDemo()) return DEMO_EXPORT_BILLS

  const query = (withPayments: boolean) =>
    supabase
      .from('bills')
      .select(withPayments ? EXPORT_WITH_PAYMENTS : EXPORT_PLAIN)
      .is('deleted_at', null)
      .gte('bill_date', from)
      .lte('bill_date', to)
      .order('bill_date', { ascending: true })

  let { data, error } = await query(paymentsAvailable)
  if (error && paymentsAvailable && error.message.includes('recipient_ok')) {
    paymentsAvailable = false
    ;({ data, error } = await query(false))
  }

  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as ExportRow[]).map(mapExportBill)
}

/**
 * One bill, for the nota.
 *
 * Fetched on demand rather than added to listBills, because the item graph is
 * an order of magnitude more rows than the bill list needs and only the nota
 * asks for it. One extra round trip on a deliberate tap is a better trade than
 * carrying it on every screen load.
 */
export async function getExportBill(billId: string): Promise<ExportBill> {
  if (import.meta.env.DEV && isDemo()) {
    const bill = DEMO_BILLS.find((b) => b.id === billId)
    const fixture = DEMO_EXPORT_BILLS.find((b) => b.ref_code === bill?.ref_code)
    if (!fixture) throw new Error(`no demo export fixture for ${bill?.ref_code ?? billId}`)
    return fixture
  }

  const query = (withPayments: boolean) =>
    supabase.from('bills').select(withPayments ? EXPORT_WITH_PAYMENTS : EXPORT_PLAIN).eq('id', billId).single()

  let { data, error } = await query(paymentsAvailable)
  if (error && paymentsAvailable && error.message.includes('recipient_ok')) {
    paymentsAvailable = false
    ;({ data, error } = await query(false))
  }

  if (error) throw new Error(error.message)
  return mapExportBill(data as unknown as ExportRow)
}


// ---------------------------------------------------------------------------
// Paying
//
// Nothing in this section requires a session. The payer is someone the operator
// split a bill with; they have no account here and will not make one. The token
// in the URL is the whole of their authority, and the server treats it that
// way — the function behind submitProof accepts a token and an image and
// nothing else, so there is no field here that could be used to reach another
// bill even if this code were tampered with.
// ---------------------------------------------------------------------------

export interface PaymentPageInfo {
  participant_id: string
  person: string
  place: string
  bill_date: string
  ref_code: string
  amount_owed: number
  /** Already in, from proofs that reached the right account. */
  amount_paid: number
  status: string
  bank_name: string | null
  account_number: string | null
  account_holder: string | null
  /** Object path in the `qris` bucket, or null when the bill has no code. */
  qris_path: string | null
  payment_method: PaymentMethod
}

export async function paymentPage(token: string): Promise<PaymentPageInfo | null> {
  if (import.meta.env.DEV && isDemo()) return demoPaymentPage(token)

  const { data, error } = await supabase.rpc('payment_page', { p_token: token })
  if (error) throw new Error(error.message)
  return ((data ?? []) as PaymentPageInfo[])[0] ?? null
}

export interface ProofResult {
  verdict: 'matched' | 'mismatch' | 'unclear' | 'already_paid'
  person: string
  /** What was still due when this proof was judged, not the original amount. */
  expected?: number
  read?: number | null
  /** What is left after this transfer. Null once the share is settled. */
  remaining?: number | null
  message: string
  error?: string
}

/** A proof the model would not settle on its own. */
export interface FlaggedPayment {
  id: string
  bill_id: string
  ref_code: string
  place: string
  person: string
  amount_owed: number
  amount_read: number | null
  recipient_read: string | null
  recipient_expected: string
  /**
   * Whether the money reached the right account, or null when the proof did
   * not say. The queue needs this to tell a short transfer from a transfer to
   * a stranger — they arrive as the same verdict and mean opposite things.
   */
  recipient_ok: boolean | null
  verdict: 'mismatch' | 'unclear'
  note: string | null
  image_path: string
  created_at: string
}

/**
 * Proofs the operator has to decide on.
 *
 * Anything the model did not settle by itself: the wrong amount, the wrong
 * account, or an image it could not read. A matched proof is not in here —
 * that one already did its job.
 *
 * Resolved by the share becoming `lunas`, not by a flag on the payment. Marking
 * someone paid is the decision the queue was asking for, so making that the
 * thing that clears it means there is no second piece of state to keep in sync,
 * and no way for the two to disagree.
 */
export async function listFlaggedPayments(): Promise<FlaggedPayment[]> {
  if (import.meta.env.DEV && isDemo()) return DEMO_FLAGGED

  const { data, error } = await supabase
    .from('payments')
    .select(
      'id, amount_read, recipient_read, recipient_expected, recipient_ok, verdict, note, image_path, created_at, bill_participants(person, amount_owed, status, bill_id, bills(place, ref_code))',
    )
    // RLS already limits this to the caller's own bills, so there is no owner
    // predicate here to get wrong.
    .neq('verdict', 'matched')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw new Error(error.message)

  type Row = {
    id: string
    amount_read: number | null
    recipient_read: string | null
    recipient_expected: string
    recipient_ok: boolean | null
    verdict: 'mismatch' | 'unclear'
    note: string | null
    image_path: string
    created_at: string
    bill_participants: {
      person: string
      amount_owed: number
      status: string
      bill_id: string
      bills: { place: string; ref_code: string } | null
    } | null
  }

  // A loop rather than filter-then-map with non-null assertions on both hops.
  // Both hops can be null in the type, and a chain of `!` to satisfy the
  // compiler is a promise about the data that nothing is keeping.
  const rows = (data as unknown as Row[]) ?? []
  const out: FlaggedPayment[] = []

  for (const p of rows) {
    const share = p.bill_participants
    const bill = share?.bills
    // Settled since the proof was uploaded — someone marked it paid by hand,
    // or a later proof matched. Either way the question is answered.
    if (!share || !bill || share.status === 'lunas') continue

    out.push({
      id: p.id,
      bill_id: share.bill_id,
      ref_code: bill.ref_code,
      place: bill.place,
      person: share.person,
      amount_owed: share.amount_owed,
      amount_read: p.amount_read,
      recipient_read: p.recipient_read,
      recipient_expected: p.recipient_expected,
      recipient_ok: p.recipient_ok,
      verdict: p.verdict,
      note: p.note,
      image_path: p.image_path,
      created_at: p.created_at,
    })
  }

  return out
}

/**
 * Send a proof of payment for reading.
 *
 * Plain fetch rather than the supabase client's invoke(), because this is the
 * one call in the app made without a session and the client's auth handling is
 * built around having one. The publishable key is the only header it needs, and
 * it is public by design.
 */
export async function submitProof(
  token: string,
  image: string,
  mediaType: string,
): Promise<ProofResult> {
  // No fixture path here, deliberately. Every other demo function returns rows
  // so a screen can be looked at; this one would have to invent a verdict, and
  // a demo that says "Lunas" without a model having read anything is a lie
  // about the one thing this feature exists to do. It fails honestly instead.
  if (import.meta.env.DEV && isDemo()) {
    throw new Error('Mode demo: validasi cuma jalan kalau nyambung ke Supabase.')
  }

  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

  const res = await fetch(`${url}/functions/v1/validate-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify({ token, image, media_type: mediaType }),
  })

  const body = (await res.json().catch(() => ({}))) as ProofResult
  if (!res.ok) throw new Error(body.error ?? `Gagal ngirim buktinya (${res.status}).`)
  return body
}

export interface SettleUpEntry {
  bill_id: string
  ref_code: string
  place: string
  bill_date: string
  person: string
  amount_owed: number
  /** Part of this share already settled by a proof of payment. */
  amount_paid: number
}

/** Every unpaid share at bill granularity, so a total can show its sources. */
export async function listSettleUp(): Promise<SettleUpEntry[]> {
  if (import.meta.env.DEV && isDemo()) return DEMO_SETTLE_UP

  const { data, error } = await supabase
    .from('v_settle_up')
    .select('*')
    .order('person', { ascending: true })

  if (error) throw new Error(error.message)
  return data as SettleUpEntry[]
}
