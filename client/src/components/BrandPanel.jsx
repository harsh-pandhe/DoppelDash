/* Doppelmayr logo mark recreated from official brand image */
function DoppelmayrLogo({ className = '' }) {
  return (
    <svg
      viewBox="0 0 260 60"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Doppelmayr"
    >
      {/* Icon: dark rounded square */}
      <rect x="0" y="2" width="56" height="56" rx="5" fill="#3C4147" />

      {/* Circle ring (left half of mark) */}
      <circle cx="24" cy="30" r="13" fill="none" stroke="white" strokeWidth="4" />

      {/* Bold D letter (right side, overlapping circle) */}
      <text
        x="26"
        y="43"
        fontFamily="'Arial Black', 'Helvetica Neue', Arial, sans-serif"
        fontWeight="900"
        fontSize="28"
        fill="white"
        letterSpacing="-1"
      >
        D
      </text>

      {/* Wordmark */}
      <text
        x="68"
        y="42"
        fontFamily="'Helvetica Neue', Helvetica, Arial, sans-serif"
        fontWeight="300"
        fontSize="30"
        fill="#3C4147"
        letterSpacing="-0.3"
      >
        Doppelmayr
      </text>

      {/* Registered trademark */}
      <text
        x="246"
        y="22"
        fontFamily="Arial, sans-serif"
        fontWeight="400"
        fontSize="11"
        fill="#3C4147"
      >
        ®
      </text>
    </svg>
  )
}

export default function BrandPanel({ subtitle }) {
  return (
    <div className="hidden lg:flex flex-col justify-between text-white px-12 py-10 relative overflow-hidden min-h-screen w-full">

      {/* Background: dramatic alpine gondola shot */}
      <img
        src="https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1400&q=90&fit=crop&crop=center"
        alt="Alpine cable car scenery"
        className="absolute inset-0 w-full h-full object-cover object-center"
        draggable={false}
      />

      {/* Gradient overlay: dark top + dark bottom, scenic mid visible */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(0,20,50,0.88) 0%, rgba(0,35,80,0.45) 35%, rgba(0,35,80,0.45) 65%, rgba(0,15,40,0.92) 100%)',
        }}
      />

      {/* Top: Logo on white card */}
      <div className="relative z-10">
        <div className="inline-flex items-center gap-3 bg-white rounded-2xl px-4 py-3 shadow-xl">
          <DoppelmayrLogo className="h-9 w-auto" />
        </div>
        <p className="text-xs font-semibold tracking-widest text-white/65 uppercase mt-3 ml-1">
          India Private Limited
        </p>
        <div className="h-px bg-white/20 w-24 mt-2" />
      </div>

      {/* Center: App headline */}
      <div className="relative z-10">
        <span className="inline-block bg-accent-500 text-white text-xs font-bold px-3 py-1 rounded-full mb-5 tracking-widest uppercase shadow-lg">
          Enterprise Suite
        </span>
        <h1 className="text-5xl font-extrabold leading-tight mb-4 drop-shadow-lg">
          DoppelDash
        </h1>
        <p className="text-base text-white/75 leading-relaxed max-w-xs drop-shadow">
          {subtitle}
        </p>

        {/* Feature pills */}
        <div className="flex flex-wrap gap-2 mt-8">
          {['CRM', 'Leave Management', 'Reimbursements'].map((f) => (
            <span
              key={f}
              className="text-xs px-3 py-1.5 rounded-full bg-white/15 border border-white/25 text-white/90 font-medium backdrop-blur-sm"
            >
              {f}
            </span>
          ))}
        </div>

        {/* Stats */}
        <div className="flex gap-8 mt-10">
          {[
            { value: '3', label: 'Modules' },
            { value: '3', label: 'Role Tiers' },
            { value: '∞', label: 'Scalable' },
          ].map(({ value, label }) => (
            <div key={label}>
              <p className="text-3xl font-extrabold text-white drop-shadow">{value}</p>
              <p className="text-xs text-white/60 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom */}
      <div className="relative z-10">
        <p className="text-xs text-white/40">
          © {new Date().getFullYear()} Doppelmayr India Private Limited. All rights reserved.
        </p>
      </div>
    </div>
  )
}
