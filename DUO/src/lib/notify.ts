/**
 * Bundling the notification feed by bill.
 *
 * The feed's unit is the invoice, not the transfer: a bill three people paid
 * produces three rows, and reading them one by one loses the question the
 * operator is actually asking — which of my bills still has something waiting.
 * So events are grouped per bill, ordered by the newest event in each, and the
 * bundle's own state is derived: any proof still waiting on a person makes it
 * "perlu dicek"; otherwise the whole bill is settled.
 *
 * Pure functions, because the ordering and the unsettled rule are the kind of
 * logic that goes wrong quietly and still looks fine.
 */
import type { NotifItem } from './types'

export interface NotifBundle {
  bill_id: string
  place: string
  ref_code: string
  /** Newest first. */
  items: NotifItem[]
  /** `created_at` of items[0]; what the new/old split is judged on. */
  newest: string
  /** Proofs the model would not settle and nobody has settled by hand. */
  unsettled: NotifItem[]
}

/**
 * Settled is the share's own answer, not the model's: a mismatch the operator
 * accepted by hand reads as done here, because it is.
 */
export function isSettled(n: NotifItem): boolean {
  return n.verdict === 'matched' || n.status === 'lunas'
}

export function bundleByBill(items: NotifItem[]): NotifBundle[] {
  const byBill = new Map<string, NotifItem[]>()
  for (const n of items) {
    const list = byBill.get(n.bill_id)
    if (list) list.push(n)
    else byBill.set(n.bill_id, [n])
  }

  const bundles: NotifBundle[] = []
  for (const [bill_id, list] of byBill) {
    // Sorted here rather than trusting the query's order: the bundle's headline
    // (its place, its age) is read off the first item, so "newest first" is a
    // fact this function has to own.
    list.sort((a, b) => b.created_at.localeCompare(a.created_at))
    const newest = list[0]
    bundles.push({
      bill_id,
      place: newest.place,
      ref_code: newest.ref_code,
      items: list,
      newest: newest.created_at,
      unsettled: list.filter((n) => !isSettled(n)),
    })
  }

  bundles.sort((a, b) => b.newest.localeCompare(a.newest))
  return bundles
}
