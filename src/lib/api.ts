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
import { normalizeExtraction, stripCodeFence } from './normalize'
import { DEMO_BILLS, DEMO_MONTHLY, DEMO_OUTSTANDING, DEMO_PEOPLE, isDemo } from './demo'
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
  status: 'belum lunas' | 'lunas'
  paid_date: string | null
}

export interface BillWithShares {
  id: string
  ref_code: string
  place: string
  bill_date: string
  total: number
  receipt_path: string | null
  notes: string | null
  shares: BillShare[]
}

/**
 * Recent bills with their per-person shares, newest first.
 *
 * Fetched as one embedded query rather than through a view: the row count here
 * is small and bounded by the limit, and PostgREST returns the participants
 * nested, so there is nothing for an aggregation view to save. If this ever
 * grows past a few hundred bills, that changes and it becomes a view.
 */
export async function listBills(limit = 60): Promise<BillWithShares[]> {
  if (import.meta.env.DEV && isDemo()) return DEMO_BILLS

  const { data, error } = await supabase
    .from('bills')
    .select(
      'id, ref_code, place, bill_date, total, receipt_path, notes, bill_participants(person, amount_owed, status, paid_date)',
    )
    .order('bill_date', { ascending: false })
    .order('ref_code', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)

  // The embedded resource arrives under its table name. Reshaping it here keeps
  // the rest of the app from knowing about PostgREST's nesting convention.
  return (data ?? []).map((row) => {
    const { bill_participants, ...bill } = row as Record<string, unknown> & {
      bill_participants?: BillShare[]
    }
    return { ...(bill as unknown as BillWithShares), shares: bill_participants ?? [] }
  })
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
}

/**
 * Commit the whole bill in one transaction.
 *
 * The gates run again server side. That is not redundant: the client can be
 * buggy or stale, and these are the invariants that decide what real people
 * owe each other.
 */
export async function commitBill(input: CommitInput): Promise<string> {
  const assignments = input.items.flatMap((item) =>
    item.assigned_to.map((person) => ({ item_position: item.position, person })),
  )

  const { data, error } = await supabase.rpc('commit_bill', {
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
  })

  if (error) throw new Error(error.message)
  return data as string
}
