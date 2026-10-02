import React from 'react'
import Link from 'next/link'
import { FileText, ArrowLeft, CheckCircle2, ShieldAlert, CreditCard, Mail } from 'lucide-react'
import { SUPPORT_CONFIG } from '@/lib/config/support'

export const metadata = {
  title: 'Terms of Service | DoppelDash',
  description: 'Terms of service and acceptable use policy for DoppelDash platform.',
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-sky-600 selection:text-white pb-20">
      {/* Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/50 backdrop-blur sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition">
            <ArrowLeft className="w-4 h-4" /> Back to DoppelDash
          </Link>
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-sky-400" />
            <span className="font-semibold text-slate-200">Terms of Service</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 pt-12">
        <div className="mb-10 text-center sm:text-left">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-2">
            DoppelDash Terms of Service
          </h1>
          <p className="text-slate-400 text-sm">
            Effective Date: October 1, 2026 • Last updated: October 2, 2026
          </p>
        </div>

        <div className="space-y-8 text-slate-300 text-sm leading-relaxed">
          <section className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 sm:p-8 space-y-3">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-sky-400" /> 1. Acceptance and Workspaces
            </h2>
            <p>
              By accessing or using DoppelDash via our Android mobile application or web portal, you agree to be bound by these Terms of Service. If you create an organization workspace, you represent that you have the authority to act on behalf of that entity.
            </p>
          </section>

          <section className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 sm:p-8 space-y-3">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-sky-400" /> 2. Plans and Google Play Subscriptions
            </h2>
            <p>
              DoppelDash provides standard Free tier features as well as Premium organization plans. On Android, Premium subscription purchases and auto-renewals are processed securely through <strong>Google Play Billing</strong>. Pricing, payment terms, and trial periods are presented at the point of subscription via Google Play and can be managed or canceled anytime via your Google Play account settings.
            </p>
          </section>

          <section className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 sm:p-8 space-y-3">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-sky-400" /> 3. Acceptable Use & Account Security
            </h2>
            <p>
              You agree not to misuse DoppelDash, attempt unauthorized access to other tenant organizations, upload malicious software, or violate applicable privacy laws. You are responsible for safeguarding your login credentials and two-factor authentication tokens.
            </p>
          </section>

          <section className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 sm:p-8 space-y-3">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Mail className="w-5 h-5 text-sky-400" /> 4. Support and Inquiries
            </h2>
            <p>
              For legal inquiries, feedback, or support assistance, please visit our <Link href="/support" className="text-sky-400 hover:underline">Support Center</Link> or contact:
            </p>
            {SUPPORT_CONFIG.isConfigured ? (
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-sky-300">
                {SUPPORT_CONFIG.supportEmail}
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-400">
                Contact information is published in our official Google Play Store developer listing and available in-app via Settings.
              </div>
            )}
          </section>

          <div className="pt-6 border-t border-slate-800 text-center text-xs text-slate-500">
            &copy; {new Date().getFullYear()} DoppelDash. All rights reserved.
          </div>
        </div>
      </main>
    </div>
  )
}
