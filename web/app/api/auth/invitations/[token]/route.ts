import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { verifyInvitationToken } from '@/lib/invitations/invitationService'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  if (!token) {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 })
  }

  await connectDB()
  const result = await verifyInvitationToken(token)

  if (!result.valid) {
    const status = result.reason === 'invalid_token' ? 404 : 410
    return NextResponse.json(result, { status })
  }

  return NextResponse.json(result)
}
