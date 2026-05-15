import { NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import UserEmailConfig from '@/models/UserEmailConfig'
import { decrypt } from '@/lib/encrypt'
import nodemailer from 'nodemailer'
import { getUser } from '@/lib/auth'

export async function POST() {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const config = await UserEmailConfig.findOne({ userId }).lean() as Record<string, unknown> | null
  if (!config) return NextResponse.json({ error: 'No email configured' }, { status: 400 })

  const appPassword = decrypt(config.appPassword as string)

  try {
    const transporter = nodemailer.createTransport({
      host:   config.smtpHost as string,
      port:   config.smtpPort as number,
      secure: (config.smtpPort as number) === 465,
      auth: {
        user: config.emailAddress as string,
        pass: appPassword,
      },
    })

    await transporter.verify()

    // Send test email to themselves
    await transporter.sendMail({
      from:    `"DoppelDash" <${config.emailAddress}>`,
      to:      config.emailAddress as string,
      subject: 'DoppelDash — Email linked successfully',
      text:    'Your email is now linked to DoppelDash. You can send CRM campaigns from this address.',
    })

    // Mark as verified
    await UserEmailConfig.updateOne({ userId }, { isVerified: true })

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Connection failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
