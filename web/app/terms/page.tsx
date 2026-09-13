import React from 'react'
import Link from 'next/link'
import { FileText, ArrowLeft } from 'lucide-react'

export const metadata = {
  title: 'Terms of Service | DoppelDash — Doppelmayr India',
  description: 'Terms of service and acceptable use policy for DoppelDash.',
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-blue-600 selection:text-white pb-20">
      {/* Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/50 backdrop-blur sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition">
            <ArrowLeft className="w-4 h-4" /> Back to DoppelDash
          </Link>
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-500" />
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
            Effective Date: September 1, 2026 • Last updated: September 1, 2026
          </p>
        </div>

        <div className="space-y-8 text-slate-300 text-sm leading-relaxed">
          <section className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 sm:p-8 space-y-3">
            <h2 className="text-lg font-semibold text-white">1. Authorized Access & Acceptable Use</h2>
            <p>
              Access to DoppelDash is restricted to verified employees, contractors, and authorized representatives of Doppelmayr India. Users must protect their credentials, passkeys, and two-factor authentication devices against unauthorized physical or digital access.
            </p>
          </section>

          <section className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 sm:p-8 space-y-3">
            <h2 className="text-lg font-semibold text-white">2. Confidentiality & Intellectual Property</h2>
            <p>
              All documentation, project specifications, client lists, CRM records, and business financial figures contained within DoppelDash are confidential proprietary information of Doppelmayr India. Unauthorized export, screen capture for external publication, or reproduction is strictly prohibited.
            </p>
          </section>

          <section className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 sm:p-8 space-y-3">
            <h2 className="text-lg font-semibold text-white">3. System Availability & Service Level</h2>
            <p>
              DoppelDash provides mission-critical operational tools. While scheduled maintenance windows are announced in advance via system notifications, Doppelmayr India reserves the right to deploy emergency security updates without prior notification.
            </p>
          </section>

          <div className="pt-6 border-t border-slate-800 text-center text-xs text-slate-500">
            © {new Date().getFullYear()} Doppelmayr India • All rights reserved.
          </div>
        </div>
      </main>
    </div>
  )
}
