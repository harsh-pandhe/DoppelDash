# DoppelDash

## Enterprise Administrative Toolsuite (CRM, LMS, RMS)

A comprehensive internal management system built with the MERN stack (MongoDB, Express.js, React, Node.js), featuring a glassmorphism UI design for a modern, responsive experience.

### Overview

DoppelDash is designed to automate and streamline enterprise administrative processes through three integrated modules:

1. **Stakeholder CRM**: Advanced client relationship management with Outlook integration, business card scanning, and AI-powered content generation.
2. **Leave Management System (LMS)**: Smart time-off tracking with conditional workflows and approval pipelines.
3. **Reimbursement & Expense Tracker (RMS)**: Visual pipeline-based system for expense management and travel requests.

### Key Features

#### Stakeholder CRM
- **Outlook Integration**: Bi-directional syncing of emails, calendar events, and meetings using Microsoft Graph API
- **Business Card Scanner**: Mobile-responsive OCR feature for automatic profile creation
- **Advanced Profiling**: Comprehensive demographic data with privacy controls
- **AI Automation**: Automated greetings and one-click content generation using local LLM or OpenAI API

#### Leave Management System (LMS)
- **Real-time Balance Tracking**: Monthly and annual leave quotas (Casual, Medical, Earned)
- **Conditional Workflows**: Dynamic requirements based on leave type and duration
- **Approval Pipeline**: Multi-tier review process with notifications

#### Reimbursement & Expense Tracker (RMS)
- **Travel & Expense Submission**: Streamlined request creation with mandatory documentation
- **3-Tier Billing Pipeline**: Manager review → Boss approval → Payment processing
- **Visual Pipeline**: Kanban-style dashboards for tracking progress

### Tech Stack
- **Frontend**: React.js with Tailwind CSS, Framer Motion, Shadcn UI
- **Backend**: Node.js, Express.js
- **Database**: MongoDB
- **File Storage**: AWS S3 or Cloudinary
- **Integrations**: Microsoft Graph API, OCR services, AI APIs
- **UI Design**: Glassmorphism aesthetic with responsive mobile-first approach

### Architecture Highlights
- **Role-Based Access Control (RBAC)**: Employee, Manager, and Boss (Super Admin) roles
- **Progressive Web App (PWA)**: Native mobile app experience for camera features
- **Automated Workflows**: Cron jobs for scheduled tasks and greetings
- **Secure File Handling**: Multi-image uploads with validation

### Getting Started

1. Clone the repository
2. Install dependencies: `npm install`
3. Set up environment variables
4. Run the development server: `npm start`

### Changelog

#### Phase 11C — Scan Card OCR + Gallery (2026-06-18)
- Business-card scanning is now **upload-only** (camera overlay removed); serverside AI OCR (Gemini vision, Ollama fallback) auto-fills contact fields.
- Every scan is **stored** in a new `ScannedCard` model (image kept as compressed base64 data-URI — works on Netlify; no Cloudinary needed). Card saves instantly on upload; OCR result is patched in after so the UI never waits on slow OCR.
- New **Card Gallery** at `/crm/scanned` (linked from the Contacts header) — view stored cards, import any into CRM (links the contact), or delete. APIs: `GET/POST /api/crm/scanned-cards`, `PATCH/DELETE /api/crm/scanned-cards/[id]`.

#### Phase 10 + 11 (partial) — Role, Access & Approval Flows (2026-06-18)
- **10A** Global `boss` → `admin` role rename — `UserRole` type + Mongo enum, ~70 role comparisons across API routes + pages, `BossDashboard` → `AdminDashboard`, sidebar/settings/users/directory labels. Local DB migrated.
- **10B** Mail access control — new `User.mailAccess` field (admins/managers always allowed; employees need it granted). Sidebar hides Compose Mail/Drafts without access; per-employee toggle in the admin Users panel (audited); server guards on `/api/crm/campaign` and the `/mail` page.
- **11A** LMS month filter — `<input type=month>` (defaults to current month) filters leave cards via `?from=&to=`; "All" clears.
- **11B** Earned-leave cap — max 4 earned days per application; frontend disables submit + warns, API returns 400.
- **11E** Travel approval chain — `pending_manager` → `pending_admin` → `approved`/`rejected` with manager-return; server state machine + admin-only final approval; every transition audited; print button for all roles on the detail page.
- **11F** Reimbursement approval flow — completed the `submit → manager approve/reject/return → admin marks paid` chain (employees can only edit `returned`); status values renamed `pending_boss`→`pending_admin`, `bossNote`→`adminNote`; every transition audited.
- ⚠️ **Prod DB migration required** after deploy — see `web/ROADMAP.md` for the exact `updateMany` commands.

#### Phase 9 — Global UI/UX Overhaul (2026-06-16)
- **9A** Standardized dialogs — new reusable `Modal`/`ModalHeader`/`ModalBody`/`ModalFooter` (`components/ui/modal.tsx`): consistent width presets, `max-h-[90vh]` overflow, Escape + backdrop close (suppressible for destructive confirms), pinned footer. Migrated all 10 raw Radix dialogs across RMS, CRM, Announcements, Analytics, Reports.
- **9B** Responsive polish — CRM contacts table now falls back to a card list below `md`; RMS expense line-items stack on mobile; Reports summary tables scroll horizontally in-container. No page-level horizontal scroll at 375px.
- **9C** Loading & error states — added route-segment `loading.tsx` skeletons to 20 segments (new `PageSkeleton`/`TableSkeleton` primitives); new `ErrorState` (inline error + retry) wired into 9 data pages (LMS, RMS, CRM, Travel, Profile, Mail, Analytics, Reports, Announcements) — failed fetches now show a retry affordance instead of a blank/silent page.

#### Phase 8 — Critical Bugs (2026-06-13)
- **8A** Audit page crash fixed — null-guarded `performedByName` before `.split()` (`(app)/admin/audit/page.tsx`).
- **8B** LMS `ERR_NETWORK_CHANGED` reload loop fixed — AbortController on polled `fetchLeaves`, cancels on unmount (`(app)/lms/page.tsx`).
- **8C** Sidebar logo — replaced placeholder "D" with `/icon-192.png` image (`components/layout/Sidebar.tsx`).
- **8D** Performance (partial) — added MongoDB compound indexes: `Leave(userId,startDate)`, `Leave(status)`, `Expense(userId,status)`, `TravelRequest(userId,status)`.

Deferred to later phases: GET-route HTTP caching (per-route public/private audit needed first), app-wide AbortController, route `loading.tsx` skeletons, `boss→admin` global rename (Phase 10A). See `web/ROADMAP.md` for full status.

### Contributing

Please read the contributing guidelines before making contributions.

### License

[Add license information]