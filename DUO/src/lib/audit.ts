/**
 * Turn an audit row into a sentence.
 *
 * `detail` is jsonb, so it arrives as `unknown` and its shape depends on which
 * action wrote it. That is exactly the kind of thing that fails quietly: a log
 * that renders "undefined" or "NaN" for one action and fine for the other four
 * looks like the log is broken rather than like one case was never handled. So
 * the narrowing lives here, with a test, instead of inside a template.
 */

/** The actions the app writes. Kept in step with `AuditAction` in api.ts. */
export type AuditAction =
  | 'bill.deleted'
  | 'bill.restored'
  | 'bill.amount_changed'
  | 'share.paid'
  | 'share.unpaid'

export interface AuditLike {
  action: string
  ref_code: string | null
  detail: unknown
}

function field(detail: unknown, key: string): unknown {
  return detail && typeof detail === 'object' ? (detail as Record<string, unknown>)[key] : undefined
}

function money(value: unknown): string {
  return typeof value === 'number' ? value.toLocaleString('id-ID') : '?'
}

/**
 * What happened, in words.
 *
 * Every branch ends in a readable sentence even when the detail is missing or
 * the wrong shape — the row still exists and still says something happened, and
 * a log that hides the entry it cannot parse is worse than one that admits it
 * does not know the details. An unrecognised action is named rather than
 * dropped, so a new action that forgets to add a case here is visible on the
 * screen instead of silently absent from it.
 */
export function describeAudit(entry: AuditLike): string {
  const person = field(entry.detail, 'person')
  const who = typeof person === 'string' && person ? person : 'Seseorang'

  switch (entry.action) {
    case 'bill.deleted':
      return 'Tagihan dihapus'
    case 'bill.restored':
      return 'Tagihan dikembalikan'
    case 'share.paid':
      return `${who} ditandai lunas`
    case 'share.unpaid':
      return `${who} dibatalkan lunasnya`
    case 'bill.amount_changed': {
      const name = field(entry.detail, 'field')
      return typeof name === 'string'
        ? `Jumlah diubah — ${name}: ${money(field(entry.detail, 'from'))} → ${money(field(entry.detail, 'to'))}`
        : 'Jumlah diubah'
    }
    default:
      // Shown as-is rather than swallowed. An action with no case here is a
      // gap in this file, and it should look like one.
      return entry.action
  }
}
