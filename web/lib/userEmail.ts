import nodemailer, { Transporter } from 'nodemailer'
import { connectDB } from '@/lib/db'
import UserEmailConfig from '@/models/UserEmailConfig'
import { decrypt } from '@/lib/encrypt'

interface SendOptions {
  to:      string | string[]
  subject: string
  html?:   string
  text?:   string
}

export async function getUserTransporter(userId: string): Promise<{ transporter: Transporter; from: string } | null> {
  await connectDB()
  const config = await UserEmailConfig.findOne({ userId }).lean() as Record<string, unknown> | null
  if (!config || !config.isVerified) return null

  const appPassword = decrypt(config.appPassword as string)
  const transporter = nodemailer.createTransport({
    host:   config.smtpHost as string,
    port:   config.smtpPort as number,
    secure: (config.smtpPort as number) === 465,
    auth: {
      user: config.emailAddress as string,
      pass: appPassword,
    },
  })

  return { transporter, from: `"DoppelDash" <${config.emailAddress}>` }
}

export async function sendFromUser(userId: string, opts: SendOptions): Promise<void> {
  const result = await getUserTransporter(userId)
  if (!result) throw new Error('No verified email configured for this user')

  const { transporter, from } = result
  await transporter.sendMail({ from, ...opts })
}
