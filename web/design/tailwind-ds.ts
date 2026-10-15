/**
 * Tailwind extension for the DoppelDash design system. Registered as a PLUGIN-provided theme extension, so it
 * only ADDS `ds-*` utilities (bg-ds-primary, text-ds-body-md, rounded-ds-md, duration-ds-base …) and can never
 * change an existing class. Values come from design/tokens.json via CSS variables (see app/design/ds-tokens.css).
 */
import tokens from './tokens.json'

const kebab = (s: string) => s.replace(/([A-Z])/g, m => '-' + m.toLowerCase())
const rgb = (name: string) => `rgb(var(--ds-${name}) / <alpha-value>)`

const roleNames = Object.keys(tokens.brands.doppelmayr.color.light).map(kebab)
const semanticNames = Object.keys(tokens.core.semantic).flatMap(n => [n, `on-${n}`, `${n}-container`, `on-${n}-container`])
const colors: Record<string, string> = {}
for (const n of [...roleNames, ...semanticNames, 'page', 'card', 'sunken']) colors[n] = rgb(n)
for (let i = 1; i <= 8; i++) colors[`chart-${i}`] = rgb(`chart-${i}`)

const fontSize: Record<string, [string, { lineHeight: string; letterSpacing: string; fontWeight: string }]> = {}
for (const [k, v] of Object.entries(tokens.core.type.scale)) {
  fontSize[`ds-${kebab(k)}`] = [`${v.size}px`, { lineHeight: `${v.line}px`, letterSpacing: `${v.track}px`, fontWeight: String(v.weight) }]
}

const borderRadius: Record<string, string> = {}
for (const k of Object.keys(tokens.core.radius)) borderRadius[`ds-${k}`] = `var(--ds-radius-${k})`
for (const k of Object.keys(tokens.core.shape)) borderRadius[`ds-${k}`] = `var(--ds-shape-${k})`

const boxShadow: Record<string, string> = {}
for (const k of Object.keys(tokens.core.elevation)) if (k !== 'usage') boxShadow[`ds-${k}`] = `var(--ds-elev-${k})`

const transitionDuration: Record<string, string> = {}
for (const k of Object.keys(tokens.core.motion.duration)) transitionDuration[`ds-${kebab(k)}`] = `var(--ds-dur-${kebab(k)})`
const transitionTimingFunction: Record<string, string> = {}
for (const k of Object.keys(tokens.core.motion.easing)) transitionTimingFunction[`ds-${kebab(k)}`] = `var(--ds-ease-${kebab(k)})`

export const dsThemeExtension = {
  colors: { ds: colors },
  fontSize,
  borderRadius,
  boxShadow,
  transitionDuration,
  transitionTimingFunction,
  maxWidth: { 'ds-content': 'var(--ds-max-content)' },
  fontFamily: { 'ds-sans': ['var(--ds-font-sans)'], 'ds-display': ['var(--ds-font-display)'], 'ds-mono': ['var(--ds-font-mono)'] },
}
