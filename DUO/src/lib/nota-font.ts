/**
 * Fetch the nota's serif and hand it to the writer.
 *
 * The one place where the browser and the writer meet. Everything in `pdf.ts`
 * draws and measures and knows nothing about the network; everything here
 * fetches and decompresses and knows nothing about PDF. Splitting them there is
 * what keeps the writer testable in a plain runtime with no DOM.
 *
 * The file is a static asset rather than something bundled, and that is the
 * point: 155KB of font in the JavaScript bundle is 155KB paid by every visitor
 * to every screen, for a face that only the nota and the payer page use. Here
 * it is paid once, by whoever builds a PDF, and cached by the service worker
 * for the next one.
 */

import { readMetrics } from './ttf'
import type { NotaFont } from './pdf'

/** Cached across builds. A phone builds more than one nota in a session. */
let pending: Promise<NotaFont | null> | null = null

/**
 * The embedded serif, or null when it could not be had.
 *
 * Null is a real answer and not an error: the document still lays out, in the
 * faces every reader already has. A PDF that refuses to be built because a
 * picture would not load is a worse document than one set in Helvetica.
 */
export function loadNotaFont(): Promise<NotaFont | null> {
  pending ??= fetchFont()
  return pending
}

async function fetchFont(): Promise<NotaFont | null> {
  try {
    const url = `${import.meta.env.BASE_URL}fonts/plex-serif-600.ttf`
    const res = await fetch(url)
    if (!res.ok) return null

    const raw = new Uint8Array(await res.arrayBuffer())
    // Parsed before it is compressed, so a file that is not a font this writer
    // can describe never becomes a document full of zeros.
    const metrics = readMetrics(raw)
    if (!metrics) return null

    const deflated = await deflate(raw)
    return {
      data: deflated ?? raw,
      flate: deflated !== null,
      uncompressed: raw.length,
      metrics,
    }
  } catch {
    return null
  }
}

/**
 * zlib, not raw — which is exactly what PDF's /FlateDecode expects, and why
 * `deflate` is the right name here rather than `deflate-raw`.
 *
 * Null when the browser has no CompressionStream (or when compressing a font
 * throws), and the font then travels uncompressed. The document is 155KB bigger
 * instead of 85KB smaller, which is a worse document and not a broken one.
 */
async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}
