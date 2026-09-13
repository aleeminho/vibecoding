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

/** "2026-09-12" -> "12 Sep 2026". Dates are stored as plain ISO strings. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
    'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
  ]
  return `${d} ${months[m - 1]} ${y}`
}
