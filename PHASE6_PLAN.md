# Phase 6 — Mail System, Expense PDF, Polish

Goal: turn ad-hoc CRM email into a real **Communications** module, add print-ready expense PDFs, make the whole app responsive, and trim dead weight.

Locked decisions (from user):
- Mail gets its own **nav section** ("Communications"), not buried in CRM.
- Bulk send offers **both**: BCC blast (no personalization) **and** click-through queue (personalized, one draft per click — respects browser user-gesture rule that blocked auto-open).
- ScanCard stays an **overlay dialog** (already `ScanCardDialog.tsx`); trigger from CRM, drop dedicated nav entry.
- Expense sheet → **LaTeX → PDF**, print/sign flow, after mail system.
- Local Outlook (`mailto:`) is the send transport. Server SMTP/campaign kept as secondary.

Known constraint discovered in testing:
- **Browsers block multiple programmatic `mailto:` launches** ("a user gesture is required"). Only the first opens. → per-contact bulk MUST be click-driven (queue), not a loop.

---

## A. Communications (Mail) module — `/mail`

New nav group **Communications**:
- `/mail` — compose + drafts list
- `/mail/drafts` — saved drafts (version history)

### A1. Rich email editor (replace current textarea / basic RichTextEditor)
- Inline styling: bold/italic/underline/strikethrough, text color, highlight
- **Horizontal rule** insert
- Nested/ordered/unordered lists
- **Image insert mid-body** (upload → Cloudinary/MinIO → inline `<img>`); drag to reposition
- Drag-and-drop **section grouping** (move blocks)
- **HTML snippet** injection (raw HTML block) — gated behind a toggle/role
- Link insert (fix the existing tiptap "Duplicate extension names: link" warning — dedupe Link extension)
- **Search & Replace** across the draft
- **Device preview** — toggle mobile/desktop frame to preview rendering

### A2. AI assist
- Generate (type + context) → subject + body  [done in single-contact, port here]
- **Partial edit**: select a region → "rewrite selection" (AI edits only the highlighted part)
- Regenerate / refine presets + feedback box  [port from contact dialog]

### A3. Recipients
- Recipient picker: search CRM contacts + Directory users, multi-select chips
- Tag-segment select (reuse campaign tag filter)
- To / Cc / Bcc fields

### A4. Send
- **BCC blast**: one Outlook draft, all in BCC (semicolon-joined — fixed). Placeholders stripped.
- **Click-through queue**: list of recipients, each row "Open draft" button → personalized `mailto:` ({{name}}/{{company}}) on click. Mark sent as you go. Respects gesture rule.
- Pre-send **confirmation dialog** showing recipient list (avoid the Dragan-style misfire).
- Keep server-SMTP campaign as a separate explicit option.

### A5. Drafts + version control
- Save draft (model `MailDraft`: owner, subject, bodyHtml, recipients, updatedAt, versions[])
- Auto-snapshot prior versions on each save; restore any past version
- Drafts list with last-edited, restore, delete

---

## B. ScanCard → overlay only
- Remove `/crm/scan` nav item; keep `ScanCardDialog` triggered from CRM list button.
- Verify dialog still works; delete dead `/crm/scan/page.tsx` if unused after.

## C. Responsive pass (whole app, desktop sizes)
- Audit每 page at 1280 / 1440 / 1920 / ultrawide. Fix fixed-width tables, sidebars, dialogs.
- Tables → horizontal scroll or stacked at narrow desktop.
- Mail editor + analytics tiles reflow.

## D. Cleanup
- Remove unused deps, dead routes, stale `next.config.ts` (keep `.mjs`).
- Fix tiptap duplicate Link extension warning.
- Manifest 404 — add `public/manifest.json` (currently 404 in console).

---

## E. Expense sheet → LaTeX PDF (Travel Expense Sheet)
Reference: client's `Travel Expense Sheet.xlsx` (Doppelmayr header, Tickets/Stay/F&B/Per Diem/Local Conveyance sections, Summary, Grand Total, signature rows).

- LaTeX template mirroring the sheet layout + **Doppelmayr header/logo** + claimant details block.
- Sections: Tickets/Fare, Stay, Food & Beverages, Per Diem, Local Conveyance, Summary, Grand Total, Balance.
- **QR code per receipt** → links to the uploaded proof (receiptUrl) in the Remarks/Bill column.
- Signature rows: **Signature of Claimant · Checked by · Approved by**.
- Flow: employee submits → manager approves → **manager prints** the generated PDF, physical signatures added after.
- UI: "View PDF" + "Print" on an approved travel/expense record (manager/boss).
- Render: server route generates `.tex` → compile (tectonic/latexmk) → stream PDF. Confirm LaTeX available on Netlify functions OR pre-render via a lib (e.g. server-side `latex` container / fallback to HTML-print if LaTeX unavailable on host).

---

## F. Suggestions — candidate additions (for user to pick)
- **Email open/click tracking** (pixel) for sent campaigns
- **Templates library** (save reusable email templates)
- **Scheduled send** (queue draft, fire later — needs server send, not mailto)
- **Contact activity timeline** auto-logging sent mails
- **Bulk import contacts** (CSV/vCard)
- **Approval workflow audit PDF** (who approved what, when)
- **Dashboard exportable as PDF**
- **Dark mode**
- **Global search** (contacts + mails + docs)
- **Mobile-responsive** (true mobile, not just desktop) if field staff use phones
- **Notification center** improvements (real-time via SSE/websocket)
- **Two-way IMAP sync** — show replies in-app (IMAP already configured)

---

## Build order
1. Manifest 404 fix + tiptap Link dedupe (quick wins)
2. ScanCard nav → overlay cleanup
3. Mail module scaffold: nav group, `/mail`, recipient picker
4. Rich editor (tiptap extended: HR, image, lists, color, search/replace, HTML snippet, device preview)
5. AI assist (port generate/refine + partial-edit selection rewrite)
6. Send: BCC + click-through queue + confirm dialog
7. Drafts + version control (MailDraft model)
8. Responsive pass
9. Cleanup dead code
10. Expense LaTeX PDF
11. Review suggestions (F) with user, pick next phase

## Risks
- LaTeX on Netlify functions — may not have a TeX distro; need a JS PDF lib fallback (pdfkit/react-pdf) or external render service.
- tiptap bundle size with many extensions — lazy-load editor.
- `mailto:` body 2000-char cap still applies — long rich emails truncate; for rich HTML, mailto can't carry formatting anyway (plaintext only). **Open question: rich formatting can't go through mailto.** Rich editor output → Outlook draft will be plaintext unless we switch transport. Flag to user.
