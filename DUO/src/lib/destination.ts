/**
 * The payment destination: who the money goes to.
 *
 * Shared between Review (where it is first written) and Bills (where it can be
 * corrected after the split), so both screens enforce the same rules and say
 * the same thing when they do not hold.
 */

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

/**
 * Required before a bill can be asked to be paid, per the PRD: a split nobody
 * can pay is not finished. Checked client side where it can be explained,
 * rather than left to the database where a failure arrives as a constraint
 * name (`bills_destination_complete`, `bills_account_number_digits`).
 */
export function destinationError(
  bankName: string,
  accountNumber: string,
  accountHolder: string,
): string | null {
  if (!bankName.trim()) return 'Bank atau e-wallet belum diisi.'
  if (!accountHolder.trim()) return 'Nama penerima belum diisi.'
  if (normaliseAccountNumber(accountNumber).length < 6) return 'Nomor tujuan minimal 6 angka.'
  return null
}
