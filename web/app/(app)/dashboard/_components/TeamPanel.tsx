import Link from 'next/link'
import { ArrowRight, Users, UserCheck, UserX, Sparkles } from 'lucide-react'

interface TeamMember {
  id:        string
  name:      string
  role:      string
  department: string
  onboardingComplete: boolean
}

interface OnLeaveToday {
  userName: string
  type:     string
  endDate:  Date | string
}

interface AvailabilityCell {
  date: Date
  count: number          // number of team on leave that day
}

interface Props {
  team:           TeamMember[]
  onLeaveToday:   OnLeaveToday[]
  availability:   AvailabilityCell[]   // 14 days starting today
}

const TYPE_COLOR: Record<string, string> = {
  casual:     'bg-blue-500',
  sick:       'bg-red-500',
  medical:    'bg-red-500',
  earned:     'bg-green-500',
  privilege:  'bg-purple-500',
  restricted: 'bg-orange-500',
  lwp:        'bg-gray-500',
}

export default function TeamPanel({ team, onLeaveToday, availability }: Props) {
  const total       = team.length
  const onboarding  = team.filter(m => !m.onboardingComplete).length
  const availToday  = total - onLeaveToday.length

  // Group team by department for the quick stats
  const byDept = team.reduce((acc, m) => {
    const d = m.department || 'General'
    acc[d] = (acc[d] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  // Max count for heatmap normalization
  const maxOnLeave = Math.max(...availability.map(c => c.count), 1)

  return (
    <div className="space-y-4">

      {/* ── Team quick stats ── */}
      <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-border flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-tight text-dm-graphite uppercase">My team</h2>
          <Link href="/admin/users" className="text-[11px] font-bold text-dm-orange hover:text-dm-orange-600 flex items-center gap-1">
            Manage <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="grid grid-cols-3 divide-x divide-surface-border">
          <Stat icon={Users}     value={total}        label="Members" />
          <Stat icon={UserCheck} value={availToday}   label="Available" tone="success" />
          <Stat icon={UserX}     value={onLeaveToday.length} label="On leave" tone={onLeaveToday.length > 0 ? 'warning' : 'neutral'} />
        </div>
        {onboarding > 0 && (
          <div className="px-5 py-2.5 bg-status-warning-bg border-t border-status-warning/20 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-status-warning" />
            <p className="text-xs font-semibold text-status-warning">{onboarding} onboarding incomplete</p>
            <Link href="/admin/users" className="ml-auto text-[10px] font-bold text-status-warning hover:underline">
              Remind →
            </Link>
          </div>
        )}
      </div>

      {/* ── On leave today ── */}
      <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-surface-border">
          <h3 className="text-xs font-bold uppercase tracking-wider text-dm-graphite">On leave today</h3>
        </div>
        {onLeaveToday.length === 0 ? (
          <div className="px-5 py-6 text-center">
            <UserCheck className="w-6 h-6 text-status-success mx-auto mb-1.5" />
            <p className="text-xs font-semibold text-dm-graphite-2">Full team in office</p>
          </div>
        ) : (
          <div className="divide-y divide-surface-border">
            {onLeaveToday.map((l, i) => (
              <div key={i} className="px-5 py-2.5 flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${TYPE_COLOR[l.type] || 'bg-gray-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-dm-graphite truncate">{l.userName}</p>
                  <p className="text-[10px] text-surface-muted capitalize">{l.type} · returns {new Date(l.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 14-day availability strip ── */}
      <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-surface-border flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-dm-graphite">Next 14 days</h3>
          <Link href="/lms/team" className="text-[10px] font-bold text-dm-orange hover:text-dm-orange-600 flex items-center gap-1">
            Full calendar <ArrowRight className="w-2.5 h-2.5" />
          </Link>
        </div>
        <div className="px-3 py-3">
          <div className="grid grid-cols-7 gap-1 text-center">
            {availability.slice(0, 14).map((c, i) => {
              const isToday = i === 0
              const weekday = c.date.toLocaleDateString('en-IN', { weekday: 'narrow' })
              const day     = c.date.getDate()
              const intensity = c.count === 0 ? 0 : Math.min(1, c.count / maxOnLeave)
              const opacity = intensity === 0 ? 0 : 0.15 + intensity * 0.85
              return (
                <div key={i} className="flex flex-col items-center py-1">
                  <span className="text-[8px] text-surface-muted uppercase font-bold">{weekday}</span>
                  <div
                    className={`w-7 h-7 mt-0.5 rounded flex items-center justify-center text-[10px] font-bold transition-colors ${
                      isToday ? 'ring-2 ring-dm-graphite ring-offset-1' : ''
                    }`}
                    style={{
                      background: c.count > 0 ? `rgba(255, 69, 0, ${opacity})` : '#f5f5f5',
                      color: intensity > 0.5 ? 'white' : '#1a1a1a',
                    }}
                  >
                    {day}
                  </div>
                  {c.count > 0 && (
                    <span className="text-[8px] font-bold text-dm-orange mt-0.5">{c.count}</span>
                  )}
                </div>
              )
            })}
          </div>
          <p className="text-[10px] text-surface-muted text-center mt-2">
            Number = team members on leave that day
          </p>
        </div>
      </div>

      {/* ── Departments breakdown ── */}
      {Object.keys(byDept).length > 0 && (
        <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-surface-border">
            <h3 className="text-xs font-bold uppercase tracking-wider text-dm-graphite">By department</h3>
          </div>
          <div className="px-5 py-3 space-y-2">
            {Object.entries(byDept).sort((a, b) => b[1] - a[1]).map(([dept, count]) => (
              <div key={dept} className="flex items-center gap-3">
                <span className="text-xs font-semibold text-dm-graphite-2 flex-1 truncate">{dept}</span>
                <div className="flex-1 h-1.5 bg-surface-2 rounded-full overflow-hidden">
                  <div className="h-full bg-dm-orange" style={{ width: `${(count / total) * 100}%` }} />
                </div>
                <span className="text-xs font-mono font-bold text-dm-graphite w-6 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ icon: Icon, value, label, tone = 'neutral' }: {
  icon: typeof Users; value: number; label: string; tone?: 'neutral' | 'success' | 'warning'
}) {
  const colors = {
    neutral: 'text-dm-graphite',
    success: 'text-status-success',
    warning: 'text-status-warning',
  }
  return (
    <div className="px-4 py-4 text-center">
      <Icon className={`w-4 h-4 mx-auto mb-1.5 ${colors[tone]}`} />
      <p className={`text-2xl font-black tracking-tighter tabular-nums ${colors[tone]}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wider font-bold text-surface-muted mt-0.5">{label}</p>
    </div>
  )
}
