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
 * PROVIDER NOTE: DeepSeek
 *
 * Fourth provider this has run on (Claude -> DeepSeek -> Gemini -> DeepSeek),
 * and the provider-specific surface has stayed the same size every time: this
 * file plus the request block in index.ts. The split maths, the gates, the
 * database schema and the UI have not changed once, and none of them know which
 * model read the receipt.
 *
 * The earlier DeepSeek attempt failed with an unfixable 401. That is gone — the
 * key authenticates, and `deepseek-flash` accepts image input.
 *
 * WHAT THIS COSTS US, relative to Gemini. Gemini had `responseSchema`, which
 * enforced the shape at the API level: the model could not return a missing
 * field, a decimal, or a markdown fence. DeepSeek has no equivalent —
 * `response_format: {type: 'json_schema'}` returns "This response_format type is
 * unavailable now" on both models, and only `json_object` works, which promises
 * valid JSON and nothing about its shape.
 *
 * Two consequences, both handled rather than hoped about:
 *
 *   1. The schema is now IN the prompt, below. It is one definition, embedded
 *      as text rather than duplicated — the same constant the type is derived
 *      from.
 *   2. normalize.ts goes back to being the only structural defence, not a
 *      backstop. It was always unit tested; now those tests are load bearing.
 *
 * And one trap that is specific to this model and cost a confusing ten minutes:
 * `deepseek-flash` is a REASONING model, and its reasoning tokens count against
 * `max_tokens`. At a small cap it returns HTTP 200, `finish_reason: "stop"`,
 * and an EMPTY string — a success that isn't. index.ts sets a large cap and
 * treats empty content as an explicit error.
 * ---------------------------------------------------------------------------
 */

/**
 * The output shape, in standard JSON Schema.
 *
 * It is embedded into PROMPT below rather than sent as a request parameter,
 * because this provider has no schema parameter to send it in. That makes it
 * documentation as much as configuration — the type in src/lib/types.ts and the
 * normalizer both read the same field names.
 *
 * Declared BEFORE PROMPT, and that order is load bearing: PROMPT interpolates
 * this at module-evaluation time, and a `const` referenced above its own
 * declaration is in the temporal dead zone. Moving this below PROMPT throws
 * "Cannot access 'EXTRACTION_SCHEMA' before initialization" the moment the
 * module loads — a hard failure rather than a wrong value, which is the only
 * reason it is worth a comment.
 *
 * Nullable fields use a two-member type array rather than Gemini's
 * `nullable: true`. Both spellings are understood by models, but only this one
 * is real JSON Schema, so the text is honest about what it is.
 */
export const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    place: {
      type: ['string', 'null'],
      description: 'Name of the restaurant or cafe as printed, or null if not visible.',
    },
    date: {
      type: ['string', 'null'],
      description: 'Transaction date in ISO YYYY-MM-DD form, or null if not visible.',
    },
    items: {
      type: 'array',
      description: 'One entry per printed line item that has a price, in the order printed.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Item name as printed.' },
          qty: { type: 'number', description: 'Quantity. 1 if no quantity is printed.' },
          line_total: {
            type: 'number',
            description: 'Printed total for this line, already multiplied by qty.',
          },
        },
        required: ['name', 'qty', 'line_total'],
      },
    },
    subtotal: {
      type: ['number', 'null'],
      description: 'Sum before discount and tax, or null if not printed.',
    },
    discount: { type: 'number', description: 'Positive number. 0 if none is printed.' },
    tax: { type: 'number', description: 'PPN. 0 if none is printed.' },
    service_charge: { type: 'number', description: '0 if none is printed.' },
    rounding_adjustment: {
      type: 'number',
      description: 'Only set if a Pembulatan line is printed. Can be negative. 0 otherwise.',
    },
    total: { type: 'number', description: 'Final printed total.' },
    confidence_notes: {
      type: ['string', 'null'],
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

/**
 * The model. Verified by hand against a real image: it reads the merchant name
 * and the line items correctly.
 *
 * `deepseek-v4-pro` also accepts images and would likely be more accurate, but
 * this is a receipt read once per bill by one person — flash is the right
 * trade. Swapping the id is the whole change.
 */
export const MODEL = 'deepseek-flash'

/**
 * The prompt.
 *
 * Carries the semantic rules — how to read an Indonesian receipt, what the
 * labels mean, how thousands separators work, and what to do about the
 * ambiguity between a unit price and a line total — and then the output shape,
 * because this provider cannot be told the shape any other way.
 *
 * The rules about modifier lines and header lines were added after testing
 * against a real photo: receipts print things like "1 ICE" indented beneath
 * "LONG BLACK", and a model reading that as its own line item silently changes
 * both the item count and the totals.
 */
export const PROMPT = `You are extracting structured data from a photograph of an Indonesian restaurant or cafe receipt (struk).

Formatting rules for Indonesian receipts:
- Numbers use a period as the thousands separator, not a decimal point. "15.000" means fifteen thousand rupiah. This is the single most common way to get every number on the receipt wrong by a factor of 1000, so apply it deliberately to every amount you read.
- All amounts are whole rupiah. There are no cents or decimals. Never return a decimal number.
- line_total is the printed total for that line, already multiplied by quantity if the receipt shows a multiplier.
- Tax is printed under two different names in Indonesia and BOTH belong in the tax field:
  "PPN" is the national VAT, usually 11%. "PB", "PB1", "PBJT" or "Pajak Restoran" is the local
  restaurant tax, usually 10%. A receipt prints one of them, and occasionally both.
  These are ordinary, expected labels. Do not record them in confidence_notes as if something
  were unclear — a note there is reserved for numbers you genuinely could not read.
- Tax may also be labeled "Pajak" or "Pajak 11%".
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
rounding_adjustment 0, total 75900, confidence_notes null.

Output format:
Reply with a single JSON object and nothing else. No prose before or after it, and no markdown code fences. It must match this JSON Schema exactly:

${JSON.stringify(EXTRACTION_SCHEMA, null, 2)}`
