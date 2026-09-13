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

import { FIRST_CHAR, LAST_CHAR, widthOf, type FontMetrics } from './ttf'

const A4 = { width: 595.28, height: 841.89 }

/**
 * A real font, for the figures the document is about.
 *
 * The base-14 faces are free because every reader already has them, which is
 * what keeps this writer small. The price is that the only serif available is
 * Times, and Times reads as a legal brief — not as the amount somebody owes.
 * So one face travels inside the document instead: about 70KB on the way out,
 * against a document that was 6KB without it.
 *
 * Already compressed when it arrives. Compressing 155KB of font per build, in
 * a browser, is a job worth doing once and caching rather than once per tap.
 */
export interface NotaFont {
  /** The font file, exactly as it arrived, or Flate-compressed when `flate`. */
  data: Uint8Array
  flate: boolean
  /** Byte length before compression, which the font stream has to declare. */
  uncompressed: number
  metrics: FontMetrics
}

/** Exact, because a proportional face has no fixed advance. In 1/1000 em. */
export function serifWidth(metrics: FontMetrics, text: string, size: number): number {
  let total = 0
  for (const char of text) {
    const code = char.codePointAt(0)!
    total += widthOf(metrics, code > 255 ? 0 : code)
  }
  return (total * size) / 1000
}

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

type Font = 'sans' | 'sans-bold' | 'mono' | 'mono-bold' | 'serif'

/**
 * The four base-14 faces, in the order they are written into the file.
 *
 * An array rather than an object keyed by name: object key order would decide
 * which /F number each face gets, and a rename that reordered the keys would
 * silently swap sans and mono throughout the document.
 *
 * The embedded serif is not here. These four are numbered 3 to 6 with the
 * catalog and the page tree ahead of them, and every page and content object
 * after; the serif is numbered beyond all of that, so it cannot move anything.
 */
const FONTS: { key: Font; base: string }[] = [
  { key: 'sans', base: 'Helvetica' },
  { key: 'sans-bold', base: 'Helvetica-Bold' },
  { key: 'mono', base: 'Courier' },
  { key: 'mono-bold', base: 'Courier-Bold' },
]

const FONT_INDEX: Record<Font, number> = {
  sans: 1,
  'sans-bold': 2,
  mono: 3,
  'mono-bold': 4,
  serif: 5,
}

/** The name the embedded face is declared under. No spaces, per the spec. */
const SERIF_NAME = 'PlexSerif-SemiBold'

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

/**
 * One character per byte, so a string's length is a byte offset.
 *
 * The writer assembles the file as a string and measures every object offset
 * with `.length`, which is only the byte offset if nothing widens on the way
 * out — see the latin1 conversion at the end of `build()`.
 *
 * Chunked because `String.fromCharCode(...bytes)` on a hundred kilobytes of
 * font data overflows the argument stack, and the throw arrives as "too many
 * arguments" from a line that has nothing to do with fonts.
 */
function latin1(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return out
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

  /**
   * The embedded serif, or null when the document is drawn in the base-14
   * faces alone. Held here rather than passed to every `text()` call, because
   * whether a face exists is a property of the document and not of a line.
   */
  private font: NotaFont | null

  constructor(font: NotaFont | null = null) {
    this.font = font
  }

  /** Whether right-aligned text in the embedded face can be placed at all. */
  get hasSerif(): boolean {
    return this.font !== null
  }

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

    // Right alignment needs a width. Courier has one by construction; the
    // embedded serif has one because its widths were read out of the font file;
    // Helvetica would need an AFM metrics table, which is the bulk of what a
    // PDF writer usually carries and the reason this one is small. Drawing
    // anyway would silently left-align, which is worse than stopping.
    const measurable = font.startsWith('mono') || (font === 'serif' && this.font !== null)
    if (align === 'right' && !measurable) {
      throw new Error(`pdf: right-align needs a measured font, got "${font}" for "${content}"`)
    }

    // Measured after escaping, because that is what actually gets drawn: an
    // escaped parenthesis is two bytes on the page. Money never contains one,
    // so this changes nothing for the column that depends on it.
    const escaped = escapeText(content)
    const width =
      font === 'serif' && this.font
        ? serifWidth(this.font.metrics, escaped, size)
        : textWidth(escaped, size)

    const drawX = align === 'right' ? x - width : x

    this.current().push(
      `BT ${color.join(' ')} rg /F${FONT_INDEX[font]} ${size} Tf ` +
        `1 0 0 1 ${drawX.toFixed(2)} ${y.toFixed(2)} Tm (${escaped}) Tj ET`,
    )
  }

  rule(x1: number, y: number, x2: number, color: Rgb = RULE, thickness = 0.7): void {
    this.current().push(
      `${color.join(' ')} RG ${thickness} w ${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S`,
    )
  }

  /** A stroked rectangle, for a slip's card. */
  box(x: number, y: number, w: number, h: number, color: Rgb = RULE): void {
    this.current().push(
      `${color.join(' ')} RG 0.7 w ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`,
    )
  }

  /** A filled rectangle, for the bands the design puts behind a total. */
  fill(x: number, y: number, w: number, h: number, color: Rgb): void {
    this.current().push(
      `${color.join(' ')} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`,
    )
  }

  /** A dotted leader, the run of dots between a label and its figure. */
  leader(x1: number, y: number, x2: number, color: Rgb = RULE): void {
    this.current().push(
      `q ${color.join(' ')} RG 0.6 w [1 2.2] 0 d ${x1.toFixed(2)} ${y.toFixed(2)} m ` +
        `${x2.toFixed(2)} ${y.toFixed(2)} l S Q`,
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
    // 1 catalog, 2 pages, then 4 font objects, then a page and a content per
    // page, then the embedded face if there is one.
    const firstPageObj = 7
    const font = this.font
    const fontObj = firstPageObj + pageCount * 2

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
      const faces = `/F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R${font ? ` /F5 ${fontObj} 0 R` : ''}`
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] ` +
          `/Resources << /Font << ${faces} >> >>${annots} ` +
          `/Contents ${firstPageObj + i * 2 + 1} 0 R >>`,
      )
      objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
    })

    if (font) {
      // Three objects, numbered past every page and content object so that
      // adding a font cannot move anything that was already numbered — the same
      // rule the page dictionaries follow, and the reason this writer's xref
      // survives being extended.
      const { widths, bbox, ascent, descent, capHeight } = font.metrics
      objects.push(
        `<< /Type /Font /Subtype /TrueType /BaseFont /${SERIF_NAME} ` +
          `/FirstChar ${FIRST_CHAR} /LastChar ${LAST_CHAR} /Encoding /WinAnsiEncoding ` +
          `/Widths [${widths.join(' ')}] /FontDescriptor ${fontObj + 1} 0 R >>`,
      )
      objects.push(
        `<< /Type /FontDescriptor /FontName /${SERIF_NAME} ` +
          // Serif (2) and Nonsymbolic (32). A reader that has to guess picks
          // worse defaults for both.
          `/Flags 34 /FontBBox [${bbox.join(' ')}] /ItalicAngle 0 ` +
          `/Ascent ${ascent} /Descent ${descent} /CapHeight ${capHeight} /StemV 110 ` +
          `/FontFile2 ${fontObj + 2} 0 R >>`,
      )
      objects.push(
        `<< /Length ${font.data.length} /Length1 ${font.uncompressed}` +
          `${font.flate ? ' /Filter /FlateDecode' : ''} >>\nstream\n` +
          latin1(font.data) +
          `\nendstream`,
      )
    }

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
 * The colours the sheet is printed in.
 *
 * The same values as the screen's, so the document and the screen are the same
 * document. The accent is the app's brand orange, and it is spent on exactly
 * two things here: the total the bill is about, and the amount each person
 * owes. `DEEP` exists because the accent itself is 4.25:1 on white and fails
 * AA as small text — it is a fill, and a label on a wash takes the darker tone.
 */
const INK2: Rgb = [0.353, 0.38, 0.431]
const INK3: Rgb = [0.525, 0.553, 0.6]
const RULE_SOFT: Rgb = [0.933, 0.941, 0.953]
const DEEP: Rgb = [0.659, 0.231, 0]
const WASH: Rgb = [0.992, 0.949, 0.918]

/** Inside a card or a band. */
const PAD = 14

/**
 * Break a paragraph into lines that fit.
 *
 * By estimate, because Helvetica cannot be measured here — the writer has no
 * metrics table for it and that is the whole reason it is small. Each character
 * is charged a deliberately unkind 0.65em, where the face's average for mixed
 * text is nearer 0.5 and only a line of capitals and digits reaches 0.6. The
 * budget has to be unkind for the same reason: a line that ends early is a
 * paragraph, and a line that ends past the margin is a bug on paper.
 */
function wrap(text: string, size: number, width: number): string[] {
  const budget = Math.max(8, Math.floor(width / (size * 0.65)))
  const lines: string[] = []
  let current = ''

  for (const word of text.split(/\s+/)) {
    if (current && current.length + 1 + word.length > budget) {
      lines.push(current)
      current = word
    } else {
      current = current ? `${current} ${word}` : word
    }
  }

  if (current) lines.push(current)
  return lines
}

/**
 * Lay the bill out as a document.
 *
 * The same document the screen draws, in the same order: the bill in one glance
 * at the top, then each person's slip, then how to pay. The two are one
 * artifact seen twice, and a PDF that reorganises what the screen showed is a
 * second document to keep correct.
 *
 * The arithmetic a reader can check is the same arithmetic: a slip's items sum
 * to its subtotal, subtotal plus the charge line is its total, and the ledger's
 * three money columns sum to its footer. All of it is derived from the same
 * `allocateBill` the summary table uses rather than recomputed here.
 *
 * `baseUrl` is where the app is served from — `location.origin + pathname`.
 * Passed in rather than read from `location` inside, so this module stays pure
 * and testable without a DOM, and so the caller decides what a link points at
 * rather than this file assuming it knows.
 *
 * `font` is the embedded serif. Without it the document still lays out, in the
 * base-14 faces alone — every figure lands, they are simply set in Helvetica.
 * That is the fallback for a phone that could not fetch the file, not a second
 * design.
 */
export function buildNotaPdf(
  bill: NotaBill,
  breakdown: PersonBreakdown[],
  baseUrl = '',
  font: NotaFont | null = null,
): Blob {
  const pdf = new Pdf(font)
  const { left, right } = pdf
  const COLUMN = right - left

  /** Right edges of the ledger's money columns. One width for all three. */
  const COL_TOTAL = right
  const COL_CHARGE = right - 104
  const COL_SUBTOTAL = right - 208

  const line = (points: number, needed = 0) => {
    // Break before a line that would not fit, not after one that already has.
    if (needed > 0 && pdf.remaining < needed) pdf.newPage()
    pdf.moveDown(points)
  }

  /*
   * The two faces, and what they become when the font never arrived.
   *
   * Every use of the embedded face has to go through one of these. A `serif`
   * that is asked for when nothing was embedded is not a fallback — the page
   * resources have no /F5, so the text is drawn in a font the reader does not
   * have and simply does not appear. And a right-aligned one throws.
   *
   * The fallbacks are not a second design. Helvetica and Courier are what this
   * writer drew in before there was a font at all, and every figure lands in
   * the same place: Courier measures exactly too.
   */
  const prose: Font = font ? 'serif' : 'sans'
  const figures: Font = font ? 'serif' : 'mono'
  /** Courier is wider than the serif, so display sizes have to come down. */
  const figuresSize = (big: number, small: number) => (font ? big : small)

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

  const subtotalOf = (p: PersonBreakdown) => p.total - p.extra
  const chargeLabel = (p: PersonBreakdown) => (p.extra < 0 ? 'Diskon' : 'PPN & service')
  const signed = (n: number) => (n < 0 ? `−${rupiahDigits(n)}` : rupiahDigits(n))
  const hasDiscount = breakdown.some((p) => p.extra < 0)

  // ---------------------------------------------------------------------------
  // Masthead
  // ---------------------------------------------------------------------------

  const mast = pdf.cursor
  pdf.text(bill.place, left, mast, { size: 17, font: prose })
  pdf.text('Nota', right, mast, { size: 22, font: figures, align: 'right' })

  pdf.moveDown(15)
  pdf.text(formatDate(bill.bill_date), left, pdf.cursor, { size: 9.5, color: INK2 })
  if (bill.paid_by_person) {
    pdf.moveDown(13)
    pdf.text(`Dibayar dulu sama ${bill.paid_by_person}`, left, pdf.cursor, {
      size: 9.5,
      color: INK2,
    })
  }

  // The bill's own numbers, keyed at the left of their column so the labels
  // need no measuring and the figures stay in a tabular face.
  const meta: [string, string][] = [
    ['Tagihan', bill.ref_code],
    ['Orang', String(breakdown.length)],
    ['Total', `Rp ${rupiahDigits(bill.total)}`],
  ]
  meta.forEach(([key, value], i) => {
    const y = mast - 20 - i * 13
    pdf.text(key, left + COLUMN - 150, y, { size: 9, color: INK2 })
    pdf.text(value, right, y, { size: 9.5, font: 'mono', align: 'right' })
  })

  line(46)
  pdf.rule(left, pdf.cursor, right, ACCENT, 2.4)
  line(26)

  // ---------------------------------------------------------------------------
  // The bill in one glance
  // ---------------------------------------------------------------------------

  pdf.text('Bagian tiap orang', left, pdf.cursor, { size: 9, color: INK3 })
  line(16)

  for (const l of wrap(
    'Satu baris per orang, PPN dan service sudah masuk. Barisnya berjumlah pas dengan ' +
      'total struk — rincian itemnya ada di bawah.',
    10,
    COLUMN,
  )) {
    pdf.text(l, left, pdf.cursor, { size: 10, color: INK2 })
    line(13)
  }
  line(8)

  // Header. The middle column is named for its sign, the same way a slip is:
  // one heading cannot be true of a column holding tax for one person and a
  // discount for the next.
  const headY = pdf.cursor
  pdf.text('Nama', left, headY, { size: 9, color: INK3 })
  const chargeHead = hasDiscount ? ['PPN, service', '& diskon'] : ['PPN & service']
  pdf.text('Subtotal', COL_SUBTOTAL, headY, { size: 9, font: figures, color: INK3, align: 'right' })
  chargeHead.forEach((l, i) => {
    pdf.text(l, COL_CHARGE, headY - i * 10, { size: 9, font: figures, color: INK3, align: 'right' })
  })
  pdf.text('Total', COL_TOTAL, headY, { size: 9, font: figures, color: INK3, align: 'right' })

  line(chargeHead.length > 1 ? 26 : 16)
  pdf.rule(left, pdf.cursor, right, ACCENT, 1.4)
  line(16)

  for (const person of breakdown) {
    const rowY = pdf.cursor
    pdf.text(person.person, left, rowY, { size: 10.5, font: 'sans-bold' })
    pdf.text(rupiahDigits(subtotalOf(person)), COL_SUBTOTAL, rowY, {
      size: 10,
      font: 'mono',
      align: 'right',
    })
    pdf.text(signed(person.extra), COL_CHARGE, rowY, { size: 10, font: 'mono', align: 'right' })
    pdf.text(rupiahDigits(person.total), COL_TOTAL, rowY, { size: 10, font: 'mono', align: 'right' })

    // The state, under the name rather than in the column: the column has to
    // keep adding up to the footer, and a remainder in it would break that.
    const state = person.is_payer
      ? 'Yang bayar ke vendor'
      : person.status === 'lunas'
        ? 'Sudah lunas'
        : person.amount_paid > 0
          ? `Udah masuk ${rupiahDigits(person.amount_paid)}`
          : ''
    line(13)
    if (state) {
      pdf.text(state, left, pdf.cursor, { size: 8.5, color: INK2 })
      line(12)
    }
    line(5)
    pdf.rule(left, pdf.cursor, right, RULE_SOFT, 0.6)
    line(15)
  }

  // Footer, on the wash so that it reads as a result rather than as one more
  // row. The three columns sum to it, which is the one thing this table claims.
  const footTop = pdf.cursor + 14
  pdf.fill(left, footTop - 24, COLUMN, 24, WASH)
  pdf.rule(left, footTop, right, ACCENT, 1.6)
  pdf.text('Total struk', left + 6, footTop - 16, { size: 10.5, font: 'sans-bold', color: DEEP })
  pdf.text(
    rupiahDigits(breakdown.reduce((a, p) => a + subtotalOf(p), 0)),
    COL_SUBTOTAL,
    footTop - 16,
    { size: 10.5, font: 'mono-bold', align: 'right' },
  )
  pdf.text(signed(breakdown.reduce((a, p) => a + p.extra, 0)), COL_CHARGE, footTop - 16, {
    size: 10.5,
    font: 'mono-bold',
    align: 'right',
  })
  pdf.text(rupiahDigits(breakdown.reduce((a, p) => a + p.total, 0)), COL_TOTAL, footTop - 16, {
    size: 10.5,
    font: 'mono-bold',
    align: 'right',
  })
  line(34)

  // ---------------------------------------------------------------------------
  // One slip per person
  // ---------------------------------------------------------------------------

  pdf.text('Rincian per orang', left, pdf.cursor, { size: 9, color: INK3 })
  line(20)

  for (const person of breakdown) {
    const link = payLink.get(person.person)
    const subRows = person.extra === 0 ? 1 : 2
    const bandH = link ? 50 : 32
    // Derived from where the drawing below actually puts the baselines, not
    // from the design's box model: 25 to the name, 20 to the first item, 12 a
    // row, 6 to the subtotal, 12 more for the charge, 4 under the last
    // descender. Over-counting shows up as a gap between the figures and the
    // band, which reads as a slip somebody forgot to finish.
    const cardH = PAD + 11 + 20 + person.items.length * 12 + 6 + (subRows - 1) * 12 + 4 + bandH

    // The whole card, so a page break lands before it and never through it.
    line(0, cardH + 4)
    const cardTop = pdf.cursor
    const cardBottom = cardTop - cardH

    pdf.box(left, cardBottom, COLUMN, cardH, RULE)

    let y = cardTop - PAD - 11
    pdf.text(person.person, left + PAD, y, { size: 12, font: 'sans-bold' })

    y -= 20
    for (const item of person.items) {
      const shared = item.shared > 1 ? `  1/${item.shared}` : ''
      pdf.text(`${item.name}${shared}`, left + PAD, y, { size: 9.5 })
      pdf.text(rupiahDigits(item.amount), right - PAD, y, {
        size: 9.5,
        font: 'mono',
        align: 'right',
      })
      y -= 12
    }

    y -= 6
    pdf.text('Subtotal', left + PAD, y, { size: 9.5, color: INK2 })
    pdf.text(rupiahDigits(subtotalOf(person)), right - PAD, y, {
      size: 9.5,
      font: 'mono',
      align: 'right',
    })
    if (person.extra !== 0) {
      y -= 12
      pdf.text(chargeLabel(person), left + PAD, y, { size: 9.5, color: INK2 })
      pdf.text(rupiahDigits(person.extra), right - PAD, y, {
        size: 9.5,
        font: 'mono',
        align: 'right',
      })
    }

    // The band. Quiet means nothing to do here, which is as true of a settled
    // share as of the payer's — the accent only works while it means one thing.
    const settled = person.is_payer || person.status === 'lunas'
    pdf.fill(left, cardBottom, COLUMN, bandH, settled ? RULE_SOFT : WASH)
    pdf.rule(left, cardBottom + bandH, right, settled ? INK3 : ACCENT, 2)

    const amountY = cardBottom + bandH - 18
    const label = person.is_payer
      ? 'Bagian dia, sudah termasuk'
      : person.status === 'lunas'
        ? 'Sudah lunas'
        : person.amount_paid > 0
          ? `Sisa Rp ${rupiahDigits(person.total - person.amount_paid)}`
          : bill.paid_by_person
            ? `Utang ke ${bill.paid_by_person}`
            : 'Bagian dia'
    pdf.text(label, left + PAD, amountY, {
      size: 9,
      font: 'sans-bold',
      color: settled ? INK2 : DEEP,
    })
    pdf.text(rupiahDigits(person.total), right - PAD, amountY - 2, {
      size: figuresSize(16, 11),
      font: figures,
      color: settled ? INK2 : ACCENT,
      align: 'right',
    })

    if (link) {
      // The word is the link; the address travels in the annotation. Left
      // aligned rather than at the money column, which is a column of figures
      // and the one place a word would be read as one.
      pdf.text('Pembayaran', left + PAD, cardBottom + 14, { size: 10, font: 'sans-bold', color: DEEP })
      pdf.link(left + PAD - 4, cardBottom + 8, 84, 16, link)
    }

    pdf.moveDown(cardH)
    line(18)
  }

  // ---------------------------------------------------------------------------
  // How to pay
  // ---------------------------------------------------------------------------

  const banks = bill.bank_name || bill.account_number
  if (banks || bill.payment_method !== 'bank') {
    line(0, 70)
    pdf.text('Cara bayar', left, pdf.cursor, { size: 9, color: INK3 })
    line(18)

    for (const l of wrap(
      bill.payment_method === 'qris'
        ? `Kode QRIS-nya ada di halaman bayar masing-masing orang, di link Pembayaran di atas. Sebutin nomor tagihan ${bill.ref_code} di keterangannya.`
        : `Transfer ke ${bill.bank_name ?? ''} ${bill.account_number ?? ''}${
            bill.account_holder ? `, a.n. ${bill.account_holder}` : ''
          }. Sebutin nomor tagihan ${bill.ref_code} di keterangannya.`,
      10,
      COLUMN,
    )) {
      pdf.text(l, left, pdf.cursor, { size: 10, color: INK2 })
      line(13)
    }
  }

  // ---------------------------------------------------------------------------
  // Colophon
  // ---------------------------------------------------------------------------

  const owing = breakdown.filter((p) => !p.is_payer && p.status !== 'lunas').length
  line(30)
  pdf.rule(left, pdf.cursor, right, RULE, 0.6)
  line(18)
  pdf.text(
    owing === 0
      ? 'Semua udah lunas.'
      : `Tinggal ${owing} dari ${breakdown.length} orang yang belum lunas.`,
    left,
    pdf.cursor,
    { size: 11, font: prose },
  )
  line(14)
  pdf.text('Semua angka dalam rupiah.', left, pdf.cursor, { size: 9, color: INK3 })

  return pdf.build()
}
