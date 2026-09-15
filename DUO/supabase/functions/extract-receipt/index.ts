/**
 * extract-receipt — reads a receipt photo into structured data.
 *
 * Spec: split_bill_app_spec.md sections 8 (prompt) and 12 (why this lives on
 * the server).
 *
 * Why this is a server function at all, when the rest of the app is a browser
 * PWA with no backend: the API key is a real secret. Putting it in the client
 * bundle would hand it to anyone who opens devtools. Here it is an Edge
 * Function secret, so it never leaves this process.
 *
 * This function is deliberately dumb: image in, model text out. It does not
 * parse, does not validate, and does NOT touch the database. Everything that
 * could be wrong about the model's answer is handled client side, in one place
 * (src/lib/normalize.ts), where it can also be unit tested. A bug here can
 * therefore never corrupt a bill — at worst it returns text the client rejects.
 *
 * Deploy:
 *   supabase secrets set DEEPSEEK_API_KEY=...
 *   supabase functions deploy extract-receipt
 */

import { MODEL, PROMPT } from './prompt.ts'

/**
 * A receipt is dense small text read off a phone photo at an angle, and the
 * model spends tokens thinking before it writes any of them.
 *
 * This is not a value to trim. `deepseek-flash` is a reasoning model and its
 * reasoning tokens count against the cap, so a cap that looks generous for the
 * JSON alone can be consumed entirely by the thinking — returning HTTP 200,
 * `finish_reason: "stop"`, and an empty string. Measured on a trivial receipt:
 * ~90-160 reasoning tokens for two fields, so a full bill is a few thousand.
 */
const MAX_TOKENS = 8192

/**
 * How long to wait before giving up. Reasoning makes this slower than a plain
 * completion; a receipt that takes longer than this is not coming back.
 */
const TIMEOUT_MS = 90_000

const API_URL = 'https://api.deepseek.com/chat/completions'

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
 * Reject anyone who is not a signed-in user of this project.
 *
 * This closes a real hole. The gateway's JWT check is satisfied by the
 * PUBLISHABLE key, which is public by design — it ships in the browser bundle.
 * So without this check, anyone who reads the bundle could call this function
 * in a loop and spend the operator's API credit. The function never touches the
 * database, so no data is at risk, but the balance is.
 *
 * The check reads the JWT payload rather than verifying a signature. That is
 * sound today because the gateway already verified the signature, so a forged
 * token never reaches this code. The publishable key is not a JWT at all (no
 * dot-separated parts), so it fails on shape before any claim is read, and a
 * legacy anon key would arrive with role "anon" and fail on the role.
 *
 * It DEPENDS on verification staying on. `verify_jwt` defaults to true and this
 * function is deployed without overriding it, but if anyone ever deploys with
 * `--no-verify-jwt`, this check becomes forgeable by a hand-written token with
 * role "authenticated" and the API credit is exposed again.
 *
 * The alternative, if that flag ever needs to be turned off, is to verify
 * properly against Supabase Auth instead of trusting the payload:
 *
 *   fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
 *     headers: {
 *       Authorization: req.headers.get('Authorization')!,
 *       apikey: Deno.env.get('SUPABASE_ANON_KEY')!,
 *     },
 *   })
 *
 * Both of those secrets are available to Edge Functions by default. It costs a
 * round trip per invocation, which is why it is not what this does by default.
 */
function isSignedIn(req: Request): boolean {
  const header = req.headers.get('Authorization') ?? ''
  const token = header.replace(/^Bearer\s+/i, '')

  const parts = token.split('.')
  if (parts.length !== 3) return false

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(base64)) as { role?: string; sub?: string }
    return payload.role === 'authenticated' && typeof payload.sub === 'string'
  } catch {
    return false
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  // First, before anything expensive.
  if (!isSignedIn(req)) {
    return json({ error: 'Harus login dulu.' }, 401)
  }

  const apiKey = Deno.env.get('DEEPSEEK_API_KEY')
  if (!apiKey) {
    return json(
      {
        error:
          'DEEPSEEK_API_KEY belum di-set di Edge Function secrets. Jalankan: supabase secrets set DEEPSEEK_API_KEY=...',
      },
      500,
    )
  }

  let image: string
  let mediaType: string
  try {
    const body = await req.json()
    image = body.image
    mediaType = body.media_type ?? 'image/jpeg'
    if (!image) throw new Error('missing "image"')
  } catch (err) {
    return json(
      {
        error: `Request body tidak valid: ${(err as Error).message}. Kirim {"image": "<base64>", "media_type": "image/jpeg"}.`,
      },
      400,
    )
  }

  let response: Response
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: [
              // Image first, instruction second. The other order works too, but
              // this is the convention for vision models and it is what the
              // receipt fixtures were validated against.
              { type: 'image_url', image_url: { url: `data:${mediaType};base64,${image}` } },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
        // Valid JSON, guaranteed. Its SHAPE is not — this provider has no
        // json_schema mode ("This response_format type is unavailable now" on
        // both models), which is why the schema is in the prompt and why
        // normalize.ts is load bearing rather than a backstop.
        response_format: { type: 'json_object' },
        max_tokens: MAX_TOKENS,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    const name = (err as Error).name
    if (name === 'TimeoutError' || name === 'AbortError') {
      return json({ error: 'Model nggak jawab dalam 90 detik. Coba lagi.' }, 504)
    }
    return json({ error: `Nggak bisa nyambung ke DeepSeek: ${(err as Error).message}` }, 502)
  }

  const raw = await response.text()

  if (!response.ok) {
    // 401 is the one worth naming: it means the key itself, and it is the exact
    // failure that made this provider unusable the first time round.
    const hint =
      response.status === 401
        ? ' (key DeepSeek salah, dicabut, atau saldonya habis)'
        : response.status === 402
          ? ' (saldo DeepSeek habis)'
          : ''
    return json(
      { error: `DeepSeek API error ${response.status}: ${raw.slice(0, 300)}${hint}` },
      response.status === 401 || response.status === 402 ? 502 : response.status,
    )
  }

  let body: {
    choices?: { message?: { content?: string }; finish_reason?: string }[]
    usage?: {
      prompt_tokens?: number
      completion_tokens?: number
      total_tokens?: number
      // DeepSeek splits input by cache hit/miss and bills them differently.
      prompt_cache_hit_tokens?: number
      prompt_cache_miss_tokens?: number
    }
  }
  try {
    body = JSON.parse(raw)
  } catch {
    return json({ error: `Jawaban DeepSeek bukan JSON: ${raw.slice(0, 300)}` }, 502)
  }

  // What this scan cost, where the wallet can see it: Supabase → Edge Functions
  // → Logs. The reasoning tokens are inside completion_tokens, so this is the
  // whole spend; the cache fields say which half of the input was re-paid for.
  // Logged before the failure branches below so a capped or empty answer still
  // shows what it burned.
  if (body.usage) {
    console.log('extract-receipt usage', MODEL, JSON.stringify(body.usage))
  }

  const choice = body.choices?.[0]

  if (choice?.finish_reason === 'length') {
    return json(
      { error: 'Output kepotong (max_tokens). Struknya kemungkinan terlalu panjang.' },
      502,
    )
  }

  const text = choice?.message?.content

  // Empty content with a 200 is the failure mode this model actually produces:
  // reasoning tokens ate the whole budget, so the call "succeeded" with nothing
  // in it. Reported as what it is rather than passed downstream as an empty
  // string for the parser to choke on.
  if (!text) {
    return json(
      {
        error:
          'Model nggak nulis apa-apa (token-nya kepake buat reasoning). Coba lagi, atau naikin max_tokens.',
      },
      502,
    )
  }

  // The raw text goes back as-is. Stripping fences, parsing and validating the
  // shape all happen on the client, in one tested place.
  return json({
    text,
    model: MODEL,
    usage: body.usage
      ? { input_tokens: body.usage.prompt_tokens, output_tokens: body.usage.completion_tokens }
      : null,
  })
})
