/**
 * Send OTP via the shared SMTP mailer. Always logs to console as backup.
 */
import { sendMail } from '@/lib/mailer'

const BRAND_BLUE  = '#0057A8'
const BRAND_DARK  = '#003B73'
const GRAPHITE    = '#1a1a1a'
const SUBTLE      = '#6b7280'
const SURFACE     = '#f5f5f5'
const BORDER      = '#e5e7eb'

const formatExpiry = () => {
  const d = new Date(Date.now() + 10 * 60 * 1000)
  return d.toLocaleTimeString('en-IN', {
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   true,
    timeZone: 'Asia/Kolkata',
  }) + ' IST'
}

const HTML = (otp: string) => {
  const expiry = formatExpiry()
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Your DoppelDash verification code</title>
</head>
<body style="margin:0;padding:0;background:${SURFACE};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif;color:${GRAPHITE};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    Your verification code is ${otp}. Expires at ${expiry}.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${SURFACE};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">
          <tr>
            <td style="background:${BRAND_BLUE};padding:22px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.01em;">DoppelDash</td>
                  <td align="right" style="color:rgba(255,255,255,0.85);font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;">Doppelmayr&nbsp;India</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 8px 32px;">
              <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${SUBTLE};">Verification code</p>
              <h1 style="margin:0 0 18px 0;font-size:22px;font-weight:700;letter-spacing:-0.01em;color:${GRAPHITE};">Confirm it's you</h1>
              <p style="margin:0 0 24px 0;font-size:14px;line-height:1.55;color:#374151;">
                Use the code below to finish signing in to DoppelDash. This step protects your account from unauthorised access.
              </p>
              <div style="background:${SURFACE};border:1px solid ${BORDER};border-radius:10px;padding:22px;text-align:center;">
                <div style="font-family:'SF Mono','JetBrains Mono',Menlo,Consolas,monospace;font-size:34px;font-weight:800;letter-spacing:10px;color:${BRAND_DARK};line-height:1;">${otp}</div>
                <p style="margin:14px 0 0 0;font-size:12px;color:${SUBTLE};">Expires at <strong style="color:${GRAPHITE};">${expiry}</strong> · single use</p>
              </div>
              <p style="margin:22px 0 0 0;font-size:13px;line-height:1.6;color:#374151;">
                Enter this code in the DoppelDash sign-in window you just opened. We will never call, text, or email you to ask for this code — share it with no one, including Doppelmayr IT.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 32px 28px 32px;">
              <div style="border-top:1px solid ${BORDER};padding-top:18px;">
                <p style="margin:0;font-size:12px;line-height:1.55;color:${SUBTLE};">
                  Didn't try to sign in? Someone may have your password. Reset it immediately and notify
                  <a href="mailto:harsh.pandhe@doppelmayr.com" style="color:${BRAND_BLUE};font-weight:600;text-decoration:none;">harsh.pandhe@doppelmayr.com</a>.
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background:${SURFACE};border-top:1px solid ${BORDER};padding:16px 32px;">
              <p style="margin:0;font-size:11px;line-height:1.55;color:${SUBTLE};">
                This is an automated message from DoppelDash — the internal platform of
                <strong style="color:${GRAPHITE};font-weight:600;">Doppelmayr</strong>.
                Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0 0;font-size:11px;color:#9ca3af;">© ${new Date().getFullYear()} Doppelmayr India · Navi Mumbai</p>
      </td>
    </tr>
  </table>
</body>
</html>`
}

const TEXT = (otp: string) => {
  const expiry = formatExpiry()
  return [
    'DoppelDash — Verification code',
    '',
    `Your one-time code: ${otp}`,
    `Expires at ${expiry} (single use).`,
    '',
    'Enter this code in the DoppelDash sign-in window you just opened.',
    '',
    'Doppelmayr IT will never call, text, or email you for this code. Share it with no one.',
    '',
    'Didn\'t try to sign in? Reset your password and contact harsh.pandhe@doppelmayr.com.',
    '',
    '— Doppelmayr',
  ].join('\n')
}

export async function sendOTP(to: string, otp: string): Promise<void> {
  // Console backup — useful for local dev and audit trail
  console.log(`\n🔐 OTP for ${to}: ${otp}\n`)

  await sendMail({
    to,
    subject: 'Your DoppelDash verification code',
    html:    HTML(otp),
    text:    TEXT(otp),
    headers: {
      'X-Entity-Ref-ID':          `doppeldash-otp-${Date.now()}`,
      'X-Auto-Response-Suppress': 'All',
    },
  })
}
