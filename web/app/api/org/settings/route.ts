import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import OrgSettings from '@/models/OrgSettings'
import { getUser } from '@/lib/auth'
import { pick } from '@/lib/pick'
import { ORG_SETTINGS_FIELDS } from '@/lib/apiFields'

export async function GET() {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const settings = await OrgSettings.findOne().lean()
  return NextResponse.json(settings || {
    name: 'Doppelmayr India Pvt Ltd',
    address: '', website: '', phone: '', email: '', logo: '',
  })
}

export async function POST(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const body = await req.json()

  const settings = await OrgSettings.findOneAndUpdate(
    {},
    { ...pick(body, ORG_SETTINGS_FIELDS), updatedBy: userId },
    { upsert: true, returnDocument: 'after' }
  ).lean()

  return NextResponse.json(settings)
}
