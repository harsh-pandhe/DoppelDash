import { ImapFlow } from 'imapflow'

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

export async function fetchEmailsSince(since: Date, lastUid: number): Promise<EmailMessage[]> {
  const client = new ImapFlow({
    host:   process.env.IMAP_HOST!,
    port:   parseInt(process.env.IMAP_PORT || '993'),
    secure: (process.env.IMAP_SECURE ?? 'true') !== 'false',
    auth: {
      user: process.env.IMAP_USER!,
      pass: process.env.IMAP_PASS!,
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
