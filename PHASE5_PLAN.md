# Phase 5 — Analytics & Reports Depth

Goal: turn the static tile dashboards into an interactive, filterable, comparable, exportable, and shareable analytics surface. ~1 week.

## Progress (as of 2026-06-09)

Done:
- ✅ Step 1 — Feature A API: server-side `dept`/`employee`/`status` filters + `filterOptions` in response.
- ✅ Step 2 — Feature A UI: global toolbar dropdowns (Department / Employee / Status).
- ✅ Step 3 — Feature B: compare API (`compare=mom|yoy`), KPI delta chips (▲/▼), MoM/YoY toolbar toggle.

Also shipped (core features 1–7): Leave copy-feature, Travel auto-expense creation, Expense bulk-approval, Calendar `.ics` exports, Out-of-Office profile config, Workload Heatmap, Onboarding nudge cron.

System: Gmail SMTP + Gemini API key fixed. Test Employee record seeded (EMP-011).

Remaining:
- ⬜ Step 4 — Feature C: drill-down route + clickable chart segments.
- ⬜ Step 5 — Feature D: CSV + PNG per-tile export.
- ⬜ Step 6 — Feature E: saved date-range presets.
- ⬜ Step 7 — Feature F: shareable read-only dashboard.
- ⬜ Step 8 — per-tile filter overrides (optional polish).

Status: codebase uncommitted, pending local test.

---

Locked decisions:
- **Dept/employee filter** → join via `Employee.department` at query time (userId→dept map). No schema migration.
- **Shareable link** → signed public token, no login required, with expiry.
- **Export** → CSV (data tiles) + PNG (visual tiles, via `html2canvas`).

Existing architecture (reuse, don't rebuild):
- `SortableTileGrid` — generic id+className+renderTile grid, edit-mode DnD.
- Analytics: `TILE_CATALOG`, `LayoutEntry[]` in localStorage, `?from&to` range, `DATE_PRESETS`.
- Reports: jspdf + jspdf-autotable + papaparse already wired; per-table CSV/XLSX + full PDF.
- `/api/analytics` aggregates leave/expense/travel by month/status/type with `ownerFilter`.

---

## Feature A — Per-tile filters (department / employee / status)

**API** (`/api/analytics`):
- Accept `dept`, `employee` (userId), `status` query params (global, applied to all aggregates).
- Build `userId → department` map from `Employee` once per request; when `dept` set, resolve to a list of userIds and add `userId: { $in }` to `baseMatch`.
- `employee` → `userId: employee`. `status` → per-collection status match (skip where N/A).
- Return `filterOptions: { departments: string[], employees: {userId,name,department}[] }` so the UI can populate dropdowns without a second call.

**Per-tile override (UI):**
- Extend `LayoutEntry` → `{ id, size, filters?: { dept?, employee?, status? } }`.
- Tile-level filter popover (funnel icon in tile header, visible on hover like drag handle).
- A tile with its own filters fetches its slice independently — add a lightweight `/api/analytics/tile?tile=<id>&...` OR (simpler) keep one global fetch + a second keyed fetch per overridden tile. **Decision: global filters live in toolbar; per-tile overrides do a scoped fetch cached by filter-key.** Keep a `Map<filterKey, AnalyticsData>` in page state.

Scope guard: per-tile filter only meaningful for chart/list/kpi that read filterable collections. Birthday/announcement tiles ignore filters.

## Feature B — Compare period vs previous (MoM / YoY)

**API:**
- Accept `compare=mom|yoy|none`. When set, compute the previous comparable window (same length immediately prior for MoM; same window −1yr for YoY) and return `previous: { kpis, leaveByMonth, ... }` alongside current.

**UI:**
- Toolbar toggle: None / MoM / YoY.
- KPI tiles: show delta chip (▲/▼ %, green/red) vs previous.
- Month charts: overlay faded "previous" series (recharts second `<Bar>`/`<Line>` at low opacity).

## Feature C — Drill-down (click donut segment → filtered list)

- Donut/bar segments become clickable → navigate to a drill page `/analytics/drill?metric=<collection>&status=<seg>&from&to&dept&employee`.
- New route `/analytics/drill/page.tsx` + `/api/analytics/drill` returning raw matching rows (paginated, 50/page).
- Reuse existing card/table styles. Back button to dashboard preserving filters.

## Feature D — Export tile as CSV / PNG

- Add `html2canvas` dep (for PNG). CSV reuses `downloadBlob` pattern from reports.
- Per-tile export menu (⋯ on hover): "Export CSV" (data tiles), "Export PNG" (all tiles — snapshots the tile DOM node via ref).
- CSV serializers per tile type (month series, status buckets, top spenders, etc).
- Toolbar already has Full PDF (reports). Leave as-is.

## Feature E — Saved custom date-range presets

- localStorage `doppeldash-date-presets-v1`: `{ label, from, to }[]`.
- In date-range popover: "Save current range as preset" + list of saved presets (apply / delete).
- Merge with built-in `DATE_PRESETS`.

## Feature F — Shareable read-only dashboard link

**Model** `SharedDashboard`:
- `token` (random 32-hex, indexed unique), `ownerId`, `layout` (snapshot JSON), `filters` (range+global), `expiresAt`, `createdAt`, `viewCount`.

**API:**
- `POST /api/analytics/share` (auth) → create token from current layout+filters, returns URL.
- `GET /api/analytics/shared/[token]` (NO auth) → validate token+expiry, run the same analytics aggregation with the snapshot's filters, return data + layout. Read-only.
- `DELETE /api/analytics/share/[token]` → revoke.

**UI:**
- "Share" button in toolbar → dialog: pick expiry (24h / 7d / 30d / never), generate, copy link, list/revoke existing.
- Public view `/shared/[token]/page.tsx` — renders tiles read-only (no edit/filter controls), "Read-only shared dashboard" banner, expiry shown.

**Security:** token is unguessable (crypto random), expiry enforced server-side, data scoped to owner's role at share time (snapshot ownerFilter so an employee's share never leaks manager-wide data). No mutation endpoints exposed on public route.

---

## Build order (each chunk independently testable + committable)
1. **A (API filters + filterOptions)** — backend first, verify via curl.
2. **A (UI global toolbar filters)** — dept/employee/status dropdowns.
3. **B (compare API + KPI deltas + chart overlay)**.
4. **C (drill route + clickable segments)**.
5. **D (CSV + PNG per-tile export)**.
6. **E (saved presets)**.
7. **F (share model + APIs + dialog + public view)** — largest, last.
8. Per-tile filter overrides (A advanced) — optional polish if time.

## Risks / notes
- Department join adds an Employee scan per analytics call — acceptable at this scale (<500 employees). Cache map in-request only.
- `html2canvas` ~ +50KB; lazy-import only on PNG export click.
- Public share route must NOT import any auth-gated helper that throws on missing session.
- recharts overlay for compare: confirm chart components accept a second series prop — may need to extend `components/ui/charts.tsx`.
