import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import PublicHoliday from '@/models/PublicHoliday'
import { getUser } from '@/lib/auth'

// India national holidays (recurring, seeded on first GET if empty)
function indiaHolidays(year: number) {
  return [
    { name: "New Year's Day",          date: new Date(year, 0,  1),  type: 'national'   },
    { name: 'Republic Day',            date: new Date(year, 0, 26),  type: 'national'   },
    { name: 'Holi',                    date: new Date(year, 2, 14),  type: 'national'   },
    { name: 'Good Friday',             date: new Date(year, 3, 18),  type: 'national'   },
    { name: 'Ambedkar Jayanti',        date: new Date(year, 3, 14),  type: 'national'   },
    { name: 'Labour Day',              date: new Date(year, 4,  1),  type: 'national'   },
    { name: 'Independence Day',        date: new Date(year, 7, 15),  type: 'national'   },
    { name: 'Janmashtami',             date: new Date(year, 7, 26),  type: 'national'   },
    { name: 'Gandhi Jayanti',          date: new Date(year, 9,  2),  type: 'national'   },
    { name: 'Dussehra',                date: new Date(year, 9,  2),  type: 'national'   },
    { name: 'Diwali',                  date: new Date(year, 9, 20),  type: 'national'   },
    { name: 'Diwali (Lakshmi Puja)',   date: new Date(year, 9, 21),  type: 'national'   },
    { name: 'Guru Nanak Jayanti',      date: new Date(year, 10, 5),  type: 'national'   },
    { name: 'Christmas',               date: new Date(year, 11, 25), type: 'national'   },
    // Restricted / optional
    { name: 'Eid ul-Fitr',             date: new Date(year, 3, 10),  type: 'restricted' },
    { name: 'Eid ul-Adha',             date: new Date(year, 5, 17),  type: 'restricted' },
    { name: 'Muharram',                date: new Date(year, 6,  6),  type: 'restricted' },
    { name: 'Milad-un-Nabi',           date: new Date(year, 8, 15),  type: 'restricted' },
    { name: 'Maha Shivaratri',         date: new Date(year, 2, 18),  type: 'optional'   },
    { name: 'Ram Navami',              date: new Date(year, 3, 17),  type: 'optional'   },
    { name: 'Navratri',                date: new Date(year, 9,  3),  type: 'optional'   },
  ].map(h => ({ ...h, year, isRecurringYearly: true, orgId: null }))
}

export async function GET(req: NextRequest) {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()

  const { searchParams } = new URL(req.url)
  const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()))

  // Seed India defaults if none exist for this year
  const count = await PublicHoliday.countDocuments({ year, orgId: null })
  if (count === 0) {
    await PublicHoliday.insertMany(indiaHolidays(year))
  }

  const holidays = await PublicHoliday.find({ year }).sort({ date: 1 }).lean()
  return NextResponse.json(holidays)
}

export async function POST(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role !== 'boss' && role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const body = await req.json()
  const { name, date, type, description } = body
  if (!name || !date) return NextResponse.json({ error: 'name and date required' }, { status: 400 })

  const d = new Date(date)
  const holiday = await PublicHoliday.create({
    name, date: d, type: type || 'optional', description,
    year: d.getFullYear(), isRecurringYearly: false, createdBy: userId,
  })
  return NextResponse.json(holiday)
}

export async function DELETE(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role !== 'boss' && role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const { id } = await req.json()
  await PublicHoliday.findByIdAndDelete(id)
  return NextResponse.json({ success: true })
}
