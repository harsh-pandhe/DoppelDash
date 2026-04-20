import { SignUp } from '@clerk/nextjs'
import BrandPanel from '@/components/BrandPanel'

const clerkAppearance = {
  variables: {
    colorPrimary:                 '#0057A8',
    colorTextOnPrimaryBackground: '#ffffff',
    colorBackground:              'transparent',
    colorInputBackground:         '#F8FAFC',
    colorInputText:               '#111827',
    colorText:                    '#111827',
    colorTextSecondary:           '#6B7280',
    colorDanger:                  '#DC2626',
    borderRadius:                 '0.625rem',
    fontFamily:                   'Inter, system-ui, sans-serif',
    fontSize:                     '14px',
  },
  elements: {
    rootBox:               'w-full',
    cardBox:               'shadow-none border-0 bg-transparent p-0 w-full',
    card:                  'shadow-none border-0 bg-transparent p-0 m-0',
    headerTitle:           'text-2xl font-extrabold text-gray-900 tracking-tight',
    headerSubtitle:        'text-sm text-gray-400 mt-0.5',
    formButtonPrimary:     'h-10 rounded-xl font-semibold text-sm transition-all',
    socialButtonsBlockButton:
      'h-9 rounded-xl border border-gray-200 font-medium text-sm text-gray-600 hover:bg-gray-50 transition-colors bg-white',
    formFieldInput:
      'h-10 rounded-xl border-gray-200 bg-[#F8FAFC] text-sm',
    formFieldLabel:        'text-xs font-semibold text-gray-500 uppercase tracking-wide',
    footerActionLink:      'text-[#0057A8] font-semibold',
    dividerLine:           'bg-gray-100',
    dividerText:           'text-gray-400 text-xs',
    footer:                'hidden',
    footerPages:           'hidden',
  },
}

export default function SignUpPage() {
  return (
    <div className="h-screen flex overflow-hidden">
      {/* Brand panel */}
      <div className="lg:w-[44%] xl:w-[40%] flex-shrink-0 h-full">
        <BrandPanel subtitle="Join Doppelmayr India's internal management platform. Built for teams that move the world." />
      </div>

      {/* Form panel */}
      <div className="flex-1 flex flex-col h-full bg-[#F1F5F9]">

        {/* Top nav */}
        <nav className="flex items-center justify-between px-10 py-4 flex-shrink-0">
          <div className="lg:hidden flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#0057A8] flex items-center justify-center">
              <span className="text-white font-black text-xs">D</span>
            </div>
            <span className="font-bold text-gray-900 text-sm">DoppelDash</span>
          </div>
          <div className="hidden lg:block" />
          <p className="text-[12px] text-gray-400">
            Have an account?{' '}
            <a href="/sign-in" className="text-[#0057A8] font-semibold hover:text-[#003B73] transition-colors">
              Sign in
            </a>
          </p>
        </nav>

        {/* Centered form */}
        <div className="flex-1 flex items-center justify-center px-6 min-h-0">
          <div className="w-full max-w-[420px]">
            <div className="bg-white rounded-2xl shadow-lg shadow-slate-200 border border-slate-100 px-8 py-7">
              {/* Brand mark */}
              <div className="flex items-center gap-2.5 mb-6 pb-5 border-b border-gray-100">
                <div className="w-7 h-7 rounded-lg bg-[#0057A8] flex items-center justify-center shadow-sm flex-shrink-0">
                  <span className="text-white font-black text-xs">D</span>
                </div>
                <span className="font-bold text-gray-800 text-sm">DoppelDash</span>
                <span className="ml-auto text-[10px] text-gray-300 font-semibold tracking-widest uppercase">
                  Enterprise
                </span>
              </div>

              <SignUp appearance={clerkAppearance} />
            </div>

            <p className="text-center text-[11px] text-gray-400 mt-5">
              © {new Date().getFullYear()} Doppelmayr India Private Limited
            </p>
          </div>
        </div>

        <div className="h-4 flex-shrink-0" />
      </div>
    </div>
  )
}
