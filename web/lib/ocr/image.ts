/**
 * Validation of an image sent for OCR. Everything is decided from the BYTES (magic numbers), never from the
 * client-declared mime type or filename; a declared type that disagrees with the bytes is rejected.
 */
export const MAX_OCR_IMAGE_BYTES = 4_500_000 // below the ~6 MB serverless request cap once base64-inflated
export type OcrImageMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'image/heic'

export type ImageCheck =
  | { ok: true; mime: OcrImageMime; base64: string; bytes: number }
  | { ok: false; status: 400 | 413 | 415; error: string; code: string }

function sniff(buf: Buffer): OcrImageMime | 'pdf' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString('ascii', 0, 6))) return 'image/gif'
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|mif1|msf1)/.test(buf.toString('ascii', 8, 12))) return 'image/heic'
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') return 'pdf'
  return null
}

export function checkOcrImage(input: { imageBase64?: unknown; mimeType?: unknown }): ImageCheck {
  if (typeof input.imageBase64 !== 'string' || input.imageBase64.length === 0) return { ok: false, status: 400, error: 'imageBase64 required', code: 'image_required' }
  let b64: string = input.imageBase64
  // tolerate a data-URI prefix from clients
  const m = /^data:([\w/+.-]+);base64,/.exec(b64)
  if (m) b64 = b64.slice(m[0].length)
  const prefixMime = m ? m[1].toLowerCase() : null
  if (b64.length > Math.ceil(MAX_OCR_IMAGE_BYTES * 4 / 3) + 8) return { ok: false, status: 413, error: 'Image is too large to scan. Use a smaller photo.', code: 'image_too_large' }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 === 1) return { ok: false, status: 400, error: 'Image data is not valid base64', code: 'invalid_base64' }
  const buf = Buffer.from(b64, 'base64')
  if (buf.length === 0) return { ok: false, status: 400, error: 'Image is empty', code: 'image_empty' }
  if (buf.length > MAX_OCR_IMAGE_BYTES) return { ok: false, status: 413, error: 'Image is too large to scan. Use a smaller photo.', code: 'image_too_large' }
  const kind = sniff(buf)
  if (kind === 'pdf') return { ok: false, status: 415, error: 'PDF receipts can be attached but not scanned. Scan a photo of the receipt instead.', code: 'pdf_not_scannable' }
  if (!kind) return { ok: false, status: 415, error: 'This file is not a supported image (JPEG, PNG, WebP, HEIC or GIF).', code: 'unsupported_type' }
  const declaredRaw = typeof input.mimeType === 'string' ? input.mimeType.toLowerCase() : prefixMime
  const declared = declaredRaw ? declaredRaw.replace('image/jpg', 'image/jpeg') : null
  if (declared && declared !== kind) return { ok: false, status: 415, error: 'The file type does not match its contents.', code: 'type_mismatch' }
  return { ok: true, mime: kind, base64: b64, bytes: buf.length }
}
