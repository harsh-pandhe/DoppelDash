import React from 'react'
import Link from 'next/link'
import { HelpCircle, ArrowLeft, Mail, Shield, Smartphone, RefreshCw, KeyRound, ExternalLink } from 'lucide-react'
import { SUPPORT_CONFIG } from '@/lib/config/support'

export const metadata = {
  title: 'Support & Help Center | DoppelDash',
  description: 'Support, documentation, troubleshooting, and contact for DoppelDash mobile application.',
}

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-sky-600 selection:text-white pb-20">
      {/* Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/50 backdrop-blur sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition">
            <ArrowLeft className="w-4 h-4" /> Back to DoppelDash
          </Link>
          <div className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-sky-400" />
            <span className="font-semibold text-slate-200">Support Center</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 pt-12">
        <div className="mb-10 text-center sm:text-left">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-medium mb-4">
            <Smartphone className="w-3.5 h-3.5" /> DoppelDash Mobile Support
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-2">
            How can we help you?
          </h1>
          <p className="text-slate-400 text-sm">
            Find answers to common questions about your DoppelDash workspace, login, subscriptions, and data.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          {/* Card 1: Direct Contact */}
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 space-y-3">
            <div className="w-10 h-10 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <Mail className="w-5 h-5" />
            </div>
            <h2 className="text-base font-semibold text-white">Contact Support</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Our engineering and customer support team responds to questions, bug reports, and account inquiries.
            </p>
            {SUPPORT_CONFIG.isConfigured ? (
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-sky-300">
                {SUPPORT_CONFIG.supportEmail}
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-400">
                Support inquiries are handled via the in-app help desk or through the Google Play Store developer contact listing.
              </div>
            )}
          </div>

          {/* Card 2: Subscriptions & Billing */}
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 space-y-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <RefreshCw className="w-5 h-5" />
            </div>
            <h2 className="text-base font-semibold text-white">Google Play Subscriptions</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              In-app Premium subscriptions are managed directly through your Google Play Store account.
            </p>
            <a
              href="https://play.google.com/store/account/subscriptions"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-semibold hover:underline"
            >
              Manage Google Play Subscriptions <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        {/* FAQ Section */}
        <div className="space-y-6 text-slate-300 text-sm">
          <h2 className="text-xl font-bold text-white mb-4">Frequently Asked Questions</h2>

          <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 space-y-2">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-sky-400" /> How do I reset my password?
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              On the mobile app Sign In screen, tap &quot;Forgot password?&quot;, enter your registered work email, and you will receive a secure one-time password reset link valid for 1 hour.
            </p>
          </div>

          <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 space-y-2">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <Shield className="w-4 h-4 text-sky-400" /> How do I delete my account or personal data?
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              You can permanently delete your account directly inside the Android application by navigating to <strong>Settings &rarr; Account &rarr; Delete Account</strong>. For full details on retention rules and owner requirements, visit our <Link href="/delete-account" className="text-sky-400 hover:underline">Account Deletion Policy</Link>.
            </p>
          </div>

          <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 space-y-2">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-sky-400" /> Who can access the Web vs. Android client?
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              DoppelDash is an Android-first mobile SaaS platform. Public organization accounts access all CRM, leave, travel, expense tracking, and team capabilities via the Android mobile application.
            </p>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-500 gap-4">
          <div>&copy; {new Date().getFullYear()} DoppelDash. All rights reserved.</div>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-slate-400">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-slate-400">Terms of Service</Link>
            <Link href="/delete-account" className="hover:text-slate-400">Delete Account</Link>
          </div>
        </div>
      </main>
    </div>
  )
}
