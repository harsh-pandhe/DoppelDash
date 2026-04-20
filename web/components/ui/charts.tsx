'use client'
import { useState } from 'react'

interface BarData { label: string; value: number }

export function BarChart({
  data, color = '#0057A8', unit = '', height = 120,
}: {
  data: BarData[]; color?: string; unit?: string; height?: number
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const max = Math.max(...data.map(d => d.value), 1)

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${data.length * 40} ${height + 30}`}
        className="w-full overflow-visible"
        style={{ height: height + 30 }}
      >
        {/* Grid lines */}
        {[0.25, 0.5, 0.75, 1].map(t => (
          <line
            key={t}
            x1={0} y1={height * (1 - t)}
            x2={data.length * 40} y2={height * (1 - t)}
            stroke="#E4E8EF" strokeWidth={1} strokeDasharray="4,3"
          />
        ))}

        {data.map((d, i) => {
          const barH = max === 0 ? 0 : (d.value / max) * height
          const x    = i * 40 + 4
          const y    = height - barH
          const isH  = hovered === i
          return (
            <g key={i}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'default' }}
            >
              {/* Bar */}
              <rect
                x={x} y={y} width={32} height={barH}
                rx={4} ry={4}
                fill={isH ? color : `${color}99`}
                style={{ transition: 'fill 0.15s, y 0.3s, height 0.3s' }}
              />
              {/* Label */}
              <text
                x={x + 16} y={height + 16}
                textAnchor="middle"
                fontSize={9} fill="#8A93A6" fontFamily="Inter, system-ui, sans-serif"
              >
                {d.label}
              </text>
              {/* Tooltip */}
              {isH && d.value > 0 && (
                <g>
                  <rect x={x - 4} y={y - 22} width={40} height={18} rx={4} fill={color} />
                  <text x={x + 16} y={y - 9} textAnchor="middle" fontSize={10} fill="white" fontWeight="bold" fontFamily="Inter, system-ui, sans-serif">
                    {unit}{d.value.toLocaleString('en-IN')}
                  </text>
                </g>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function DonutChart({
  data, size = 100,
}: {
  data: { label: string; value: number; color: string }[]
  size?: number
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total === 0) return (
    <div className="flex items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <circle cx={50} cy={50} r={35} fill="none" stroke="#E4E8EF" strokeWidth={18} />
      </svg>
    </div>
  )

  const r  = 35
  const cx = 50; const cy = 50
  const circ = 2 * Math.PI * r
  let cumulative = 0

  const slices = data.map(d => {
    const pct   = d.value / total
    const dash  = pct * circ
    const gap   = circ - dash
    const offset = circ * 0.25 - cumulative * circ
    cumulative += pct
    return { ...d, dash, gap, offset }
  })

  return (
    <svg viewBox="0 0 100 100" width={size} height={size}>
      {slices.map((s, i) => (
        <circle
          key={i} cx={cx} cy={cy} r={r}
          fill="none" stroke={s.color} strokeWidth={18}
          strokeDasharray={`${s.dash} ${s.gap}`}
          strokeDashoffset={s.offset}
          style={{ transition: 'stroke-dasharray 0.4s ease' }}
        />
      ))}
      <text x={50} y={53} textAnchor="middle" fontSize={14} fontWeight="bold" fill="#111827" fontFamily="Inter, system-ui, sans-serif">
        {total}
      </text>
    </svg>
  )
}
