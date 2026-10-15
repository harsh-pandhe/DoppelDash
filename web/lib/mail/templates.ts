import { SUPPORT_CONFIG } from '@/lib/config/support'
import { escapeHtml, safeUrl, singleLine } from './escape'
import { PLATFORM_BRAND, type MailBrand } from './brand'

/**
 * Transactional templates for authentication / account mail.
 *
 * Rules enforced here (and nowhere else to forget):
 *   - callers pass RAW values; this module escapes at the point of interpolation
 *   - URLs are validated (http/https only) before reaching an href
 *   - subjects are single-line (no header injection)
 *   - branding comes from the `brand` argument (resolved from the organisation's
 *     stored configuration, see brand.ts); the default is the neutral platform brand
 */
const INK = '#0f172a'
const MUTED = '#64748b'
const SURFACE = '#f1f5f9'
const BORDER = '#e2e8f0'

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

interface LayoutOptions {
  brand: MailBrand
  preheader: string
  eyebrow?: string
  title: string
  /** Plain paragraphs (escaped). */
  paragraphs: string[]
  /** Large monospace code block (escaped). */
  code?: string
  codeCaption?: string
  cta?: { label: string; url: string }
  /** Small print below the card (escaped). */
  footnote?: string
}

function supportLine(brand: MailBrand): string {
  // The public DoppelDash support desk is only meaningful for the neutral platform brand.
  return brand.isPlatform && SUPPORT_CONFIG.isConfigured ? `Need help? Contact ${SUPPORT_CONFIG.supportEmail}.` : ''
}

function layout(o: LayoutOptions): string {
  const url = o.cta ? safeUrl(o.cta.url) : ''
  const { brand } = o
  const support = supportLine(brand)
  const paragraphs = o.paragraphs
    .map(p => `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(p)}</p>`)
    .join('')
  const code = o.code
    ? `<div style="background:${SURFACE};border:1px solid ${BORDER};border-radius:12px;padding:20px;text-align:center;margin:8px 0 18px 0;">
         <div style="font-family:'SF Mono','JetBrains Mono',Menlo,Consolas,monospace;font-size:32px;font-weight:800;letter-spacing:10px;color:${brand.darkColor};line-height:1;">${escapeHtml(o.code)}</div>
         ${o.codeCaption ? `<p style="margin:12px 0 0 0;font-size:12px;color:${MUTED};">${escapeHtml(o.codeCaption)}</p>` : ''}
       </div>`
    : ''
  const cta = o.cta
    ? `<p style="margin:22px 0;"><a href="${escapeHtml(url)}" style="display:inline-block;background:${brand.color};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px;">${escapeHtml(o.cta.label)}</a></p>
       <p style="margin:0 0 14px 0;font-size:12px;color:${MUTED};word-break:break-all;">Or paste this link into your browser:<br>${escapeHtml(url)}</p>`
    : ''
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(o.title)}</title></head>
<body style="margin:0;padding:0;background:${SURFACE};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif;color:${INK};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${SURFACE};padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border:1px solid ${BORDER};border-radius:16px;overflow:hidden;">
<tr><td style="background:${brand.color};padding:20px 28px;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.01em;">${escapeHtml(brand.name)}</td></tr>
<tr><td style="padding:32px 32px 12px 32px;">
${o.eyebrow ? `<p style="margin:0 0 6px 0;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${MUTED};">${escapeHtml(o.eyebrow)}</p>` : ''}
<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:${INK};">${escapeHtml(o.title)}</h1>
${paragraphs}${code}${cta}
</td></tr>
<tr><td style="padding:8px 32px 28px 32px;"><div style="border-top:1px solid ${BORDER};padding-top:16px;">
${o.footnote ? `<p style="margin:0 0 8px 0;font-size:12px;line-height:1.55;color:${MUTED};">${escapeHtml(o.footnote)}</p>` : ''}
${support ? `<p style="margin:0;font-size:12px;color:${MUTED};">${escapeHtml(support)}</p>` : ''}
</div></td></tr>
</table>
<p style="margin:16px 0 0 0;font-size:11px;color:#94a3b8;">This is an automated message from ${escapeHtml(brand.name)}. Please don’t reply.</p>
</td></tr></table></body></html>`
}

function plain(o: LayoutOptions): string {
  return [
    o.brand.name,
    '',
    o.title,
    '',
    ...o.paragraphs.flatMap(p => [p, '']),
    ...(o.code ? [`Code: ${o.code}`, ...(o.codeCaption ? [o.codeCaption] : []), ''] : []),
    ...(o.cta ? [`${o.cta.label}: ${safeUrl(o.cta.url)}`, ''] : []),
    ...(o.footnote ? [o.footnote, ''] : []),
    ...(supportLine(o.brand) ? [supportLine(o.brand)] : []),
  ].join('\n')
}

function build(subject: string, o: LayoutOptions): RenderedEmail {
  // Subjects are plain text, but strip angle brackets so a hostile org/inviter name can never smuggle markup.
  return { subject: singleLine(subject).replace(/[<>]/g, ''), html: layout(o), text: plain(o) }
}

export function renderOtpEmail(p: { code: string; brand?: MailBrand }): RenderedEmail {
  const brand = p.brand ?? PLATFORM_BRAND
  return build(`Your ${brand.name} verification code`, {
    brand,
    preheader: `Your verification code is ${p.code}.`,
    eyebrow: 'Verification code',
    title: 'Confirm it’s you',
    paragraphs: [`Use the code below to finish signing in to ${brand.name}. We will never ask you for this code by phone, text or email.`],
    code: p.code,
    codeCaption: 'Expires in 10 minutes · single use',
    footnote: 'Didn’t try to sign in? Someone may know your password — reset it right away.',
  })
}

export function renderVerificationEmail(p: { firstName?: string; code: string; brand?: MailBrand }): RenderedEmail {
  const brand = p.brand ?? PLATFORM_BRAND
  return build(`Verify your email for ${brand.name}`, {
    brand,
    preheader: `Your email verification code is ${p.code}.`,
    eyebrow: 'Email verification',
    title: p.firstName ? `Welcome, ${p.firstName}` : 'Verify your email',
    paragraphs: [`Enter this code in ${brand.name} to confirm your email address.`],
    code: p.code,
    codeCaption: 'Expires in 10 minutes · single use',
    footnote: `If you didn’t create a ${brand.name} account you can ignore this email.`,
  })
}

export function renderPasswordResetEmail(p: { firstName?: string; resetUrl: string; brand?: MailBrand }): RenderedEmail {
  const brand = p.brand ?? PLATFORM_BRAND
  return build(`Reset your ${brand.name} password`, {
    brand,
    preheader: 'Use this link to choose a new password.',
    eyebrow: 'Password reset',
    title: 'Reset your password',
    paragraphs: [
      `${p.firstName ? `Hi ${p.firstName}, a` : 'A'} password reset was requested for your ${brand.name} account. Use the button below to set a new password.`,
      'This link expires in 1 hour and can only be used once. Resetting your password signs you out of every device.',
    ],
    cta: { label: 'Reset password', url: p.resetUrl },
    footnote: 'If you didn’t request this, you can safely ignore this email — your password won’t change.',
  })
}

export function renderInvitationEmail(p: { organizationName: string; role: string; inviterName: string; inviteUrl: string; brand?: MailBrand }): RenderedEmail {
  const brand = p.brand ?? PLATFORM_BRAND
  const org = singleLine(p.organizationName, 80) || 'a workspace'
  return build(`You’ve been invited to join ${org} on ${brand.name}`, {
    brand,
    preheader: `${singleLine(p.inviterName, 60)} invited you to join ${org}.`,
    eyebrow: 'Workspace invitation',
    title: `Join ${org}`,
    paragraphs: [
      `${singleLine(p.inviterName, 60) || 'A teammate'} has invited you to join ${org} on ${brand.name} as ${p.role === 'manager' ? 'a manager' : 'a team member'}.`,
      'Accept the invitation to set your password and get started. The link expires in 7 days.',
    ],
    cta: { label: 'Accept invitation', url: p.inviteUrl },
    footnote: 'If you weren’t expecting this invitation you can ignore this email.',
  })
}

export function renderAccountWelcomeEmail(p: { firstName: string; email: string; tempPassword: string; signInUrl: string; brand?: MailBrand }): RenderedEmail {
  const brand = p.brand ?? PLATFORM_BRAND
  return build(`Welcome to ${brand.name} — your sign-in details`, {
    brand,
    preheader: 'Your account is ready.',
    eyebrow: 'Account created',
    title: `Welcome, ${p.firstName}`,
    paragraphs: [
      `Your ${brand.name} account (${p.email}) has been created by an administrator.`,
      'Sign in with the temporary password below. You will be asked to choose your own password on first sign-in.',
    ],
    code: p.tempPassword,
    codeCaption: 'Temporary password',
    cta: { label: 'Sign in', url: p.signInUrl },
    footnote: 'For your security, change this password immediately after signing in.',
  })
}
