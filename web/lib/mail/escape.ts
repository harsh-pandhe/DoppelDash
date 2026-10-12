/**
 * Output encoding for e-mail. Every user-controlled value that reaches an HTML
 * template, an attribute, a URL or a header goes through one of these — there is
 * no other sanctioned way to interpolate into a template.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
}

/** Escape for HTML text nodes AND quoted attribute values. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"'`]/g, ch => HTML_ESCAPES[ch])
}

/** Strip CR/LF/NUL and collapse whitespace — for subjects and header values (header-injection safe). */
export function singleLine(value: unknown, max = 200): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/**
 * Only http(s) URLs may appear in an href/link. Anything else (javascript:, data:,
 * relative, malformed) is replaced with a harmless "#" and flagged.
 */
export function safeUrl(value: unknown): string {
  try {
    const u = new URL(String(value ?? ''))
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.toString()
  } catch { /* fall through */ }
  return '#'
}

/** A conservative recipient check — one address, no whitespace/control chars, sane length. */
export function isSendableAddress(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length < 3 || value.length > 254) return false
  if (/[\s\u0000-\u001f<>,;"]/.test(value)) return false
  const at = value.indexOf('@')
  return at > 0 && at === value.lastIndexOf('@') && value.indexOf('.', at) > at + 1 && !value.endsWith('.')
}

/** Mask an address for logs: `jane.doe@acme.com` → `j***@acme.com`. */
export function maskAddress(value: unknown): string {
  const s = String(value ?? '')
  const at = s.indexOf('@')
  if (at < 1) return '***'
  return `${s[0]}***${s.slice(at)}`
}
