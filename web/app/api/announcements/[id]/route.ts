import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import Announcement from '@/models/Announcement'
import { getUser } from '@/lib/auth'
import { sanitizeMailHtml } from '@/lib/sanitizeHtml'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!mongoose.isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const effectiveOrgId = orgId || 'org_doppelmayr'
  await connectDB()
  const body = await req.json()
  delete body.orgId
  delete body.authorId
  delete body._id

  if ('scheduledFor' in body) {
    body.scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : null
  }
  if (typeof body.body === 'string') body.body = sanitizeMailHtml(body.body)
  const item = await Announcement.findOneAndUpdate({ _id: params.id, orgId: effectiveOrgId }, body, { returnDocument: 'after' })
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(item)
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!mongoose.isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const effectiveOrgId = orgId || 'org_doppelmayr'
  await connectDB()
  const res = await Announcement.findOneAndDelete({ _id: params.id, orgId: effectiveOrgId })
  if (!res) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
