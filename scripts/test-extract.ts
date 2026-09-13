/**
 * Offline test for the receipt extraction step.
 *
 * Runs the exact same model, prompt and schema as the deployed Edge Function
 * (both import from supabase/functions/extract-receipt/prompt.ts), but calls
 * the API directly from this machine. That means the riskiest part of the whole
 * app — can the model read a real Indonesian receipt correctly — can be
 * verified before anything is deployed or any UI is built.
 *
 * It also runs the real client-side pipeline on the result: strip the code
 * fence, parse, normalize, then the gates and the split. So a failure here is
 * a failure the app would actually hit, not an artefact of the test.
 *
 * Usage:
 *
 *   bun run test:extract <path-to-receipt-photo>
 *
 * The key is read from .env.local, which Bun loads automatically. No export,
 * no per-run setup.
 *
 * What it checks:
 *   1. The response survives stripCodeFence + JSON.parse + normalizeExtraction.
 *   2. Gate 1, the receipt's own arithmetic.
 *   3. Gate 2, that the item line totals sum to the printed subtotal.
 *   4. That a single-person split of the whole bill reproduces the printed
 *      total exactly, which exercises the real computeSplit path.
 *   5. If the photo is a known fixture, an exact comparison against the values
 *      read off the receipt by hand.
 *
 * It does not test assignment, because that is the operator's job on the review
 * screen and is not something the model can know.
 */

import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { GoogleGenAI } from '@google/genai'
import {
  EXTRACTION_SCHEMA,
  MODEL,
  PROMPT,
} from '../supabase/functions/extract-receipt/prompt.ts'
import { normalizeExtraction, stripCodeFence } from '../src/lib/normalize.ts'
import { checkGate1, checkGate2, computeSplit } from '../src/lib/split.ts'
import type { AssignedItem } from '../src/lib/types.ts'

// ---------------------------------------------------------------------------
// Known fixtures
//
// Values read off the photo by hand, so a model regression shows up as a failed
// assertion rather than as a plausible-looking wrong number. Add a new entry
// each time a receipt is checked by eye and agreed to be correct.
// ---------------------------------------------------------------------------

interface Fixture {
  note: string
  /**
   * A token the place name must CONTAIN, not a string it must equal.
   *
   * The receipt prints "LUCKY CAT" in large letters with "- coffee & kitchen -"
   * as a subtitle beneath it. Both "Lucky Cat" and "Lucky Cat Coffee & Kitchen"
   * are correct readings of that, and which one a model returns is not a
   * quality signal — the operator can edit the field on the review screen
   * anyway. What matters is that it read the right restaurant, so the check is
   * one-directional containment against the brand, which still fails loudly on
   * a different venue or a truncated read.
   */
  placeContains: string
  date: string
  itemCount: number
  subtotal: number
  discount: number
  tax: number
  service_charge: number
  total: number
}

const FIXTURES: Record<string, Fixture> = {
  // The Lucky Cat receipt kept in the abandoned `uno` project. A real phone
  // photo: angled, with a logo, an address block, embedded "1 ICE" modifier
  // lines that must not become items, a DD-MM-YYYY date, and a "Grand Total"
  // label. Harder than the synthetic example in the spec, which is the point.
  'BILL_20260912_002.jpg': {
    note: 'Lucky Cat Coffee & Kitchen, 26-06-2026, 7 priced lines',
    placeContains: 'luckycat',
    // 26 JUNE, not May. This was first written down as 2026-05-26 and the model
    // disagreed, reporting 2026-06-26. Zooming the photo 5x settled it: the
    // receipt reads 26-06-2026 on both the Date and Time In lines, and the
    // fixture was the thing that was wrong.
    //
    // Worth keeping the history, because the instinct on a failed assertion is
    // to assume the model misread. It is just as likely the fixture did — a
    // human reading a dot-matrix digit once, versus a model reading the whole
    // page every time. When they disagree, go and look, and do not assume which
    // side is wrong.
    date: '2026-06-26',
    itemCount: 7,
    subtotal: 395000,
    discount: 0,
    tax: 41475,
    service_charge: 19750,
    total: 456225,
  },
}

const MEDIA_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

// ---------------------------------------------------------------------------

function fail(message: string): never {
  console.error(`\n  FAIL  ${message}\n`)
  process.exit(1)
}

function ok(message: string): void {
  console.log(`  ok    ${message}`)
}

const path = process.argv[2]
if (!path) {
  fail('Kasih path foto struk-nya. Contoh: bun run test:extract receipt.jpg')
}

const apiKey = process.env.GEMINI_API_KEY
if (!apiKey) {
  fail(
    'GEMINI_API_KEY kosong.\n' +
      '        Isi di .env.local, satu baris:\n' +
      '          GEMINI_API_KEY=...\n\n' +
      '        Key dari aistudio.google.com (Google AI Studio).\n\n' +
      '        Kalau lu udah isi tapi masih muncul ini, pastiin lu jalanin dari\n' +
      '        root project (bun otomatis baca .env.local dari folder kerja).',
  )
}

// Read the file BEFORE inspecting its extension.
//
// If someone passes the wrong argument entirely — an API key rather than a
// path, which has happened — then "file not found" is a useful message and
// "extension .Ab8RN6Iuiw2U5ok... is not supported" is not: it reads like a bug
// in this script rather than a typo in the command, and it echoes a credential
// into the terminal to boot.
let bytes: Buffer
try {
  bytes = readFileSync(path)
} catch {
  fail(
    `File nggak ketemu atau nggak bisa dibaca:\n` +
      `        ${path}\n\n` +
      `        Pastiin argumennya PATH FOTO, bukan yang lain. Contoh:\n` +
      `        bun run test:extract "C:/foto/struk.jpg"`,
  )
}

const extension = extname(path).toLowerCase()
const mediaType = MEDIA_TYPES[extension]
if (!mediaType) {
  fail(
    `Ekstensi "${extension}" nggak didukung. Pakai .jpg, .jpeg, .png, atau .webp.\n` +
      `        Filenya ada dan kebaca, tapi formatnya bukan gambar yang didukung.`,
  )
}

const image = bytes.toString('base64')
const name = basename(path)
const fixture = FIXTURES[name]

console.log(`\nFoto    : ${name}`)
console.log(`Model   : ${MODEL} (Gemini)`)
if (fixture) console.log(`Fixture : ${fixture.note}`)
else console.log('Fixture : (nggak ada patokan buat file ini, cuma cek jalur + gate)')
console.log(`Ukuran  : ${(bytes.length / 1024).toFixed(0)} KB\n`)

const ai = new GoogleGenAI({ apiKey })

console.log('Manggil model...')
const started = Date.now()

/**
 * The API's own error message is the actionable part, so print that rather than
 * a stack trace. Wrapping it in a function also keeps the response type
 * inferred, which an explicit annotation on an overloaded method gets wrong.
 */
async function callModel() {
  try {
    return await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: mediaType, data: image } },
            { text: PROMPT },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: EXTRACTION_SCHEMA,
        maxOutputTokens: 8192,
      },
    })
  } catch (err) {
    const e = err as { status?: number; message?: string }
    console.error('\n  FAIL  Request ke Gemini API ditolak.')
    if (e.status) console.error(`        HTTP ${e.status}`)
    if (e.message) console.error(`        ${e.message}`)
    if (e.status === 403) {
      console.error(
        '\n        Key salah, atau Generative Language API belum diaktifkan\n' +
          '        di project Google itu.',
      )
    }
    console.error('')
    process.exit(1)
  }
}

const response = await callModel()
const elapsed = ((Date.now() - started) / 1000).toFixed(1)
console.log(`Selesai dalam ${elapsed}s\n`)

const finish = response.candidates?.[0]?.finishReason
if (finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT' || finish === 'RECITATION') {
  fail('Model menolak memproses gambar ini.')
}
if (finish === 'MAX_TOKENS') fail('Output kepotong (maxOutputTokens).')

const text = response.text
if (!text) fail('Model nggak balikin teks.')

console.log('--- Teks mentah dari model ---')
console.log(
  text.length > 1500 ? `${text.slice(0, 1500)}\n  [...kepotong, ${text.length} karakter total]` : text,
)
console.log('')

// ---------------------------------------------------------------------------
// The real client path: strip the fence, parse, normalize
// ---------------------------------------------------------------------------

console.log('--- Jalur client (stripCodeFence -> parse -> normalize) ---')

let raw: ReturnType<typeof normalizeExtraction>
try {
  raw = normalizeExtraction(JSON.parse(stripCodeFence(text)))
} catch (err) {
  fail(
    `Hasil model nggak bisa dibaca jadi Extraction:\n` +
      `        ${(err as Error).message}\n\n` +
      `        Ini yang bakal kejadian di aplikasi juga. Kalau modelnya balikin\n` +
      `        bentuk yang beda, schema-nya yang perlu diperbaiki.`,
  )
}
ok('normalize berhasil — tiap field ada dan tipenya bener')

console.log('\n--- Hasil setelah normalize ---')
console.log(JSON.stringify(raw, null, 2))
console.log('')

// ---------------------------------------------------------------------------
// Gates, on real model output
// ---------------------------------------------------------------------------

console.log('--- Gate 1 & 2 (dari spec section 9) ---')

const items: AssignedItem[] = raw.items.map((item, i) => ({
  ...item,
  position: i + 1,
  // Everything on one person, purely so the gates and the split can run.
  // Assignment is the operator's job on the review screen.
  assigned_to: ['TEST'],
}))

const subtotal = raw.subtotal ?? items.reduce((acc, i) => acc + i.line_total, 0)

const gate1 = checkGate1({ ...raw, subtotal })
const gate2 = checkGate2(items, subtotal)

for (const f of [...gate1, ...gate2]) fail(`gate ${f.gate}: ${f.message}`)
ok('gate 1 lolos — aritmatika struk balance')
ok(`gate 2 lolos — total item ${subtotal} sama dengan subtotal`)

console.log('\n--- Split (spec section 6), semua ke satu orang ---')
const split = computeSplit(
  items,
  subtotal,
  raw.discount,
  raw.tax,
  raw.service_charge,
  raw.total,
  ['TEST'],
)
const only = split.participants[0]
if (only.amount_owed !== raw.total) {
  fail(`split satu orang menghasilkan ${only.amount_owed}, harusnya ${raw.total}`)
}
ok(`split satu orang = ${only.amount_owed} = total struk (residual ${split.residual})`)

// ---------------------------------------------------------------------------
// Exact comparison, when we know what the answer should be
// ---------------------------------------------------------------------------

if (fixture) {
  console.log('\n--- Perbandingan sama bacaan manual ---')

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

  const normalizedPlace = raw.place ? normalize(raw.place) : ''
  if (normalizedPlace.includes(fixture.placeContains)) {
    ok(`place: ${JSON.stringify(raw.place)} — mengandung "${fixture.placeContains}"`)
  } else {
    fail(
      `place beda — model bilang ${JSON.stringify(raw.place)}, harusnya mengandung "${fixture.placeContains}"`,
    )
  }

  const checks: [string, unknown, unknown][] = [
    ['date', raw.date, fixture.date],
    ['jumlah item', raw.items.length, fixture.itemCount],
    ['subtotal', raw.subtotal, fixture.subtotal],
    ['discount', raw.discount, fixture.discount],
    ['tax', raw.tax, fixture.tax],
    ['service_charge', raw.service_charge, fixture.service_charge],
    ['total', raw.total, fixture.total],
  ]

  for (const [label, actual, expected] of checks) {
    if (actual === expected) {
      ok(`${label}: ${JSON.stringify(actual)}`)
    } else {
      fail(
        `${label} beda — model bilang ${JSON.stringify(actual)}, harusnya ${JSON.stringify(expected)}`,
      )
    }
  }

  const names = raw.items.map((i) => normalize(i.name))
  const expectedNames = [
    'longblack',
    'icecaramellatte',
    'lycheetea',
    'peachtea',
    'icelatte',
    'japanese',
    'aquareflectionsnatural',
  ]
  for (const expected of expectedNames) {
    if (!names.some((n) => n.includes(expected))) {
      fail(
        `item "${expected}" nggak ketemu. Model balikin: ${raw.items.map((i) => i.name).join(', ')}`,
      )
    }
  }
  ok(`semua ${expectedNames.length} nama item ketemu`)
}

if (response.usageMetadata) {
  console.log('\n--- Pemakaian token ---')
  console.log(`  input  : ${response.usageMetadata.promptTokenCount}`)
  console.log(`  output : ${response.usageMetadata.candidatesTokenCount}`)
}

console.log(`\n  LULUS — ${elapsed}s\n`)
