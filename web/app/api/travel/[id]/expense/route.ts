import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import { getUser } from '@/lib/auth'
import { apiError } from '@/lib/travel/http'
import { convertTrip } from '@/lib/travel/conversion'
import { FailpointCrash, requestedFailpoint } from '@/lib/travel/failpoints'

/**
 * Create the expense claim for a completed (approved + returned) trip. Owner only. Idempotent and concurrency-safe: any number of
 * calls, in any order or in parallel, resolve to ONE expense (201 for the call that created it, 200 for every other). The protocol,
 * its recovery rules and its limits are in lib/travel/conversion.ts and docs/TRAVEL_VERTICAL_AUDIT.md (Slice 4).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, orgId } = await getUser()
  if (!userId) return apiError(401, 'Unauthorized', 'unauthorized')
  if (!mongoose.isValidObjectId(params.id)) return apiError(404, 'Not found', 'not_found')
  await connectDB()
  try {
    const r = await convertTrip({ tripId: params.id, orgId, userId, failpoint: requestedFailpoint(req.headers) })
    return NextResponse.json(r.body, { status: r.status, headers: r.headers })
  } catch (err) {
    if (err instanceof FailpointCrash) return apiError(500, 'Interrupted', 'conversion_interrupted')
    console.error('[travel-conversion] unexpected', (err as Error)?.name)
    return apiError(500, 'We couldn’t create the expense. Please try again.', 'conversion_failed')
  }
}
