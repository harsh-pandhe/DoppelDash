'use client'
import {
  ResponsiveContainer, BarChart as RBarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  PieChart, Pie,
} from 'recharts'

interface BarData { label: string; value: number }

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
          contentStyle={{ background: '#fff', border: '1px solid #E4E8EF', borderRadius: 8, fontSize: 12 }}
          cursor={{ fill: `${color}14` }}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {chartData.map((_, i) => <Cell key={i} fill={color} fillOpacity={0.85} />)}
        </Bar>
      </RBarChart>
    </ResponsiveContainer>
  )
}

export function DonutChart({
  data, size = 100,
}: {
  data: { label: string; value: number; color: string }[]
  size?: number
}) {
  const total = data.reduce((s, d) => s + d.value, 0)

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
        >
          {(total === 0 ? [{ color: '#E4E8EF' }] : data).map((d, i) => (
            <Cell key={i} fill={d.color} />
          ))}
        </Pie>
      </PieChart>
    </div>
  )
}
