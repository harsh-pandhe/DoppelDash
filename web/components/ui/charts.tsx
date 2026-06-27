'use client'
import {
  ResponsiveContainer, BarChart as RBarChart, Bar,
  AreaChart as RAreaChart, Area,
  LineChart as RLineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  PieChart, Pie,
} from 'recharts'

interface BarData { label: string; value: number }

/** Area/trend chart for time-series (e.g. monthly leave/expense). */
export function AreaChart({
  data, color = '#0057A8', unit = '',
}: {
  data: BarData[]; color?: string; unit?: string
}) {
  const chartData = data.map(d => ({ name: d.label, value: d.value }))
  const fmt = (v: number) => unit ? `${unit}${v.toLocaleString('en-IN')}` : v.toLocaleString('en-IN')
  const gid = `area-${color.replace('#', '')}`
  return (
    <ResponsiveContainer width="100%" height={160}>
      <RAreaChart data={chartData} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="#E4E8EF" strokeDasharray="4 3" />
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#8A93A6' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#8A93A6' }} axisLine={false} tickLine={false} tickFormatter={v => unit ? `${unit}${v >= 1000 ? Math.round(v/1000)+'k' : v}` : String(v)} />
        <Tooltip
          formatter={(v) => [fmt(Number(v ?? 0)), 'Value']}
          contentStyle={{ background: 'var(--tooltip-bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text)' }}
        />
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#${gid})`} />
      </RAreaChart>
    </ResponsiveContainer>
  )
}

export function BarChart({
  data, color = '#0057A8', unit = '',
}: {
  data: BarData[]; color?: string; unit?: string; height?: number
}) {
  const chartData = data.map(d => ({ name: d.label, value: d.value }))
  const fmt = (v: number) => unit ? `${unit}${v.toLocaleString('en-IN')}` : v.toLocaleString('en-IN')

  return (
    <ResponsiveContainer width="100%" height={160}>
      <RBarChart data={chartData} margin={{ top: 8, right: 4, left: -16, bottom: 0 }} barCategoryGap="35%">
        <CartesianGrid vertical={false} stroke="#E4E8EF" strokeDasharray="4 3" />
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#8A93A6' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#8A93A6' }} axisLine={false} tickLine={false} tickFormatter={v => unit ? `${unit}${v >= 1000 ? Math.round(v/1000)+'k' : v}` : String(v)} />
        <Tooltip
          formatter={(v) => [fmt(Number(v ?? 0)), 'Value']}
          contentStyle={{ background: 'var(--tooltip-bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text)' }}
          cursor={{ fill: `${color}14` }}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {chartData.map((_, i) => <Cell key={i} fill={color} fillOpacity={0.85} />)}
        </Bar>
      </RBarChart>
    </ResponsiveContainer>
  )
}

/** Line/trend chart — sharper than area for comparing month-over-month. */
export function LineChart({
  data, color = '#0057A8', unit = '',
}: {
  data: BarData[]; color?: string; unit?: string
}) {
  const chartData = data.map(d => ({ name: d.label, value: d.value }))
  const fmt = (v: number) => unit ? `${unit}${v.toLocaleString('en-IN')}` : v.toLocaleString('en-IN')
  return (
    <ResponsiveContainer width="100%" height={160}>
      <RLineChart data={chartData} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#E4E8EF" strokeDasharray="4 3" />
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#8A93A6' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#8A93A6' }} axisLine={false} tickLine={false} tickFormatter={v => unit ? `${unit}${v >= 1000 ? Math.round(v/1000)+'k' : v}` : String(v)} />
        <Tooltip
          formatter={(v) => [fmt(Number(v ?? 0)), 'Value']}
          contentStyle={{ background: 'var(--tooltip-bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text)' }}
        />
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} dot={{ r: 3, fill: color }} activeDot={{ r: 5 }} />
      </RLineChart>
    </ResponsiveContainer>
  )
}

/** Horizontal bar chart with per-bar colors — good for category breakdowns. */
export function HBarChart({
  data, unit = '',
}: {
  data: { label: string; value: number; color?: string }[]; unit?: string
}) {
  const chartData = data.map(d => ({ name: d.label, value: d.value, color: d.color || '#0057A8' }))
  const fmt = (v: number) => unit ? `${unit}${v.toLocaleString('en-IN')}` : v.toLocaleString('en-IN')
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, chartData.length * 34)}>
      <RBarChart data={chartData} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid horizontal={false} stroke="#E4E8EF" strokeDasharray="4 3" />
        <XAxis type="number" tick={{ fontSize: 10, fill: '#8A93A6' }} axisLine={false} tickLine={false} tickFormatter={v => unit ? `${unit}${v >= 1000 ? Math.round(v/1000)+'k' : v}` : String(v)} />
        <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10, fill: '#8A93A6' }} axisLine={false} tickLine={false} />
        <Tooltip
          formatter={(v) => [fmt(Number(v ?? 0)), 'Value']}
          contentStyle={{ background: 'var(--tooltip-bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text)' }}
          cursor={{ fill: '#0057A814' }}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {chartData.map((d, i) => <Cell key={i} fill={d.color} fillOpacity={0.85} />)}
        </Bar>
      </RBarChart>
    </ResponsiveContainer>
  )
}

export function DonutChart({
  data, size = 100, onSegmentClick,
}: {
  data: { label: string; value: number; color: string }[]
  size?: number
  onSegmentClick?: (label: string) => void
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const clickable = !!onSegmentClick && total > 0

  return (
    <div className="shrink-0">
      <PieChart width={size} height={size}>
        <Pie
          data={total === 0 ? [{ label: 'empty', value: 1, color: '#E4E8EF' }] : data}
          cx={size / 2 - 1}
          cy={size / 2 - 1}
          innerRadius={size * 0.3}
          outerRadius={size * 0.45}
          dataKey="value"
          startAngle={90}
          endAngle={-270}
          strokeWidth={0}
          onClick={clickable ? ((slice: { label?: string }) => slice?.label && onSegmentClick!(slice.label)) as never : undefined}
          className={clickable ? 'cursor-pointer focus:outline-none' : undefined}
        >
          {(total === 0 ? [{ color: '#E4E8EF' }] : data).map((d, i) => (
            <Cell key={i} fill={d.color} />
          ))}
        </Pie>
      </PieChart>
    </div>
  )
}
