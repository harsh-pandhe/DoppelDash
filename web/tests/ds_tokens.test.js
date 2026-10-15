/**
 * Design-token architecture tests (pure Node, no server, no DB).
 *   - ONE token file (core + brand layers), cross-language canonical hash
 *   - generated web artifacts are fresh; CSS is scoped (cannot restyle un-migrated pages)
 *   - WCAG AA contrast for every brand × light/dark
 *   - brand layers are data (no organisation ids), Doppelmayr corporate blue is pinned
 *   - Tailwind extension is purely additive (ds-* names only)
 *   - parity with the Android copy of the tokens when that repo is checked out next to this one
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const tokens = JSON.parse(fs.readFileSync(path.join(root, 'design/tokens.json'), 'utf8'))
const canon = o => (o === null || typeof o !== 'object') ? JSON.stringify(o) : Array.isArray(o) ? `[${o.map(canon).join(',')}]` : `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`
const lum = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

test('T1. the core token section hashes to the recorded value (cross-language canonical JSON)', () => {
  assert.equal(crypto.createHash('sha256').update(canon(tokens.core)).digest('hex'), tokens.meta.coreHash)
  assert.equal(tokens.meta.version, 2)
})

test('T2. generated web files are in sync with design/tokens.json', () => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/design/emit.mjs'), '--check'], { encoding: 'utf8' })
  assert.equal(r.status, 0, `STALE generated tokens — run: node scripts/design/emit.mjs\n${r.stderr}`)
})

test('T3. the generated CSS is scoped: every rule targets .ds-root / [data-ds-*] (un-migrated pages cannot be restyled)', () => {
  const css = fs.readFileSync(path.join(root, 'app/design/ds-tokens.css'), 'utf8') + fs.readFileSync(path.join(root, 'app/design/ds-base.css'), 'utf8')
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  // selectors = text before each "{" at any depth, excluding @-rules and keyframe steps
  const selectors = [...stripped.matchAll(/([^{}@]+)\{/g)].map(m => m[1].trim()).filter(s => s && !/^(from|to|\d+%(,\s*\d+%)*)$/.test(s) && !/^(media\b|keyframes ds-)/.test(s))
  assert.ok(selectors.length > 15, `parsed ${selectors.length} selectors`)
  for (const sel of selectors) {
    for (const part of sel.split(',').map(p => p.trim())) {
      assert.match(part, /^(\.ds-|\[data-ds-|\.ds-root|:root\[data-ds)/, `unscoped selector: "${part}"`)
    }
  }
  assert.doesNotMatch(stripped, /(^|\n)\s*(html|body|:root)\s*[,{]/, 'no global element/root rules')
})

for (const [id, brand] of Object.entries(tokens.brands)) {
  for (const mode of ['light', 'dark']) {
    test(`T4. ${id} ${mode}: text/container pairs meet WCAG AA (4.5:1), UI strokes 3:1`, () => {
      const c = brand.color[mode]
      const sem = tokens.core.semantic
      const card = mode === 'dark' ? c.surfaceContainer : c.surfaceContainerLowest
      const pairs = {
        'onSurface/surface': [c.onSurface, c.surface], 'onSurface/card': [c.onSurface, card], 'onSurfaceVariant/card': [c.onSurfaceVariant, card], 'onSurfaceVariant/surface': [c.onSurfaceVariant, c.surface],
        'onPrimary/primary': [c.onPrimary, c.primary], 'onPrimaryContainer/primaryContainer': [c.onPrimaryContainer, c.primaryContainer],
        'onSecondaryContainer/secondaryContainer': [c.onSecondaryContainer, c.secondaryContainer], 'onTertiaryContainer/tertiaryContainer': [c.onTertiaryContainer, c.tertiaryContainer],
        'onError/error': [c.onError, c.error], 'onErrorContainer/errorContainer': [c.onErrorContainer, c.errorContainer],
        'primary/card (links)': [c.primary, card], 'primary/surface': [c.primary, c.surface], 'error/card': [c.error, card],
        'onInverseSurface/inverseSurface (toast)': [c.onInverseSurface, c.inverseSurface], 'inversePrimary/inverseSurface (toast action)': [c.inversePrimary, c.inverseSurface],
      }
      for (const n of Object.keys(sem)) { pairs[`on${n}Container`] = [sem[n][mode].onContainer, sem[n][mode].container]; pairs[`on${n}/${n}`] = [sem[n][mode].onColor, sem[n][mode].color] }
      for (const [name, [fg, bg]] of Object.entries(pairs)) assert.ok(contrast(fg, bg) >= tokens.core.a11y.minContrast.text, `${id} ${mode} ${name}: ${contrast(fg, bg).toFixed(2)}`)
      assert.ok(contrast(c.outline, card) >= tokens.core.a11y.minContrast.ui, `${id} ${mode} outline vs card`)
    })
  }
}

test('T5. brand layers are data: distinct colours, shared foundations, Doppelmayr corporate blue pinned, no organisation ids', () => {
  const { doppelmayr, doppeldash } = tokens.brands
  assert.equal(doppelmayr.color.light.primary, '#0057A8')
  assert.notEqual(doppelmayr.color.light.primary, doppeldash.color.light.primary)
  assert.equal(doppelmayr.client, 'web'); assert.equal(doppeldash.client, 'android')
  assert.equal(doppelmayr.tone, 'enterprise'); assert.equal(doppeldash.tone, 'saas')
  const text = JSON.stringify(tokens)
  assert.doesNotMatch(text, /org_[a-z]/i, 'tokens must never reference an organisation id')
  assert.deepEqual(Object.keys(doppelmayr.color.light).sort(), Object.keys(doppeldash.color.light).sort(), 'both brands define the same roles')
})

test('T6. foundations are sane: 4px spacing, type minimums, status roles resolve, motion durations ordered', () => {
  for (const [k, v] of Object.entries(tokens.core.space)) if (k !== '0.5') assert.equal(v % 4, 0, `space ${k}=${v}`)
  for (const [k, v] of Object.entries(tokens.core.type.scale)) assert.ok(v.size >= tokens.core.type.minimums.label, `${k} size ${v.size}`)
  const roles = new Set(['success', 'warning', 'info', 'error', 'tertiary', 'neutral'])
  for (const [k, v] of Object.entries(tokens.core.status)) assert.ok(roles.has(v), `status ${k} → ${v}`)
  const d = tokens.core.motion.duration
  assert.ok(d.instant < d.fast && d.fast < d.base && d.base < d.slow && d.slow < d.emphasized)
  assert.ok(d.slow <= 450, 'no slow transitions')
  assert.ok(tokens.core.a11y.minTarget.touch >= 48)
})

test('T7. the Tailwind extension only ADDS ds-* utilities (cannot change an existing class)', () => {
  const jiti = require('jiti')(__filename, { interopDefault: true })
  const { dsThemeExtension } = jiti(path.join(root, 'design/tailwind-ds.ts'))
  for (const group of ['fontSize', 'borderRadius', 'boxShadow', 'transitionDuration', 'transitionTimingFunction', 'maxWidth', 'fontFamily']) {
    for (const key of Object.keys(dsThemeExtension[group])) assert.match(key, /^ds-/, `${group}.${key}`)
  }
  assert.deepEqual(Object.keys(dsThemeExtension.colors), ['ds'])
  assert.ok(dsThemeExtension.colors.ds['on-primary-container'].includes('--ds-on-primary-container'))
  assert.ok(dsThemeExtension.fontSize['ds-body-md'] || dsThemeExtension.fontSize['ds-body-medium'])
})

test('T8. web tokens equal the Android copy (when DoppelDash-mobile is checked out beside the repo)', t => {
  const candidates = [process.env.DD_MOBILE_TOKENS, path.resolve(root, '../../../../../DoppelDash-mobile/tool/design/tokens.json'), '/home/harsh-pandhe/GitHub/DoppelDash-mobile/tool/design/tokens.json'].filter(Boolean)
  const found = candidates.find(p => fs.existsSync(p))
  if (!found) return t.skip('Android tokens not found next to this repo (set DD_MOBILE_TOKENS to compare)')
  assert.equal(fs.readFileSync(found, 'utf8'), fs.readFileSync(path.join(root, 'design/tokens.json'), 'utf8'), 'design/tokens.json drifted from the Android copy — run tool/design/sync_to_web.py')
})
