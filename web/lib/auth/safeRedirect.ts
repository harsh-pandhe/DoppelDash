/** Same-origin relative paths only (no protocol-relative / backslash tricks, never back into auth pages). */
export function safeRedirect(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null
  if (value.startsWith('/sign-in') || value.startsWith('/web-access-restricted')) return null
  return value
}
