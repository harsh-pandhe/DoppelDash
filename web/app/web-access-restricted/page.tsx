import Link from 'next/link'
import { ShieldAlert, ArrowRight } from 'lucide-react'
import { PlainSignOutButton } from '@/components/auth/SignOutButton'

export const metadata = {
  title: 'Web access not enabled',
  description: 'Web access is not enabled for this account.',
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
            Web access isn’t enabled
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            Your organization isn’t enabled for the Doppelmayr India web workspace. If you expect to have web access, contact your administrator.
          </p>
        </div>


        <div className="pt-2 flex flex-col sm:flex-row gap-3">
          <div className="flex-1"><PlainSignOutButton className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-sm font-medium text-slate-300 transition-colors disabled:opacity-60" /></div>
          <Link
            href="/sign-in"
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-sm font-medium text-white shadow-lg shadow-brand-600/20 transition-all"
          >
            Use a different account
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  )
}
