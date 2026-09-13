import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Leave from '@/models/Leave'
import PublicHoliday from '@/models/PublicHoliday'
import { getUser } from '@/lib/auth'

// Format a Date as an all-day ICS value (YYYYMMDD, floating local date).
const icsDate = (d: Date) => {
  const dt = new Date(d)
  return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getDate()).padStart(2, '0')}`
}
// DTEND on all-day events is exclusive — add one day.
const icsDateExclusive = (d: Date) => {
  const dt = new Date(d)
  dt.setDate(dt.getDate() + 1)
  return icsDate(dt)
}
const esc = (s: string) => (s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n')
const fold = (line: string) => {
  if (line.length <= 73) return line
  const chunks: string[] = []
  let rest = line
  chunks.push(rest.slice(0, 73)); rest = rest.slice(73)
  while (rest.length) { chunks.push(' ' + rest.slice(0, 72)); rest = rest.slice(72) }
  return chunks.join('\r\n')
}

export async function GET(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  const isManager = role === 'manager' || role === 'admin'

  await connectDB()
  const scope = new URL(req.url).searchParams.get('scope') || 'me'
  const teamScope = scope === 'team' && isManager

  const leaveQuery: Record<string, unknown> = { status: 'approved', orgId }
  if (!teamScope) leaveQuery.userId = userId
  const leaves = await Leave.find(leaveQuery).sort({ startDate: 1 }).limit(500).lean()
  const holidays = await PublicHoliday.find({ $or: [{ orgId }, { orgId: null }] }).sort({ date: 1 }).limit(500).lean()

  const stamp = `${icsDate(new Date())}T000000Z`
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DoppelDash//Leave Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:DoppelDash ${teamScope ? 'Team' : 'My'} Leaves & Holidays`,
  ]

  for (const l of leaves) {
    const half = l.isHalfDay ? ` (½ day ${l.halfDayPeriod || ''})`.trimEnd() : ''
    const who = teamScope ? `${l.userName} — ` : ''
    lines.push(
      'BEGIN:VEVENT',
      `UID:leave-${String(l._id)}@doppeldash`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(l.startDate)}`,
      `DTEND;VALUE=DATE:${icsDateExclusive(l.endDate)}`,
      fold(`SUMMARY:${esc(`${who}${l.type} leave${half}`)}`),
      fold(`DESCRIPTION:${esc(l.reason || '')}`),
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    )
  }

  for (const h of holidays) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:holiday-${String(h._id)}@doppeldash`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(h.date)}`,
      `DTEND;VALUE=DATE:${icsDateExclusive(h.date)}`,
      fold(`SUMMARY:${esc(`🏖 ${h.name}`)}`),
      fold(`DESCRIPTION:${esc(`${h.type} holiday${h.description ? ' — ' + h.description : ''}`)}`),
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    )
  }

  lines.push('END:VCALENDAR')
  const body = lines.join('\r\n')

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="doppeldash-${teamScope ? 'team' : 'my'}-leaves.ics"`,
    },
  })
}
