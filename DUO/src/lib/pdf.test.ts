/**
 * Tests for the PDF writer.
 *
 * The fragile part is not the drawing, it is the cross-reference table: every
 * entry has to be the byte offset of an object that had not been written yet at
 * the time the entry was made. Get it wrong and the file opens in one reader and
 * not another, which is the kind of bug that reaches a group chat before it
 * reaches a test. So the offsets are checked against the bytes they claim to
 * point at, not just counted.
 */

import { describe, expect, test } from 'bun:test'
import { buildNotaPdf, Pdf, serifWidth, textWidth, type NotaFont } from './pdf'
import { allocateBill, type ExportBill } from './export'
import { FIRST_CHAR, LAST_CHAR, readMetrics } from './ttf'

/**
 * The real face, read off disk.
 *
 * Not a fixture. The whole point of this file being here is that a genuine
 * TrueType font survives the trip into a PDF, and a hand-made stand-in would
 * have none of the tables that make it fiddly — no cmap to look a character up
 * in, no hmtx to measure it with.
 */
const fontBytes = new Uint8Array(
  await Bun.file(new URL('../../public/fonts/plex-serif-600.ttf', import.meta.url)).arrayBuffer(),
)
const font: NotaFont = {
  data: fontBytes,
  flate: false,
  uncompressed: fontBytes.length,
  metrics: readMetrics(fontBytes)!,
}

const bill: ExportBill = {
  ref_code: '9PMXR2KV',
  bill_date: '2026-06-14',
  place: 'Warung Bu Siti',
  total: 75900,
  bank_name: 'BCA',
  account_number: '1234567890',
  account_holder: 'Alee',
  paid_by_person: null,
  qris_path: null,
  payment_method: 'bank',
  items: [
    { name: 'Nasi Goreng', qty: 1, line_total: 25000, assigned_to: ['Budi'] },
    { name: 'Es Teh', qty: 2, line_total: 16000, assigned_to: ['Budi', 'Sarah'] },
    { name: 'Kentang Goreng Gede', qty: 1, line_total: 30000, assigned_to: ['Sarah'] },
  ],
  shares: [
    {
      pay_token: null,
      amount_paid: 0,
      payments: [],
      person: 'Budi',
      discount_share: 2817,
      tax_share: 3718,
      service_share: 1859,
      rounding_share: 0,
      amount_owed: 42760,
      status: 'lunas',
      paid_date: '2026-06-15',
    },
    {
      pay_token: null,
      amount_paid: 0,
      payments: [],
      person: 'Sarah',
      discount_share: 2183,
      tax_share: 2882,
      service_share: 1441,
      rounding_share: 0,
      amount_owed: 33140,
      status: 'belum lunas',
      paid_date: null,
    },
  ],
}

async function bytes(billData: ExportBill): Promise<string> {
  const blob = buildNotaPdf(billData, allocateBill(billData))
  return Buffer.from(await blob.arrayBuffer()).toString('latin1')
}

describe('pdf writer', () => {
  test('courier is measured exactly, so right alignment lands on the margin', () => {
    // 0.6em per character is the whole reason this writer needs no metrics
    // table, and the reason the money column can be right-aligned at all.
    expect(textWidth('1234567890', 10)).toBe(60)
  })

  test('refuses a right-aligned proportional font rather than left-aligning it', () => {
    const pdf = new Pdf()
    expect(() => pdf.text('x', 100, 100, { font: 'sans', align: 'right' })).toThrow(
      /needs a measured font/,
    )
  })

  test('refuses a right-aligned serif when no font was embedded', () => {
    // The face is named in the font table whether or not the file came with
    // it. Drawing anyway would left-align a figure against the margin it was
    // supposed to end at, which is a column that silently stops adding up.
    const pdf = new Pdf()
    expect(() => pdf.text('x', 100, 100, { font: 'serif', align: 'right' })).toThrow(
      /needs a measured font/,
    )
  })

  test('escapes the characters that would end a PDF string early', async () => {
    const s = await bytes({ ...bill, place: 'Kopi (Spesial) \\ Enak' })
    // The raw stream must carry the escapes; an unescaped ")" truncates the
    // string and the rest of the file parses as garbage.
    expect(s).toContain('Kopi \\(Spesial\\)')
  })

  test('is a well-formed PDF', async () => {
    const s = await bytes(bill)
    expect(s.startsWith('%PDF-1.4')).toBe(true)
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(s).toMatch(/trailer\n<< \/Size \d+ \/Root 1 0 R >>/)
  })

  test('every xref entry points at the object it claims', async () => {
    const s = await bytes(bill)
    const xrefAt = s.indexOf('\nxref\n') + 1
    expect(Number(s.match(/startxref\n(\d+)/)?.[1])).toBe(xrefAt)

    const entries = [...s.slice(xrefAt).matchAll(/^(\d{10}) (\d{5}) [nf] $/gm)]
    // one free entry, plus catalog, pages, four fonts, page, content
    expect(entries.length).toBe(9)

    entries.slice(1).forEach((entry, i) => {
      const offset = Number(entry[1])
      expect(s.startsWith(`${i + 1} 0 obj`, offset)).toBe(true)
    })
  })

  test('carries the itemisation, including the shared marker', async () => {
    const s = await bytes(bill)
    expect(s).toContain('(Nasi Goreng)')
    // A fraction on the line, the way a receipt prints a shared dish, rather
    // than a word beside it.
    expect(s).toContain('(Es Teh  1/2)')
    expect(s).toContain('(42.760)')
    expect(s).toContain('(Sudah lunas)')
  })

  /*
   * The links are the reason this is a PDF and not a print dialog: on a phone,
   * selecting a 36-character UUID out of a PDF by hand is close to impossible,
   * so a link that is not a real annotation is a link that cannot be used.
   *
   * An annotation is also the one part of the output that some readers reject
   * the whole file for when it is malformed, which is why this asserts on the
   * assembled dictionaries rather than on my having written them.
   *
   * The address is only ever in the annotation. What the page shows is the word
   * that says what the row does, which is why these assertions are about the
   * two being in the same place rather than about the URL being on the page.
   */
  describe('payment links', () => {
    const BASE = 'https://splitfair.xyz/'
    const TOKEN = 'aaaabbbb-1111-4222-8333-ccccddddeeee'
    const withLinks = async (billData: ExportBill, base = BASE) =>
      Buffer.from(await buildNotaPdf(billData, allocateBill(billData), base).arrayBuffer()).toString('latin1')

    /*
     * Sarah is the unpaid one in this fixture and Budi is `lunas`, and the
     * tests below turn on that. The first version of this file put the token on
     * Budi and two of them passed for the wrong reason — a settled share is
     * filtered out whether or not it has a token, so "no link" proved nothing.
     */
    const unpaid = (patch: Partial<ExportBill['shares'][number]>): ExportBill => ({
      ...bill,
      shares: [{ ...bill.shares[0] }, { ...bill.shares[1], pay_token: TOKEN, ...patch }],
    })

    test('carries no annotations when nobody has a token', async () => {
      // The fixtures have pay_token: null, which is a real state — a bill made
      // before the links existed. The section is skipped and the page
      // dictionary gains nothing.
      expect(await withLinks(bill)).not.toContain('/Annots')
    })

    test('a bill with an unpaid share gets one tappable row', async () => {
      const s = await withLinks(unpaid({}))
      expect(s).toContain('/Subtype /Link')
      expect(s).toContain(`(https://splitfair.xyz/#/bayar?t=${TOKEN})`)
      expect(s.match(/\/Subtype \/Link/g)?.length).toBe(1)
    })

    /*
     * Where the word is drawn. Not `s.indexOf('Pembayaran')` — the page
     * dictionary is written before the content stream, so anything searching
     * the whole file for a string the annotation also carries finds the
     * annotation, and every assertion after it is about the wrong bytes. That
     * cost two red tests when the row carried the URL.
     */
    const drawnAt = (s: string) => s.indexOf('(Pembayaran) Tj')

    test('the link is a word, and the URL is nowhere on the page', async () => {
      // A 36-character UUID in 7.5pt monospace was a line of small print that
      // said nothing a reader wanted to read. It travels in the annotation,
      // which is all a tap follows, and the page says what the row does.
      const s = await withLinks(unpaid({}))
      expect(drawnAt(s)).toBeGreaterThan(-1)
      expect(s).not.toContain(`(#/bayar?t=${TOKEN}) Tj`)
    })

    test('the link sits in that person own block, not in a section at the foot', async () => {
      // Under their items, so the document says whose credential it is by
      // position. Collected at the foot it was a row of small print that had to
      // be read across to find your own name.
      const s = await withLinks(unpaid({}))
      const at = drawnAt(s)
      // Past the ledger's footer, and before the pay block: inside the slips,
      // which is the section the person's own card lives in.
      expect(at).toBeGreaterThan(s.indexOf('(Total struk)'))
      expect(at).toBeLessThan(s.indexOf('(Cara bayar)'))
    })

    test('the link is set in the deep accent, readable on the wash', async () => {
      // The deeper tone rather than the accent itself, because the row sits on
      // the washed band and #d04a02 on #fdf2ea is under 4.5:1 — the same reason
      // the screen's version of this row is `--accent-deep`. Asserted on the
      // operator holding the word rather than on the row.
      const s = await withLinks(unpaid({}))
      const at = drawnAt(s)
      const op = s.slice(s.lastIndexOf('BT ', at), s.indexOf('Tj ET', at))
      expect(op).toContain('0.659 0.231 0 rg')
    })

    test('the tappable rectangle sits over the word', async () => {
      // The rect is a fixed width because the writer cannot measure a
      // proportional face. If the word ever outgrows it the link still works
      // and only part of it is tappable, which is the failure this catches.
      const s = await withLinks(unpaid({}))
      const rect = s.match(/\/Rect \[([\d.]+) [\d.]+ ([\d.]+) [\d.]+\]/)
      expect(rect).not.toBeNull()

      const [x1, x2] = [Number(rect![1]), Number(rect![2])]
      // Ten points of Helvetica, estimated generously at half its length.
      const wordEndsBy = 48 + 12 + 'Pembayaran'.length * 5
      expect(x2).toBeGreaterThan(wordEndsBy)
    })

    test('a settled share gets no link, even with a token', async () => {
      // Handing somebody a payment link for a bill they have already paid is a
      // good way to be paid twice.
      const linked: ExportBill = {
        ...bill,
        shares: [{ ...bill.shares[0], pay_token: TOKEN }, { ...bill.shares[1] }],
      }
      expect(await withLinks(linked)).not.toContain('/Annots')
    })

    test('a part-paid share still gets one, it just owes less', async () => {
      expect(await withLinks(unpaid({ amount_paid: 10000 }))).toContain('/Subtype /Link')
    })

    test('the annotation rectangle stays on the page', async () => {
      // A rect outside the MediaBox is not an error any reader reports — it
      // just silently is not there. Both edges are checked because a negative
      // width would put the right edge left of the left one and look fine to
      // an assertion that only checked the first number.
      const rect = (await withLinks(unpaid({}))).match(
        /\/Rect \[([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)\]/,
      )
      expect(rect).not.toBeNull()

      const [x1, y1, x2, y2] = rect!.slice(1).map(Number)
      expect(x1).toBeGreaterThanOrEqual(0)
      expect(x2).toBeLessThanOrEqual(595.28)
      expect(x1).toBeLessThan(x2)
      expect(y1).toBeGreaterThanOrEqual(0)
      expect(y2).toBeLessThanOrEqual(841.89)
      expect(y1).toBeLessThan(y2)
    })

    test('the vendor payer gets no link, even while their share reads unpaid', async () => {
      // The rule, not the mechanism. Their share being settled is what normally
      // keeps them out of this list, and that is written by a separate call —
      // so if the marker landed and the status write did not, the document
      // would tell somebody they paid the vendor and then ask them to pay.
      const linked: ExportBill = {
        ...unpaid({}),
        paid_by_person: 'Sarah',
      }
      const s = await withLinks(linked)
      expect(s).toContain('(Yang bayar ke vendor)')
      expect(s).toContain('(Bagian dia, sudah termasuk)')
      expect(s).not.toContain('/Subtype /Link')
    })

    test('an empty base URL prints nothing rather than a broken link', async () => {
      const s = await withLinks(unpaid({}), '')
      expect(s).not.toContain('/Annots')
      expect(s).not.toContain('#/bayar')
    })
  })

  /*
   * The figures, which are the only text whose placement is arithmetic. The
   * document has four right-aligned columns now — three in the ledger and one
   * on each slip — so the old assertion that everything ends on the margin is
   * no longer true and no longer the point. What is still true, and is what
   * would break first, is that nothing ends past it.
   */
  test('no figure ends past the right margin', async () => {
    const s = await bytes(bill)
    const RIGHT = 595.28 - 48
    const ops = [...s.matchAll(/\/F[34] ([\d.]+) Tf 1 0 0 1 ([\d.]+) [\d.]+ Tm \(([\d.]+)\) Tj/g)]
    expect(ops.length).toBeGreaterThan(6)

    const edges = new Set<number>()
    for (const [, size, x, text] of ops) {
      const end = Number(x) + textWidth(text, Number(size))
      expect(end).toBeLessThanOrEqual(RIGHT + 0.5)
      edges.add(Math.round(end))
    }

    // And that they are columns rather than a ragged edge: the ledger's three
    // money columns plus the slips' inset one.
    expect(edges.size).toBeGreaterThanOrEqual(4)
  })

  /*
   * The arithmetic the document claims. Each slip is checked against itself
   * rather than recomputed, which is what catches a change to one of the two
   * renderings and not the other — the same thing the design's own checker does
   * against its HTML.
   */
  test('each slip adds up, and the ledger columns sum to its footer', async () => {
    const s = await bytes(bill)

    // Budi's slip, bounded by the next person's slip and not by their ledger
    // row — the ledger comes first, so searching back from it gives an empty
    // slice and a test that passes because it checked nothing.
    const from = s.indexOf('(Nasi Goreng)')
    const slip = s.slice(from, s.indexOf('(Sarah)', from))

    // In the order they are drawn: the two items, the subtotal, the charge,
    // the band.
    const figures = [...slip.matchAll(/\(([\d.]+)\) Tj/g)].map((m) =>
      Number(m[1].replace(/\./g, '')),
    )
    expect(figures).toHaveLength(5)

    const [first, second, subtotal, charge, total] = figures
    expect(first + second).toBe(subtotal)
    expect(subtotal + charge).toBe(total)
  })

  /*
   * The embedded face. Everything here is about the two places it can go
   * quietly wrong: the object numbering, which is what the xref depends on, and
   * the widths, which is what every right-aligned figure depends on.
   */
  describe('the embedded serif', () => {
    const serifPdf = () => {
      const pdf = new Pdf(font)
      pdf.text('456.225', pdf.right, pdf.cursor, { size: 22, font: 'serif', align: 'right' })
      return pdf
    }

    test('measures a proportional face, not a monospaced one', () => {
      // 600 units for every digit and 278 for the stop, against Courier's flat
      // 0.6em — if these ever come out equal the widths are not being read.
      expect(serifWidth(font.metrics, '456.225', 22)).toBeCloseTo(85.32, 1)
      expect(textWidth('456.225', 22)).toBeCloseTo(92.4, 1)
      expect(font.metrics.widths).toHaveLength(LAST_CHAR - FIRST_CHAR + 1)
    })

    test('every character the writer emits has a glyph to measure', () => {
      // The writer's WINANSI table maps these to bytes; a byte the font has no
      // glyph for measures zero, and a figure on the same line is then placed
      // as though the character were not there.
      for (const code of [0x97, 0x96, 0x91, 0x92, 0x93, 0x94, 0x85, 0xb7, 0xd7, 0x2d, 0xbd]) {
        const width = serifWidth(font.metrics, String.fromCharCode(code), 10)
        expect(`${code.toString(16)}:${width > 0}`).toBe(`${code.toString(16)}:true`)
      }
    })

    test('carries the font, its descriptor and its file', async () => {
      const s = Buffer.from(await serifPdf().build().arrayBuffer()).toString('latin1')
      expect(s).toContain('/Subtype /TrueType')
      expect(s).toContain('/Encoding /WinAnsiEncoding')
      expect(s).toContain('/FontFile2 11 0 R')
      expect(s).toContain(`/Length1 ${fontBytes.length}`)
      // The bytes really are in there, not a reference to something absent.
      expect(s).toContain('/Flags 34')
      expect(s.length).toBeGreaterThan(fontBytes.length)
    })

    test('the font objects do not disturb the xref', async () => {
      const s = Buffer.from(await serifPdf().build().arrayBuffer()).toString('latin1')
      const xrefAt = s.indexOf('\nxref\n') + 1
      expect(Number(s.match(/startxref\n(\d+)/)?.[1])).toBe(xrefAt)

      // one free entry, catalog, pages, four fonts, page, content, then the
      // face: font, descriptor, file
      const entries = [...s.slice(xrefAt).matchAll(/^(\d{10}) (\d{5}) [nf] $/gm)]
      expect(entries.length).toBe(12)

      entries.slice(1).forEach((entry, i) => {
        expect(s.startsWith(`${i + 1} 0 obj`, Number(entry[1]))).toBe(true)
      })
      // Numbered past every page object, so adding a face cannot move one.
      expect(s.startsWith('9 0 obj', Number(entries[9][1]))).toBe(true)
    })

    test('a right-aligned figure ends on the margin', async () => {
      // The whole reason the widths are read at all. Asserted as arithmetic
      // rather than against a constant, because the placement is the thing that
      // would be wrong and the constant would have to be wrong with it.
      const s = Buffer.from(await serifPdf().build().arrayBuffer()).toString('latin1')
      const op = s.match(/\/F5 22 Tf 1 0 0 1 ([\d.]+) [\d.]+ Tm \((456\.225)\) Tj/)
      expect(op).not.toBeNull()

      const placed = Number(op![1])
      expect(placed + serifWidth(font.metrics, '456.225', 22)).toBeCloseTo(595.28 - 48, 1)
    })
  })

  /*
   * The QRIS is not in this document. The payer's own page shows the code, and
   * that page is one tap from here — so what this writer has to get right is
   * not drawing it, and not printing a transfer the operator turned off.
   */
  describe('which way to pay', () => {
    const withMethod = async (method: ExportBill['payment_method']): Promise<string> => {
      const b: ExportBill = { ...bill, payment_method: method, qris_path: 'u/a.jpg' }
      return Buffer.from(await buildNotaPdf(b, allocateBill(b)).arrayBuffer()).toString('latin1')
    }

    test('a qris-only bill prints no transfer box, even with an account number', async () => {
      // The fixture has a BCA account number. Printing it would send somebody
      // to a method the operator turned off.
      const s = await withMethod('qris')
      expect(s).not.toContain('Transfer ke')
      expect(s).not.toContain('1234567890')
    })

    test('a bank-only bill prints the transfer box', async () => {
      // The bill can carry a code and still ask for a transfer — that is what
      // `payment_method` is stored for rather than derived from qris_path.
      const s = await withMethod('bank')
      expect(s).toContain('Transfer ke')
    })

    test('offering both prints the transfer box without the code', async () => {
      const s = await withMethod('both')
      expect(s).toContain('Transfer ke')
      // Nothing in the writer can draw one, so this is really an assertion that
      // no half-removed QRIS plumbing grew back.
      expect(s).not.toContain('/Subtype /Image')
    })
  })
})
