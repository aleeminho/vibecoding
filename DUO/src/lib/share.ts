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

export interface ShareBill {
  ref_code: string
  place: string
  bill_date: string
  total: number
  bank_name: string | null
  account_number: string | null
  account_holder: string | null
  shares: { person: string; amount_owed: number; status: string }[]
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
  const who = bill.shares
  const paid = who.filter((s) => s.status === 'lunas')
  const unpaid = who.filter((s) => s.status !== 'lunas')

  const lines: string[] = []

  lines.push(tone === 'reminder' ? '*Pengingat split bill*' : '*Split bill*')
  lines.push(`${plain(bill.place)} — ${formatDate(bill.bill_date)}`)
  lines.push(`Total ${rupiah(bill.total)}`)
  lines.push('')

  const list = tone === 'reminder' && unpaid.length > 0 ? unpaid : who
  for (const share of list) {
    const mark = share.status === 'lunas' ? ' (lunas)' : ''
    lines.push(`${plain(share.person)}: ${rupiah(share.amount_owed)}${mark}`)
  }

  // On a reminder, saying who has already paid is the thing that stops the
  // group chat asking. On the first message it is noise.
  if (tone === 'reminder' && paid.length > 0) {
    lines.push('')
    lines.push(`Udah lunas: ${paid.map((s) => plain(s.person)).join(', ')}`)
  }

  const dest = destination(bill)
  if (dest.length > 0) {
    lines.push('')
    lines.push(...dest)
  }

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
