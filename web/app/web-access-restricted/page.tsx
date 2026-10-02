import Link from 'next/link'
import { ShieldAlert, Smartphone, ArrowRight, LogOut } from 'lucide-react'

export const metadata = {
  title: 'Web Access Restricted · DoppelDash',
  description: 'DoppelDash Web Portal is currently in private preview for select organizations.',
}

export default function WebAccessRestrictedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="max-w-md w-full bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl space-y-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 mx-auto flex items-center justify-center shadow-lg shadow-amber-500/5">
          <ShieldAlert className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-100">
            Web Portal In Preview
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            The DoppelDash Web Portal is currently in private preview for enterprise accounts. Public organizations currently operate via the Android mobile application.
          </p>
        </div>

        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 text-left space-y-3">
          <div className="flex items-start gap-3">
            <Smartphone className="w-5 h-5 text-brand-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-slate-200">Mobile Access Enabled</p>
              <p className="text-xs text-slate-400 mt-0.5">
                All CRM contacts, expenses, leaves, and team operations are fully accessible through the DoppelDash Android application.
              </p>
            </div>
          </div>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row gap-3">
          <form action="/api/auth/logout" method="POST" className="flex-1">
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-sm font-medium text-slate-300 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </form>
          <Link
            href="/sign-in"
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-sm font-medium text-white shadow-lg shadow-brand-600/20 transition-all"
          >
            Switch Account
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  )
}
