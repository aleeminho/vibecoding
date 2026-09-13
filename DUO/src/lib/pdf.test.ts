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
      expect(at).toBeGreaterThan(s.indexOf('(Sarah)'))
      expect(at).toBeLessThan(s.indexOf('cocok dengan total struk'))
    })

    test('the link is set in the accent the bill total is set in', async () => {
      // Which is what makes it read as something to press. Asserted on the
      // operator holding the word rather than on the row, because the accent is
      // the only thing distinguishing it from the quiet small print around it.
      const s = await withLinks(unpaid({}))
      const at = drawnAt(s)
      const op = s.slice(s.lastIndexOf('BT ', at), s.indexOf('Tj ET', at))
      expect(op).toContain('0.816 0.29 0.008 rg')
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
