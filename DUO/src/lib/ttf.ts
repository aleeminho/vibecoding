/**
 * Just enough TrueType to put a real font in the nota.
 *
 * The PDF writer's whole trick is that it never needed this: the money column
 * is Courier, Courier's advance is exactly 0.6em, so right-alignment is
 * arithmetic. A proportional serif has no such number — every glyph is its own
 * width — and the widths are only in the font file. PDF also wants the font box
 * and the ascent/descent for its descriptor, and those are in there too.
 *
 * So this reads four tables and nothing else:
 *
 *   head   unitsPerEm, the font box, and how `loca` is encoded
 *   hhea   ascender, descender, and how many `hmtx` entries are real
 *   hmtx   the advance width of every glyph
 *   cmap   which glyph a character code means (format 4, the one text fonts use)
 *
 * What it does NOT do is modify the font. The whole file is embedded as it
 * arrived, `/FontFile2`, so there is no subsetter here and no way to corrupt
 * one. Flate on the way into the PDF takes 155KB down to about 70KB, which is
 * why subsetting was not worth the code.
 */

/** The character range a PDF simple font declares. WinAnsi is 32..255. */
export const FIRST_CHAR = 32
export const LAST_CHAR = 255

/** PDF states widths and boxes in thousandths of an em, whatever the font says. */
const PDF_UNITS = 1000

export interface FontMetrics {
  /**
   * Advance width per character code, from FIRST_CHAR to LAST_CHAR, in 1/1000
   * em. Zero where the font has no glyph for that code, which is what a PDF
   * reader wants to see for a character it cannot draw.
   */
  widths: number[]
  /** The font box in 1/1000 em: [xMin, yMin, xMax, yMax]. */
  bbox: [number, number, number, number]
  ascent: number
  descent: number
  capHeight: number
}

function u16(b: Uint8Array, at: number): number {
  return (b[at] << 8) | b[at + 1]
}

function u32(b: Uint8Array, at: number): number {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0
}

function i16(b: Uint8Array, at: number): number {
  const v = u16(b, at)
  return v >= 0x8000 ? v - 0x10000 : v
}

interface Table {
  offset: number
  length: number
}

/** The table directory: a tag, an offset and a length for each table. */
function directory(bytes: Uint8Array): Map<string, Table> {
  const tables = new Map<string, Table>()
  const count = u16(bytes, 4)

  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16
    const tag = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3])
    tables.set(tag, { offset: u32(bytes, at + 8), length: u32(bytes, at + 12) })
  }

  return tables
}

/**
 * The (3,1) Unicode subtable, which is the one that maps a character code to a
 * glyph in a font meant for Windows — the same thing WinAnsiEncoding means.
 *
 * Format 4 only. It is the format every text font carries, and a font without
 * one is a font this returns null for rather than guesses at; the caller then
 * sets the document in the faces that do not need measuring.
 */
function unicodeSubtable(bytes: Uint8Array, cmap: Table): number | null {
  const count = u16(bytes, cmap.offset + 2)

  for (let i = 0; i < count; i++) {
    const at = cmap.offset + 4 + i * 8
    const platform = u16(bytes, at)
    const encoding = u16(bytes, at + 2)
    // (3,1) is Windows Unicode BMP; (0,x) is Unicode, which is the same table
    // under a different platform id in fonts built on a Mac.
    const wanted = (platform === 3 && encoding === 1) || (platform === 0 && encoding <= 4)
    if (!wanted) continue

    const sub = cmap.offset + u32(bytes, at + 4)
    if (u16(bytes, sub) === 4) return sub
  }

  return null
}

/**
 * What the codes from 0x80 to 0x9F mean in WinAnsi.
 *
 * These are the only codes where a byte is not its own Unicode code point.
 * 0x97 is an em dash, not U+0097 — and the difference is not academic: the
 * writer emits an em dash as byte 0x97, and looking that up in the font's
 * Unicode table finds a control character the font has no glyph for, so the
 * dash measures zero and every figure on a line with one is placed wrong.
 *
 * Undefined slots are absent rather than mapped to something, and get a width
 * of zero, which is what a reader wants for a character it cannot draw.
 */
const WINANSI_HIGH: Record<number, number> = {
  0x80: 0x20ac, // €
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026, // …
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x8e: 0x017d,
  0x91: 0x2018, // ‘
  0x92: 0x2019, // ’
  0x93: 0x201c, // “
  0x94: 0x201d, // ”
  0x95: 0x2022,
  0x96: 0x2013, // –
  0x97: 0x2014, // —
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9e: 0x017e,
  0x9f: 0x0178,
}

/** The Unicode code point a WinAnsi byte stands for, or null if undefined. */
function winAnsiToUnicode(code: number): number | null {
  if (code >= 0x80 && code <= 0x9f) return WINANSI_HIGH[code] ?? null
  return code
}

/** Format 4's segmented lookup. Returns a glyph id, or 0 for "no glyph". */
function glyphFor(bytes: Uint8Array, sub: number, code: number): number {
  const segCountX2 = u16(bytes, sub + 6)
  const ends = sub + 14
  const starts = ends + segCountX2 + 2
  const deltas = starts + segCountX2
  const ranges = deltas + segCountX2

  for (let i = 0; i < segCountX2; i += 2) {
    if (u16(bytes, ends + i) < code) continue
    if (u16(bytes, starts + i) > code) return 0

    const delta = i16(bytes, deltas + i)
    const range = u16(bytes, ranges + i)
    if (range === 0) return (code + delta) & 0xffff

    // The offset is relative to its own slot, which is the one genuinely odd
    // thing about this format: the array is walked by adding to the address of
    // the entry being read.
    const at = ranges + i + range + (code - u16(bytes, starts + i)) * 2
    if (at + 1 >= bytes.length) return 0
    const glyph = u16(bytes, at)
    return glyph === 0 ? 0 : (glyph + delta) & 0xffff
  }

  return 0
}

/**
 * Read the metrics a PDF font dictionary needs.
 *
 * Returns null for anything that is not a TrueType font with a Unicode cmap,
 * which is the caller's cue to fall back rather than to write a descriptor full
 * of zeros — a font with no widths is a document where every right-aligned
 * figure is in the wrong place.
 */
export function readMetrics(bytes: Uint8Array): FontMetrics | null {
  if (bytes.length < 12 || u32(bytes, 0) !== 0x00010000) return null

  const tables = directory(bytes)
  const head = tables.get('head')
  const hhea = tables.get('hhea')
  const hmtx = tables.get('hmtx')
  const cmapTable = tables.get('cmap')
  if (!head || !hhea || !hmtx || !cmapTable) return null

  const sub = unicodeSubtable(bytes, cmapTable)
  if (sub === null) return null

  const unitsPerEm = u16(bytes, head.offset + 18)
  if (!unitsPerEm) return null

  const scale = (v: number) => Math.round((v * PDF_UNITS) / unitsPerEm)

  const metrics = u16(bytes, hhea.offset + 34)
  const advance = (glyph: number) => {
    const at = Math.min(glyph, metrics - 1)
    return u16(bytes, hmtx.offset + at * 4)
  }

  const widths: number[] = []
  for (let code = FIRST_CHAR; code <= LAST_CHAR; code++) {
    const unicode = winAnsiToUnicode(code)
    const glyph = unicode === null ? 0 : glyphFor(bytes, sub, unicode)
    widths.push(glyph === 0 ? 0 : scale(advance(glyph)))
  }

  // Cap height lives in OS/2 from version 2 on. Where it is missing, three
  // quarters of the ascent is the usual estimate and is only ever used for the
  // descriptor, not for placing anything.
  const os2 = tables.get('OS/2')
  const version = os2 ? u16(bytes, os2.offset) : 0
  const ascent = scale(u16(bytes, hhea.offset + 4))
  const capHeight =
    os2 && version >= 2 ? scale(u16(bytes, os2.offset + 88)) : Math.round(ascent * 0.75)

  return {
    widths,
    bbox: [
      scale(i16(bytes, head.offset + 36)),
      scale(i16(bytes, head.offset + 38)),
      scale(i16(bytes, head.offset + 40)),
      scale(i16(bytes, head.offset + 42)),
    ],
    // hhea's ascender and descender are unsigned for the ascender and signed
    // for the descender, which PDF wants as a negative too.
    ascent,
    descent: scale(i16(bytes, hhea.offset + 6)),
    capHeight,
  }
}

/** The width of one character code, in 1/1000 em. */
export function widthOf(metrics: FontMetrics, code: number): number {
  return code >= FIRST_CHAR && code <= LAST_CHAR ? metrics.widths[code - FIRST_CHAR] : 0
}
