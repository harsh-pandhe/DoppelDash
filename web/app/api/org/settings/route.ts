import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import OrgSettings from '@/models/OrgSettings'
import { getUser } from '@/lib/auth'
import { pick } from '@/lib/pick'
import { ORG_SETTINGS_FIELDS } from '@/lib/apiFields'

export async function GET() {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orgId = user?.orgId || 'org_doppelmayr'
  await connectDB()
  const settings = await OrgSettings.findOne({ orgId }).lean()
  return NextResponse.json(settings || {
    orgId,
    name: orgId === 'org_doppelmayr' ? 'Doppelmayr India Pvt Ltd' : 'My Organization',
    address: '', website: '', phone: '', email: '', logo: '',
  })
}

export async function POST(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = user?.orgId || 'org_doppelmayr'
  await connectDB()
  const body = await req.json()

  const settings = await OrgSettings.findOneAndUpdate(
    { orgId },
    { ...pick(body, ORG_SETTINGS_FIELDS), orgId, updatedBy: userId },
    { upsert: true, returnDocument: 'after' }
  ).lean()

  return NextResponse.json(settings)
}
