# DoppelDash — Master Plan
**Enterprise Admin Toolsuite: CRM + LMS + RMS**  
Stack: Next.js 14 · MongoDB · Clerk Auth · Tailwind CSS · Ollama (Gemma 4) · Resend  
Last updated: 2026-04-27

---

## What This App Actually Is

Self-hosted enterprise operating system for Doppelmayr India. Three modules:
- **CRM** — Stakeholder relationship intelligence (NOT a sales CRM)
- **LMS** — Leave management with approval workflows
- **RMS** — 3-tier expense reimbursement pipeline

Runs on client's own Windows Server (WSL2 + Docker). No SaaS fees, no vendor lock-in.

---

## Deployment Target

| | Detail |
|---|---|
| Server OS | Windows Server 2019/2022 with WSL2 + Ubuntu 22.04 |
| Containerisation | Docker + Docker Compose |
| Reverse Proxy | Nginx (in Docker) |
| CDN / SSL / DDoS | Cloudflare (free tier) |
| Domain | Client to purchase (e.g. dash.doppelmayr.in) |
| Database | MongoDB (Docker volume) |
| File Storage | MinIO (Docker, self-hosted S3) — replacing local /public/uploads/ |
| Job Queue | BullMQ + Redis (Docker) |
| Email (system) | Resend API — transactional alerts |
| Email (per-user) | User's own Outlook/Gmail via SMTP — linked in Settings |
| AI (text + vision) | Ollama — gemma4:e4b (local, no API key) |
| Image Generation | Pollinations.ai (free, no key) → swap to Replicate/Fal.ai for quality |
| OCR | Gemma 4 vision via Ollama (replaces Tesseract CLI) |

**What to get from client before deployment:**
1. Domain name (buy from GoDaddy/Namecheap)
2. Cloudflare account (free — cloudflare.com)
3. Server static IP (or DynDNS service)
4. Windows Server version (2019 or 2022)
5. Server specs (min 8GB RAM, 100GB SSD recommended 16GB/250GB)
6. Company email domain (for Resend "from" address — e.g. noreply@doppelmayr.in)

**.env is server config — set ONCE by admin. Users never touch it.**  
Per-user settings (linked email, preferences) are stored encrypted in MongoDB.

---

## Current Status

| Phase | Focus | Status |
|-------|-------|--------|
| 1 | Foundation, Auth (Clerk), DB | ✅ Done |
| 2 | Dashboard + Navigation | ✅ Done |
| 3 | LMS — leave submit, approve, calendar | ✅ Done |
| 4 | RMS — 3-tier expense pipeline | ✅ Done |
| 5 | Announcements | ✅ Done |
| 6 | Analytics Charts | ✅ Done |
| 7 | File Uploads (local MinIO-ready) | ✅ Done |
| 8 | CRM — profiles, timeline, OCR, AI messages | ✅ Done (OCR upgrade pending) |
| 9 | Email Notifications (Resend) | ✅ Done |
| 10 | Admin Panel — users, balances, audit log | ✅ Done |
| 11 | Reports page | ✅ Done |
| 12 | Security — encryption, rate limit, sanitize | ✅ Done |
| 13 | UI — glassmorphism, animations, polish | ✅ Done |
| **A** | **OCR — Gemma 4 vision (replace Tesseract)** | 🔄 Next |
| **B** | **Per-user email linking (Outlook/Gmail SMTP)** | ⏳ Pending |
| **C** | **Segmented CRM email sending** | ⏳ Pending |
| **D** | **Business card share/request system** | ⏳ Pending |
| **E** | **Dynamic RBAC (replace hardcoded roles)** | ⏳ Pending |
| **F** | **AI Content Suite (LinkedIn post editor)** | ⏳ Pending |
| **G** | **Settings Hub (full customisation)** | ⏳ Pending |
| **H** | **Docker + MinIO + Redis infra** | ⏳ Pending |
| **I** | **XLSX / PDF export** | ⏳ Pending |
| **J** | **Production deployment scripts** | ⏳ Pending |

---

## Phase A — OCR: Gemma 4 Vision (Replace Tesseract)

**Problem:** Tesseract CLI is fragile, low accuracy on stylised business cards.  
**Solution:** Send card image directly to Gemma 4 (multimodal) via Ollama. One call, structured JSON out.

### Flow
```
User opens /crm/scan
  → Camera capture OR file upload
  → client-side compress to <500KB
  → POST /api/crm/ocr  { image: base64 }
  → Server: send to Ollama gemma4:e4b with vision prompt
  → Gemma returns JSON: { name, email, phone, company, designation, address, website }
  → Pre-fill new contact form
  → Dedup check: query contacts where email OR phone matches
  → If match: show "Similar contact found" → merge or create new
  → On confirm: save contact
  → Option: Share with team members
```

### Prompt to Gemma 4
```
You are a business card OCR assistant. Extract contact information from this business card image.
Return ONLY a JSON object with these fields (use null if not found):
{
  "name": string,
  "email": string,
  "phone": string,
  "company": string,
  "designation": string,
  "address": string,
  "website": string,
  "linkedin": string
}
Do not include any explanation. Return only the JSON.
```

**Files to change:**
- `web/app/api/crm/ocr/route.ts` — replace Tesseract exec with Ollama vision call
- `web/app/(app)/crm/scan/page.tsx` — add share flow after confirm

---

## Phase B — Per-User Email Linking (Outlook / Gmail SMTP)

**Every user** (boss → employee) can link their personal work email in Settings.  
The app sends emails **from their account** using SMTP. No Azure, no OAuth complexity.

### How it works
1. Settings → "My Email" tab
2. User enters:
   - Email address: `harsh@doppelmayr.in`
   - SMTP host: `smtp.office365.com` (Outlook) or `smtp.gmail.com` (Gmail)
   - SMTP port: `587`
   - App password (NOT their login password — they generate this in Outlook/Gmail settings)
3. "Test Connection" button — sends a test email to themselves
4. Saved encrypted in MongoDB `UserEmailConfig` collection
5. When they send from CRM → app uses Nodemailer with their config

### App passwords (how to tell users)
- **Outlook/Microsoft 365**: myaccount.microsoft.com → Security → App passwords → New
- **Gmail**: myaccount.google.com → Security → 2-Step → App passwords

### MongoDB model: `UserEmailConfig`
```
userId (Clerk)
smtpHost
smtpPort
emailAddress
appPassword  ← AES-256-GCM encrypted (same encrypt.ts system)
isVerified
createdAt
```

### Files to create/change
- `web/models/UserEmailConfig.ts`
- `web/app/api/user/email-config/route.ts` — GET/POST/DELETE
- `web/app/api/user/email-config/test/route.ts` — test connection
- `web/lib/userEmail.ts` — Nodemailer helper using stored config
- `web/app/(app)/settings/[[...rest]]/page.tsx` — add "My Email" tab

---

## Phase C — Segmented CRM Email Sending

**Use case:** Filter all Hindu contacts → send Diwali greetings from your own Outlook.  
**Use case:** Filter all contacts at company X → send event invite.

### Flow
```
CRM page → "Send Campaign" button
  → Filter panel:
      Religion: Hindu / Muslim / Christian / Sikh / Other / All
      Caste: (free text filter)
      Tags: [multiselect]
      Company: (free text)
      Designation: (free text)
  → Preview: "23 contacts selected"
  → Compose:
      Subject line
      Body (rich text OR AI-generate from template)
      Template selector: Diwali / Eid / Christmas / Custom
  → From: [user's linked email] (must have email linked)
  → Schedule: Send now / Schedule date+time
  → Send → queued via BullMQ → Nodemailer sends from user's SMTP
  → Track: sent count, failed, bounced
```

### AI template generation
- User picks "Diwali Greeting" template type
- Selects tone: Formal / Warm / Festive
- Gemma 4 generates personalised body with {name} placeholder
- User edits and confirms

### Files to create
- `web/app/(app)/crm/campaign/page.tsx` — campaign composer UI
- `web/app/api/crm/campaign/route.ts` — POST to queue jobs
- `web/models/Campaign.ts` — track campaign status
- BullMQ email job worker

---

## Phase D — Business Card Share / Request System

**Flow:**
```
User scans card → saves to their personal CRM
  → "Share with Team" button on contact card
  → Select team members to share with
  → They receive notification: "Harsh shared a contact: [Name]"
  → They can: Accept (adds to their CRM) | Reject (dismiss)
  → On accept: contact copied to their contacts with source: "shared by Harsh"
```

### MongoDB model: `ContactShareRequest`
```
fromUserId
toUserId
contactId
status: pending | accepted | rejected
createdAt
respondedAt
```

### UI
- Notification bell shows pending share requests (alongside leave/expense)
- Notification: "Harsh shared 'Ravi Kumar · Siemens' with you"
- Accept/Reject buttons in notification
- Contact page: "Shared from: Harsh Pandhe" badge

### Files to create
- `web/models/ContactShareRequest.ts`
- `web/app/api/crm/share/route.ts` — POST create share, PATCH accept/reject
- Update Header notification bell to also show share requests

---

## Phase E — Dynamic RBAC (Replace Hardcoded Roles)

**Current:** `role === 'boss'` hardcoded strings everywhere.  
**Target:** Roles in MongoDB with `permissions[]` array. Admin creates/edits roles from Settings.

### Why this matters
- Client may want: Finance role (can mark paid but not approve), HR role (LMS only), Intern (read-only)
- Zero code change to add a new role
- `boss/manager/employee` become the defaults, fully editable

### MongoDB models
```
Role: { name, description, permissions[], isDefault, color, createdAt }
Permission: { key, label, module, description }  ← seeded master list
```

### Permission keys (seeded)
```
lms:submit        lms:approve       lms:configure     lms:view_all
rms:submit        rms:approve       rms:payout        rms:view_all
crm:read          crm:write         crm:delete        crm:encrypt_view  crm:campaign
admin:users       admin:roles       admin:reports     admin:settings    admin:audit
announcements:post
```

### Settings → Roles tab
- List all roles with permission toggle grid
- Create new role (clone from existing)
- Assign role to users from User Management
- Delete custom roles (cannot delete defaults)

### Migration plan
- Default roles seeded to match current behaviour:
  - `employee` = lms:submit, rms:submit, crm:read/write, announcements:read
  - `manager` = + lms:approve, rms:approve, crm:view_all, reports:view
  - `boss` = + rms:payout, admin:users, admin:reports, admin:audit
- All API routes switch from `role === 'boss'` to `permissions.includes('rms:payout')`
- Clerk unsafeMetadata stores `roleId` (MongoDB ObjectId) instead of string

### Files to create
- `web/models/Role.ts`
- `web/models/Permission.ts`  
- `web/lib/permissions.ts` — `hasPermission(userId, key)` helper
- `web/app/api/admin/roles/route.ts`
- `web/app/(app)/settings/[[...rest]]/page.tsx` — Roles tab

---

## Phase F — AI Content Suite

### F1 — LinkedIn Post Editor (`/ai/post`)
Full post composer:
```
1. Context: attach CRM contact / event / announcement (optional)
2. Post type: Achievement / Product update / Event / Thought leadership / Festive
3. Tone: Professional / Warm / Inspirational / Formal
4. Language: English / Hindi / Hinglish
5. [Generate with AI] → Gemma 4 drafts post
6. Edit inline, [Regenerate] sections
7. Image panel:
   - [Generate image] → Pollinations.ai free API (no key)
   - OR upload your own
   - OR branded card (Satori OG image — company logo + text)
8. Preview panel (LinkedIn card mock)
9. [Copy text] [Download image] [Copy both]
```

### F2 — AI Email Drafter (in CRM contact page)
Already built. Upgrade:
- Full contact context: history, last interaction, role, company, birthday
- Templates: intro, follow-up, meeting request, grievance response, congratulations
- Language selector
- Directly feeds into Phase C campaign composer

### F3 — AI Insights Widget (Dashboard)
- Weekly summary: "3 leaves pending, ₹45k in pipeline, 2 contacts have birthdays this week"
- Smart nudges: "You haven't contacted Ravi Kumar in 30 days"
- Festive alerts: "Diwali in 5 days — 14 Hindu contacts in your CRM"

### Image generation
- Provider: `Pollinations.ai` — `https://image.pollinations.ai/prompt/{text}?width=1200&height=630`
- Zero API key, zero cost, works in local dev and production
- For better quality: `NEXT_PUBLIC_IMAGE_GEN_PROVIDER=replicate` in .env (optional)

---

## Phase G — Settings Hub (Full Customisation)

Single `/settings` page with tabs:

| Tab | Who | What |
|---|---|---|
| Profile | All | Clerk UserProfile |
| My Email | All | Link Outlook/Gmail SMTP for sending |
| Notifications | All | Toggle which emails you receive |
| Roles & Permissions | Boss+ | Create/edit roles, toggle permissions |
| Leave Types | Boss+ | Add/edit leave categories, days, proof rules |
| Expense Categories | Boss+ | Add/edit expense types |
| Holidays | Boss+ | Company holiday calendar |
| Branding | Boss+ | Company name, logo, accent colour |
| AI Config | Boss+ | Ollama model URL, model name |
| Email Config | Boss+ | Resend key, from address |
| Data & Backup | Boss+ | Export all data, trigger backup |

---

## Phase H — Infrastructure (Docker)

### docker-compose.yml services
```yaml
app:      Next.js (production build)
mongodb:  MongoDB 7 (named volume)
minio:    MinIO (named volume, ports 9000+9001)
redis:    Redis (named volume)
nginx:    Nginx (ports 80+443, config volume)
```

### MinIO (replace local /public/uploads/)
- `lib/minio.ts` — upload file, get pre-signed URL (15 min expiry)
- All receipts, medical docs, payment proofs, OCR images → MinIO
- Pre-signed URLs for secure temporary access (no public buckets)

### BullMQ + Redis (replace fire-and-forget)
- Email notification jobs
- OCR processing job (async)
- Campaign email jobs (throttled, 1/sec to avoid spam blocks)
- Birthday greeting cron (daily 9 AM)
- IMAP poll job (every 5 min)

### Files to create
- `docker-compose.yml`
- `Dockerfile`
- `nginx/nginx.conf`
- `web/lib/minio.ts`
- `web/lib/queue.ts` — BullMQ client
- `web/workers/email.worker.ts`
- `web/workers/campaign.worker.ts`

---

## Phase I — XLSX / PDF Export

- Leave report: per employee, date range, days taken by type → XLSX
- Expense report: per employee, totals, paid vs pending → XLSX
- Both with company logo header → PDF via jsPDF
- Reports page: "Export XLSX" and "Export PDF" buttons

Libraries: `xlsx` (SheetJS) + `jspdf` + `jspdf-autotable`

---

## Phase J — Production Deployment

### What happens on client's server
```
1. Install WSL2 on Windows Server
2. Install Ubuntu 22.04 in WSL2
3. Install Docker + Docker Compose in Ubuntu
4. git clone repo → cd web → cp .env.production .env.local
5. docker compose up -d
6. Configure Cloudflare: point domain → server IP, enable proxy
7. Done — app live at https://dash.doppelmayr.in
```

### Backup strategy
- `mongodump` cron: daily 2 AM → compress → upload to MinIO `backups/` bucket
- MinIO bucket synced to external drive or NAS via rclone (optional)

### Environment variables (full production list)
```
MONGODB_URI
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
RESEND_API_KEY
RESEND_FROM_EMAIL
ENCRYPTION_SECRET          ← never changes after first deploy
CRON_SECRET
OLLAMA_URL                 ← http://host.docker.internal:11434
OLLAMA_MODEL               ← gemma4:e4b
MINIO_ENDPOINT
MINIO_ACCESS_KEY
MINIO_SECRET_KEY
MINIO_BUCKET
REDIS_URL
NEXT_PUBLIC_APP_URL
IMAGE_GEN_PROVIDER         ← pollinations (default, free) | replicate | fal
REPLICATE_API_KEY          ← optional
```

---

## What's NOT Being Built (Scope Exclusions)

| Feature | Reason |
|---|---|
| Microsoft Graph API / Azure | Can't get Azure app registration; replaced with IMAP |
| Google Vision OCR | Replaced with Gemma 4 vision (free, local) |
| OpenAI GPT-4o | Replaced with Ollama Gemma 4 (free, local) |
| Cloudinary | Replaced with MinIO (self-hosted) |
| Vercel deployment | Self-hosted on client's Windows server |
| BullMQ before Phase H | Fire-and-forget works for now; queue added in Phase H |

---

## Key Decisions Log

| Decision | Reason |
|---|---|
| Clerk instead of NextAuth | Better DX, free tier sufficient, faster to build |
| Ollama/Gemma instead of OpenAI | Client is self-hosted, no recurring API costs |
| Gemma 4 vision for OCR | Better accuracy than Tesseract on styled cards, already installed |
| IMAP instead of Microsoft Graph | No Azure registration needed, works with any email provider |
| Pollinations.ai for image gen | Free, no key, works day one; swap later |
| Per-user SMTP instead of server SMTP | Each user sends from their own work email — more personal, no shared credentials |
| AES-256-GCM for field encryption | Built into Node.js, no extra dependency, DPDP Act compliant |
| hardcoded roles → Phase E RBAC | Ship fast now, migrate cleanly later |
