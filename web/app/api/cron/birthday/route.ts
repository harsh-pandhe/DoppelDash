import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { isCronAuthorized } from '@/lib/cron/auth'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import { claim, finish, release, claimableFragment } from '@/lib/cron/claim'
import { sendBirthdayEmail } from '@/lib/email'
import { getBirthdayNotificationRecipients } from '@/lib/cron-recipients'

// Called by system cron: 0 8 * * * curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/birthday
async function GET_handler(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await connectDB()
  const today = new Date()
  const month = today.getMonth() + 1
  const day   = today.getDate()
  const year  = today.getFullYear()

  // Candidates: birthday today, not yet sent THIS YEAR, lease free/expired, under today's attempt cap (lib/cron/claim.ts).
  const coll = Contact.collection as unknown as import('mongodb').Collection<import('mongodb').Document>
  const contacts = await Contact.find({
    birthday: { $exists: true },
    birthdayGreetingYear: { $ne: year },
    ...claimableFragment('birthday', today),
  }).lean()

  const todayBirthdays = contacts.filter(c => {
    const b = new Date(c.birthday!)
    return b.getMonth() + 1 === month && b.getDate() === day
  })

  if (!todayBirthdays.length) {
    return NextResponse.json({ sent: 0, message: 'No birthdays today' })
  }

  let sent = 0
  for (const contact of todayBirthdays) {
    // A record without a tenant is never assigned one — skip it.
    if (!contact.orgId) continue
    // ATOMIC LEASE before sending: overlapping runs cannot both win; a crashed run's lease expires and the contact is retried.
    if (!(await claim(coll, contact._id, { birthdayGreetingYear: { $ne: year } }, 'birthday', today))) continue
    try {
      const managerEmails = await getBirthdayNotificationRecipients(contact.orgId)
      if (managerEmails.length) await sendBirthdayEmail({ contactName: contact.name, emails: managerEmails, orgId: contact.orgId })
      await finish(coll, contact._id, 'birthday', { birthdayGreetingYear: year, birthdayGreetingSent: true })
      sent++
    } catch {
      await release(coll, contact._id, 'birthday').catch(() => undefined)   // retried by the next run (bounded per day)
    }
  }

  // Counts only: the scheduler's run history/logs (often third-party or public) must never carry contact names.
  return NextResponse.json({ sent })
}

export const GET = dbGuard(GET_handler)
