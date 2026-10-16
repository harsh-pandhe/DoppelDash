import { NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { getUser } from '@/lib/auth'
import { connectDB } from '@/lib/db'
import User from '@/models/User'

/** Mark the welcome tour as seen for the signed-in user (DB-persisted, survives storage resets). */
async function POST_handler() {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  await User.findByIdAndUpdate(userId, { tourSeen: true })
  return NextResponse.json({ ok: true })
}

export const POST = dbGuard(POST_handler)
