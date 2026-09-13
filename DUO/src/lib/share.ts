/**
 * The WhatsApp message.
 *
 * Deliberately a copy-and-paste rather than a send. WhatsApp offers no way for
 * a web page to post into a group, and the alternatives — the click-to-chat URL
 * on desktop, the share sheet on iOS — both drop the recipient into a picker
 * with the text already written, which is fine, but neither works everywhere.
 * One tap on Copy works on every phone this app runs on, so that is the primary
 * action and the wa.me link is offered beside it.
 *
 * The formatting rules are WhatsApp's, not Markdown's: *bold*, _italic_, and
 * newlines preserved. A stray asterisk in a merchant name would start a bold
 * run and make the rest of the message look broken, which is why names are
 * sanitised rather than trusted.
 */

import { formatDate, rupiah } from './format'
import type { PersonBreakdown } from './export'

/**
 * Everyone's breakdown in `breakdown` must sum to `total`.
 *
 * That is the reconciliation the message prints at the bottom. It is not a
 * sanity check bolted on: a message that lists what each person ordered and
 * then asks them for a number that does not match the sum of those lines is
 * worse than a message with no lines at all, because now there is something
 * concrete to argue with. `allocateBill` guarantees it; this prints it.
 */
export interface ShareBill {
  ref_code: string
  place: string
  bill_date: string
  total: number
  bank_name: string | null
  account_number: string | null
  account_holder: string | null
  breakdown: PersonBreakdown[]
}

/**
 * Strip the characters WhatsApp treats as formatting.
 *
 * A cafe called "Kopi *Enak*" would otherwise embolden everything after it, and
 * the operator would have no idea why their message looked wrong.
 */
function plain(text: string): string {
  return text.replace(/[*_~`]/g, '').trim()
}

function destination(bill: ShareBill): string[] {
  if (!bill.bank_name || !bill.account_number) return []
  const lines = [`Transfer ke:`, `${plain(bill.bank_name)} ${bill.account_number}`]
  if (bill.account_holder) lines.push(`a/n ${plain(bill.account_holder)}`)
  return lines
}

/**
 * Build the message.
 *
 * `tone` changes only the opening line. The amounts, the names and the account
 * are identical in both, because a reminder that is vaguer about what is owed
 * just generates another round of questions.
 */
export function buildShareMessage(
  bill: ShareBill,
  { tone = 'initial' }: { tone?: 'initial' | 'reminder' } = {},
): string {
  const paid = bill.breakdown.filter((p) => p.status === 'lunas')
  const unpaid = bill.breakdown.filter((p) => p.status !== 'lunas')

  const lines: string[] = []

  lines.push(tone === 'reminder' ? '*Pengingat split bill*' : '*Split bill*')
  lines.push(`*${plain(bill.place)}* — ${formatDate(bill.bill_date)}`)
  lines.push(`Total struk ${rupiah(bill.total)}`)

  // On a reminder, only the people who still owe get itemised. Reprinting the
  // order of someone who already paid is how a reminder turns into an argument.
  const list = tone === 'reminder' && unpaid.length > 0 ? unpaid : bill.breakdown

  for (const person of list) {
    lines.push('')
    const mark = person.status === 'lunas' ? ' _(lunas)_' : ''
    lines.push(`*${plain(person.person)}*${mark}`)

    for (const item of person.items) {
      const split = item.shared > 1 ? ` _(bagi ${item.shared})_` : ''
      const qty = item.qty > 1 && item.shared === 1 ? ` x${item.qty}` : ''
      lines.push(`  ${plain(item.name)}${qty}${split} ${rupiah(item.amount)}`)
    }

    // What turns a list of dishes into the number being asked for. Without it
    // the items never add up to the total and the first reply is "kok segitu?".
    for (const part of person.components) {
      const sign = part.amount < 0 ? '−' : '+'
      lines.push(`  ${part.label} ${sign}${rupiah(Math.abs(part.amount))}`)
    }

    lines.push(`  *Total ${rupiah(person.total)}*`)
  }

  if (tone === 'reminder' && paid.length > 0) {
    lines.push('')
    lines.push(`Udah lunas: ${paid.map((p) => plain(p.person)).join(', ')}`)
  }

  const dest = destination(bill)
  if (dest.length > 0) {
    lines.push('')
    lines.push(...dest)
  }

  // The reconciliation, printed rather than assumed. If this ever reads as
  // anything other than the same number twice, the split is broken and the
  // message says so instead of quietly asking for the wrong amounts.
  const summed = bill.breakdown.reduce((acc, p) => acc + p.total, 0)
  lines.push('')
  lines.push(
    summed === bill.total
      ? `Dicek: ${rupiah(summed)} — pas sama total struk.`
      : `PERHATIAN: jumlahnya ${rupiah(summed)}, total struk ${rupiah(bill.total)}.`,
  )

  return lines.join('\n')
}

/**
 * The wa.me shortcut. Phone numbers are not stored, so this opens WhatsApp's
 * contact picker with the text already in the box rather than addressing a
 * particular chat.
 */
export function whatsappUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}

/**
 * Copy to the clipboard.
 *
 * `navigator.clipboard` needs a secure context, which the app has in production
 * and on localhost — but not when it is opened over plain HTTP on a LAN address
 * from a phone, which is exactly how it gets tested during development. The
 * textarea fallback exists for that case, not for old browsers.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the fallback rather than failing the tap
  }

  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
