/**
 * Receipt photo preparation, browser side.
 * Spec section 10.
 *
 * Two things have to happen before a photo leaves the phone, and neither is
 * optional:
 *
 * 1. **HEIC to JPEG.** iPhones capture HEIC. The vision API does not accept it.
 *    Drawing the image to a canvas and re-encoding as JPEG does the conversion
 *    for free, using the same decoder Safari uses to display the photo.
 *
 * 2. **Downscale to 1568px on the long edge.** That is the size the vision API
 *    works at internally, so anything larger is bytes sent for nothing. A full
 *    resolution capture is several megabytes, which is a slow upload from a
 *    restaurant with bad signal, and the operator is standing there waiting.
 */

/** The long edge the vision API works at. Larger is wasted bytes. */
const MAX_EDGE = 1568

/** Visually lossless for text at this size, and roughly a third the bytes of 1.0. */
const JPEG_QUALITY = 0.85

export interface PreparedReceipt {
  /** base64 JPEG with no data: prefix. This is the Edge Function's input. */
  base64: string
  /** Same image, for previewing. The review screen must show the photo the model actually saw. */
  dataUrl: string
  width: number
  height: number
  bytes: number
}

interface Decoded {
  image: CanvasImageSource
  width: number
  height: number
  release: () => void
}

/**
 * Decode a File into something drawable.
 *
 * createImageBitmap is the fast path and honours EXIF orientation, which
 * matters because an iPhone photo of a receipt is very often rotated. Where it
 * refuses the format (Safari is inconsistent about HEIC here), fall back to an
 * <img>, which Safari will decode because it can display the photo at all.
 */
async function decode(file: File): Promise<Decoded> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return {
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    }
  } catch {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.src = url

    try {
      await img.decode()
    } catch (err) {
      URL.revokeObjectURL(url)
      throw new Error(`Gambar nggak bisa dibaca: ${(err as Error).message}`)
    }

    return {
      image: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      // Revoked only after the canvas draw, not before.
      release: () => URL.revokeObjectURL(url),
    }
  }
}

/** Scale so the long edge fits, never scaling up. A small photo stays small. */
function fit(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= MAX_EDGE) return { width, height }

  const scale = MAX_EDGE / longest
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob menghasilkan null'))),
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('FileReader tidak menghasilkan string'))
        return
      }
      // Strip the "data:image/jpeg;base64," prefix. The API wants raw base64.
      const comma = result.indexOf(',')
      resolve(comma === -1 ? result : result.slice(comma + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader gagal'))
    reader.readAsDataURL(blob)
  })
}

export async function prepareReceiptImage(file: File): Promise<PreparedReceipt> {
  const decoded = await decode(file)

  try {
    const { width, height } = fit(decoded.width, decoded.height)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context nggak tersedia di browser ini')

    // White background: a HEIC with transparency would otherwise come out black
    // where JPEG has no alpha channel, and a black receipt is unreadable.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(decoded.image, 0, 0, width, height)

    const blob = await toBlob(canvas)
    const base64 = await toBase64(blob)

    return {
      base64,
      dataUrl: `data:image/jpeg;base64,${base64}`,
      width,
      height,
      bytes: blob.size,
    }
  } finally {
    decoded.release()
  }
}
