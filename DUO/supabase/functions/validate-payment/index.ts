/**
 * validate-payment — reads an uploaded proof of payment and decides.
 *
 * ---------------------------------------------------------------------------
 * THIS FUNCTION IS PUBLIC. IT HAS NO AUTH CHECK, AND THAT IS DELIBERATE.
 *
 * The payer is someone the operator split a bill with. They do not have an
 * account, and asking them to make one to upload a screenshot is how the
 * feature goes unused. So there is no session here to key anything on, and
 * `verify_jwt` is deployed OFF for this function alone — which is also why
 * deploy-functions.yml asserts the flag per function rather than for all of
 * them. Turning it off globally would expose extract-receipt, whose auth check
 * trusts the gateway to have verified the token.
 *
 * The security model is the token, and it is worth being precise about what
 * that buys. This function accepts exactly two things from the caller: a token
 * and an image. It never accepts a bill id, a participant, an amount, or a
 * status. It resolves the token to one participant row itself, and every write
 * it makes is scoped to that row. So the worst a leaked or guessed link can do
 * is settle the single share it belongs to — it cannot reach another bill, it
 * cannot change an amount, and it cannot read anything.
 *
 * The token is a 128-bit random uuid. Guessing one is not a thing that happens.
 *
 * ---------------------------------------------------------------------------
 * Unlike extract-receipt, this function DOES touch the database, and it does so
 * with the service key because there is no user for row level security to key
 * on. That is the whole reason the input surface above is kept to two fields.
 * Do not add a third without thinking about who could send it.
 */

import { judge, type ReadProof } from './match.ts'
import { PAYMENT_MODEL, PAYMENT_PROMPT } from './prompt.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/**
 * A phone screenshot of a transfer, base64.
 *
 * Capped below the storage bucket's own 5MB limit rather than at it, because
 * base64 is four bytes per three and the cap is applied to the encoded length.
 */
const MAX_IMAGE_BYTES = 5_000_000

const MAX_TOKENS = 8192
const TIMEOUT_MS = 90_000

interface Page {
  participant_id: string
  person: string
  place: string
  bill_date: string
  ref_code: string
  amount_owed: number
  /** Everything already paid on this share that reached the right account. */
  amount_paid: number
  status: string
  bank_name: string | null
  account_number: string | null
  account_holder: string | null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const deepseekKey = Deno.env.get('DEEPSEEK_API_KEY')

  if (!url || !serviceKey) {
    return json({ error: 'Supabase env belum lengkap di function ini.' }, 500)
  }
  if (!deepseekKey) {
    return json({ error: 'DEEPSEEK_API_KEY belum di-set.' }, 500)
  }

  let token: string
  let image: string
  let mediaType: string
  try {
    const body = await req.json()
    token = body.token
    image = body.image
    mediaType = body.media_type ?? 'image/jpeg'

    if (!token || typeof token !== 'string') throw new Error('missing "token"')
    if (!image || typeof image !== 'string') throw new Error('missing "image"')
    if (image.length > MAX_IMAGE_BYTES) throw new Error('gambarnya kegedean')
    // A uuid, so a malformed one is rejected before it reaches the database.
    if (!/^[0-9a-f-]{36}$/i.test(token)) throw new Error('token nggak valid')
  } catch (err) {
    return json({ error: `Request body tidak valid: ${(err as Error).message}` }, 400)
  }

  const auth = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }

  // ---- resolve the token -------------------------------------------------

  const pageRes = await fetch(`${url}/rest/v1/rpc/payment_page`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: token }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!pageRes.ok) {
    return json({ error: `Nggak bisa baca link-nya: ${await pageRes.text()}` }, 502)
  }

  const rows = (await pageRes.json()) as Page[]
  const page = rows[0]

  // Not found and already-settled are different answers, and the payer deserves
  // to be told which. A dead link and a link that has already been used look
  // identical if both return the same error.
  if (!page) return json({ error: 'Link-nya nggak dikenali.' }, 404)
  if (page.status === 'lunas') {
    return json({ verdict: 'already_paid', person: page.person, amount: page.amount_owed })
  }

  // ---- read the proof ----------------------------------------------------

  let read: ReadProof
  try {
    const modelRes = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deepseekKey}` },
      body: JSON.stringify({
        model: PAYMENT_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mediaType};base64,${image}` } },
              { type: 'text', text: PAYMENT_PROMPT },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: MAX_TOKENS,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!modelRes.ok) {
      const hint = modelRes.status === 401 ? ' (key DeepSeek bermasalah)' : ''
      return json(
        { error: `Model error ${modelRes.status}${hint}: ${(await modelRes.text()).slice(0, 200)}` },
        502,
      )
    }

    const body = (await modelRes.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[]
    }
    const content = body.choices?.[0]?.message?.content

    // Same trap as the receipt reader: this is a reasoning model, and reasoning
    // tokens come out of the same budget, so a small cap returns an empty
    // string with a 200 and looks like success.
    if (!content) {
      return json({ error: 'Modelnya nggak balikin apa-apa. Coba upload lagi.' }, 502)
    }

    read = JSON.parse(content) as ReadProof
  } catch (err) {
    return json({ error: `Gagal baca buktinya: ${(err as Error).message}` }, 502)
  }

  // ---- decide ------------------------------------------------------------

  /*
   * What is still due, not what was owed at the start.
   *
   * This is what makes an instalment work. The second half of a part payment
   * is the transfer that finishes the job, and comparing it against the
   * original amount would call it short forever — the share would sit at
   * "kurang Rp 77.050" no matter how much arrived.
   *
   * `amount_paid` only counts payments that reached the right account, so the
   * remainder this produces is the real one rather than a running total of
   * whatever was uploaded.
   */
  const due = Math.max(0, page.amount_owed - page.amount_paid)

  // Everything is already in, but the share was never marked settled — the
  // operator left it for review, or a proof arrived and the status write
  // failed. Either way there is nothing left to pay, and taking more money
  // would be the wrong answer.
  if (due === 0) {
    return json({ verdict: 'already_paid', person: page.person, amount: page.amount_owed })
  }

  const { verdict, recipientOk, note } = judge(read, {
    amountDue: due,
    accountHolder: page.account_holder,
    accountNumber: page.account_number,
  })

  // ---- keep the evidence -------------------------------------------------

  // Stored before anything is decided on, because the interesting case is the
  // one that did not match and a proof that vanishes on a mismatch is the one
  // the operator most needs to look at.
  const bytes = Uint8Array.from(atob(image), (c) => c.charCodeAt(0))
  const ext = mediaType.includes('png') ? 'png' : mediaType.includes('webp') ? 'webp' : 'jpg'
  // Under bukti/ so the proofs of payment sort away from the receipts of the
  // bill itself, which live under the same ref_code.
  const imagePath = `bukti/${page.ref_code}/${token.slice(0, 8)}-${Date.now()}.${ext}`

  const uploadRes = await fetch(`${url}/storage/v1/object/receipts/${imagePath}`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': mediaType, 'x-upsert': 'false' },
    body: bytes,
  })
  if (!uploadRes.ok) {
    return json({ error: `Nggak bisa nyimpen gambarnya: ${await uploadRes.text()}` }, 502)
  }

  const insertRes = await fetch(`${url}/rest/v1/payments`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      // The id came back with the page read, resolved from the token by the
      // database. Nothing the caller sent decides which row this lands on.
      participant_id: page.participant_id,
      amount_read: read.amount,
      recipient_read: read.recipient_name ?? read.recipient_account,
      recipient_expected: page.account_holder ?? page.account_number ?? '',
      // The field the running total is summed on. A `mismatch` cannot stand in
      // for it: that word covers both an instalment and a transfer to a
      // stranger, and only one of those should reduce what someone owes.
      recipient_ok: recipientOk,
      verdict,
      note,
      image_path: imagePath,
    }),
  })
  if (!insertRes.ok) {
    return json({ error: `Nggak bisa nyatet buktinya: ${await insertRes.text()}` }, 502)
  }

  // ---- settle, only on a double match ------------------------------------

  if (verdict === 'matched') {
    const patchRes = await fetch(
      `${url}/rest/v1/bill_participants?pay_token=eq.${encodeURIComponent(token)}`,
      {
        method: 'PATCH',
        headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'lunas',
          paid_date: new Date().toISOString().slice(0, 10),
        }),
      },
    )
    if (!patchRes.ok) {
      return json({ error: `Buktinya cocok tapi gagal update status: ${await patchRes.text()}` }, 502)
    }
  }

  // The payer is told the outcome, not the operator's note. "Kurang Rp 27.050"
  // is useful to them; a verdict word and a mismatch log are not.
  //
  // `remaining` is what is left after this transfer, which is the number a
  // part-payer needs and the one the page did not have before. Null once the
  // share is settled, because "sisa Rp 0" reads like a demand for nothing
  // rather than like being done.
  const paidNow = page.amount_paid + (recipientOk === true && read.amount ? read.amount : 0)
  const remaining = Math.max(0, page.amount_owed - paidNow)

  return json({
    verdict,
    person: page.person,
    expected: due,
    read: read.amount,
    remaining: verdict === 'matched' || remaining === 0 ? null : remaining,
    message:
      verdict === 'matched'
        ? 'Lunas. Makasih!'
        : verdict === 'mismatch'
          ? note
          : 'Buktinya masuk, tapi belum bisa dicek otomatis. Nanti dikonfirmasi.',
  })
})
