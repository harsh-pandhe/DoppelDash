import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import UserEmailConfig from '@/models/UserEmailConfig'
import { encrypt } from '@/lib/encrypt'
import { getUser } from '@/lib/auth'

export async function GET() {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const config = await UserEmailConfig.findOne({ userId }).lean() as Record<string, unknown> | null
  if (!config) return NextResponse.json(null)

  return NextResponse.json({
    emailAddress: config.emailAddress,
    smtpHost:     config.smtpHost,
    smtpPort:     config.smtpPort,
    isVerified:   config.isVerified,
  })
}

export async function POST(req: NextRequest) {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { emailAddress?: string; smtpHost?: string; smtpPort?: number; appPassword?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { emailAddress, smtpHost, smtpPort = 587, appPassword } = body
  if (!emailAddress || !smtpHost || !appPassword) {
    return NextResponse.json({ error: 'emailAddress, smtpHost, and appPassword are required' }, { status: 400 })
  }

  await connectDB()
  const encrypted = encrypt(appPassword)
  await UserEmailConfig.findOneAndUpdate(
    { userId },
    { userId, emailAddress, smtpHost, smtpPort, appPassword: encrypted, isVerified: false },
    { upsert: true, returnDocument: 'after' }
  )

  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  await UserEmailConfig.deleteOne({ userId })
  return NextResponse.json({ ok: true })
}
