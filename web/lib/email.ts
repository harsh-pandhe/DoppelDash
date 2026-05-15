import { getUserById } from '@/lib/auth/userService'
import { sendMail } from '@/lib/mailer'

export async function getUserEmail(userId: string): Promise<string | null> {
  const u = await getUserById(userId)
  return u?.email || null
}

export async function sendEmail(to: string, subject: string, html: string, text?: string): Promise<void> {
  if (!to) return
  await sendMail({ to, subject, html, text })
}

/* ═══════════════════════════════════════════════════════════════════════════
   Shared transactional email template
   ─────────────────────────────────────────────────────────────────────────── */

const BRAND_BLUE  = '#0057A8'
const BRAND_DARK  = '#003B73'
const GRAPHITE    = '#1a1a1a'
const SUBTLE      = '#6b7280'
const SURFACE     = '#f5f5f5'
const BORDER      = '#e5e7eb'
const SUCCESS     = '#0a7d3b'
const SUCCESS_BG  = '#e6f4ec'
const DANGER      = '#c83838'
const DANGER_BG   = '#fbe9e9'
const WARNING     = '#d97706'
const WARNING_BG  = '#fef3e2'

type Tone = 'info' | 'success' | 'warning' | 'danger'

const TONE_HEADER: Record<Tone, string> = {
  info:    BRAND_BLUE,
  success: SUCCESS,
  warning: WARNING,
  danger:  DANGER,
}

const TONE_BANNER_BG: Record<Tone, string> = {
  info:    '#e8f0fa',
  success: SUCCESS_BG,
  warning: WARNING_BG,
  danger:  DANGER_BG,
}

const TONE_BANNER_FG: Record<Tone, string> = {
  info:    BRAND_DARK,
  success: SUCCESS,
  warning: WARNING,
  danger:  DANGER,
}

export interface DetailRow {
  label: string
  value: string
  emphasis?: boolean   // larger / bolder, used for the headline value (e.g. amount)
}

export interface BuiltEmail {
  subject: string
  html:    string
  text:    string
}

export interface TransactionalEmailOpts {
  tone:        Tone
  eyebrow:     string                 // small label above heading (e.g. "Reimbursement")
  heading:     string                 // main heading shown in the body
  intro:       string                 // 1-2 sentence intro paragraph
  banner?:     { label: string; tone?: Tone }   // optional status pill below intro
  rows:        DetailRow[]            // key/value details
  cta?:        { label: string; href: string }
  note?:       { label: string; value: string }  // freeform note from sender (e.g. manager comment)
  subject:     string                 // email subject line
  previewText?:string                 // hidden preview text shown in inbox
  recipientName?: string              // for personalization ("Hi {name},")
  footerHint?: string                 // small extra line at the very bottom
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function buildTransactionalEmail(opts: TransactionalEmailOpts): BuiltEmail {
  const headerColor = TONE_HEADER[opts.tone]
  const greeting = opts.recipientName ? `Hi ${opts.recipientName},` : 'Hi,'

  const bannerHtml = opts.banner
    ? `<tr><td style="padding:0 32px 16px 32px;">
         <div style="display:inline-block;padding:6px 12px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;background:${TONE_BANNER_BG[opts.banner.tone || opts.tone]};color:${TONE_BANNER_FG[opts.banner.tone || opts.tone]};">${escapeHtml(opts.banner.label)}</div>
       </td></tr>`
    : ''

  const rowsHtml = opts.rows.length
    ? `<tr><td style="padding:0 32px 8px 32px;">
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${SURFACE};border:1px solid ${BORDER};border-radius:10px;">
           ${opts.rows.map((r, i) => `
             <tr>
               <td style="padding:${i === 0 ? '14px' : '10px'} 18px ${i === opts.rows.length - 1 ? '14px' : '10px'} 18px;${i < opts.rows.length - 1 ? `border-bottom:1px solid ${BORDER};` : ''}">
                 <p style="margin:0 0 2px 0;font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${SUBTLE};">${escapeHtml(r.label)}</p>
                 <p style="margin:0;font-size:${r.emphasis ? '20px' : '14px'};font-weight:${r.emphasis ? '800' : '600'};color:${GRAPHITE};${r.emphasis ? 'letter-spacing:-0.01em;' : ''}">${escapeHtml(r.value)}</p>
               </td>
             </tr>`).join('')}
         </table>
       </td></tr>`
    : ''

  const noteHtml = opts.note
    ? `<tr><td style="padding:14px 32px 4px 32px;">
         <div style="padding:14px 16px;border-left:3px solid ${BRAND_BLUE};background:#fafbfc;border-radius:0 8px 8px 0;">
           <p style="margin:0 0 4px 0;font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${SUBTLE};">${escapeHtml(opts.note.label)}</p>
           <p style="margin:0;font-size:14px;line-height:1.55;color:#374151;font-style:italic;">${escapeHtml(opts.note.value)}</p>
         </div>
       </td></tr>`
    : ''

  const ctaHtml = opts.cta
    ? `<tr><td style="padding:24px 32px 28px 32px;">
         <a href="${opts.cta.href}" style="display:inline-block;background:${BRAND_BLUE};color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;padding:11px 22px;border-radius:8px;">${escapeHtml(opts.cta.label)}</a>
       </td></tr>`
    : `<tr><td style="padding:0 0 16px 0;"></td></tr>`

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(opts.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${SURFACE};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif;color:${GRAPHITE};">
  ${opts.previewText ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(opts.previewText)}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${SURFACE};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">
        <tr>
          <td style="background:${headerColor};padding:22px 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.01em;">DoppelDash</td>
                <td align="right" style="color:rgba(255,255,255,0.85);font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;">Doppelmayr&nbsp;India</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 32px 4px 32px;">
            <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${SUBTLE};">${escapeHtml(opts.eyebrow)}</p>
            <h1 style="margin:0 0 14px 0;font-size:22px;font-weight:700;letter-spacing:-0.01em;color:${GRAPHITE};line-height:1.3;">${escapeHtml(opts.heading)}</h1>
            <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#374151;">${escapeHtml(greeting)}</p>
            <p style="margin:0 0 4px 0;font-size:14px;line-height:1.6;color:#374151;">${opts.intro}</p>
          </td>
        </tr>
        ${bannerHtml ? `<tr><td style="padding:16px 32px 0 32px;"></td></tr>${bannerHtml}` : '<tr><td style="height:8px;"></td></tr>'}
        ${rowsHtml}
        ${noteHtml}
        ${ctaHtml}
        <tr>
          <td style="background:${SURFACE};border-top:1px solid ${BORDER};padding:16px 32px;">
            <p style="margin:0;font-size:11px;line-height:1.55;color:${SUBTLE};">
              ${opts.footerHint ? `${escapeHtml(opts.footerHint)}<br/>` : ''}
              This is an automated message from DoppelDash — the internal platform of
              <strong style="color:${GRAPHITE};font-weight:600;">Doppelmayr</strong>.
              Please do not reply to this email.
            </p>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0 0;font-size:11px;color:#9ca3af;">© ${new Date().getFullYear()} Doppelmayr India · Navi Mumbai</p>
    </td></tr>
  </table>
</body>
</html>`

  const text = [
    opts.subject,
    '',
    greeting,
    '',
    opts.intro,
    opts.banner ? '\n[' + opts.banner.label + ']' : '',
    ...opts.rows.map(r => `${r.label}: ${r.value}`),
    opts.note ? `\n${opts.note.label}: ${opts.note.value}` : '',
    opts.cta ? `\nOpen in DoppelDash: ${opts.cta.href}` : '',
    '',
    '— Doppelmayr',
  ].filter(Boolean).join('\n')

  return { html, text, subject: opts.subject }
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || ''
}

const LEAVE_TYPE_LABEL: Record<string, string> = {
  casual:     'Casual leave',
  sick:       'Sick leave',
  medical:    'Sick leave',
  earned:     'Earned leave',
  privilege:  'Privilege leave',
  restricted: 'Restricted leave',
  lwp:        'Leave without pay',
}
function leaveLabel(type: string): string {
  return LEAVE_TYPE_LABEL[type] || type.charAt(0).toUpperCase() + type.slice(1) + ' leave'
}

/* ─── Leave emails ───────────────────────────────────────────────────────── */

export async function emailLeaveSubmitted(opts: {
  managerEmail: string; employeeName: string; leaveType: string; days: number; reason: string
}) {
  const label = leaveLabel(opts.leaveType)
  const built = buildTransactionalEmail({
    tone:        'info',
    eyebrow:     'New leave request',
    heading:     `${opts.employeeName} requested ${label.toLowerCase()}`,
    intro:       `<strong>${escapeHtml(opts.employeeName)}</strong> has submitted a leave request that needs your review.`,
    rows: [
      { label: 'Employee', value: opts.employeeName },
      { label: 'Leave type', value: label },
      { label: 'Duration', value: `${opts.days} day${opts.days !== 1 ? 's' : ''}` },
      { label: 'Reason', value: opts.reason || '(not provided)' },
    ],
    cta:         { label: 'Review in DoppelDash', href: `${appUrl()}/lms` },
    subject:     `Leave request from ${opts.employeeName} · ${opts.days}d ${label.toLowerCase()}`,
    previewText: `${opts.employeeName} requested ${opts.days} day(s) of ${label.toLowerCase()}.`,
    footerHint:  'You are receiving this because you manage leave approvals.',
  })
  await sendMail({ to: opts.managerEmail, subject: built.subject, html: built.html, text: built.text })
}

export async function emailLeaveStatusChanged(opts: {
  employeeEmail: string; status: 'approved' | 'rejected'; leaveType: string; days: number; note?: string
}) {
  const approved = opts.status === 'approved'
  const label = leaveLabel(opts.leaveType)
  const built = buildTransactionalEmail({
    tone:        approved ? 'success' : 'danger',
    eyebrow:     'Leave decision',
    heading:     approved ? `Your ${label.toLowerCase()} was approved` : `Your ${label.toLowerCase()} was rejected`,
    intro:       approved
      ? `Your manager has approved your leave request. Enjoy your time off.`
      : `Your manager has reviewed and rejected your leave request. See the note below for context.`,
    banner:      { label: approved ? 'Approved' : 'Rejected' },
    rows: [
      { label: 'Leave type', value: label },
      { label: 'Duration', value: `${opts.days} day${opts.days !== 1 ? 's' : ''}` },
    ],
    note:        opts.note ? { label: 'Manager note', value: opts.note } : undefined,
    cta:         { label: 'View in DoppelDash', href: `${appUrl()}/lms` },
    subject:     approved ? `Approved · ${label} (${opts.days}d)` : `Rejected · ${label} (${opts.days}d)`,
    previewText: approved
      ? `Your ${opts.days}-day ${label.toLowerCase()} request was approved.`
      : `Your ${opts.days}-day ${label.toLowerCase()} request was rejected.`,
  })
  await sendMail({ to: opts.employeeEmail, subject: built.subject, html: built.html, text: built.text })
}

/* ─── Expense emails ─────────────────────────────────────────────────────── */

function inr(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`
}

export async function emailExpenseSubmitted(opts: {
  managerEmail: string; employeeName: string; title: string; amount: number
}) {
  const built = buildTransactionalEmail({
    tone:        'info',
    eyebrow:     'New reimbursement',
    heading:     `${opts.employeeName} submitted an expense claim`,
    intro:       `A new reimbursement claim has been submitted and is waiting for manager review.`,
    rows: [
      { label: 'Employee',  value: opts.employeeName },
      { label: 'Title',     value: opts.title },
      { label: 'Amount',    value: inr(opts.amount), emphasis: true },
    ],
    cta:         { label: 'Review in DoppelDash', href: `${appUrl()}/rms` },
    subject:     `Reimbursement from ${opts.employeeName} · ${inr(opts.amount)}`,
    previewText: `${opts.employeeName} submitted ${opts.title} for ${inr(opts.amount)}.`,
    footerHint:  'You are receiving this because you manage expense approvals.',
  })
  await sendMail({ to: opts.managerEmail, subject: built.subject, html: built.html, text: built.text })
}

export async function emailExpensePendingPayout(opts: {
  bossEmail: string; employeeName: string; title: string; amount: number
}) {
  const built = buildTransactionalEmail({
    tone:        'warning',
    eyebrow:     'Awaiting payout',
    heading:     `Reimbursement awaiting your payout approval`,
    intro:       `A manager has approved this expense. It is now ready for you to release the payout.`,
    banner:      { label: 'Pending payout', tone: 'warning' },
    rows: [
      { label: 'Employee',  value: opts.employeeName },
      { label: 'Title',     value: opts.title },
      { label: 'Amount',    value: inr(opts.amount), emphasis: true },
    ],
    cta:         { label: 'Process payout', href: `${appUrl()}/rms` },
    subject:     `Payout pending · ${inr(opts.amount)} for ${opts.employeeName}`,
    previewText: `${opts.title} for ${opts.employeeName} · ${inr(opts.amount)} ready for payout.`,
    footerHint:  'You are receiving this because you handle expense payouts.',
  })
  await sendMail({ to: opts.bossEmail, subject: built.subject, html: built.html, text: built.text })
}

export async function emailExpenseStatusChanged(opts: {
  employeeEmail: string; status: 'paid' | 'rejected'; title: string; amount: number; note?: string
}) {
  const paid = opts.status === 'paid'
  const built = buildTransactionalEmail({
    tone:        paid ? 'success' : 'danger',
    eyebrow:     paid ? 'Reimbursement paid' : 'Reimbursement rejected',
    heading:     paid
      ? `Your reimbursement of ${inr(opts.amount)} has been paid`
      : `Your reimbursement was rejected`,
    intro:       paid
      ? `The amount has been released to your registered bank account or payout channel. Allow some time for it to reflect.`
      : `Your reimbursement claim was reviewed and rejected. See the note below for the reason — you can submit a new claim with corrected details.`,
    banner:      { label: paid ? 'Paid' : 'Rejected' },
    rows: [
      { label: 'Claim',  value: opts.title },
      { label: 'Amount', value: inr(opts.amount), emphasis: true },
    ],
    note:        opts.note ? { label: paid ? 'Note from finance' : 'Reason for rejection', value: opts.note } : undefined,
    cta:         { label: 'View in DoppelDash', href: `${appUrl()}/rms` },
    subject:     paid
      ? `Reimbursed · ${inr(opts.amount)} — ${opts.title}`
      : `Rejected · ${opts.title}`,
    previewText: paid
      ? `${opts.title} reimbursed — ${inr(opts.amount)}.`
      : `${opts.title} was rejected.`,
  })
  await sendMail({ to: opts.employeeEmail, subject: built.subject, html: built.html, text: built.text })
}

/* ─── Travel emails ──────────────────────────────────────────────────────── */

function fmtDateRange(start: Date | string, end: Date | string): string {
  const s = new Date(start), e = new Date(end)
  const sStr = s.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  const eStr = e.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${sStr} — ${eStr}`
}

export async function emailTravelSubmitted(opts: {
  managerEmail: string; employeeName: string
  purpose: string; destination: string
  departureDate: Date | string; returnDate: Date | string
  estimatedTotal: number; advanceRequested: number
}) {
  const rows: DetailRow[] = [
    { label: 'Employee',    value: opts.employeeName },
    { label: 'Purpose',     value: opts.purpose },
    { label: 'Destination', value: opts.destination },
    { label: 'Travel dates',value: fmtDateRange(opts.departureDate, opts.returnDate) },
    { label: 'Estimated total', value: inr(opts.estimatedTotal), emphasis: true },
  ]
  if (opts.advanceRequested > 0) {
    rows.push({ label: 'Advance requested', value: inr(opts.advanceRequested) })
  }
  const built = buildTransactionalEmail({
    tone:        'info',
    eyebrow:     'New travel request',
    heading:     `${opts.employeeName} requested travel approval`,
    intro:       `A new travel request is waiting for your review before the trip begins.`,
    rows,
    cta:         { label: 'Review in DoppelDash', href: `${appUrl()}/travel` },
    subject:     `Travel request from ${opts.employeeName} · ${opts.destination}`,
    previewText: `${opts.purpose} — ${opts.destination}, ${inr(opts.estimatedTotal)}.`,
    footerHint:  'You are receiving this because you manage travel approvals.',
  })
  await sendMail({ to: opts.managerEmail, subject: built.subject, html: built.html, text: built.text })
}

export async function emailTravelForwardedToBoss(opts: {
  bossEmail: string; employeeName: string
  purpose: string; destination: string
  departureDate: Date | string; returnDate: Date | string
  estimatedTotal: number; advanceRequested: number
}) {
  const rows: DetailRow[] = [
    { label: 'Employee',    value: opts.employeeName },
    { label: 'Purpose',     value: opts.purpose },
    { label: 'Destination', value: opts.destination },
    { label: 'Travel dates',value: fmtDateRange(opts.departureDate, opts.returnDate) },
    { label: 'Estimated total', value: inr(opts.estimatedTotal), emphasis: true },
  ]
  if (opts.advanceRequested > 0) {
    rows.push({ label: 'Advance requested', value: inr(opts.advanceRequested) })
  }
  const built = buildTransactionalEmail({
    tone:        'warning',
    eyebrow:     'Awaiting final approval',
    heading:     `Travel request needs your sign-off`,
    intro:       `A manager has reviewed this request and forwarded it for your final approval.`,
    banner:      { label: 'Pending boss approval', tone: 'warning' },
    rows,
    cta:         { label: 'Approve in DoppelDash', href: `${appUrl()}/travel` },
    subject:     `Travel approval pending · ${opts.employeeName} → ${opts.destination}`,
    previewText: `${opts.purpose} · ${opts.destination} · ${inr(opts.estimatedTotal)}`,
    footerHint:  'You are receiving this because you give final approval for travel.',
  })
  await sendMail({ to: opts.bossEmail, subject: built.subject, html: built.html, text: built.text })
}

export async function emailTravelDecision(opts: {
  employeeEmail: string; status: 'approved' | 'rejected'
  purpose: string; destination: string
  departureDate: Date | string; returnDate: Date | string
  estimatedTotal: number; note?: string
}) {
  const approved = opts.status === 'approved'
  const built = buildTransactionalEmail({
    tone:        approved ? 'success' : 'danger',
    eyebrow:     'Travel decision',
    heading:     approved
      ? `Your travel to ${opts.destination} was approved`
      : `Your travel request was rejected`,
    intro:       approved
      ? `You're cleared to travel. Keep your receipts — submit a reimbursement claim after the trip with the linked expense form.`
      : `Your travel request has been reviewed and rejected. See the note below for context.`,
    banner:      { label: approved ? 'Approved' : 'Rejected' },
    rows: [
      { label: 'Purpose',         value: opts.purpose },
      { label: 'Destination',     value: opts.destination },
      { label: 'Travel dates',    value: fmtDateRange(opts.departureDate, opts.returnDate) },
      { label: 'Estimated total', value: inr(opts.estimatedTotal), emphasis: true },
    ],
    note:        opts.note ? { label: approved ? 'Note from approver' : 'Reason for rejection', value: opts.note } : undefined,
    cta:         { label: 'View in DoppelDash', href: `${appUrl()}/travel` },
    subject:     approved
      ? `Approved · Travel to ${opts.destination}`
      : `Rejected · Travel to ${opts.destination}`,
    previewText: approved
      ? `Your travel to ${opts.destination} is approved.`
      : `Your travel to ${opts.destination} was rejected.`,
  })
  await sendMail({ to: opts.employeeEmail, subject: built.subject, html: built.html, text: built.text })
}

/* ─── Birthday emails ────────────────────────────────────────────────────── */

export async function sendBirthdayEmail(opts: { contactName: string; emails: string[] }) {
  if (!opts.emails.length) return
  const built = buildTransactionalEmail({
    tone:        'info',
    eyebrow:     'Birthday reminder',
    heading:     `${opts.contactName} has a birthday today`,
    intro:       `One of your CRM contacts is celebrating today. A quick personalised note goes a long way.`,
    rows: [
      { label: 'Contact', value: opts.contactName },
      { label: 'Date',    value: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) },
    ],
    cta:         { label: 'Open CRM', href: `${appUrl()}/crm` },
    subject:     `Birthday today: ${opts.contactName}`,
    previewText: `${opts.contactName} is celebrating today — consider reaching out.`,
  })
  await Promise.all(opts.emails.map(to =>
    sendMail({ to, subject: built.subject, html: built.html, text: built.text })
  ))
}

/* ═══════════════════════════════════════════════════════════════════════════
   Announcement emails (kept separate — visual hierarchy differs)
   ─────────────────────────────────────────────────────────────────────────── */

const URGENT_RED = '#c83838'

export function buildAnnouncementEmail(opts: {
  title: string; body: string; priority?: string; senderName?: string
}): { html: string; text: string; subject: string } {
  const isUrgent = opts.priority === 'urgent'
  const isImportant = opts.priority === 'important'
  const sender = opts.senderName || 'Management'
  const url = appUrl()
  const headerColor = isUrgent ? URGENT_RED : BRAND_BLUE
  const subject = isUrgent ? `Urgent: ${opts.title}` : opts.title

  const priorityBadge = isUrgent
    ? `<span style="display:inline-block;background:rgba(255,255,255,0.18);color:#ffffff;font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;padding:4px 10px;border-radius:999px;margin-top:8px;">Urgent · action required</span>`
    : isImportant
    ? `<span style="display:inline-block;background:rgba(255,255,255,0.18);color:#ffffff;font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;padding:4px 10px;border-radius:999px;margin-top:8px;">Important</span>`
    : ''

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${SURFACE};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif;color:${GRAPHITE};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${escapeHtml(opts.title)} — from ${escapeHtml(sender)} via DoppelDash
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${SURFACE};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">
        <tr>
          <td style="background:${headerColor};padding:22px 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.01em;">DoppelDash</td>
                <td align="right" style="color:rgba(255,255,255,0.85);font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;">Doppelmayr&nbsp;India</td>
              </tr>
            </table>
            ${priorityBadge}
          </td>
        </tr>
        <tr>
          <td style="padding:32px 32px 8px 32px;">
            <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${SUBTLE};">Company announcement</p>
            <h1 style="margin:0 0 18px 0;font-size:22px;font-weight:700;letter-spacing:-0.01em;color:${GRAPHITE};line-height:1.3;">${escapeHtml(opts.title)}</h1>
            <div style="font-size:15px;line-height:1.65;color:#374151;">${opts.body}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px 28px 32px;">
            <a href="${url}/announcements" style="display:inline-block;background:${BRAND_BLUE};color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;padding:11px 22px;border-radius:8px;">Open in DoppelDash</a>
          </td>
        </tr>
        <tr>
          <td style="background:${SURFACE};border-top:1px solid ${BORDER};padding:16px 32px;">
            <p style="margin:0;font-size:11px;line-height:1.55;color:${SUBTLE};">
              Sent by <strong style="color:${GRAPHITE};font-weight:600;">${escapeHtml(sender)}</strong> via DoppelDash —
              the internal platform of <strong style="color:${GRAPHITE};font-weight:600;">Doppelmayr</strong>.
              Please do not reply to this email.
            </p>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0 0;font-size:11px;color:#9ca3af;">© ${new Date().getFullYear()} Doppelmayr India · Navi Mumbai</p>
    </td></tr>
  </table>
</body>
</html>`

  const plainBody = opts.body.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]*>/g, '').replace(/\n{3,}/g, '\n\n').trim()
  const text = [
    isUrgent ? 'URGENT — ' + opts.title : opts.title,
    '',
    plainBody,
    '',
    `Open in DoppelDash: ${url}/announcements`,
    '',
    `— ${sender}, via DoppelDash (Doppelmayr)`,
  ].join('\n')

  return { html, text, subject }
}

export async function emailUrgentAnnouncement(opts: {
  emails: string[]; title: string; body: string; senderName?: string
}) {
  if (!opts.emails.length) return
  const { html, text, subject } = buildAnnouncementEmail({
    title:      opts.title,
    body:       opts.body,
    priority:   'urgent',
    senderName: opts.senderName,
  })
  await Promise.all(opts.emails.map(to => sendMail({ to, subject, html, text })))
}

export async function emailAnnouncement(opts: {
  emails: string[]; title: string; body: string; priority?: string; senderName?: string
}) {
  if (!opts.emails.length) return
  const { html, text, subject } = buildAnnouncementEmail(opts)
  await Promise.all(opts.emails.map(to => sendMail({ to, subject, html, text })))
}
