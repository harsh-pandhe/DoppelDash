import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import sanitizeHtml from 'sanitize-html'
import { connectDB } from '@/lib/db'
import InboxMessage from '@/models/InboxMessage'

export interface EmailMessage {
  uid: number
  subject: string
  fromName: string
  fromEmail: string
  date: Date
  snippet: string
}

export function imapConfigured(): boolean {
  return !!(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASS)
}

// Gmail app passwords are shown as 4 space-separated groups ("xxxx xxxx xxxx xxxx")
// but IMAP/SMTP auth expects them with no spaces. Normalize defensively.
function imapPass(): string {
  return (process.env.IMAP_PASS || '').replace(/\s+/g, '')
}

export async function fetchEmailsSince(since: Date, lastUid: number): Promise<EmailMessage[]> {
  const client = new ImapFlow({
    host:   process.env.IMAP_HOST!,
    port:   parseInt(process.env.IMAP_PORT || '993'),
    secure: (process.env.IMAP_SECURE ?? 'true') !== 'false',
    auth: {
      user: process.env.IMAP_USER!,
      pass: imapPass(),
    },
    logger: false,
  })

  const messages: EmailMessage[] = []

  await client.connect()
  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const uids = await client.search({ since, uid: lastUid ? `${lastUid + 1}:*` : undefined })
      if (!uids.length) return messages

      for await (const msg of client.fetch(uids, { envelope: true, bodyParts: ['text'] })) {
        const from = msg.envelope?.from?.[0]
        if (!from?.address) continue

        const bodyPart = msg.bodyParts?.get('text')
        const snippet  = bodyPart
          ? Buffer.from(bodyPart as Buffer).toString('utf8').slice(0, 300).replace(/\s+/g, ' ')
          : ''

        messages.push({
          uid:       msg.uid,
          subject:   msg.envelope?.subject || '(no subject)',
          fromName:  from.name || from.address,
          fromEmail: from.address.toLowerCase(),
          date:      msg.envelope?.date || new Date(),
          snippet,
        })
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout()
  }

  return messages
}

/* ════════════════════════════════════════════════════════════════════
   Standalone Inbox sync (full body parse → InboxMessage collection)
   Poll-on-demand; idempotent via (mailbox, uid) unique index.
   ════════════════════════════════════════════════════════════════════ */

const INBOX_MAILBOX = 'INBOX'
const MAX_PER_SYNC = 40 // cap work per poll so a serverless invocation stays under timeout

function sanitizeBody(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'span']),
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height'],
      '*': ['style'],
    },
    allowedSchemes: ['https', 'http', 'mailto', 'data', 'cid'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
    },
  })
}

export interface SyncResult {
  synced: number
  skipped: number
  total: number
  configured: boolean
}

/**
 * Fetch messages with UID greater than the highest already stored, parse +
 * sanitize + upsert into InboxMessage. Returns counts. Re-runnable safely.
 */
export async function syncInbox(): Promise<SyncResult> {
  if (!imapConfigured()) {
    return { synced: 0, skipped: 0, total: 0, configured: false }
  }
  await connectDB()

  const newest = await InboxMessage.findOne({ mailbox: INBOX_MAILBOX })
    .sort({ uid: -1 }).select('uid').lean()
  const sinceUid = newest?.uid ?? 0

  const client = new ImapFlow({
    host:   process.env.IMAP_HOST || 'imap.gmail.com',
    port:   parseInt(process.env.IMAP_PORT || '993'),
    secure: (process.env.IMAP_SECURE ?? 'true') !== 'false',
    auth:   { user: process.env.IMAP_USER!, pass: imapPass() },
    logger: false,
  })

  let synced = 0, skipped = 0, total = 0

  await client.connect()
  try {
    const lock = await client.getMailboxLock(INBOX_MAILBOX)
    try {
      // imapflow@1.3.2 .d.ts under-types `mailbox`/fetched `source`+`flags`
      // (present at runtime). Narrow locally rather than upgrade.
      const mbox = (client as unknown as { mailbox: { exists: number } | false }).mailbox
      total = mbox ? mbox.exists : 0

      // resolve new UIDs first (2-arg fetch is what imapflow@1.3.2 .d.ts allows)
      const allUids = await client.search({ uid: `${sinceUid + 1}:*` })
      // bound the fetch to the newest MAX_PER_SYNC UIDs — fetching a huge range
      // (e.g. an entire 27k-message mailbox on first sync) times the socket out.
      const uids = (allUids || []).slice(-MAX_PER_SYNC)
      skipped += Math.max(0, (allUids?.length || 0) - uids.length)
      const fetcher = (uids.length > 0)
        ? client.fetch(
            uids,
            { uid: true, flags: true, source: true } as Parameters<typeof client.fetch>[1],
          ) as AsyncIterable<{ uid: number; source?: Buffer; flags?: Set<string> }>
        : ([] as AsyncIterable<{ uid: number; source?: Buffer; flags?: Set<string> }> | never[])
      for await (const msg of fetcher) {
        if (msg.uid <= sinceUid) { skipped++; continue }
        if (synced >= MAX_PER_SYNC) break
        if (!msg.source) { skipped++; continue }

        const parsed = await simpleParser(msg.source)
        const fromAddr = parsed.from?.value?.[0]
        const toList = Array.isArray(parsed.to)
          ? parsed.to.flatMap(t => t.value.map(v => v.address || ''))
          : (parsed.to?.value?.map(v => v.address || '') ?? [])
        const text = parsed.text || ''
        const rawHtml = typeof parsed.html === 'string' ? parsed.html : ''
        const html = rawHtml ? sanitizeBody(rawHtml) : ''
        const snippet = (text || rawHtml.replace(/<[^>]+>/g, ' '))
          .replace(/\s+/g, ' ').trim().slice(0, 200)

        await InboxMessage.updateOne(
          { mailbox: INBOX_MAILBOX, uid: msg.uid },
          {
            $set: {
              mailbox:     INBOX_MAILBOX,
              uid:         msg.uid,
              messageId:   parsed.messageId,
              fromName:    fromAddr?.name || '',
              fromAddress: (fromAddr?.address || 'unknown@unknown').toLowerCase(),
              toAddresses: toList.filter(Boolean),
              subject:     parsed.subject || '(no subject)',
              snippet,
              text,
              html,
              date:        parsed.date || new Date(),
              seen:        msg.flags?.has('\\Seen') ?? false,
              attachments: (parsed.attachments || []).map(a => ({
                filename:    a.filename || 'attachment',
                contentType: a.contentType || 'application/octet-stream',
                size:        a.size || 0,
              })),
              syncedAt:    new Date(),
            },
            $setOnInsert: { readByApp: false },
          },
          { upsert: true },
        )
        synced++
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }

  return { synced, skipped, total, configured: true }
}
