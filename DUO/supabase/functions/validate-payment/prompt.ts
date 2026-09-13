/**
 * Reading a proof of payment.
 *
 * Deliberately a separate prompt from the receipt one rather than a shared
 * "read an image" contract. The two have almost nothing in common: a receipt is
 * a list of line items printed on thermal paper, a transfer confirmation is a
 * handful of labelled fields on a phone screenshot, and the questions being
 * asked of each are different. One prompt doing both would carry the union of
 * both sets of rules and be worse at each.
 *
 * What this one must get right is the destination, not just the amount. A
 * transfer of exactly the right amount to the wrong account is the failure that
 * costs real money, and an amount-only check waves it through.
 */

export const PAYMENT_MODEL = 'deepseek-flash'

/**
 * The shape, in standard JSON Schema, embedded into the prompt below.
 *
 * Declared before the prompt because the prompt interpolates it at module
 * evaluation, and a const used above its own declaration is in the temporal
 * dead zone.
 */
export const PAYMENT_SCHEMA = {
  type: 'object',
  properties: {
    amount: {
      type: ['number', 'null'],
      description: 'The amount transferred, as a whole number of rupiah. null if no amount is visible.',
    },
    recipient_name: {
      type: ['string', 'null'],
      description: 'Name of the account the money went TO, as printed. null if not visible.',
    },
    recipient_account: {
      type: ['string', 'null'],
      description: 'Account number or phone the money went TO, digits only. null if not visible.',
    },
    sender_name: {
      type: ['string', 'null'],
      description: 'Name of the account the money came FROM, as printed. null if not visible.',
    },
    status_text: {
      type: ['string', 'null'],
      description: 'The transaction status as printed, e.g. Berhasil, Sukses, Pending. null if absent.',
    },
    date: {
      type: ['string', 'null'],
      description: 'Transaction date in ISO YYYY-MM-DD form. null if not visible.',
    },
    confidence_notes: {
      type: ['string', 'null'],
      description: 'Anything blurry, cut off or ambiguous. null if nothing to report.',
    },
  },
  required: [
    'amount',
    'recipient_name',
    'recipient_account',
    'sender_name',
    'status_text',
    'date',
    'confidence_notes',
  ],
}

export const PAYMENT_PROMPT = `You are reading a screenshot of a payment confirmation from an Indonesian bank or e-wallet.

The screenshot may come from BCA, Mandiri, BNI, BRI, GoPay, OVO, DANA, ShopeePay, or a QRIS confirmation. The layouts differ completely between them. Do not assume a fixed position for any field — read the labels.

What matters most, in this order:

1. The RECIPIENT — who received the money. This is the field that decides whether a payment is correct, and it is the one most likely to be missed. It may be labelled "Penerima", "Ke", "Tujuan", "Nama Penerima", "Merchant", or appear only as a name under an account number. Report both the name and the account number if either is visible.

2. The AMOUNT actually transferred. It may be labelled "Jumlah", "Nominal", "Total", "Amount", or appear as the large figure in the middle of the screen. Do not report a balance, an admin fee, a "saldo akhir", or a "sisa saldo" as the amount.

3. The status. "Berhasil" or "Sukses" means it went through. "Pending", "Menunggu", or "Gagal" means it did not. Report exactly what is printed. If the screenshot shows a failed or pending transfer, say so in status_text rather than leaving it null — a failed transfer reported as a valid one is worse than an unread one.

Rules:
- Amounts in Indonesia use a period as the thousands separator. "127.050" is one hundred twenty-seven thousand and fifty rupiah, not 127. Never return a decimal.
- Recipient account numbers are digits only. Drop spaces, dots and dashes. If the number is masked, for example "****1234", report only the digits that are actually visible.
- Do not confuse the sender with the recipient. The sender is usually the account holder's own name at the top of the screen; the recipient is who the money went to.
- If a field is not visible on this particular screenshot, use null for it. Do not guess, and do not carry over a value from a different part of the screen.
- If something is blurry, cropped, or genuinely ambiguous, make your best reading and say exactly what you were unsure about in confidence_notes. If nothing is unclear, set it to null.

Reply with a single JSON object and nothing else. No prose, no markdown fences. It must match this JSON Schema exactly:

${JSON.stringify(PAYMENT_SCHEMA, null, 2)}`
