/**
 * Whitelist-copy for request bodies.
 *
 * Spreading a request body straight into a Mongoose write (`{ ...body }`) lets a
 * client set any field the schema defines — including ownership and approval
 * fields the route means to derive server-side (userId, approvedBy, paidBy).
 * Route handlers pass the explicit set of fields the caller is allowed to send.
 *
 * `undefined` values are dropped so a partial PATCH never blanks a stored field.
 */
export function pick<T extends object>(src: unknown, keys: readonly (keyof T)[]): Partial<T> {
  if (!src || typeof src !== 'object') return {}
  const source = src as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    const k = key as string
    if (Object.prototype.hasOwnProperty.call(source, k) && source[k] !== undefined) {
      out[k] = source[k]
    }
  }
  return out as Partial<T>
}
