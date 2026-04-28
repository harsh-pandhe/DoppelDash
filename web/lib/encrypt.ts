import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

const ALGO = 'aes-256-gcm'

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET || 'fallback-insecure-key-set-env'
  return createHash('sha256').update(secret).digest()
}

export function encrypt(text: string): string {
  if (!text) return text
  const iv  = randomBytes(12)
  const key = getKey()
  const cipher = createCipheriv(ALGO, key, iv)
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decrypt(encoded: string): string {
  if (!encoded) return encoded
  try {
    const buf = Buffer.from(encoded, 'base64')
    if (buf.length < 28) return encoded
    const iv  = buf.subarray(0,  12)
    const tag = buf.subarray(12, 28)
    const enc = buf.subarray(28)
    const decipher = createDecipheriv(ALGO, getKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
  } catch {
    return encoded
  }
}

const SENSITIVE = ['gender', 'caste', 'religion'] as const
type Sensitive = typeof SENSITIVE[number]

export function encryptContact(body: Record<string, unknown>): Record<string, unknown> {
  const out = { ...body }
  for (const key of SENSITIVE) {
    if (typeof out[key] === 'string' && out[key]) {
      out[key] = encrypt(out[key] as string)
    }
  }
  return out
}

export function decryptContact(doc: unknown): Record<string, unknown> {
  const out = { ...(doc as Record<string, unknown>) }
  for (const key of SENSITIVE as readonly string[]) {
    if (typeof out[key] === 'string') {
      out[key] = decrypt(out[key] as string)
    }
  }
  return out
}
