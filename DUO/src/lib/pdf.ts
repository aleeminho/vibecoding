/**
 * A small PDF writer, just enough for the nota.
 *
 * Why this exists rather than a library: jsPDF is around 300KB, and this app's
 * whole bundle is 314KB. Nearly doubling it to draw one table on a phone over
 * mobile data is a bad trade, and the alternative — handing the document back
 * to the browser's print dialog — costs the one-tap share, which is the thing
 * being built.
 *
 * What makes it small is a decision made elsewhere: the money column is already
 * monospaced. Courier's advance is exactly 0.6em per character, so right
 * alignment is arithmetic rather than a font metrics table. Words are left
 * aligned and need no measurement at all. That removes the only genuinely large
 * thing a PDF writer normally carries.
 *
 * Text uses the base-14 fonts every reader already has, so nothing is embedded
 * and the output is a few kilobytes of actual content.
 */

const A4 = { width: 595.28, height: 841.89 }

/** Courier's advance width, in ems. Fixed for every glyph, which is the point. */
const COURIER_ADVANCE = 0.6

/**
 * The few non-ASCII characters that turn up in Indonesian text, mapped to their
 * WinAnsi byte. Anything else becomes a question mark rather than a corrupt
 * byte — a mangled name is worse than an obviously missing character.
 */
const WINANSI: Record<string, number> = {
  '—': 0x97,
  '–': 0x96,
  '’': 0x92,
  '‘': 0x91,
  '“': 0x93,
  '”': 0x94,
  '…': 0x85,
  '·': 0xb7,
  '×': 0xd7,
  '−': 0x2d,
  '½': 0xbd,
}

/** RGB in 0..1, the way PDF wants it. */
export type Rgb = [number, number, number]

export const INK: Rgb = [0.11, 0.098, 0.09]
export const SOFT: Rgb = [0.42, 0.396, 0.376]
export const RULE: Rgb = [0.89, 0.87, 0.85]
export const ACCENT: Rgb = [0.816, 0.29, 0.008]

type Font = 'sans' | 'sans-bold' | 'mono' | 'mono-bold'

/**
 * The four faces, in the order they are written into the file.
 *
 * An array rather than an object keyed by name: object key order would decide
 * which /F number each face gets, and a rename that reordered the keys would
 * silently swap sans and mono throughout the document.
 */
const FONTS: { key: Font; base: string }[] = [
  { key: 'sans', base: 'Helvetica' },
  { key: 'sans-bold', base: 'Helvetica-Bold' },
  { key: 'mono', base: 'Courier' },
  { key: 'mono-bold', base: 'Courier-Bold' },
]

const FONT_INDEX: Record<Font, number> = { sans: 1, 'sans-bold': 2, mono: 3, 'mono-bold': 4 }

function escapeText(input: string): string {
  let out = ''
  for (const char of input) {
    const code = char.codePointAt(0)!
    if (char === '\\') out += '\\\\'
    else if (char === '(') out += '\\('
    else if (char === ')') out += '\\)'
    else if (code < 128) out += char
    else if (WINANSI[char] !== undefined) out += String.fromCharCode(WINANSI[char])
    else if (code < 256) out += String.fromCharCode(code)
    else out += '?'
  }
  return out
}

/** Exact, because the face is monospaced. */
export function textWidth(text: string, size: number): number {
  return text.length * COURIER_ADVANCE * size
}

export class Pdf {
  private pages: string[][] = [[]]
  /**
   * Clickable regions, one list per page, parallel to `pages`.
   *
   * Kept beside the content rather than interleaved with it because the two
   * are emitted in different places: the drawing ops go in the content stream,
   * the annotations go in the page dictionary.
   */
  private annots: string[][] = [[]]
  private y = A4.height - 56

  readonly left = 48
  readonly right = A4.width - 48
  readonly top = A4.height - 56
  readonly bottom = 56

  /** Room left on the current page, in points. */
  get remaining(): number {
    return this.y - this.bottom
  }

  get cursor(): number {
    return this.y
  }

  /** Start a new page. The caller is responsible for re-drawing any header. */
  newPage(): void {
    this.pages.push([])
    this.annots.push([])
    this.y = this.top
  }

  /**
   * Make a rectangle of the page open `uri` when tapped.
   *
   * The whole point of putting links in a document that is read on a phone:
   * selecting a URL out of a PDF by hand is miserable, and on iOS it is
   * frequently impossible. A link that cannot be tapped is a link that has to
   * be retyped, which for a 36-character UUID means it will not be.
   *
   * `y` is the bottom edge and `height` grows upward, matching how everything
   * else here is measured — PDF coordinates put the origin at the bottom left.
   */
  link(x: number, y: number, width: number, height: number, uri: string): void {
    this.annots[this.annots.length - 1].push(
      `<< /Type /Annot /Subtype /Link /Rect [${x.toFixed(2)} ${y.toFixed(2)} ` +
        `${(x + width).toFixed(2)} ${(y + height).toFixed(2)}] ` +
        `/Border [0 0 0] /A << /S /URI /URI (${escapeText(uri)}) >> >>`,
    )
  }

  moveDown(points: number): void {
    this.y -= points
  }

  text(
    content: string,
    x: number,
    y: number,
    {
      size = 10,
      font = 'sans' as Font,
      color = INK,
      align = 'left' as 'left' | 'right',
    } = {},
  ): void {
    if (!content) return

    // Right alignment needs a width, and only the monospaced faces have one
    // here — Helvetica would need an AFM metrics table, which is the bulk of
    // what a PDF writer usually carries and the reason this one is small.
    // Drawing anyway would silently left-align, which is worse than stopping.
    if (align === 'right' && !font.startsWith('mono')) {
      throw new Error(`pdf: right-align needs a monospaced font, got "${font}" for "${content}"`)
    }

    const drawX = align === 'right' ? x - textWidth(content, size) : x

    this.current().push(
      `BT ${color.join(' ')} rg /F${FONT_INDEX[font]} ${size} Tf ` +
        `1 0 0 1 ${drawX.toFixed(2)} ${y.toFixed(2)} Tm (${escapeText(content)}) Tj ET`,
    )
  }

  rule(x1: number, y: number, x2: number, color: Rgb = RULE, thickness = 0.7): void {
    this.current().push(
      `${color.join(' ')} RG ${thickness} w ${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S`,
    )
  }

  roundedBox(x: number, y: number, w: number, h: number, color: Rgb = RULE): void {
    this.current().push(
      `${color.join(' ')} RG 0.8 w ` +
        `${(x + 6).toFixed(2)} ${y.toFixed(2)} m ${(x + w - 6).toFixed(2)} ${y.toFixed(2)} l ` +
        `${(x + w).toFixed(2)} ${(y + 6).toFixed(2)} l ${(x + w).toFixed(2)} ${(y + h - 6).toFixed(2)} l ` +
        `${(x + w - 6).toFixed(2)} ${(y + h).toFixed(2)} l ${(x + 6).toFixed(2)} ${(y + h).toFixed(2)} l ` +
        `${x.toFixed(2)} ${(y + h - 6).toFixed(2)} l ${x.toFixed(2)} ${(y + 6).toFixed(2)} l h S`,
    )
  }

  private current(): string[] {
    return this.pages[this.pages.length - 1]
  }

  /**
   * Assemble the file.
   *
   * The only part of a PDF that is genuinely fiddly is the cross-reference
   * table, and only because every offset has to be the byte position of an
   * object that has not been written yet. So objects are emitted into an array
   * while their offsets are recorded, and the table is built once at the end
   * from those offsets. Getting this wrong produces a file that some readers
   * open and others reject, which is why the test checks the byte offsets
   * rather than just that the header looks right.
   */
  build(): Blob {
    const objects: string[] = []
    const pageCount = this.pages.length
    // 1 catalog, 2 pages, then 4 font objects, then a page and a content per page
    const firstPageObj = 7

    for (const { base } of FONTS) {
      objects.push(
        `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`,
      )
    }

    const kids = this.pages.map((_, i) => `${firstPageObj + i * 2} 0 R`).join(' ')
    objects.unshift(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`)
    objects.unshift(`<< /Type /Catalog /Pages 2 0 R >>`)

    this.pages.forEach((ops, i) => {
      const content = ops.join('\n')
      // Inline dictionaries in the array rather than numbered objects with
      // references. Both are legal PDF and every reader in use handles the
      // first, and inline leaves the object numbering — and therefore the xref
      // and the page/content stride below — completely untouched. That
      // numbering is the fragile part of this writer; a feature that cannot
      // disturb it cannot break it.
      const links = this.annots[i]
      const annots = links.length > 0 ? ` /Annots [${links.join(' ')}]` : ''
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >>${annots} ` +
          `/Contents ${firstPageObj + i * 2 + 1} 0 R >>`,
      )
      objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
    })

    let file = '%PDF-1.4\n'
    const offsets: number[] = []
    objects.forEach((body, i) => {
      offsets.push(file.length)
      file += `${i + 1} 0 obj\n${body}\nendobj\n`
    })

    const xref = file.length
    file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    for (const offset of offsets) {
      file += `${String(offset).padStart(10, '0')} 00000 n \n`
    }
    file +=
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
      `startxref\n${xref}\n%%EOF\n`

    // latin1, not utf8: the content is already WinAnsi bytes, and utf8 would
    // widen every accented character into two bytes and corrupt the offsets.
    return new Blob([Uint8Array.from(file, (c) => c.charCodeAt(0))], {
      type: 'application/pdf',
    })
  }
}

// ---------------------------------------------------------------------------
// The nota
// ---------------------------------------------------------------------------

import { formatDate, rupiahDigits } from './format'
import type { PersonBreakdown } from './export'

export interface NotaBill {
  ref_code: string
  bill_date: string
  place: string
  total: number
  bank_name: string | null
  account_number: string | null
  account_holder: string | null
  /** Which of the two ways to pay the document offers. Not which one was used. */
  payment_method: 'bank' | 'qris' | 'both'
  /** The participant who paid the vendor, or null if nobody was marked. */
  paid_by_person: string | null
  /**
   * Just enough to print the payment links: who still owes, and their token.
   *
   * Deliberately narrower than the export's share shape. This file draws; it
   * does not decide who owes what, and a type that carried the item breakdown
   * would invite layout code to start working it out.
   */
  shares: {
    person: string
    pay_token: string | null
    amount_owed: number
    amount_paid: number
    status: string
  }[]
}

/**
 * Lay the bill out as a document.
 *
 * Mirrors the on-screen nota deliberately — same order, same information, same
 * right-aligned money column — because the two are the same artifact seen two
 * ways, and a PDF that reorganises what the screen showed is a second document
 * to keep correct.
 *
 * The money column carries no "Rp". It is stated once at the top, the way a
 * till does it, and repeating it fourteen times down a narrow column is what
 * makes a receipt hard to scan.
 *
 * `baseUrl` is where the app is served from — `location.origin + pathname`.
 * Passed in rather than read from `location` inside, so this module stays pure
 * and testable without a DOM, and so the caller decides what a link points at
 * rather than this file assuming it knows.
 */
export function buildNotaPdf(
  bill: NotaBill,
  breakdown: PersonBreakdown[],
  baseUrl = '',
): Blob {
  const pdf = new Pdf()
  const { left, right } = pdf
  const OPERATOR_X = right - 62

  // What the bill offers, which is the operator's choice and not a record of
  // what any one payer used — nothing in the database says that. A method set
  // to qris with no code uploaded is a real state (see the payment method
  // control), and it prints no transfer box rather than printing the one the
  // operator turned off. The code itself is not in this document at all: the
  // payer's own page shows it, and that is one tap from here.
  const offersBank = bill.payment_method !== 'qris' && Boolean(bill.account_number)

  const line = (points: number, needed = 0) => {
    // Break before a line that would not fit, not after one that already has.
    if (needed > 0 && pdf.remaining < needed) pdf.newPage()
    pdf.moveDown(points)
  }

  // ---- head ----
  pdf.text(bill.place, left, pdf.cursor, { size: 16, font: 'sans-bold' })
  line(20)
  pdf.text(`${formatDate(bill.bill_date)} · ${bill.ref_code}`, left, pdf.cursor, {
    size: 9,
    color: SOFT,
  })
  line(28)

  const totalText = rupiahDigits(bill.total)
  // Right-aligned in a monospaced face so the gap is exact. Placing it by its
  // left edge against a measured total put the two 4.6pt inside each other, and
  // Helvetica's own width is not knowable here without a metrics table.
  pdf.text('Rp', right - textWidth(totalText, 22) - 9, pdf.cursor, {
    size: 11,
    font: 'mono-bold',
    color: ACCENT,
    align: 'right',
  })
  pdf.text(totalText, right, pdf.cursor, {
    size: 22,
    font: 'mono-bold',
    color: ACCENT,
    align: 'right',
  })
  line(16)
  pdf.rule(left, pdf.cursor, right, INK, 1.6)
  line(22)

  /*
   * Each person's payment link, under their own items rather than collected at
   * the foot.
   *
   * The link is the credential — whoever holds it can mark that share paid —
   * and putting it in the block it belongs to means the document says whose it
   * is by position instead of by a row of small print at the bottom that has to
   * be read across. It is also where the screen has always put it.
   *
   * Resolved before the loop rather than inside it, because a block's height
   * has to account for its link before the block is drawn or a page break lands
   * through somebody's items.
   *
   * `is_payer` is excluded as a rule rather than as a consequence. Their share
   * being settled is the mechanism; not handing them a link is the intent, and
   * the two are written by separate calls. If the marker landed and the status
   * write did not, the document would otherwise tell somebody they paid the
   * vendor and then ask them to pay.
   *
   * The trade-off, stated where it is made rather than left implicit: these are
   * credentials and the document they are on goes to the whole group. A mis-tap
   * is possible. What catches it is the amount check at the other end — paying
   * Rp 98.175 against a page expecting Rp 127.050 settles nothing and lands in
   * the review queue instead. Two people owing the exact same amount is the
   * case that gets through, and it is rare enough to accept.
   */
  const payLink = new Map<string, string>()
  if (baseUrl) {
    for (const share of bill.shares) {
      if (
        share.person !== bill.paid_by_person &&
        share.status !== 'lunas' &&
        share.pay_token &&
        share.amount_paid < share.amount_owed
      ) {
        payLink.set(share.person, `${baseUrl}#/bayar?t=${share.pay_token}`)
      }
    }
  }

  // ---- one block per person ----
  for (const person of breakdown) {
    const link = payLink.get(person.person)
    const blockHeight =
      52 + person.items.length * 13 + person.components.length * 13 + (link ? 19 : 0)
    line(0, blockHeight)

    // Beside the name rather than in the money column. The column has to keep
    // adding up to the bill total in the reconciliation at the foot, and a
    // remainder there would break it — the figure stays the person's share of
    // the split, and what has landed is a note about it.
    //
    // The payer is marked differently from someone who has paid, because it is
    // a different fact: they are in the split only because their dinner is part
    // of the bill, and their share was never a debt. "sudah bayar" would raise
    // the question of who they paid.
    const mark = person.is_payer
      ? '  ·  yang bayar ke vendor'
      : person.status === 'lunas'
        ? '  ·  sudah bayar'
        : person.amount_paid > 0
          ? `  ·  udah masuk ${rupiahDigits(person.amount_paid)}`
          : ''
    pdf.text(`${person.person}${mark}`, left, pdf.cursor, { size: 11, font: 'sans-bold' })
    pdf.text(rupiahDigits(person.total), right, pdf.cursor, {
      size: 11,
      font: 'mono-bold',
      align: 'right',
    })
    line(13)
    pdf.rule(left, pdf.cursor, right)
    line(15)

    for (const item of person.items) {
      const shared = item.shared > 1 ? `  (dibagi ${item.shared})` : ''
      pdf.text(`${item.name}${shared}`, left, pdf.cursor, { size: 9.5 })
      pdf.text(rupiahDigits(item.amount), right, pdf.cursor, {
        size: 9.5,
        font: 'mono',
        align: 'right',
      })
      line(13)
    }

    if (person.components.length > 0) {
      line(5)
      for (const part of person.components) {
        pdf.text(part.label, left + 12, pdf.cursor, { size: 9.5, color: SOFT })
        pdf.text(part.amount < 0 ? '−' : '+', OPERATOR_X, pdf.cursor, {
          size: 9.5,
          font: 'mono',
          color: SOFT,
          align: 'right',
        })
        pdf.text(rupiahDigits(Math.abs(part.amount)), right, pdf.cursor, {
          size: 9.5,
          font: 'mono',
          color: SOFT,
          align: 'right',
        })
        line(13)
      }
    }

    if (link) {
      line(5)
      /*
       * The word is the link; the URL is not printed.
       *
       * A 36-character UUID set in 7.5pt monospace said nothing a reader wanted
       * to read and looked like small print rather than like something to
       * press. The row says what it does instead, and the address is where it
       * always was — in the annotation, which is what a tap follows.
       *
       * Left-aligned rather than in the money column, which is a column of
       * figures in a tabular face and the one place in this document a word
       * would be read as a number. `text()` cannot right-align a proportional
       * face anyway: measuring one needs a metrics table, and not carrying one
       * is what keeps this writer small.
       */
      pdf.text('Pembayaran', left + 12, pdf.cursor, {
        size: 10,
        font: 'sans-bold',
        color: ACCENT,
      })
      // Wider than the word on purpose. Ten points of Helvetica is a small
      // target under a thumb, and the width cannot be measured here — the
      // estimate only has to be generous, not right, because the worst case is
      // a tap that lands where the link would have been anyway.
      pdf.link(left + 12, pdf.cursor - 4, 72, 15, link)
      line(14)
    }

    line(14)
  }

  // ---- foot ----
  line(0, 96)
  pdf.rule(left, pdf.cursor, right, INK, 1.6)
  line(20)

  const summed = breakdown.reduce((acc, p) => acc + p.total, 0)
  const fits = summed === bill.total
  pdf.text(
    fits
      ? `${breakdown.length} orang — cocok dengan total struk`
      : `${breakdown.length} orang — TIDAK cocok, total struk ${rupiahDigits(bill.total)}`,
    left,
    pdf.cursor,
    { size: 9.5, color: fits ? SOFT : ACCENT },
  )
  pdf.text(rupiahDigits(summed), right, pdf.cursor, {
    size: 11,
    font: 'mono-bold',
    align: 'right',
  })

  if (offersBank) {
    line(26)
    const boxTop = pdf.cursor + 6
    pdf.roundedBox(left, boxTop - 34, right - left, 34)
    pdf.text('Transfer ke', left + 14, boxTop - 14, { size: 9, color: SOFT })
    const holder = bill.account_holder ? ` · ${bill.account_holder}` : ''
    pdf.text(`${bill.bank_name} ${bill.account_number}${holder}`, right - 14, boxTop - 14, {
      size: 10,
      font: 'mono-bold',
      align: 'right',
    })
    // The box is drawn upward from the cursor, so the cursor is left sitting
    // inside it. Nothing followed this section before, which is why it never
    // showed — and the payment links did, landing straight on the account
    // number. Found in a render, not in the bytes.
    line(42)
  }

  return pdf.build()
}
