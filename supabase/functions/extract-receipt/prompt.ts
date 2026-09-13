/**
 * The extraction contract: model, prompt, and output schema.
 *
 * Spec: split_bill_app_spec.md section 8.
 *
 * This lives in its own module, next to the function that uses it, so that the
 * Edge Function and the offline test script (scripts/test-extract.ts) exercise
 * the exact same artifacts. If the prompt were duplicated, the test would drift
 * from production and start passing for the wrong reason.
 *
 * ---------------------------------------------------------------------------
 * PROVIDER NOTE: Gemini
 *
 * Third provider this has run on (Claude -> DeepSeek -> Gemini), and the
 * provider-specific surface has stayed the same size every time: this file plus
 * the request block in index.ts. The split maths, the gates, the database
 * schema and the UI have not changed once, and none of them know which model
 * read the receipt.
 *
 * Gemini is the first one since Claude to support a real response schema, so
 * the shape is enforced at the API level again rather than by prompt discipline
 * plus a normalizer. normalize.ts stays as defence in depth and is still unit
 * tested, but it is now a backstop rather than the only line.
 * ---------------------------------------------------------------------------
 */

/**
 * Gemini's flash model. Verified to work on a real receipt in the `uno` project
 * this replaced, which is why this exact id and not a newer one.
 *
 * If it ever 404s, `gemini-3.7-flash` is the next one up.
 */
export const MODEL = 'gemini-3.6-flash'

/**
 * The prompt.
 *
 * Carries only the semantic rules: how to read an Indonesian receipt, what the
 * labels mean, how thousands separators work, and what to do about the
 * ambiguity between a unit price and a line total.
 *
 * It does NOT carry the output shape. That is responseSchema's job in index.ts,
 * and prompt-level schema instructions are a weaker guarantee than API-level
 * enforcement — as the DeepSeek detour demonstrated, where a missing field
 * could only be caught after the fact.
 *
 * The rules about modifier lines and header lines were added after testing
 * against a real photo: receipts print things like "1 ICE" indented beneath
 * "LONG BLACK", and a model reading that as its own line item silently changes
 * both the item count and the totals.
 */
export const PROMPT = `You are extracting structured data from a photograph of an Indonesian restaurant or cafe receipt (struk).

Formatting rules for Indonesian receipts:
- Numbers use a period as the thousands separator, not a decimal point. "15.000" means fifteen thousand rupiah.
- All amounts are whole rupiah. There are no cents or decimals. Never return a decimal number.
- line_total is the printed total for that line, already multiplied by quantity if the receipt shows a multiplier.
- Tax may be labeled "PPN", "Pajak", or "Pajak 11%".
- Service charge may be labeled "Service", "Svc", or "Service Charge".
- Discount may be labeled "Diskon", "Disc", or "Potongan". Report it as a positive number representing the amount subtracted.
- A rounding line may be labeled "Pembulatan". Report it exactly as printed, it can be negative.
- The grand total may be labeled "Total", "Grand Total", "Total Bayar", or "TOTAL".
- If a numeric field is not printed on the receipt, use 0. Only subtotal and total may be null, and only if genuinely unreadable.

Accuracy rules:
- Never invent items, prices, or a place name that are not visible on the receipt.
- Receipts often print a quantity column, a unit price, and a line total on the same row, for example "2 Es Teh 8.000 16.000". Read line_total as the line total, not the unit price.
- If a printed number could be read as either a unit price or a line total, choose the reading that makes the item line totals sum to the printed subtotal.
- Some receipts print a modifier line indented under an item, for example "1 ICE" beneath "LONG BLACK". That is a description of the item above it, not a separate item: do not emit it as an item, and do not add its number to the quantity of the item above it.
- Lines above the items, such as an address, a phone number, an email, a table number, a server name, a cashier name or a pax count, are not items.
- The date may be printed as DD-MM-YYYY, and may be followed by a time. Report only the date, in YYYY-MM-DD form.
- If any number is blurry, cut off, or ambiguous, make your best reading but note exactly what you were unsure about in confidence_notes. Do not silently guess without flagging it.
- If confidence_notes has nothing to report, set it to null.

Worked example:
A receipt showing:
  Warung Bu Siti
  12/09/2026
  Nasi Goreng          25.000
  2x Es Teh            16.000
  Kentang Goreng Gede  30.000
  Subtotal             71.000
  Diskon Member         5.000
  PPN                   6.600
  Service               3.300
  Total                75.900

must produce:
place "Warung Bu Siti", date "2026-09-12",
items [Nasi Goreng 1x 25000, Es Teh 2x 16000, Kentang Goreng Gede 1x 30000],
subtotal 71000, discount 5000, tax 6600, service_charge 3300,
rounding_adjustment 0, total 75900, confidence_notes null.`

/**
 * The output schema, in Gemini's Schema dialect.
 *
 * Note the UPPERCASE type names — this is not JSON Schema, it is Gemini's own
 * Type enum. Nullability is `nullable: true` rather than a two-member type
 * array, which is what the Claude and DeepSeek versions of this file used.
 *
 * The descriptions are not decoration: they are passed to the model and carry
 * the field-level semantics, which is why the prompt no longer has to spell out
 * the shape.
 */
export const EXTRACTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    place: {
      type: 'STRING',
      nullable: true,
      description: 'Name of the restaurant or cafe as printed, or null if not visible.',
    },
    date: {
      type: 'STRING',
      nullable: true,
      description: 'Transaction date in ISO YYYY-MM-DD form, or null if not visible.',
    },
    items: {
      type: 'ARRAY',
      description: 'One entry per printed line item that has a price, in the order printed.',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: 'Item name as printed.' },
          qty: { type: 'NUMBER', description: 'Quantity. 1 if no quantity is printed.' },
          line_total: {
            type: 'NUMBER',
            description: 'Printed total for this line, already multiplied by qty.',
          },
        },
        required: ['name', 'qty', 'line_total'],
      },
    },
    subtotal: {
      type: 'NUMBER',
      nullable: true,
      description: 'Sum before discount and tax, or null if not printed.',
    },
    discount: { type: 'NUMBER', description: 'Positive number. 0 if none is printed.' },
    tax: { type: 'NUMBER', description: 'PPN. 0 if none is printed.' },
    service_charge: { type: 'NUMBER', description: '0 if none is printed.' },
    rounding_adjustment: {
      type: 'NUMBER',
      description: 'Only set if a Pembulatan line is printed. Can be negative. 0 otherwise.',
    },
    total: { type: 'NUMBER', description: 'Final printed total.' },
    confidence_notes: {
      type: 'STRING',
      nullable: true,
      description: 'Anything blurry, cut off or ambiguous. null if nothing to report.',
    },
  },
  required: [
    'place',
    'date',
    'items',
    'subtotal',
    'discount',
    'tax',
    'service_charge',
    'rounding_adjustment',
    'total',
    'confidence_notes',
  ],
}
