function DoppelmayrLogo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 260 60" xmlns="http://www.w3.org/2000/svg" className={className} aria-label="Doppelmayr">
      <rect x="0" y="2" width="56" height="56" rx="5" fill="#3C4147" />
      <circle cx="24" cy="30" r="13" fill="none" stroke="white" strokeWidth="4" />
      <text x="26" y="43" fontFamily="'Arial Black', 'Helvetica Neue', Arial, sans-serif" fontWeight="900" fontSize="28" fill="white" letterSpacing="-1">D</text>
      <text x="68" y="42" fontFamily="'Helvetica Neue', Helvetica, Arial, sans-serif" fontWeight="300" fontSize="30" fill="#3C4147" letterSpacing="-0.3">Doppelmayr</text>
      <text x="246" y="22" fontFamily="Arial, sans-serif" fontWeight="400" fontSize="11" fill="#3C4147">®</text>
    </svg>
  )
}

export default function BrandPanel({ subtitle }: { subtitle: string }) {
  return (
    <div className="hidden lg:flex flex-col justify-between text-white px-14 py-12 relative overflow-hidden h-full w-full">
      {/* Background photo */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1600&q=90&fit=crop&crop=center"
        alt="Alpine scenery"
        className="absolute inset-0 w-full h-full object-cover object-center"
        draggable={false}
      />
      {/* Deep gradient overlay */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(160deg, rgba(0,15,40,0.95) 0%, rgba(0,30,70,0.75) 40%, rgba(0,25,60,0.6) 60%, rgba(0,10,30,0.95) 100%)',
        }}
      />

      {/* Logo */}
      <div className="relative z-10">
        <div className="inline-flex items-center gap-3 bg-white rounded-xl px-4 py-2.5 shadow-lg">
          <DoppelmayrLogo className="h-8 w-auto" />
        </div>
        <p className="text-[11px] font-semibold tracking-[0.18em] text-white/50 uppercase mt-3 ml-0.5">
          India Private Limited
        </p>
      </div>

      {/* Hero content */}
      <div className="relative z-10 space-y-6">
        <div>
          <span className="inline-flex items-center gap-2 bg-accent-500/90 text-white text-[11px] font-bold px-3 py-1.5 rounded-full tracking-widest uppercase shadow-lg mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-white/80 inline-block" />
            Enterprise Suite
          </span>
          <h1 className="text-[3.2rem] font-black leading-[1.05] tracking-tight mb-4 drop-shadow-2xl">
            DoppelDash
          </h1>
          <p className="text-[15px] text-white/70 leading-relaxed max-w-[320px]">{subtitle}</p>
        </div>

        {/* Module chips */}
        <div className="flex flex-wrap gap-2">
          {['CRM', 'Leave Management', 'Reimbursements'].map((f) => (
            <span
              key={f}
              className="text-[12px] px-3.5 py-1.5 rounded-full bg-white/10 border border-white/20 text-white/85 font-medium backdrop-blur-sm"
            >
              {f}
            </span>
          ))}
        </div>

        {/* Stats */}
        <div className="flex gap-10 pt-2">
          {[
            { value: '3', label: 'Core Modules' },
            { value: '3', label: 'Role Tiers' },
            { value: '∞', label: 'Scalable' },
          ].map(({ value, label }) => (
            <div key={label}>
              <p className="text-[2rem] font-black leading-none text-white">{value}</p>
              <p className="text-[11px] text-white/45 mt-1 tracking-wide">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="relative z-10">
        <div className="h-px bg-white/10 mb-4 w-16" />
        <p className="text-[11px] text-white/35 tracking-wide">
          © {new Date().getFullYear()} Doppelmayr India Pvt Ltd. All rights reserved.
        </p>
      </div>
    </div>
  )
}
