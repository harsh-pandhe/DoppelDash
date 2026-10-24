import React from 'react'
import Link from 'next/link'
import { Trash2, ArrowLeft, ShieldAlert, CheckCircle2, AlertTriangle, Mail, Smartphone } from 'lucide-react'
import { SUPPORT_CONFIG } from '@/lib/config/support'

export const metadata = {
  title: 'Delete Account & Data | DoppelDash',
  description: 'Account and personal data deletion policy and instructions for DoppelDash.',
}

export default function DeleteAccountPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-rose-600 selection:text-white pb-20">
      {/* Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/50 backdrop-blur sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition">
            <ArrowLeft className="w-4 h-4" /> Back to DoppelDash
          </Link>
          <div className="flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-rose-400" />
            <span className="font-semibold text-slate-200">Account Deletion</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 pt-12">
        <div className="mb-10 text-center sm:text-left">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-medium mb-4">
            <ShieldAlert className="w-3.5 h-3.5" /> Google Play Data Safety &amp; User Privacy
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-2">
            Delete Your Account and Personal Data
          </h1>
          <p className="text-slate-400 text-sm">
            Learn how account deletion works in DoppelDash, what data is permanently erased, and how to submit a deletion request.
          </p>
        </div>

        <div className="space-y-8 text-slate-300 text-sm leading-relaxed">
          {/* Section 1: In-App Self-Service Deletion */}
          <section className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-sky-400" /> 1. Self-Service Deletion in the Mobile App
            </h2>
            <p>
              Any registered user can delete their account directly within the DoppelDash Android application:
            </p>
            <ol className="list-decimal pl-5 space-y-2 text-slate-300">
              <li>Open the <strong>DoppelDash</strong> Android application on your device.</li>
              <li>Sign in to your account.</li>
              <li>Tap the <strong>Settings</strong> icon in the navigation bar.</li>
              <li>Under the <strong>Account</strong> section, tap <strong>Delete Account</strong>.</li>
              <li>Review the confirmation dialog and confirm by selecting <strong>Delete My Account</strong>.</li>
            </ol>
            <p className="text-xs text-slate-400">
              Upon confirmation, your account is deactivated and every session is immediately invalidated, and stored tokens are wiped from your device Keystore. Your account is then permanently deleted after a 14-day grace period; sign in again within those 14 days and choose to restore the account if you change your mind.
            </p>
          </section>

          {/* Section 2: Exact Backend Behavior & Retention */}
          <section className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" /> 2. What Data is Deleted vs. Retained
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-slate-950 border border-emerald-900/30 space-y-2">
                <span className="font-semibold text-emerald-400 text-xs tracking-wider uppercase">Permanently Purged (after the 14-day grace period)</span>
                <ul className="list-disc pl-4 space-y-1 text-xs text-slate-300">
                  <li>User account record and login password hashes</li>
                  <li>Personal employee profile (phone, DOB, personal details)</li>
                  <li>Active sessions, refresh tokens, and passkeys</li>
                  <li>Personal leave balances and notification tokens</li>
                </ul>
              </div>
              <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
                <span className="font-semibold text-slate-400 text-xs tracking-wider uppercase">Legally Retained</span>
                <ul className="list-disc pl-4 space-y-1 text-xs text-slate-400">
                  <li>Your organisation&apos;s expense claims and their receipts (8 years from payment), leave records (3 years) and travel records (2 years) — your name is replaced by &ldquo;Former member&rdquo;</li>
                  <li>Security audit entries (8 years, without your e-mail address)</li>
                  <li>Copies in encrypted backups, until the backups expire (up to 30 days)</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Section 3: Organization Owner Rules */}
          <section className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" /> 3. Special Rules for Organization Owners
            </h2>
            <p>
              To protect organization continuity and prevent orphaned employee workspaces:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-slate-300">
              <li>
                <strong>Organizations with other members:</strong> If you created the organization and other active members exist, you cannot delete your account until you transfer ownership to another active administrator of the organization (the owner can do this from the app or the web console) or remove the other members.
              </li>
              <li>
                <strong>Sole member workspaces:</strong> If you are the sole member of your custom organization, deleting your account deactivates the organization immediately. After the 14-day grace period its contact lists, mailbox connections and organizational configuration are permanently deleted. Financial and HR records (expense claims and receipts, leave, travel) are kept until their retention period ends and are then deleted too.
              </li>
            </ul>
          </section>

          {/* Section 4: External Deletion Request */}
          <section className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Mail className="w-5 h-5 text-rose-400" /> 4. Request Deletion via Support Email
            </h2>
            <p>
              If you have lost access to your device or cannot log in, you may submit a manual account deletion request by emailing our support desk:
            </p>
            <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-sky-300 space-y-1">
              <div>
                <strong>To:</strong>{' '}
                {SUPPORT_CONFIG.isConfigured
                  ? SUPPORT_CONFIG.supportEmail
                  : 'Designated support channel listed in Google Play Store listing or in-app Settings'}
              </div>
              <div><strong>Subject:</strong> Account Deletion Request — [Your Registered Email]</div>
            </div>
            <p className="text-xs text-slate-400">
              Please send the request from the email address registered with DoppelDash. We verify ownership and fulfill verified deletion requests within 30 days.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-500 gap-4">
          <div>&copy; {new Date().getFullYear()} DoppelDash. All rights reserved.</div>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-slate-400">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-slate-400">Terms of Service</Link>
            <Link href="/support" className="hover:text-slate-400">Support Center</Link>
          </div>
        </div>
      </main>
    </div>
  )
}
