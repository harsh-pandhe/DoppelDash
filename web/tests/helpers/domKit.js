/**
 * jsdom + Testing Library harness for the design-system component tests.
 * Sets DOM globals BEFORE React / Testing Library load, and compiles the repo's .tsx through jiti
 * (alias "@" → web root). Component code under components/ds avoids inline `type` imports, which jiti 1.x can't parse.
 */
const path = require('node:path')
const { JSDOM } = require('jsdom')

const root = path.resolve(__dirname, '../..')
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
const g = globalThis
g.window = dom.window
g.document = dom.window.document
for (const k of ['navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'FocusEvent', 'MutationObserver', 'getComputedStyle', 'DocumentFragment', 'HTMLInputElement', 'HTMLButtonElement', 'CustomEvent', 'PointerEvent', 'InputEvent', 'SVGElement']) {
  try { Object.defineProperty(g, k, { value: dom.window[k], configurable: true, writable: true }) } catch { /* read-only on this Node version */ }
}
// Every other DOM interface (NodeFilter, HTMLSelectElement, Text, Range …) that Node itself doesn't define.
for (const k of Object.getOwnPropertyNames(dom.window)) {
  if (/^[A-Z]/.test(k) && !(k in g)) { try { Object.defineProperty(g, k, { value: dom.window[k], configurable: true, writable: true }) } catch { /* ignore */ } }
}
g.IS_REACT_ACT_ENVIRONMENT = true
g.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0)
g.cancelAnimationFrame = id => clearTimeout(id)
dom.window.requestAnimationFrame = g.requestAnimationFrame
dom.window.cancelAnimationFrame = g.cancelAnimationFrame
g.ResizeObserver = dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
dom.window.HTMLElement.prototype.scrollIntoView = () => {}
dom.window.HTMLElement.prototype.hasPointerCapture = () => false
dom.window.HTMLElement.prototype.releasePointerCapture = () => {}
dom.window.HTMLElement.prototype.setPointerCapture = () => {}
let reduced = false
dom.window.matchMedia = g.matchMedia = query => ({
  matches: /prefers-reduced-motion/.test(query) ? reduced : false,
  media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false },
})
const setOsReducedMotion = v => { reduced = v }

g.React = require('react')

// Compile the repo's .ts/.tsx with the TypeScript compiler already in devDependencies (classic JSX → React global),
// and resolve the "@/…" alias like Next does. No Babel/jiti involved, so any valid TS the app uses works here.
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  return originalResolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, ...rest)
}
for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (mod, filename) => {
    const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true, resolveJsonModule: true },
      fileName: filename,
    }).outputText
    mod._compile(out, filename)
  }
}
const load = rel => require(path.resolve(root, rel))

const rtl = require('@testing-library/react')
const userEvent = require('@testing-library/user-event').default
module.exports = { dom, load, rtl, userEvent, setOsReducedMotion, React: g.React, root }
