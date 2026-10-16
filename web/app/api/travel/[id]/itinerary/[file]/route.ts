import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { apiError } from '@/lib/travel/http'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import TravelRequest from '@/models/TravelRequest'
import { getUser } from '@/lib/auth'
import { rateLimit } from '@/lib/ratelimit'
import { isReceiptRef } from '@/lib/uploads/attachmentStorage'
import { servePrivateFile } from '@/lib/uploads/privateFile'

/**
 * The ONLY way to read a stored itinerary document. Authorisation is the same as reading the trip (owner, or a manager/admin of the same
 * organisation; other tenants get 404), re-checked on every request. Streamed server-side from private storage — no provider URL ever reaches a client.
 * Path: /api/travel/<tripId>/itinerary/<n>[.ext]   (n = index in `itineraryDocs`)
 */
async function GET_handler(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string; file: string }> }) {
  const params = await paramsPromise
  const { userId, user, orgId } = await getUser()
  if (!userId) return apiError(401, 'Unauthorized', 'unauthorized')
  if (!mongoose.isValidObjectId(params.id)) return apiError(404, 'Not found', 'not_found')
  const m = /^(\d{1,3})(?:\.[a-z0-9]{2,5})?$/i.exec(params.file)
  if (!m) return apiError(404, 'Not found', 'not_found')
  if (!(await rateLimit(`travel-doc:${userId}`, 300, 60_000))) return NextResponse.json({ error: 'Too many requests', code: 'rate_limited' }, { status: 429 })

  await connectDB()
  const role = user?.role || 'employee'
  const tr = await TravelRequest.findOne({ _id: params.id, orgId }).lean()
  if (!tr) return apiError(404, 'Not found', 'not_found')
  if (role === 'employee' && tr.userId !== userId) return apiError(403, 'Forbidden', 'forbidden')
  const stored = tr.itineraryDocs?.[Number(m[1])]
  if (!stored) return apiError(404, 'Not found', 'not_found')
  if (!isReceiptRef(stored)) return NextResponse.json({ error: 'This document is a legacy file and is not served by this endpoint.', code: 'legacy_attachment' }, { status: 404 })
  return servePrivateFile(stored, orgId, 'itinerary', 'travel-docs')
}

export const GET = dbGuard(GET_handler)
