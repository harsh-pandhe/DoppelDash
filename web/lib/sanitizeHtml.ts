import sanitizeHtml from 'sanitize-html'

// Shared inbound/outbound HTML sanitizer — used for IMAP mail bodies and any
// other user-authored HTML (e.g. announcements) that gets persisted/emailed.
export function sanitizeMailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'span']),
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height'],
    },
    allowedSchemes: ['https', 'http', 'mailto', 'data', 'cid'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
    },
  })
}
