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
import { buildNotaPdf, Pdf, textWidth, type QrisImage } from './pdf'
import { allocateBill, type ExportBill } from './export'

const bill: ExportBill = {
  ref_code: 'BILL_20260614_001',
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

/**
 * A JPEG header for the writer to read — not a decodable image, and not meant
 * to be. Only the SOF marker is parsed, so a real one would be a hundred
 * kilobytes of fixture for the same three numbers.
 *
 * The bytes are deliberately free of 0x0a, so the xref line count in the test
 * below cannot be inflated by a binary line that happens to look like an entry.
 */
function fakeJpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0 with an empty payload
    0xff, 0xc0, 0x00, 0x11, 0x08, // SOF0, 17-byte segment, 8 bits per channel
    height >> 8, height & 0xff,
    width >> 8, width & 0xff,
    0x03, // three components, which is what the canvas encoder produces
    0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, // component specs
    0xff, 0xd9, // EOI
  ])
}

describe('pdf writer', () => {
  test('courier is measured exactly, so right alignment lands on the margin', () => {
    // 0.6em per character is the whole reason this writer needs no metrics
    // table, and the reason the money column can be right-aligned at all.
    expect(textWidth('1234567890', 10)).toBe(60)
  })

  test('refuses a right-aligned proportional font rather than left-aligning it', () => {
    const pdf = new Pdf()
    expect(() => pdf.text('x', 100, 100, { font: 'sans', align: 'right' })).toThrow(/monospaced/)
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
    expect(s).toContain('Es Teh  \\(dibagi 2\\)')
    expect(s).toContain('(42.760)')
    expect(s).toContain('sudah bayar')
  })

  /*
   * The links are the reason this is a PDF and not a print dialog: on a phone,
   * selecting a 36-character UUID out of a PDF by hand is close to impossible,
   * so a link that is not a real annotation is a link that cannot be used.
   *
   * An annotation is also the one part of the output that some readers reject
   * the whole file for when it is malformed, which is why this asserts on the
   * assembled dictionaries rather than on my having written them.
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

    test('the widest deployment still fits beside the longest name', () => {
      // The name is left-aligned at the margin and the URL is right-aligned,
      // so the two collide silently once they are wider than the column
      // together — and there is nothing in the output that says so. GitHub
      // Pages is the longest of the three places this is served from, and a
      // twenty-character Indonesian name is not unusual.
      const COLUMN = 595.28 - 48 - 48
      const longestName = 'Muhammad Alifikri Wijaya'.slice(0, 20)
      const pagesUrl = 'https://aleeminho.github.io/vibecoding/#/bayar?t=00000000-0000-4000-8000-000000000000'

      // Helvetica is proportional and this writer has no metrics table for it,
      // so the name is estimated at about half its length in points at 9.5pt —
      // deliberately generous, because the point of the check is to catch a
      // collision with room to spare rather than to be exact.
      const nameWidth = longestName.length * 5
      const urlWidth = textWidth(pagesUrl, 7.5)

      expect(nameWidth + urlWidth).toBeLessThan(COLUMN)
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
      expect(s).toContain('yang bayar ke vendor')
      expect(s).not.toContain('/Subtype /Link')
    })

    test('an empty base URL prints nothing rather than a broken link', async () => {
      const s = await withLinks(unpaid({}), '')
      expect(s).not.toContain('/Annots')
      expect(s).not.toContain('#/bayar')
    })
  })

  /*
   * Only the figures. Everything else in a monospaced face sits somewhere
   * deliberate: "Rp" is placed to the left of the total, the + and − have their
   * own inset column so the arithmetic reads down the page, and the account
   * number sits inside a box with its own padding. Asserting on every
   * monospaced run makes those look like failures when they are the layout.
   */
  test('every figure ends exactly at the right margin', async () => {
    const s = await bytes(bill)
    const RIGHT = 595.28 - 48
    const ops = [...s.matchAll(/\/F[34] ([\d.]+) Tf 1 0 0 1 ([\d.]+) [\d.]+ Tm \(([\d.]+)\) Tj/g)]
    // the two person totals, four item lines, two of them shared, and the
    // PPN and Service lines
    expect(ops.length).toBeGreaterThan(6)
    for (const [, size, x, text] of ops) {
      const end = Number(x) + textWidth(text, Number(size))
      expect(Math.abs(end - RIGHT)).toBeLessThan(0.5)
    }
  })

  /*
   * The code, which is the one part of this document somebody acts on rather
   * than reads. It is drawn rather than linked because the payer is often not
   * the person holding the phone, and both failure modes here are quiet: an
   * image object that is not referenced draws nothing, and one whose object
   * number is wrong draws nothing in some readers and the whole file fails in
   * others.
   */
  describe('the QRIS code', () => {
    const URL = 'https://x.supabase.co/storage/v1/object/public/qris/u/a.jpg'
    const attached: ExportBill = { ...bill, qris_path: 'u/a.jpg', payment_method: 'qris' }

    const withQris = async (
      patch: Partial<ExportBill> = {},
      qris: QrisImage | null = { jpeg: fakeJpeg(240, 240), url: URL },
    ): Promise<string> => {
      const b: ExportBill = { ...attached, ...patch }
      return Buffer.from(await buildNotaPdf(b, allocateBill(b), '', qris).arrayBuffer()).toString(
        'latin1',
      )
    }

    test('draws the code and names it in the page resources', async () => {
      const s = await withQris()
      expect(s).toContain('/Subtype /Image')
      expect(s).toContain('/Filter /DCTDecode')
      // The size comes off the SOF marker, and the dictionary has to carry the
      // source pixels rather than the placement — a reader that took these as
      // points would draw the code at a quarter of its size.
      expect(s).toContain('/Width 240 /Height 240')
      expect(s).toContain('/ColorSpace /DeviceRGB')
      expect(s).toContain('/XObject << /Im1')
      expect(s).toContain('/Im1 Do')
    })

    test('the image object does not disturb the xref', async () => {
      const s = await withQris()
      const xrefAt = s.indexOf('\nxref\n') + 1
      expect(Number(s.match(/startxref\n(\d+)/)?.[1])).toBe(xrefAt)

      // one free entry, plus catalog, pages, four fonts, page, content, image
      const entries = [...s.slice(xrefAt).matchAll(/^(\d{10}) (\d{5}) [nf] $/gm)]
      expect(entries.length).toBe(10)

      entries.slice(1).forEach((entry, i) => {
        expect(s.startsWith(`${i + 1} 0 obj`, Number(entry[1]))).toBe(true)
      })
      // Last, so that adding one cannot move a page or a content object.
      expect(s.startsWith('9 0 obj', Number(entries[9][1]))).toBe(true)
    })

    test('a code that is not a JPEG falls back to a link rather than a blank box', async () => {
      // The bytes a PNG screenshot would start with. The writer cannot embed
      // it, and a silently-skipped image would leave the label with nothing
      // under it.
      const png: QrisImage = { jpeg: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d]), url: URL }
      const s = await withQris({}, png)
      expect(s).not.toContain('/Subtype /Image')
      expect(s).toContain('/Subtype /Link')
      expect(s).toContain(`(${URL})`)
    })

    test('an offline phone still produces a document that says how to pay', async () => {
      const s = await withQris({}, { jpeg: null, url: URL })
      expect(s).not.toContain('/Subtype /Image')
      expect(s).toContain('Buka kode QR')
    })

    test('a qris-only bill prints no transfer box, even with an account number', async () => {
      // The fixture has a BCA account number. Printing it would send somebody
      // to a method the operator turned off.
      const s = await withQris()
      expect(s).toContain('Scan QRIS')
      expect(s).not.toContain('Transfer ke')
      expect(s).not.toContain('1234567890')
    })

    test('a bank-only bill prints the transfer box and no code', async () => {
      // The bill can carry a code and still ask for a transfer — that is what
      // `payment_method` is stored for rather than derived.
      const s = await withQris({ payment_method: 'bank' })
      expect(s).not.toContain('/Subtype /Image')
      expect(s).not.toContain('Scan QRIS')
      expect(s).toContain('Transfer ke')
    })

    test('offering both prints both', async () => {
      const s = await withQris({ payment_method: 'both' })
      expect(s).toContain('/Subtype /Image')
      expect(s).toContain('Transfer ke')
    })
  })
})
