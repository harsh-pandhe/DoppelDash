import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { connectDB } from '@/lib/db'
import OrgSettings from '@/models/OrgSettings'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const settings = await OrgSettings.findOne().lean()
  return NextResponse.json(settings || {
    name: 'Doppelmayr India Pvt Ltd',
    address: '', website: '', phone: '', email: '', logo: '',
  })
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await currentUser().catch(() => null)
  const role = (user?.unsafeMetadata?.role as string) || 'employee'
  if (role !== 'boss') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const body = await req.json()

  const settings = await OrgSettings.findOneAndUpdate(
    {},
    { ...body, updatedBy: userId },
    { upsert: true, new: true }
  ).lean()

  return NextResponse.json(settings)
}
