# Dark Mode — Implementation Plan

Status: **not started** — scoped, ready to execute on greenlight.
Why it's a phase, not a quick task: 0 dark-mode infra today (`darkMode` not set in tailwind, 0 `dark:` classes, no toggle) and **57 files use `bg-white`** plus many `text-gray-*` / `bg-surface` / hardcoded hex. A partial job leaves unreadable white-on-white panels, so it must be done in one coherent pass.

## Decisions needed from product owner (before coding)
1. **Trigger**: system-preference auto (`prefers-color-scheme`) only, manual toggle only, or both (toggle overrides system)? — *recommend both.*
2. **Persistence**: `localStorage` (instant, per-device) vs a `User.themePref` DB field (follows the user across devices)? — *recommend localStorage first; DB later if needed.*
3. **Toggle placement**: Header (next to notifications) or Settings page? — *recommend Header.*
4. **Dark palette**: confirm the surface ramp + whether brand blue `#0057A8` stays or lightens for contrast on dark (it fails WCAG on near-black). *recommend a lighter brand `#3b82f6`-ish for dark only.*

## Approach (token-based — the only sane way)
Do **not** sprinkle `dark:` on 57 files by hand. Instead:

### 1. Make surface/text colors CSS variables
In `app/globals.css`:
```css
:root {
  --bg-app: #f5f5f5; --bg-card: #ffffff; --bg-surface: #f5f5f5;
  --border: #e5e5e5; --text: #1a1a1a; --text-muted: #737373;
  --brand: #0057A8;
}
.dark {
  --bg-app: #0b0e14; --bg-card: #151a23; --bg-surface: #1a212d;
  --border: #2a3340; --text: #e8eaed; --text-muted: #9aa4b2;
  --brand: #3b82f6;
}
```
### 2. Point tailwind tokens at the vars
In `tailwind.config.ts`: `darkMode: 'class'`, and remap:
```
surface: { 1: 'var(--bg-card)', 2: 'var(--bg-app)', border: 'var(--border)', muted: 'var(--text-muted)' }
```
This makes existing `bg-surface`, `border-surface-border`, `text-surface-muted` classes **theme-aware automatically** — no per-file edits where those tokens are already used.

### 3. Codemod the literal classes
The remaining offenders are literal `bg-white` / `text-gray-900` / `text-gray-700` / `bg-gray-50`. Two options:
- **Preferred**: a one-time codemod (sed/jscodeshift) mapping `bg-white`→`bg-surface-1`, `text-gray-900`→`text-[var(--text)]` (or a new `text-base` token), `text-gray-{500..700}`→`text-surface-muted`, `bg-gray-50/100`→`bg-surface-2`. Review the diff per file (it's mechanical but needs eyes on gradients/badges that should stay fixed).
- Status badges, brand gradients, and the colored `dm-orange`/status palettes **stay as-is** (they read fine on dark).

### 4. Toggle + script
- `components/ThemeToggle.tsx`: reads/writes `localStorage.theme`, toggles `document.documentElement.classList`.
- Inline `<script>` in `app/layout.tsx` `<head>` to set `.dark` **before paint** (avoids flash): `if(localStorage.theme==='dark'||(!('theme'in localStorage)&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')`.

### 5. Verify
- Playwright: screenshot every (app) page in both themes; eyeball for white-on-white / black-on-black.
- Check the Modal, Sheet, Toast, charts (recharts axis/grid colors are hardcoded `#8A93A6`/`#E4E8EF` — fine on both, but tooltip `background:#fff` needs a var).
- Print styles (`@media print`) must force light.

## Effort
~1–2 focused days. Step 2 buys most of the coverage cheaply; step 3 (codemod + review) is the bulk.

## Out of scope / watch-outs
- `components/ui/charts.tsx` tooltip `contentStyle.background:'#fff'` → var.
- Auth pages / BrandPanel use brand gradients — keep dark-friendly.
- ScanCard/Modal gradient headers already dark-on-brand — fine.
