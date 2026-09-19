/**
 * Rupiah display and input helpers.
 *
 * The app stores and computes in plain integer rupiah. These helpers exist so
 * that human-facing strings never carry a decimal, and so a pasted receipt
 * value like "25.000" or "Rp 25.000" becomes 25000 rather than NaN.
 */

/** 42760 -> "Rp 42.760" */
export function rupiah(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  return `${sign}Rp ${Math.abs(amount).toLocaleString('id-ID')}`
}

/** 42760 -> "42.760" (for input fields, where the Rp prefix is separate) */
export function rupiahDigits(amount: number): string {
  return Math.abs(amount).toLocaleString('id-ID')
}

/**
 * Parse operator input back to an integer.
 *
 * Handles the formats an Indonesian receipt actually prints, plus whatever the
 * operator types while correcting one: "25.000", "Rp 25.000", "25000",
 * "25,000". Returns null for anything that is not a number, so the caller can
 * flag the field rather than silently storing a zero.
 */
export function parseRupiah(input: string): number | null {
  const cleaned = input
    .trim()
    .replace(/^rp\.?\s*/i, '')
    .replace(/[\s.]/g, '')
    .replace(/,/g, '')

  if (cleaned === '') return null
  if (!/^-?\d+$/.test(cleaned)) return null

  const parsed = Number.parseInt(cleaned, 10)
  return Number.isSafeInteger(parsed) ? parsed : null
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
]

/** "2026-09-12" -> "12 Sep 2026". Dates are stored as plain ISO strings. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/**
 * An ISO timestamp as "13 Sep 2026, 21.19", in the reader's own timezone.
 *
 * Local rather than UTC, unlike `formatDate`: that one renders a bill's date,
 * which is a calendar fact about a day and should not shift. This one renders
 * when an action happened, and an audit entry that reads three hours off from
 * the clock on the wall is an audit entry nobody trusts.
 */
export function formatDateTime(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  const time = `${String(at.getHours()).padStart(2, '0')}.${String(at.getMinutes()).padStart(2, '0')}`
  const day = `${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}`
  return `${day}, ${time}`
}

/**
 * A timestamp at conversation distance: "baru aja", "12 menit lalu", "3 jam
 * lalu", "kemarin", "4 hari lalu", then `formatDate` once it is a date rather
 * than an age.
 *
 * The notification feed exists to answer "what happened since I last looked",
 * and for that the useful answer is how long ago it was, not the clock time.
 * Past a week the age stops meaning anything and the date is the honest label.
 *
 * `now` is injectable so the test can pin the boundaries without racing a real
 * clock; every caller takes the default.
 */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso

  // Rounded down, not negated into the future: a timestamp a few seconds ahead
  // of this device's clock (clock skew between the phone and the database) is
  // "baru aja", not "-1 menit lalu".
  const minutes = Math.floor(Math.max(0, now.getTime() - at.getTime()) / 60_000)
  if (minutes < 1) return 'baru aja'
  if (minutes < 60) return `${minutes} menit lalu`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} jam lalu`

  const days = Math.floor(hours / 24)
  if (days === 1) return 'kemarin'
  if (days < 7) return `${days} hari lalu`

  // Built from the local calendar fields rather than slicing the ISO string:
  // an 06:00 WIB notification is 23:00 UTC the day before, and the slice would
  // print yesterday's date to the one reader who cares which day it was.
  const local = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
  return formatDate(local)
}
