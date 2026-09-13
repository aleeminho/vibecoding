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
import { buildNotaPdf, Pdf, textWidth } from './pdf'
import { allocateBill, type ExportBill } from './export'

const bill: ExportBill = {
  ref_code: 'BILL_20260614_001',
  bill_date: '2026-06-14',
  place: 'Warung Bu Siti',
  total: 75900,
  bank_name: 'BCA',
  account_number: '1234567890',
  account_holder: 'Alee',
  items: [
    { name: 'Nasi Goreng', qty: 1, line_total: 25000, assigned_to: ['Budi'] },
    { name: 'Es Teh', qty: 2, line_total: 16000, assigned_to: ['Budi', 'Sarah'] },
    { name: 'Kentang Goreng Gede', qty: 1, line_total: 30000, assigned_to: ['Sarah'] },
  ],
  shares: [
    {
      pay_token: null,
      amount_paid: 0,
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
})
