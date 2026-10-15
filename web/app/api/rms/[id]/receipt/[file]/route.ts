import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import Expense from '@/models/Expense'
import { getUser } from '@/lib/auth'
import { rateLimit } from '@/lib/ratelimit'
import { isReceiptRef } from '@/lib/uploads/attachmentStorage'
import { servePrivateFile } from '@/lib/uploads/privateFile'

/**
 * The ONLY way to read a stored receipt. Authorisation is the same as reading the expense itself (owner, or a manager/admin
 * of the same organisation; every other tenant gets a 404), re-checked on every request. The file is fetched server-side from
 * the provider with a freshly signed private-download request and streamed back with `no-store`: no provider URL, signature
 * or reusable link ever reaches a client, so there is nothing to forward, cache or leak — access ends when the user's
 * authorisation does.
 *
 * Path: /api/rms/<expenseId>/receipt/<n>[.ext]   (n = index in `receipts`; `l<n>` = index in `lineItems`)
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string; file: string } }) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!mongoose.isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const m = /^(l?)(\d{1,3})(?:\.[a-z0-9]{2,5})?$/i.exec(params.file)
  if (!m) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!(await rateLimit(`rms-receipt:${userId}`, 300, 60_000))) return NextResponse.json({ error: 'Too many requests', code: 'rate_limited' }, { status: 429 })

  await connectDB()
  const role = user?.role || 'employee'
  const expense = await Expense.findOne({ _id: params.id, orgId }).lean()
  if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (role === 'employee' && expense.userId !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const idx = Number(m[2])
  const stored = m[1] ? expense.lineItems?.[idx]?.receiptUrl : expense.receipts?.[idx]
  if (!stored) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isReceiptRef(stored)) {
    // A pre-existing public URL (not a private reference): clients are given that URL directly by the API.
    return NextResponse.json({ error: 'This receipt is a legacy public file and is not served by this endpoint.', code: 'legacy_attachment' }, { status: 404 })
  }

  return servePrivateFile(stored, orgId, 'receipt', 'receipts')
}
