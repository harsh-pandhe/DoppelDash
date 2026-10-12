#!/usr/bin/env node
/**
 * Emit the web design-token artifacts from design/tokens.json (copied from DoppelDash-mobile/tool/design).
 *   node scripts/design/emit.mjs          → writes app/design/ds-tokens.css and lib/ds/tokens.ts
 *   node scripts/design/emit.mjs --check  → exits 1 if the generated files are stale (used by tests/CI)
 *
 * The CSS is SCOPED: every variable lives under  [data-ds-brand="…"][data-ds-theme="…"]  or .ds-root, so
 * importing it never changes a page that is not wrapped in <DsProvider>. Legacy (non-ds) pages are untouched.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tokens = JSON.parse(fs.readFileSync(path.join(root, 'design/tokens.json'), 'utf8'))
const { core, brands, meta } = tokens

const canon = o => (o === null || typeof o !== 'object') ? JSON.stringify(o) : Array.isArray(o) ? `[${o.map(canon).join(',')}]` : `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`
const coreHash = crypto.createHash('sha256').update(canon(core)).digest('hex')
if (coreHash !== meta.coreHash) { console.error(`design/tokens.json is inconsistent: core hash ${coreHash.slice(0, 12)} ≠ meta.coreHash ${meta.coreHash.slice(0, 12)}`); process.exit(2) }

const rgb = h => { const n = parseInt(h.slice(1), 16); return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}` }
const kebab = s => s.replace(/([A-Z])/g, m => '-' + m.toLowerCase())
const roleVars = m => Object.entries(m).map(([k, v]) => `  --ds-${kebab(k)}: ${rgb(v)};`).join('\n')
const semanticVars = (mode) => Object.entries(core.semantic).map(([name, v]) => {
  const x = v[mode]
  return [`  --ds-${name}: ${rgb(x.color)};`, `  --ds-on-${name}: ${rgb(x.onColor)};`, `  --ds-${name}-container: ${rgb(x.container)};`, `  --ds-on-${name}-container: ${rgb(x.onContainer)};`].join('\n')
}).join('\n')

let css = `/* GENERATED FILE — do not edit. Source: design/tokens.json (node scripts/design/emit.mjs). Scoped: affects only [data-ds-*] / .ds-root. */\n`
// core (brand-independent) variables
const sp = Object.entries(core.space).map(([k, v]) => `  --ds-space-${k.replace('.', '_')}: ${v}px;`).join('\n')
const rad = Object.entries(core.radius).map(([k, v]) => `  --ds-radius-${k}: ${v}px;`).join('\n')
const shape = Object.entries(core.shape).map(([k, v]) => `  --ds-shape-${k}: var(--ds-radius-${v});`).join('\n')
const dur = Object.entries(core.motion.duration).map(([k, v]) => `  --ds-dur-${kebab(k)}: ${v}ms;`).join('\n')
const ease = Object.entries(core.motion.easing).map(([k, v]) => `  --ds-ease-${kebab(k)}: cubic-bezier(${v.join(', ')});`).join('\n')
const elev = Object.entries(core.elevation).filter(([k]) => k !== 'usage').map(([k, v]) => `  --ds-elev-${k}: ${v};`).join('\n')
css += `\n.ds-root, [data-ds-brand] {\n${sp}\n${rad}\n${shape}\n${dur}\n${ease}\n${elev}\n  --ds-focus-ring: ${core.focus.ringWidth}px;\n  --ds-focus-offset: ${core.focus.ringOffset}px;\n  --ds-sidebar: ${core.layout.sidebar.expanded}px;\n  --ds-rail: ${core.layout.sidebar.rail}px;\n  --ds-topbar: ${core.layout.topBar}px;\n  --ds-max-content: ${core.layout.maxContent}px;\n  --ds-font-sans: var(--font-inter), Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;\n  --ds-font-display: var(--font-inter-tight), "Inter Tight", var(--ds-font-sans);\n  --ds-font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;\n}\n`
for (const [bid, b] of Object.entries(brands)) {
  for (const mode of ['light', 'dark']) {
    const chart = b.chart[mode].map((c, i) => `  --ds-chart-${i + 1}: ${rgb(c)};`).join('\n')
    const c = b.color[mode]
    const dark = mode === 'dark'
    const page = c.surface
    const card = dark ? c.surfaceContainer : c.surfaceContainerLowest
    const sunken = dark ? c.surfaceContainerHigh : c.surfaceContainer
    css += `\n[data-ds-brand="${bid}"][data-ds-theme="${mode}"] {\n  color-scheme: ${mode};\n${roleVars(c)}\n${semanticVars(mode)}\n  --ds-page: ${rgb(page)};\n  --ds-card: ${rgb(card)};\n  --ds-sunken: ${rgb(sunken)};\n${chart}\n}\n`
  }
}
css += `\n/* Reduced motion: durations collapse, transforms are dropped (opacity cross-fades <=120ms remain). */\n@media (prefers-reduced-motion: reduce) {\n  .ds-root, [data-ds-brand] { --ds-dur-instant: 0ms; --ds-dur-fast: 0ms; --ds-dur-base: 0ms; --ds-dur-slow: 0ms; --ds-dur-emphasized: 0ms; }\n}\n[data-ds-motion="reduced"] { --ds-dur-instant: 0ms; --ds-dur-fast: 0ms; --ds-dur-base: 0ms; --ds-dur-slow: 0ms; --ds-dur-emphasized: 0ms; }\n`

// ---- typed constants for components / tests
const brandsTs = Object.fromEntries(Object.entries(brands).map(([id, b]) => [id, { id, name: b.name, shortName: b.shortName, tagline: b.tagline, tone: b.tone, client: b.client, seed: b.seed }]))
const ts = `// GENERATED FILE — do not edit. Source: design/tokens.json (node scripts/design/emit.mjs).
export const CORE_HASH = ${JSON.stringify(meta.coreHash)} as const
export type BrandId = ${Object.keys(brands).map(b => JSON.stringify(b)).join(' | ')}
export const DEFAULT_BRAND: BrandId = ${JSON.stringify(meta.defaultBrand)}
export const BRANDS = ${JSON.stringify(brandsTs, null, 2)} as const
export const STATUS_ROLE = ${JSON.stringify(core.status, null, 2)} as const
export type StatusRole = 'success' | 'warning' | 'info' | 'error' | 'tertiary' | 'neutral'
export const TYPE_SCALE = ${JSON.stringify(core.type.scale, null, 2)} as const
export type TypeStyle = keyof typeof TYPE_SCALE
export const BREAKPOINTS = ${JSON.stringify(core.breakpoints)} as const
export const DURATION_MS = ${JSON.stringify(core.motion.duration)} as const
export const MIN_TARGET = ${JSON.stringify(core.a11y.minTarget)} as const
`
const out = { 'app/design/ds-tokens.css': css, 'lib/ds/tokens.ts': ts }
const check = process.argv.includes('--check')
let stale = false
for (const [rel, body] of Object.entries(out)) {
  const file = path.join(root, rel)
  if (check) { if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== body) { console.error(`STALE: ${rel}`); stale = true } }
  else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); console.log('wrote', rel) }
}
if (check) process.exit(stale ? 1 : 0)
