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
