// Strip MongoDB operator keys ($-prefixed) to prevent injection
export function sanitize<T>(input: T): T {
  if (Array.isArray(input)) return input.map(sanitize) as unknown as T
  if (input !== null && typeof input === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (!k.startsWith('$') && !k.includes('.')) {
        out[k] = sanitize(v)
      }
    }
    return out as T
  }
  return input
}
