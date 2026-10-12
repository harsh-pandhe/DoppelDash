import { cn } from '@/lib/ds/cn'

export type Art =
  | 'welcomeWork' | 'welcomeApprove' | 'welcomeConnect' | 'empty' | 'search' | 'inbox' | 'calendar' | 'receipt'
  | 'contacts' | 'travel' | 'announce' | 'offline' | 'error' | 'success' | 'lock' | 'team' | 'setup' | 'notFound' | 'forbidden'

/** Shared vector language (same subjects on web and Android). Colours are design-token variables, so they follow the brand layer and light/dark. */
const C = {
  disc: 'rgb(var(--ds-primary-container))',
  strong: 'rgb(var(--ds-primary))',
  onStrong: 'rgb(var(--ds-on-primary))',
  soft: 'rgb(var(--ds-surface-container-lowest))',
  line: 'rgb(var(--ds-outline-variant))',
  accent: 'rgb(var(--ds-tertiary))',
  good: 'rgb(var(--ds-success))',
  bad: 'rgb(var(--ds-error))',
  warn: 'rgb(var(--ds-warning))',
  badDisc: 'rgb(var(--ds-error-container))',
  goodDisc: 'rgb(var(--ds-success-container))',
}

const card = (x: number, y: number, w: number, h: number, r = 10) =>
  <rect key={`c${x}${y}`} x={x} y={y} width={w} height={h} rx={r} fill={C.soft} stroke={C.line} strokeWidth={1.5} />
const bar = (x: number, y: number, w: number, fill = C.line, h = 6) =>
  <rect key={`b${x}${y}`} x={x} y={y} width={w} height={h} rx={h / 2} fill={fill} />
const check = (cx: number, cy: number, r: number, fill: string, stroke = '#fff') => (
  <g key={`k${cx}${cy}`}>
    <circle cx={cx} cy={cy} r={r} fill={fill} />
    <path d={`M${cx - r * 0.45} ${cy}l${r * 0.35} ${r * 0.35} ${r * 0.65}-${r * 0.75}`} fill="none" stroke={stroke} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
  </g>
)

function scene(art: Art): { disc: string; body: React.ReactNode } {
  switch (art) {
    case 'welcomeWork': return { disc: C.disc, body: <>{card(36, 38, 88, 84)}{bar(48, 54, 40, C.strong, 8)}{bar(48, 72, 64)}{bar(48, 86, 52)}{bar(48, 100, 58)}{check(118, 44, 14, C.accent, C.onStrong)}</> }
    case 'welcomeApprove': return { disc: C.disc, body: <>{card(30, 46, 100, 36)}{card(30, 90, 100, 36)}<circle cx={52} cy={64} r={9} fill={C.disc} />{bar(70, 58, 44, C.strong)}{bar(70, 70, 30)}<circle cx={52} cy={108} r={9} fill={C.disc} />{bar(70, 102, 44)}{bar(70, 114, 30)}{check(124, 52, 15, C.good)}</> }
    case 'welcomeConnect': return { disc: C.disc, body: <><line x1={46} y1={104} x2={80} y2={58} stroke={C.line} strokeWidth={3} /><line x1={80} y1={58} x2={116} y2={100} stroke={C.line} strokeWidth={3} /><line x1={46} y1={104} x2={116} y2={100} stroke={C.line} strokeWidth={3} /><circle cx={46} cy={104} r={15} fill={C.soft} stroke={C.strong} strokeWidth={3} /><circle cx={116} cy={100} r={15} fill={C.soft} stroke={C.accent} strokeWidth={3} /><circle cx={80} cy={58} r={19} fill={C.strong} /><circle cx={80} cy={52} r={6} fill={C.onStrong} /><path d="M69 69a11 9 0 0 1 22 0z" fill={C.onStrong} /></> }
    case 'empty': return { disc: C.disc, body: <>{card(40, 54, 80, 58)}{bar(52, 68, 36, C.line, 8)}{bar(52, 84, 56)}{bar(52, 96, 44)}<circle cx={118} cy={48} r={13} fill={C.accent} /><path d="M118 42v12M112 48h12" stroke={C.onStrong} strokeWidth={3.5} strokeLinecap="round" /></> }
    case 'search': return { disc: C.disc, body: <>{card(36, 44, 72, 66)}{bar(48, 58, 34, C.strong, 7)}{bar(48, 74, 48)}{bar(48, 88, 40)}<circle cx={104} cy={96} r={20} fill={C.soft} stroke={C.strong} strokeWidth={5} /><line x1={119} y1={111} x2={132} y2={124} stroke={C.strong} strokeWidth={7} strokeLinecap="round" /></> }
    case 'inbox': return { disc: C.disc, body: <><path d="M36 88l16-34h56l16 34v30a8 8 0 0 1-8 8H44a8 8 0 0 1-8-8z" fill={C.soft} stroke={C.line} strokeWidth={2} /><path d="M36 88h30l6 12h16l6-12h30" fill="none" stroke={C.strong} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" /><circle cx={116} cy={48} r={10} fill={C.accent} /></> }
    case 'calendar': return { disc: C.disc, body: <>{card(34, 44, 92, 80)}<path d="M34 62h92V52a8 8 0 0 0-8-8H42a8 8 0 0 0-8 8z" fill={C.strong} /><rect x={52} y={36} width={7} height={16} rx={3.5} fill={C.accent} /><rect x={101} y={36} width={7} height={16} rx={3.5} fill={C.accent} />{[46, 64, 82, 100].map(x => bar(x, 78, 12, x === 82 ? C.strong : C.line))}{[46, 64, 82, 100].map(x => bar(x, 96, 12))}</> }
    case 'receipt': return { disc: C.disc, body: <><path d="M44 38h72v84l-9-6-9 6-9-6-9 6-9-6-9 6-9-6z" fill={C.soft} stroke={C.line} strokeWidth={2} />{bar(56, 54, 30, C.strong, 7)}{bar(56, 70, 48)}{bar(56, 82, 40)}{bar(56, 98, 24, C.accent, 7)}<circle cx={118} cy={46} r={13} fill={C.warn} /><text x={118} y={52} textAnchor="middle" fontSize={16} fontWeight={700} fill="#fff" fontFamily="sans-serif">₹</text></> }
    case 'contacts': return { disc: C.disc, body: <>{card(36, 44, 88, 72)}<circle cx={64} cy={72} r={11} fill={C.strong} /><path d="M45 100a19 14 0 0 1 38 0z" fill={C.strong} />{bar(92, 62, 24)}{bar(92, 76, 18)}{bar(92, 92, 22, C.accent)}</> }
    case 'travel': return { disc: C.disc, body: <><path d="M30 102c24-26 70-32 100-12" fill="none" stroke={C.line} strokeWidth={3} strokeDasharray="6 7" strokeLinecap="round" /><path d="M96 58l30-8-8 12 12 8-24 6-14 18-4-14-18-4 14-10z" fill={C.strong} transform="rotate(-10 100 66)" /><circle cx={36} cy={100} r={7} fill={C.accent} /></> }
    case 'announce': return { disc: C.disc, body: <><path d="M44 74v22h22l36 24V50L66 74z" fill={C.strong} /><rect x={40} y={96} width={14} height={26} rx={5} fill={C.accent} /><path d="M114 66a24 24 0 0 1 0 38" fill="none" stroke={C.strong} strokeWidth={5} strokeLinecap="round" opacity={0.5} /><circle cx={122} cy={44} r={8} fill={C.accent} /></> }
    case 'offline': return { disc: C.badDisc, body: <><path d="M52 108a22 22 0 0 1 4-43 30 30 0 0 1 56 8 18 18 0 0 1-2 35z" fill={C.soft} stroke={C.line} strokeWidth={2} /><line x1={52} y1={48} x2={112} y2={118} stroke={C.bad} strokeWidth={7} strokeLinecap="round" /></> }
    case 'error': return { disc: C.badDisc, body: <><path d="M80 36l44 76a6 6 0 0 1-5 9H41a6 6 0 0 1-5-9z" fill={C.soft} stroke={C.bad} strokeWidth={5} strokeLinejoin="round" /><line x1={80} y1={66} x2={80} y2={88} stroke={C.bad} strokeWidth={7} strokeLinecap="round" /><circle cx={80} cy={102} r={4.5} fill={C.bad} /></> }
    case 'success': return { disc: C.goodDisc, body: <><circle cx={80} cy={80} r={40} fill={C.good} /><path d="M62 80l13 13 25-27" fill="none" stroke="#fff" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" /></> }
    case 'lock': return { disc: C.disc, body: <><rect x={46} y={72} width={68} height={52} rx={12} fill={C.strong} /><path d="M60 72V60a20 20 0 0 1 40 0v12" fill="none" stroke={C.strong} strokeWidth={8} strokeLinecap="round" /><circle cx={80} cy={94} r={7} fill={C.onStrong} /><rect x={77} y={98} width={6} height={14} rx={3} fill={C.onStrong} /></> }
    case 'team': return { disc: C.disc, body: <><circle cx={56} cy={64} r={12} fill={C.accent} /><path d="M36 100a20 15 0 0 1 40 0z" fill={C.accent} /><circle cx={106} cy={64} r={12} fill={C.strong} /><path d="M86 100a20 15 0 0 1 40 0z" fill={C.strong} /><circle cx={81} cy={54} r={14} fill={C.soft} stroke={C.line} strokeWidth={2} /><path d="M58 112a23 17 0 0 1 46 0z" fill={C.soft} stroke={C.line} strokeWidth={2} /></> }
    case 'setup': return { disc: C.disc, body: <>{card(36, 54, 88, 66)}<rect x={48} y={38} width={30} height={24} rx={6} fill={C.strong} />{bar(48, 76, 40)}{bar(48, 90, 56)}{bar(48, 104, 34)}{check(118, 50, 13, C.accent, C.onStrong)}</> }
    case 'notFound': return { disc: C.disc, body: <>{card(30, 44, 100, 72)}{bar(44, 58, 28, C.line, 8)}<text x={80} y={104} textAnchor="middle" fontSize={34} fontWeight={800} fill={C.strong} fontFamily="Inter, sans-serif">404</text><circle cx={126} cy={44} r={11} fill={C.accent} /></> }
    case 'forbidden': return { disc: C.badDisc, body: <><rect x={46} y={72} width={68} height={52} rx={12} fill={C.bad} /><path d="M60 72V60a20 20 0 0 1 40 0v12" fill="none" stroke={C.bad} strokeWidth={8} strokeLinecap="round" /><circle cx={80} cy={96} r={7} fill="#fff" /></> }
  }
}

export function Illustration({ art, size = 160, className, label }: { art: Art; size?: number; className?: string; label?: string }) {
  const { disc, body } = scene(art)
  return (
    <svg viewBox="0 0 160 160" width={size} height={size} className={cn('shrink-0', className)} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} xmlns="http://www.w3.org/2000/svg">
      <circle cx={80} cy={80} r={74} fill={disc} opacity={0.55} />
      {body}
    </svg>
  )
}
