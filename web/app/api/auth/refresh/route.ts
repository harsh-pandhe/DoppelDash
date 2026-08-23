import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import { rotateMobileRefreshToken, signMobileAccessToken } from '@/lib/auth'

// Mobile-only: exchanges a still-valid refresh token for a new access token
// + a rotated refresh token. No cookie/session involved — this is the
// entire Bearer-auth story for the app's silent-refresh-on-401 flow.
export async function POST(req: NextRequest) {
  const { refreshToken } = await req.json()
  if (!refreshToken) return NextResponse.json({ error: 'refreshToken required' }, { status: 400 })

  const rotated = await rotateMobileRefreshToken(refreshToken)
  if (!rotated) return NextResponse.json({ error: 'Invalid or expired refresh token' }, { status: 401 })

  await connectDB()
  const user = await User.findById(rotated.userId)
  if (!user || !user.isActive || user.isBanned) {
    return NextResponse.json({ error: 'Account unavailable' }, { status: 403 })
  }

  const accessToken = await signMobileAccessToken(user.toPublic())
  return NextResponse.json({ accessToken, refreshToken: rotated.refreshToken })
}
