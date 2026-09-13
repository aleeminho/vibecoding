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
 *   supabase secrets set GEMINI_API_KEY=...
 *   supabase functions deploy extract-receipt
 */

import { GoogleGenAI } from 'npm:@google/genai'
import { EXTRACTION_SCHEMA, MODEL, PROMPT } from './prompt.ts'

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

  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) {
    return json(
      {
        error:
          'GEMINI_API_KEY belum di-set di Edge Function secrets. Jalankan: supabase secrets set GEMINI_API_KEY=...',
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

  const ai = new GoogleGenAI({ apiKey })

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            // Image first, instruction second. The other order works too, but
            // this is the convention for vision models and it is what the
            // receipt fixtures were validated against.
            { inlineData: { mimeType: mediaType, data: image } },
            { text: PROMPT },
          ],
        },
      ],
      config: {
        // API-level schema enforcement. The model cannot return a missing
        // field, a decimal, or a markdown fence — which is the guarantee the
        // DeepSeek detour lost and this restores.
        responseMimeType: 'application/json',
        responseSchema: EXTRACTION_SCHEMA,

        // A receipt is dense small text read off a phone photo at an angle.
        // The default cap is generous but this is not a place to save tokens.
        maxOutputTokens: 8192,
      },
    })

    const finish = response.candidates?.[0]?.finishReason
    if (finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT' || finish === 'RECITATION') {
      return json({ error: 'Model menolak memproses gambar ini.' }, 422)
    }
    if (finish === 'MAX_TOKENS') {
      return json(
        { error: 'Output kepotong (maxOutputTokens). Struknya kemungkinan terlalu panjang.' },
        502,
      )
    }

    // `text` is a property on the current SDK, not a method. It is undefined
    // rather than throwing when there are no candidates at all.
    const text = response.text
    if (!text) {
      return json({ error: 'Model tidak mengembalikan teks sama sekali.' }, 502)
    }

    // The raw text goes back as-is. Stripping fences, parsing and validating the
    // shape all happen on the client, in one tested place.
    return json({
      text,
      model: MODEL,
      usage: response.usageMetadata
        ? {
            input_tokens: response.usageMetadata.promptTokenCount,
            output_tokens: response.usageMetadata.candidatesTokenCount,
          }
        : null,
    })
  } catch (err) {
    const e = err as { status?: number; message?: string }
    const status = e.status ?? 502
    // A 400 from Gemini is almost always a bad request shape rather than a bad
    // key; 403 is the one that means the key is missing, wrong, or not enabled
    // for this API. Naming that saves a confusing round of guessing.
    const hint =
      status === 403
        ? ' (key salah, atau Generative Language API belum diaktifkan di project Google itu)'
        : ''
    return json({ error: `Gemini API error: ${e.message ?? String(err)}${hint}` }, status)
  }
})
