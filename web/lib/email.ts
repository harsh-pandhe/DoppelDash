import { clerkClient } from '@clerk/nextjs/server'

export async function getUserEmail(userId: string): Promise<string | null> {
  try {
    const client = await clerkClient()
    const user   = await client.users.getUser(userId)
    return user.primaryEmailAddress?.emailAddress || null
  } catch {
    return null
  }
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey || !to) return
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from:    process.env.RESEND_FROM_EMAIL || 'DoppelDash <no-reply@doppeldash.in>',
        to:      [to],
        subject, html,
      }),
    })
  } catch { /* fire-and-forget */ }
}

// ─── Leave emails ──────────────────────────────────────────────────────────

export async function emailLeaveSubmitted(opts: {
  managerEmail: string; employeeName: string; leaveType: string; days: number; reason: string
}) {
  await sendEmail(
    opts.managerEmail,
    `New leave request from ${opts.employeeName}`,
    `<p>Hi,</p>
     <p><strong>${opts.employeeName}</strong> has submitted a <strong>${opts.leaveType}</strong> leave request for <strong>${opts.days} day(s)</strong>.</p>
     <p><em>Reason:</em> ${opts.reason}</p>
     <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/lms">Review in DoppelDash →</a></p>`
  )
}

export async function emailLeaveStatusChanged(opts: {
  employeeEmail: string; status: 'approved' | 'rejected'; leaveType: string; days: number; note?: string
}) {
  const approved = opts.status === 'approved'
  await sendEmail(
    opts.employeeEmail,
    `Your ${opts.leaveType} leave has been ${opts.status}`,
    `<p>Hi,</p>
     <p>Your <strong>${opts.leaveType}</strong> leave request (${opts.days} day(s)) has been <strong>${opts.status}</strong>.</p>
     ${opts.note ? `<p><em>Note from manager:</em> ${opts.note}</p>` : ''}
     <p style="color:${approved ? '#16a34a' : '#dc2626'}; font-weight:bold">${approved ? '✓ Approved' : '✗ Rejected'}</p>
     <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/lms">View in DoppelDash →</a></p>`
  )
}

// ─── Expense emails ─────────────────────────────────────────────────────────

export async function emailExpenseSubmitted(opts: {
  managerEmail: string; employeeName: string; title: string; amount: number
}) {
  await sendEmail(
    opts.managerEmail,
    `New expense claim from ${opts.employeeName}`,
    `<p>Hi,</p>
     <p><strong>${opts.employeeName}</strong> submitted an expense claim: <strong>${opts.title}</strong> — ₹${opts.amount.toLocaleString('en-IN')}.</p>
     <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/rms">Review in DoppelDash →</a></p>`
  )
}

export async function emailExpensePendingPayout(opts: {
  bossEmail: string; employeeName: string; title: string; amount: number
}) {
  await sendEmail(
    opts.bossEmail,
    `Expense pending payout — ₹${opts.amount.toLocaleString('en-IN')}`,
    `<p>Hi,</p>
     <p>An expense from <strong>${opts.employeeName}</strong> is awaiting your payout approval.</p>
     <p><strong>${opts.title}</strong> — ₹${opts.amount.toLocaleString('en-IN')}</p>
     <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/rms">Review in DoppelDash →</a></p>`
  )
}

export async function emailExpenseStatusChanged(opts: {
  employeeEmail: string; status: 'paid' | 'rejected'; title: string; amount: number; note?: string
}) {
  const paid = opts.status === 'paid'
  await sendEmail(
    opts.employeeEmail,
    paid ? `Expense reimbursed — ₹${opts.amount.toLocaleString('en-IN')}` : `Expense rejected: ${opts.title}`,
    `<p>Hi,</p>
     <p>Your expense <strong>${opts.title}</strong> (₹${opts.amount.toLocaleString('en-IN')}) has been <strong>${opts.status}</strong>.</p>
     ${opts.note ? `<p><em>Note:</em> ${opts.note}</p>` : ''}
     <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/rms">View in DoppelDash →</a></p>`
  )
}

// ─── Birthday emails ─────────────────────────────────────────────────────────

export async function sendBirthdayEmail(opts: { contactName: string; emails: string[] }) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey || !opts.emails.length) return
  await Promise.all(
    opts.emails.map(email =>
      sendEmail(
        email,
        `🎂 Birthday today: ${opts.contactName}`,
        `<p>Hi,</p>
         <p><strong>${opts.contactName}</strong> has a birthday today!</p>
         <p>Consider reaching out with a personalized message.</p>
         <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/crm">Open CRM →</a></p>`
      )
    )
  )
}

// ─── Announcement emails ────────────────────────────────────────────────────

export async function emailUrgentAnnouncement(opts: {
  emails: string[]; title: string; body: string
}) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey || !opts.emails.length) return
  await Promise.all(
    opts.emails.map(email =>
      sendEmail(email, `🚨 Urgent: ${opts.title}`, `<p><strong>${opts.title}</strong></p><p>${opts.body}</p>`)
    )
  )
}
