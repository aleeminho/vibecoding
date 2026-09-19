/**
 * The notification feed's state, shared by the letterhead bell and the screen.
 *
 * There is no push and no notifier function. The feed is a read over `payments`
 * (see `listNotifications`), refreshed when the app opens, when the tab comes
 * back to the foreground, and on a slow interval — the badge is a convenience,
 * and a convenience that polls harder than that costs more than it is worth.
 *
 * "Unread" is a marker, not a column: the newest `created_at` the operator has
 * already seen, kept on the device. So the same feed can be unread on the phone
 * that has not looked since yesterday and read on the desktop that looked a
 * minute ago — which is what the person carrying both actually expects.
 */
import { listNotifications } from './api'
import type { NotifItem } from './types'

const SEEN_KEY = 'duo.notifSeenAt'

class NotificationsStore {
  items = $state<NotifItem[]>([])

  /** ISO timestamp of the newest entry the operator has seen. '' = never looked. */
  seenAt = $state<string>(readSeen())

  /**
   * True once a load has actually succeeded.
   *
   * The screen gates its empty state on this rather than on `items.length ===
   * 0`: an in-flight first fetch also has zero items, and "Belum ada
   * notifikasi." printed over a request still in the air is the screen telling
   * the operator something it does not know yet.
   */
  loaded = $state(false)

  /** In-flight loads are collapsed: a poll landing on top of the screen's own
   * refresh would otherwise finish out of order and repaint stale rows. */
  #loading = false

  get unread(): NotifItem[] {
    return this.items.filter((n) => n.created_at > this.seenAt)
  }

  async load(): Promise<void> {
    if (this.#loading) return
    this.#loading = true
    try {
      this.items = await listNotifications()
      this.loaded = true
    } finally {
      this.#loading = false
    }
  }

  /**
   * Mark everything currently loaded as seen, by moving the marker to the
   * newest entry rather than to the wall clock.
   *
   * `now` would be wrong in the other direction: a payment that lands between
   * the query and the tap is older than `now` but was never in the list, and it
   * would come back already-read. The newest row's own timestamp can only be
   * overtaken by a row that arrived after it.
   */
  markSeen(): void {
    const newest = this.items[0]?.created_at
    if (!newest || newest <= this.seenAt) return
    this.seenAt = newest
    try {
      localStorage.setItem(SEEN_KEY, newest)
    } catch {
      // Private browsing with storage disabled. The marker still holds for this
      // session; the badge just comes back on the next launch.
    }
  }

  /**
   * Settle one entry in place, after the operator accepted its proof.
   *
   * Flipping the share's status locally is what lets the row show LUNAS the
   * moment the write lands. A refetch would say the same thing a minute later,
   * which is a minute of a row insisting it still needs attention right after
   * it was answered.
   */
  resolve(id: string): void {
    this.items = this.items.map((n) => (n.id === id ? { ...n, status: 'lunas' } : n))
  }
}

function readSeen(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export const notifications = new NotificationsStore()
