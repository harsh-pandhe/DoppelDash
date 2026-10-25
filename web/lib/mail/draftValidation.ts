/** Mail-draft input validation (Phase 12): types, sizes and recipient shape. Returns the offending top-level field names. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export const DRAFT_MAX = { subject: 998, bodyHtml: 500_000, recipients: 200, name: 200, email: 254, company: 200 }
const FIELDS = ['to', 'cc', 'bcc']
const SOURCES = ['contact', 'directory', 'manual']

export function invalidDraftFields(body: Record<string, unknown>): string[] {
  const bad: string[] = []
  if (body.subject !== undefined && (typeof body.subject !== 'string' || body.subject.length > DRAFT_MAX.subject)) bad.push('subject')
  if (body.bodyHtml !== undefined && (typeof body.bodyHtml !== 'string' || body.bodyHtml.length > DRAFT_MAX.bodyHtml)) bad.push('bodyHtml')
  const r = body.recipients
  if (r !== undefined) {
    const ok = Array.isArray(r) && r.length <= DRAFT_MAX.recipients && r.every(x => {
      const o = x as Record<string, unknown>
      return !!x && typeof x === 'object' && !Array.isArray(x)
        && typeof o.email === 'string' && o.email.length <= DRAFT_MAX.email && EMAIL.test(o.email)
        && (o.name === undefined || (typeof o.name === 'string' && o.name.length <= DRAFT_MAX.name))
        && (o.company === undefined || (typeof o.company === 'string' && o.company.length <= DRAFT_MAX.company))
        && (o.field === undefined || FIELDS.includes(o.field as string))
        && (o.source === undefined || SOURCES.includes(o.source as string))
    })
    if (!ok) bad.push('recipients')
  }
  return bad
}

/** Reduce each recipient to the schema fields (no extra keys stored). Call only after invalidDraftFields() passed. */
export function cleanRecipients(r: unknown[]): { name: string; email: string; company?: string; field: 'to' | 'cc' | 'bcc'; source: 'contact' | 'directory' | 'manual' }[] {
  return r.map(x => {
    const o = x as Record<string, string | undefined>
    return {
      name: o.name || '', email: o.email as string, ...(o.company ? { company: o.company } : {}),
      field: (o.field || 'to') as 'to' | 'cc' | 'bcc', source: (o.source || 'manual') as 'contact' | 'directory' | 'manual',
    }
  })
}
