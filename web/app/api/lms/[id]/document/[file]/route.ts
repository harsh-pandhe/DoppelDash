import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import Leave from '@/models/Leave'
import { getUser } from '@/lib/auth'
import { rateLimit } from '@/lib/ratelimit'
import { isReceiptRef } from '@/lib/uploads/attachmentStorage'
import { servePrivateFile } from '@/lib/uploads/privateFile'

/**
 * The ONLY way to read a stored leave medical document. Authorisation is re-checked on EVERY request, exactly like reading the leave itself
 * (GET /api/lms/[id]): anonymous → 401; another organisation → 404; an employee → only their own leave (403 otherwise); a manager or admin of
 * the same organisation → any leave of that organisation. The file is streamed server-side from private storage — no provider URL, signature or
 * storage reference ever reaches a client (`Cache-Control: no-store`).
 * Path: /api/lms/<leaveId>/document/<n>[.ext]   (n = index in `medicalDocs`)
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string; file: string } }) {
  const { userId, user, orgId } = await getUser()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!mongoose.isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const m = /^(\d{1,3})(?:\.[a-z0-9]{2,5})?$/i.exec(params.file)
  if (!m) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(await rateLimit(`leave-doc:${userId}`, 300, 60_000))) return NextResponse.json({ error: 'Too many requests', code: 'rate_limited' }, { status: 429 })

  await connectDB()
  const role = user?.role || 'employee'
  const leave = await Leave.findOne({ _id: params.id, orgId }).lean()
  if (!leave) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (role === 'employee' && (leave as unknown as { userId: string }).userId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const stored = leave.medicalDocs?.[Number(m[1])]
  if (!stored) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Legacy values (public URLs from before the private contract) are not served by this endpoint.
  if (!isReceiptRef(stored)) return NextResponse.json({ error: 'This document is a legacy file and is not served by this endpoint.', code: 'legacy_attachment' }, { status: 404 })
  return servePrivateFile(stored, orgId, 'medical-document', 'leave-docs')
}
