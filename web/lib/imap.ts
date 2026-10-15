import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { connectDB } from '@/lib/db'
import InboxMessage from '@/models/InboxMessage'
import { sanitizeMailHtml } from '@/lib/sanitizeHtml'

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

/**
 * The platform IMAP mailbox (IMAP_HOST/USER/PASS in the environment) is ONE mailbox. Its mail belongs to exactly one organisation —
 * IMAP_OWNER_ORG_ID (the operator's organisation id). Without that binding every tenant could trigger a sync and have the operator's mail matched
 * against THEIR contacts' timelines (cross-tenant leak) and could hammer the mailbox. Fail closed: unset → nobody may use the shared mailbox.
 */
export function imapOwnerOrgId(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = (env.IMAP_OWNER_ORG_ID || '').trim()
  return v || null
}
export function canUseSharedImap(orgId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const owner = imapOwnerOrgId(env)
  return !!owner && !!orgId && owner === orgId
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
export async function syncInbox(orgId: string): Promise<SyncResult> {
  if (!imapConfigured() || !canUseSharedImap(orgId)) {
    return { synced: 0, skipped: 0, total: 0, configured: false }
  }
  await connectDB()

  const newest = await InboxMessage.findOne({ orgId, mailbox: INBOX_MAILBOX })
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

        try {
          const parsed = await simpleParser(msg.source)
          const fromAddr = parsed.from?.value?.[0]
          const toList = Array.isArray(parsed.to)
            ? parsed.to.flatMap(t => t.value.map(v => v.address || ''))
            : (parsed.to?.value?.map(v => v.address || '') ?? [])
          const text = parsed.text || ''
          const rawHtml = typeof parsed.html === 'string' ? parsed.html : ''
          const html = rawHtml ? sanitizeMailHtml(rawHtml) : ''
          const snippet = (text || rawHtml.replace(/<[^>]+>/g, ' '))
            .replace(/\s+/g, ' ').trim().slice(0, 200)

          await InboxMessage.updateOne(
            { orgId, mailbox: INBOX_MAILBOX, uid: msg.uid },
            {
              $set: {
                orgId,
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
        } catch (err) {
          console.error(`syncInbox: failed to process uid ${msg.uid}`, err)
          // Store a minimal stub so this UID counts as "handled" and sinceUid
          // (derived from the max stored uid) advances past it next poll —
          // otherwise a single poisoned message would block all newer mail forever.
          await InboxMessage.updateOne(
            { orgId, mailbox: INBOX_MAILBOX, uid: msg.uid },
            {
              $set: {
                orgId,
                mailbox:  INBOX_MAILBOX,
                uid:      msg.uid,
                subject:  '(failed to parse message)',
                syncedAt: new Date(),
              },
              $setOnInsert: {
                fromName: '', fromAddress: 'unknown@unknown', toAddresses: [],
                snippet: '', text: '', html: '', date: new Date(),
                seen: false, attachments: [], readByApp: false,
              },
            },
            { upsert: true },
          ).catch(e => console.error(`syncInbox: failed to store stub for uid ${msg.uid}`, e))
          skipped++
        }
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }

  return { synced, skipped, total, configured: true }
}
