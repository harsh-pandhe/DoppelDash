import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/cron/auth'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import { sendBirthdayEmail } from '@/lib/email'
import { getBirthdayNotificationRecipients } from '@/lib/cron-recipients'

// Called by system cron: 0 8 * * * curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/birthday
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await connectDB()
  const today = new Date()
  const month = today.getMonth() + 1
  const day   = today.getDate()
  const year  = today.getFullYear()

  // Candidates: birthday today and not yet claimed THIS YEAR (the old boolean + Jan-1 reset could re-send on a second Jan-1 run).
  const contacts = await Contact.find({
    birthday: { $exists: true },
    birthdayGreetingYear: { $ne: year },
  }).lean()

  const todayBirthdays = contacts.filter(c => {
    const b = new Date(c.birthday!)
    return b.getMonth() + 1 === month && b.getDate() === day
  })

  if (!todayBirthdays.length) {
    return NextResponse.json({ sent: 0, message: 'No birthdays today' })
  }

  let sent = 0
  const names: string[] = []
  for (const contact of todayBirthdays) {
    // A record without a tenant is never assigned one — skip it.
    if (!contact.orgId) continue
    // ATOMIC CLAIM before sending: two overlapping runs (a retried trigger, two schedulers) cannot both win, so a reminder goes out once.
    const claimed = await Contact.findOneAndUpdate(
      { _id: contact._id, birthdayGreetingYear: { $ne: year } },
      { $set: { birthdayGreetingYear: year, birthdayGreetingSent: true } },
      { projection: { _id: 1 } },
    )
    if (!claimed) continue
    try {
      const managerEmails = await getBirthdayNotificationRecipients(contact.orgId)
      if (managerEmails.length) await sendBirthdayEmail({ contactName: contact.name, emails: managerEmails, orgId: contact.orgId })
      sent++; names.push(contact.name)
    } catch {
      // Could not even attempt delivery: release the claim so the next run retries (at-least-once, never silently dropped).
      await Contact.updateOne({ _id: contact._id, birthdayGreetingYear: year }, { $unset: { birthdayGreetingYear: 1 }, $set: { birthdayGreetingSent: false } }).catch(() => undefined)
    }
  }

  return NextResponse.json({ sent, contacts: names })
}
