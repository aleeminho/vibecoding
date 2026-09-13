/**
 * Decide whether a proof of payment settles a share.
 *
 * Split out from the function that calls the model because this is the part
 * where being wrong costs money, and it is the part that can be tested without
 * a network. The rest of the function is plumbing.
 *
 * The rule is deliberately strict. A payment is only accepted when the amount
 * matches to the rupiah AND the destination can be shown to be the right one.
 * Everything else — a short transfer, a failed transaction, a recipient the
 * model could not read — is kept and surfaced for a human. Marking someone paid
 * wrongly is expensive in a way that asking the operator to glance at a row is
 * not: the payer believes they are square, so nobody looks again.
 */

export interface ReadProof {
  amount: number | null
  recipient_name: string | null
  recipient_account: string | null
  status_text: string | null
  confidence_notes: string | null
}

export interface Expected {
  amountOwed: number
  accountHolder: string | null
  accountNumber: string | null
}

export type Verdict = 'matched' | 'mismatch' | 'unclear'

export interface Judgement {
  verdict: Verdict
  /** Human-readable, shown to the operator. Never shown to the payer as a verdict. */
  note: string
}

/** Digits only, so "1234 5678" and "1234-5678" are the same account. */
function digits(value: string | null): string {
  return (value ?? '').replace(/\D/g, '')
}

/** Letters and digits only, uppercased, so "Alee" and "ALEE." compare equal. */
function normaliseName(value: string | null): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Words that mean the transfer did not go through.
 *
 * Reported rather than reasoned about: the model is asked for the printed
 * status, and this checks it here so a screenshot of a failed transfer cannot
 * pass on the strength of its amount alone.
 */
const NOT_SUCCESSFUL = ['gagal', 'failed', 'pending', 'menunggu', 'diproses', 'tertunda', 'batal']

function statusLooksFailed(status: string | null): boolean {
  const text = (status ?? '').toLowerCase()
  return NOT_SUCCESSFUL.some((word) => text.includes(word))
}

/**
 * Whether the destination on the proof is the destination it should be.
 *
 * Returns null when it cannot be established either way, which is a distinct
 * outcome from false — a masked account number or an unreadable name is
 * "unclear", not "wrong", and the two deserve different words in front of the
 * operator.
 */
function recipientMatches(read: ReadProof, expected: Expected): boolean | null {
  const readAccount = digits(read.recipient_account)
  const expectedAccount = digits(expected.accountNumber)

  // An account number is the stronger signal when both sides have one, so it is
  // checked first and short-circuits.
  if (readAccount.length >= 4 && expectedAccount.length >= 4) {
    if (readAccount === expectedAccount) return true
    // Screenshots routinely mask the middle: "****1234". Four visible digits
    // matching the tail is as much as the image can tell us.
    if (readAccount.length <= 6 && expectedAccount.endsWith(readAccount)) return true
    if (expectedAccount.endsWith(readAccount.slice(-4)) && readAccount.length <= 6) return true
    return false
  }

  const readName = normaliseName(read.recipient_name)
  const expectedName = normaliseName(expected.accountHolder)

  // Three characters is the floor for a containment test to mean anything — on
  // a two-letter name it would match most of the alphabet.
  if (readName.length >= 3 && expectedName.length >= 3) {
    return readName.includes(expectedName) || expectedName.includes(readName)
  }

  return null
}

export function judge(read: ReadProof, expected: Expected): Judgement {
  if (statusLooksFailed(read.status_text)) {
    return {
      verdict: 'mismatch',
      note: `Buktinya kedeteksi belum berhasil (${read.status_text}).`,
    }
  }

  if (read.amount === null || !Number.isFinite(read.amount)) {
    return { verdict: 'unclear', note: 'Nominalnya nggak kebaca dari gambar.' }
  }

  if (read.amount !== expected.amountOwed) {
    const diff = expected.amountOwed - read.amount
    return {
      verdict: 'mismatch',
      note:
        diff > 0
          ? `Kurang Rp ${diff.toLocaleString('id-ID')} — kebaca Rp ${read.amount.toLocaleString('id-ID')}, harusnya Rp ${expected.amountOwed.toLocaleString('id-ID')}.`
          : `Lebih Rp ${Math.abs(diff).toLocaleString('id-ID')} — kebaca Rp ${read.amount.toLocaleString('id-ID')}, harusnya Rp ${expected.amountOwed.toLocaleString('id-ID')}.`,
    }
  }

  const recipient = recipientMatches(read, expected)

  if (recipient === null) {
    return {
      verdict: 'unclear',
      note: 'Nominalnya pas, tapi penerimanya nggak kebaca — perlu dicek manual.',
    }
  }

  if (!recipient) {
    return {
      verdict: 'mismatch',
      note: `Nominalnya pas, tapi penerimanya beda (${read.recipient_name ?? '?'}). Kemungkinan salah rekening.`,
    }
  }

  return { verdict: 'matched', note: 'Nominal dan penerima cocok.' }
}
