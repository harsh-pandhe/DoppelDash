// Direct browser → Cloudinary upload using an *unsigned* preset.
//
// Uploads deliberately bypass our own API: Netlify functions cap request bodies
// at ~6 MB (most scanned PDFs exceed that) and have no persistent filesystem,
// which is why the previous /api/upload local-disk write silently failed in
// production. Unsigned presets also mean no API secret ever reaches the client.

const CLOUD_NAME    = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
const UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET

const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'application/pdf',
]

export async function uploadToCloudinary(file: File): Promise<string> {
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    // Fail loudly — a silent no-op here is what hid the broken uploads before.
    throw new Error('File upload is not configured — set NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME and NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET.')
  }
  if (file.size > MAX_BYTES) {
    throw new Error(`${file.name} is larger than 10 MB.`)
  }
  if (file.type && !ALLOWED_TYPES.includes(file.type)) {
    throw new Error(`${file.name} is not an allowed file type (images and PDF only).`)
  }

  const formData = new FormData()
  formData.append('file', file)
  formData.append('upload_preset', UPLOAD_PRESET)

  // `auto` (not `image`) so PDFs upload as raw files rather than being rejected.
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`, {
    method: 'POST',
    body:   formData,
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.error?.message || 'Upload failed')
  }

  const data = await res.json()
  return data.secure_url as string
}

export async function uploadMultiple(files: File[]): Promise<string[]> {
  return Promise.all(files.map(uploadToCloudinary))
}
