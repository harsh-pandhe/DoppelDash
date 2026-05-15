import { listUsers } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import { sendBirthdayEmail } from '@/lib/email'

// Called by system cron: 0 8 * * * curl http://localhost:3000/api/cron/birthday?secret=<CRON_SECRET>
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await connectDB()
  const today = new Date()
  const month = today.getMonth() + 1
  const day   = today.getDate()

  const contacts = await Contact.find({
    birthday: { $exists: true },
    birthdayGreetingSent: { $ne: true },
  }).lean()

  const todayBirthdays = contacts.filter(c => {
    const b = new Date(c.birthday!)
    return b.getMonth() + 1 === month && b.getDate() === day
  })

  if (!todayBirthdays.length) {
    return NextResponse.json({ sent: 0, message: 'No birthdays today' })
  }

  // Get all manager/boss emails to notify
  let managerEmails: string[] = []
  try {
    const users = await listUsers({ limit: 500 })
    managerEmails = users
      .filter(u => u.role === 'manager' || u.role === 'boss')
      .map(u => u.email)
      .filter((e): e is string => Boolean(e))
  } catch { /* best-effort */ }

  let sent = 0
  for (const contact of todayBirthdays) {
    if (managerEmails.length) {
      await sendBirthdayEmail({ contactName: contact.name, emails: managerEmails })
    }
    await Contact.findByIdAndUpdate(contact._id, { birthdayGreetingSent: true })
    sent++
  }

  // Reset birthdayGreetingSent on Jan 1 for the new year
  if (month === 1 && day === 1) {
    await Contact.updateMany({}, { birthdayGreetingSent: false })
  }

  return NextResponse.json({ sent, contacts: todayBirthdays.map(c => c.name) })
}
