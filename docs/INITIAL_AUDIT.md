# DoppelDash Initial Comprehensive Audit Report

**Date of Audit**: September 24, 2026  
**Auditor**: Senior Software Architect / Security & Product Engineer  
**Audit Scope**: Web Application (Next.js), Backend (Next.js Route Handlers + MongoDB), Mobile Application (Flutter Android), Multi-Tenancy Isolation, Authentication, Security, Parity, and Release Readiness.  
**Repository (Web & Backend)**: `https://github.com/harsh-pandhe/DoppelDash`  
**Repository (Mobile)**: `/home/harsh-pandhe/GitHub/DoppelDash-mobile`  
**Production Deployment**: `https://doppeldash-crm.netlify.app`  

---

## 1. Executive Summary

DoppelDash is a dual-client enterprise management toolsuite comprising:
1. **Web Application**: A Next.js 14 full-stack application deployed on Netlify, serving as an internal operations hub (CRM, LMS, RMS, Mail, Analytics, Administration) for Doppelmayr India.
2. **Mobile Application**: A Flutter Android application (Dart 3.12.2 / Flutter 3.44.7) designed to run against the same Next.js backend and MongoDB database.

The product is in the middle of a strategic transition: originally conceived and operated as a single-tenant internal ERP for Doppelmayr India, it is being converted into a **multi-tenant SaaS platform** where public organizations can sign up, create an organization, manage employees, and use CRM functionality from the Android app, while Doppelmayr remains a distinguished internal tenant.

### Current Reality Check
- **Codebase Health**: The mobile codebase has high compilation discipline (132 passing unit/widget tests, clean `flutter analyze`, builds debug and release APKs cleanly). The web codebase compiles cleanly with Next.js 14 and TypeScript (`tsc --noEmit` exits with 0 errors).
- **Production State**: **Public registration is 100% broken**. Attempting to call `POST /api/auth/register` on the production server returns **HTTP 500 Internal Server Error**. 
- **Multi-Tenancy Isolation**: The multi-tenant migration is only partially complete. While many standard CRUD routes now scope queries by `orgId`, critical admin and reporting endpoints (`/api/admin/users/[userId]`, `/api/analytics/software`, and all background cron jobs) have fatal cross-tenant data leaks and privilege escalation vectors.
- **Automated Web Testing**: There are **zero** automated tests in the web codebase.
- **Invitations & Billing**: There is currently **zero** code for inviting users (no invitation tokens, links, or routes) and **zero** code for billing, subscription plans, or feature entitlement gating.

---

## 2. Architecture

### High-Level Topology
```
┌──────────────────────────────────────┐     ┌──────────────────────────────────────┐
│       Next.js Web Client             │     │      Flutter Android Client          │
│   (Internal Doppelmayr Branding)     │     │   (Generic DoppelDash Branding)      │
└──────────────────┬───────────────────┘     └──────────────────┬───────────────────┘
                   │ Cookie: dd_session                         │ Authorization: Bearer <JWT>
                   ▼                                            ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                      Next.js 14 App Router (Netlify Serverless)                   │
│                                                                                   │
│  middleware.ts ──► Route Handlers (/api/*) ──► JWT / Mobile Token Validation       │
│                                            ──► AES Decryption / Mailer / OCR      │
└──────────────────────────────────────────┬────────────────────────────────────────┘
                                           │ Mongoose 9.4.1 (Connection Pool)
                                           ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                              MongoDB Database                                     │
│     (Shared multi-tenant collections filtered primarily by `orgId` string)       │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### Technical Stack Specifications
| Component | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Web Framework** | Next.js (App Router) | `14.2.35` | SSR, Static Generation, API Routes |
| **Frontend UI** | React, Tailwind CSS, Lucide | React `18`, Tailwind `3.4.1` | Web UI & Glassmorphism design |
| **Mobile Framework** | Flutter SDK | `3.44.7` (Dart `3.12.2`) | Cross-platform Android application |
| **Mobile State** | ViewModels (`ChangeNotifier`) | Custom MVVM | Screen state & business logic |
| **Mobile HTTP** | Dio | `5.11.0` | API requests & interceptors |
| **Database** | MongoDB | Mongoose `9.4.1` | Document storage |
| **Auth System** | Custom JWT + Password/OTP | `jose 6.2.3`, `bcryptjs 3.0.3` | Dual cookie/Bearer authentication |
| **2FA / Passkeys** | SimpleWebAuthn + Otplib | `@simplewebauthn` `10.0.1` | WebAuthn passkeys + TOTP |
| **External Mail** | Nodemailer | `8.0.7` | Shared SMTP relay (Gmail SMTP) |
| **AI / OCR** | Google Gemini / Ollama | `@google/genai` pattern | Card scanning & receipt OCR |

---

## 3. Authentication Architecture

The system uses a custom authentication system replacing legacy Clerk dependencies. It maintains two distinct authentication mechanisms depending on the client.

### 1. Web Authentication
- **Step 1: Credentials**: User enters email and password at `/sign-in`.
- **Backend Verification**: `POST /api/auth/login` validates password using `bcrypt.compare`.
- **Pre-Auth Step**: On success, an ephemeral `preAuthToken` (JWT, 10-minute expiry) is returned. An OTP is generated, hashed with `JWT_SECRET`, and emailed to the user (unless TOTP is configured).
- **Step 2: Second Factor**: User submits the 6-digit OTP to `POST /api/auth/verify-otp`.
- **Session Issuance**: Upon verification, an HTTP-only session cookie named `dd_session` is set with a 7-day expiration (`COOKIE_OPTS: { httpOnly: true, sameSite: 'lax', secure: true, maxAge: 7d }`).
- **Web Passkeys**: Supported via WebAuthn (`/api/auth/passkey/login`).

### 2. Android Mobile Authentication
- **Step 1 & 2**: Mobile follows the identical `login` -> `verify-otp` sequence using `Dio`.
- **Token Delivery**: Mobile cannot reliably rely on web cookies. `POST /api/auth/verify-otp` returns both:
  - `accessToken`: A short-lived JWT (15-minute expiration) signed with `JWT_SECRET` containing `{ userId, orgId, email, role, firstName, lastName }`.
  - `refreshToken`: A 32-byte cryptographically random hex token stored as a SHA-256 hash in the `RefreshToken` MongoDB collection with a 30-day TTL.
- **Client Storage**: The Flutter client stores tokens securely in `FlutterSecureStorage`.
- **Authorization Header**: Sent on all requests as `Authorization: Bearer <accessToken>`.
- **Token Rotation**: When `accessToken` expires (401), the mobile `ApiClient` interceptor calls `POST /api/auth/refresh` with `{ refreshToken }`. The backend revokes the presented refresh token and issues a fresh access token and new rotated refresh token.
- **Biometric Unlock**: Mobile supports local biometric authentication (`local_auth`) to unlock the stored session without retyping credentials.

---

## 4. Multi-Tenancy Audit

### Mechanism
Tenant isolation is enforced logically at the application layer using an `orgId` string identifier across documents.
- Default Organization: `org_doppelmayr` (reserved for internal Doppelmayr India staff).
- New Organizations: Generated during registration as `org_<hex_objectId>`.
- Request Identity: The backend derives `orgId` primarily from `getUser()`, which validates the JWT payload and fetches the active `User` record from the database.

### Isolation Strength & Vulnerabilities
| Evaluation | Detail / Severity |
| :--- | :--- |
| **VERIFIED SECURE** | Standard user endpoints (`/api/lms`, `/api/rms`, `/api/travel`, `/api/crm`, `/api/org/settings`) correctly scope lookups and mutations by `orgId: user.orgId`. |
| **CONFIRMED VULNERABLE: Cross-Tenant Admin IDOR** | `PATCH /api/admin/users/[userId]` does not verify that the target user belongs to the calling admin's `orgId`. Any admin of Organization A can alter roles, permissions, ban status, and employee details for users in Organization B or Doppelmayr. |
| **CONFIRMED VULNERABLE: Cross-Tenant Analytics Leak** | `GET /api/analytics/software` executes `listUsers({ limit: 500 })` and `Employee.find({})` with **no `orgId` filter**. Any manager or admin from any organization can view user names, emails, login times, and platform usage counts of all other tenants. |
| **CONFIRMED VULNERABLE: Cross-Tenant Background Crons** | `/api/cron/announcements` and `/api/cron/birthday` run without tenant scoping. Urgent announcements created in Org A are emailed to all users across all organizations; birthdays in Org A notify managers in Org B. |
| **CONFIRMED VULNERABLE: Cross-Tenant Audit Log Write** | `writeAudit` calls in `admin/users/[userId]` omit `orgId`, rendering audit trail entries unscoped or global. |

---

## 5. Backend API Inventory (72 Routes)

| Endpoint | Method(s) | Auth Required | Scope / Scoping Method | Used by Web | Used by Mobile | Status |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| `/api/auth/login` | POST | Public | IP Rate limit; user email | Yes | Yes | **VERIFIED** |
| `/api/auth/register` | POST | Public | IP Rate limit; generates new `orgId` | Yes* (Missing UI) | Yes | **CONFIRMED BROKEN** (500) |
| `/api/auth/send-otp` | POST | Pre-auth JWT | Ephemeral pre-auth token | Yes | Yes | **VERIFIED** |
| `/api/auth/verify-otp` | POST | Pre-auth JWT | Validates OTP; issues session/tokens | Yes | Yes | **VERIFIED** |
| `/api/auth/refresh` | POST | Public (Token Body) | SHA-256 Refresh Token rotation | No | Yes | **VERIFIED** |
| `/api/auth/logout` | POST | Public/Auth | Clears cookie / revokes mobile token | Yes | Yes | **VERIFIED** |
| `/api/auth/me` | GET | Authenticated | Scoped to current `userId` | Yes | Yes | **VERIFIED** |
| `/api/auth/change-password` | POST | Authenticated | Scoped to current `userId` | Yes | Yes | **VERIFIED** |
| `/api/auth/setup` | POST | Secret-Gated | Requires `SETUP_SECRET` | Admin init | No | **VERIFIED** |
| `/api/auth/totp/setup` | GET, POST | Authenticated | Scoped to current `userId` | Yes | Yes | **VERIFIED** |
| `/api/auth/tour-seen` | POST | Authenticated | Scoped to current `userId` | Yes | Yes | **VERIFIED** |
| `/api/auth/passkey/login` | POST | Public | WebAuthn challenge | Yes | No | **VERIFIED** |
| `/api/auth/passkey/register` | POST | Authenticated | WebAuthn credential registration | Yes | No | **VERIFIED** |
| `/api/auth/passkey/credentials` | GET, DELETE | Authenticated | Scoped to current `userId` | Yes | No | **VERIFIED** |
| `/api/auth/outlook` | GET | Authenticated | Initiates OAuth flow | Yes | No | **VERIFIED** |
| `/api/auth/outlook/callback` | GET | Authenticated | OAuth code exchange | Yes | No | **VERIFIED** |
| `/api/admin/users` | GET, POST | Admin/Manager | Scoped by `orgId` | Yes | Yes | **PARTIALLY BROKEN** (POST fails auto EMP-ID) |
| `/api/admin/users/[userId]` | PATCH | Admin | **UNSCOPED** (`User.findById`) | Yes | Yes | **CONFIRMED BROKEN (Security Risk)** |
| `/api/admin/balances/[userId]` | GET, PATCH | Admin | Scoped by `orgId` | Yes | Yes | **VERIFIED** |
| `/api/admin/audit` | GET | Admin | Scoped by `orgId` | Yes | Yes | **VERIFIED** |
| `/api/analytics` | GET | Authenticated | Scoped by `orgId` via `computeAnalytics` | Yes | Yes | **VERIFIED** |
| `/api/analytics/drill` | GET | Authenticated | Scoped by `orgId` | Yes | No | **VERIFIED** |
| `/api/analytics/software` | GET | Admin/Manager | **UNSCOPED** (fetches all DB users) | Yes | No | **CONFIRMED BROKEN (Data Leak)** |
| `/api/analytics/share` | POST | Admin/Manager | Generates share token with `orgId` | Yes | No | **VERIFIED** |
| `/api/analytics/share/[token]` | DELETE | Admin/Manager | Scoped to share owner | Yes | No | **VERIFIED** |
| `/api/analytics/shared/[token]` | GET | Public | Validates token, reads scoped dashboard | Yes | No | **VERIFIED** |
| `/api/announcements` | GET, POST | Authenticated | Scoped by `orgId` | Yes | Yes | **VERIFIED** |
| `/api/announcements/[id]` | PATCH, DELETE | Admin/Manager | Scoped by `orgId` | Yes | Yes | **VERIFIED** |
| `/api/announcements/broadcast` | POST | Admin/Manager | Scoped by `orgId` | Yes | No | **VERIFIED** |
| `/api/crm` | GET, POST | Authenticated | Scoped by `orgId` | Yes | Yes | **VERIFIED** |
| `/api/crm/[id]` | GET, PATCH, DELETE | Authenticated | Scoped by `orgId` + ownership rules | Yes | Yes | **VERIFIED** |
| `/api/crm/[id]/share` | GET, POST, DELETE | Authenticated | Scoped by `createdBy: userId` | Yes | Yes | **VERIFIED** |
| `/api/crm/campaign` | GET, POST | Authenticated | Scoped by `orgId` | Yes | Yes | **VERIFIED** |
| `/api/crm/generate` | POST | Authenticated | Scoped by `userId` (AI prompt) | Yes | No | **VERIFIED** |
| `/api/crm/ocr` | POST | Authenticated | File payload OCR extraction | Yes | Yes | **VERIFIED** |
| `/api/crm/reminders` | GET | Authenticated | Scoped by `orgId` + `userId` | Yes | No | **VERIFIED** |
| `/api/crm/scanned-cards` | GET, POST | Authenticated | Scoped by `orgId` + `userId` | Yes | Yes | **VERIFIED** |
| `/api/crm/scanned-cards/[id]` | PATCH, DELETE | Authenticated | Scoped by `orgId` | Yes | No | **VERIFIED** |
| `/api/cron/announcements` | GET | Secret-Gated | **UNSCOPED** (queries all tenants) | Cron | No | **CONFIRMED BROKEN (Cross-Tenant)** |
| `/api/cron/birthday` | GET | Secret-Gated | **UNSCOPED** (queries all tenants) | Cron | No | **CONFIRMED BROKEN (Cross-Tenant)** |
| `/api/cron/onboarding` | GET | Secret-Gated | Unscoped candidate scan; emails individual | Cron | No | **PARTIALLY VERIFIED** |
| `/api/dev/migrate` | POST | Secret-Gated | DB migration tool | Dev | No | **VERIFIED** |
| `/api/dev/reset-to-admin` | POST | Secret-Gated | Maintenance reset | Dev | No | **VERIFIED** |
| `/api/dev/seed` | POST | Secret-Gated | Demo dataset population | Dev | No | **VERIFIED** |
| `/api/employees/directory` | GET | Authenticated | Scoped by `orgId` | Yes | Yes | **VERIFIED** |
| `/api/employees/me` | GET, PATCH | Authenticated | Scoped by current `userId` | Yes | Yes | **VERIFIED** |
| `/api/employees/[id]` | GET, PATCH | Authenticated | Scoped by `orgId` | Yes | No | **VERIFIED** |
| `/api/holidays` | GET, POST, DELETE | Authenticated | Scoped by `orgId` + fallback null | Yes | Yes | **VERIFIED** |
| `/api/inbox` | GET | Authenticated | Scoped by `orgId` + `userId` | Yes | Yes | **VERIFIED** |
| `/api/inbox/[id]` | GET, PATCH | Authenticated | Scoped by `orgId` + `userId` | Yes | Yes | **VERIFIED** |
| `/api/lms` | GET, POST | Authenticated | Scoped by `orgId` | Yes | Yes | **VERIFIED** |
| `/api/lms/[id]` | GET, PATCH, DELETE | Authenticated | Scoped by `orgId` | Yes | Yes | **VERIFIED** |
| `/api/lms/balance` | GET | Authenticated | Scoped by `orgId` + `userId` | Yes | Yes | **VERIFIED** |
| `/api/lms/calendar` | GET | Authenticated | Scoped by `orgId` | Yes | Yes | **VERIFIED** |
| `/api/lms/workload` | GET | Authenticated | Scoped by `orgId` | Yes | No | **VERIFIED** |
| `/api/mail/drafts` | GET, POST | Authenticated | Scoped by `orgId` + `userId` | Yes | Yes | **VERIFIED** |
| `/api/mail/drafts/[id]` | GET, PATCH, DELETE | Authenticated | Scoped by `orgId` + `userId` | Yes | Yes | **VERIFIED** |
| `/api/notifications` | GET, POST | Authenticated | Scoped by `orgId` | Yes | Yes | **VERIFIED** |
| `/api/org/settings` | GET, POST | Authenticated | Scoped by `orgId` | Yes | Yes | **VERIFIED** |
| `/api/reports` | GET | Authenticated | Scoped by `orgId` | Yes | No | **VERIFIED** |
| `/api/rms` | GET, POST | Authenticated | Scoped by `orgId` | Yes | Yes | **VERIFIED** |
| `/api/rms/[id]` | GET, PATCH, DELETE | Authenticated | Scoped by `orgId` | Yes | Yes | **VERIFIED** |
| `/api/rms/ocr` | POST | Authenticated | File OCR parsing | Yes | Yes | **VERIFIED** |
| `/api/search` | GET | Authenticated | Scoped by `orgId`; **Vulnerable to ReDoS** | Yes | Yes | **PARTIALLY BROKEN (ReDoS)** |
| `/api/support/chat` | POST | Public | Rate limited, Gemini AI assistant | Yes | No | **VERIFIED** |
| `/api/sync/email` | POST | Authenticated | IMAP sync trigger | Yes | No | **VERIFIED** |
| `/api/travel` | GET, POST | Authenticated | Scoped by `orgId` | Yes | Yes | **VERIFIED** |
| `/api/travel/[id]` | GET, PATCH, DELETE | Authenticated | Scoped by `orgId` | Yes | Yes | **VERIFIED** |
| `/api/travel/[id]/expense` | POST | Authenticated | Scoped by `orgId` (creates RMS expense) | Yes | Yes | **VERIFIED** |
| `/api/user/email-config` | GET, POST | Authenticated | Scoped to current `userId` | Yes | Yes | **VERIFIED** |
| `/api/user/email-config/test` | POST | Authenticated | Tests user SMTP connection | Yes | No | **VERIFIED** |
| `/api/webhooks/outlook` | POST | Secret-Gated | Microsoft Graph push notifications | Webhook | No | **VERIFIED** |

---

## 6. Database Map & Schema Relationships

### Data Models Summary (22 Models)
1. **`User`**: Core identity model. Stores email, hashed password, `orgId`, role (`admin`, `manager`, `employee`), permissions, OTP/TOTP secrets.
2. **`Employee`**: Rich HR profile linked to `User` by `clerkUserId` (matches `User._id.toString()`) and `orgId`. Contains employeeId, joiningDate, department, emergency contacts, encrypted bank details, and travel privileges.
3. **`OrgSettings`**: Organization profile metadata (name, address, website, phone, logo). Indexed by unique `orgId`.
4. **`Leave`**: LMS leave requests with multi-tier approval state machine (`pending`, `approved`, `rejected`).
5. **`LeaveBalance`**: Annual entitlement quotas per user/org (`casual`, `sick`, `earned`, `privilege`, `restricted`, `lwpDays`).
6. **`Expense`**: RMS expense claims with 3-tier pipeline (`draft`, `pending_manager`, `pending_admin`, `paid`, `returned`, `rejected`).
7. **`TravelRequest`**: Multi-leg travel itineraries with advance tracking and approval pipeline.
8. **`Contact`**: CRM contacts with encrypted PII, tags, birthday tracking, and public share tokens.
9. **`ScannedCard`**: OCR business card uploads with parsed fields and Cloudinary URLs.
10. **`CampaignLog`**: History of mass email blasts sent to tagged CRM contacts.
11. **`Announcement`**: Org-wide broadcast posts with scheduled publishing and pinned flags.
12. **`InboxMessage`**: Synced IMAP email messages indexed by `orgId` and `userId`.
13. **`MailDraft`**: Rich-text email drafts with version history.
14. **`PublicHoliday`**: Yearly holiday calendar with recurring and org-specific entries.
15. **`SharedDashboard`**: Public tokenized read-only views into analytics summaries.
16. **`AuditLog`**: Tamper-evident ledger of user actions.
17. **`RefreshToken`**: SHA-256 hashed mobile refresh tokens with 30-day expiration.
18. **`PasskeyCredential`**: WebAuthn public key credentials and counter tracking.
19. **`RateLimit`**: Sliding-window rate limiter state.
20. **`OutlookToken`**: Microsoft Graph OAuth refresh tokens and subscription IDs.
21. **`UserEmailConfig`**: Encrypted custom SMTP credentials per user.
22. **`SyncState`**: Timestamp markers for background sync tasks.

---

## 7. Web Application Feature Inventory

- **Authentication (`/sign-in`)**: Modern glassmorphism UI with interactive 3D Three.js cable car animation, email/password, OTP challenge, TOTP support, passkeys, and an AI IT Support chatbot modal.
- **Dashboard (`/dashboard`)**: KPI metric cards, quick-action launchers, pending approvals queue, upcoming holidays, team leaves today, and recency feeds.
- **CRM (`/crm`, `/crm/new`, `/crm/[id]`, `/crm/directory`, `/crm/campaigns`, `/crm/scanned`)**: Stakeholder management with business card OCR, AI greeting generator, tag filtering, contact sharing (`/contact/[token]`), and mass email campaigns.
- **Leave Management (`/lms`, `/lms/new`, `/lms/[id]`, `/lms/team`, `/lms/holidays`)**: Leave submission with balance validation, multi-tier manager approval, team absence calendar, and public holiday configuration.
- **Expense Reimbursement (`/rms`, `/rms/new`, `/rms/[id]`, `/print/expense/[id]`)**: Receipt OCR scanning, expense categorisation, 3-tier approval (Manager -> Boss -> Paid), PDF printable reimbursement vouchers.
- **Travel Management (`/travel`, `/travel/new`, `/travel/[id]`)**: Multi-leg travel requests, travel advance tracking, itinerary reviews, and one-click expense claim generation.
- **Mail & Inbox (`/mail`, `/mail/drafts`, `/inbox`)**: Personal email configuration (custom SMTP/IMAP), rich-text email composing with TipTap, auto-saved drafts, and incoming message reader.
- **Analytics (`/analytics`, `/analytics/drill`, `/shared/[token]`)**: Visual charts (Recharts) covering expense burn rates, leave trends, department distributions, drill-down audits, and public link sharing.
- **Announcements (`/announcements`)**: Team-wide notices, rich text, priority tags, pinned posts, and scheduled publishing.
- **Reports & Directory (`/reports`, `/crm/directory`)**: Employee anniversary/birthday calendars, organizational directory, and PDF exports.
- **Administration (`/admin/users`, `/admin/audit`, `/settings`)**: User management, role elevation, permission assignment, quota override, audit log browser, and organization settings.

---

## 8. Android (Flutter) Feature Inventory

The Android application is located at `/home/harsh-pandhe/GitHub/DoppelDash-mobile` and implements:
- **Onboarding & Auth**: 3-step feature carousel, login with email/password, OTP entry, biometric unlock, and organization sign-up screen (`SignUpView`).
- **Dashboard**: KPI summaries, quick actions, pending approvals indicator, and leave balance summary.
- **CRM Module**: Contact list, contact search, contact creation sheet, business card scanner (camera/gallery image upload to `/api/crm/ocr`), contact detail view, and QR code / vCard sharing sheet.
- **LMS Module**: Leave list with status filters, leave request sheet with date pickers, leave balance widgets, and calendar absence view.
- **RMS Module**: Expense list, receipt camera scanner with OCR parsing (`/api/rms/ocr`), submit expense sheet, and manager approval action sheet.
- **Travel Module**: Travel request list, multi-leg travel creator sheet, approval workflow, and one-click expense generator.
- **Mail Module**: Custom SMTP configuration sheet, inbox viewer with HTML rendering, mail detail view, draft composer, and campaign mailer.
- **Announcements**: Feed of active announcements with urgency banners and creation sheet.
- **Admin & Settings**: User list, user edit sheet (role/status/mail access), audit log viewer, holiday management, TOTP configuration, and dark/light theme switching.

---

## 9. Web ↔ Android Feature Parity Matrix

| Feature | Web Application | Android Application | Backend API Ready | Parity Status | Classification |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Org Registration** | Missing UI (404) | Implemented (`SignUpView`) | Endpoint returns 500 | **CONFIRMED BROKEN** | **REQUIRED** (Primary SaaS Blocker) |
| **User Sign-In** | Implemented | Implemented | Yes | **VERIFIED** | Matched |
| **Passkey Login** | Implemented (WebAuthn) | Not Implemented | Yes (Web-specific) | Missing on Mobile | Intentionally Web-Only |
| **Biometric Auth** | Not Implemented | Implemented (`local_auth`) | Handled via Refresh Token | Mobile-Only | Intentionally Mobile-Only |
| **Dashboard** | Implemented | Implemented | Yes | **VERIFIED** | Matched |
| **CRM Contact List/Detail**| Implemented | Implemented | Yes | **VERIFIED** | Matched |
| **Business Card OCR** | Implemented | Implemented (Camera/Dio) | Yes | **VERIFIED** | Matched |
| **Contact vCard / Share** | Implemented | Implemented | Yes | **VERIFIED** | Matched (Web branding leak) |
| **AI Content Generator** | Implemented | Not Implemented | Yes (`/api/crm/generate`) | Missing on Mobile | **REQUIRED** |
| **LMS Leave Application** | Implemented | Implemented | Yes | **VERIFIED** | Matched |
| **LMS Approval Pipeline** | Implemented | Implemented | Yes | **VERIFIED** | Matched |
| **LMS Calendar View** | Implemented | Implemented | Yes | **VERIFIED** | Matched |
| **RMS Expense Filing** | Implemented | Implemented | Yes | **VERIFIED** | Matched |
| **RMS Receipt OCR** | Implemented | Implemented (Camera/Dio) | Yes | **VERIFIED** | Matched |
| **RMS Printable Voucher** | Implemented (`/print/..`) | Not Implemented | Web-rendered route | Missing on Mobile | Intentionally Web-Only |
| **Travel Requests** | Implemented | Implemented | Yes | **VERIFIED** | Matched |
| **Travel to Expense Conv.**| Implemented | Implemented | Yes | **VERIFIED** | Matched |
| **Mail Inbox / Sync** | Implemented | Implemented | Yes | **VERIFIED** | Matched |
| **Mail Drafting** | Implemented | Implemented | Yes | **VERIFIED** | Matched |
| **Analytics Charts** | Implemented (Recharts) | Basic KPI Cards (fl_chart)| Partial | Simplified on Mobile | Acceptable |
| **Shared Analytics Link** | Implemented | Not Implemented | Yes | Web-Only Feature | Intentionally Web-Only |
| **Announcements** | Implemented | Implemented | Yes | **VERIFIED** | Matched |
| **Admin: User Management**| Implemented | Implemented | Broken auto-ID on POST | **PARTIALLY BROKEN** | **REQUIRED** |
| **Admin: Quota Override** | Implemented | Implemented | Yes | **VERIFIED** | Matched |
| **Admin: Audit Log** | Implemented | Implemented | Yes | **VERIFIED** | Matched |
| **Employee Invitations** | Not Implemented | Not Implemented | No Endpoint | **MISSING** | **REQUIRED** (Public SaaS) |
| **Subscription / Billing**| Not Implemented | Not Implemented | No Endpoint | **MISSING** | Future Requirement |

---

## 10. Security Audit Findings (Prioritized)

### Priority 1: Critical (Cross-Tenant Admin IDOR & Privilege Escalation)
- **Location**: `web/app/api/admin/users/[userId]/route.ts` (lines 15–38)
- **Vulnerability**: The endpoint retrieves the target user using `getUserById(params.userId)` without verifying `target.orgId === user.orgId`. It then executes `updateUser(params.userId, patch)` and `Employee.findOneAndUpdate({ clerkUserId: params.userId }, empPatch)`.
- **Impact**: Any workspace admin from any tenant can modify credentials, roles, permissions, and ban status for users belonging to other organizations (including Doppelmayr India).

### Priority 2: High (Cross-Tenant Information Leak in Analytics)
- **Location**: `web/app/api/analytics/software/route.ts` (lines 16–50)
- **Vulnerability**: Calls `listUsers({ limit: 500 })`, `Employee.find({})`, `Leave.countDocuments({})`, and `Expense.countDocuments({})` without an `orgId` filter.
- **Impact**: Any user with `manager` or `admin` privileges in any organization can see the names, email addresses, departments, last login times, and total usage numbers of all users in the database across all tenants.

### Priority 3: High (Cross-Tenant Notification Leak via Background Crons)
- **Location**: `web/app/api/cron/announcements/route.ts` and `web/app/api/cron/birthday/route.ts`
- **Vulnerability**: Background cron jobs fetch announcements and birthdays globally and broadcast emails to `listUsers({ limit: 500 })` across all tenants.
- **Impact**: Sensitive corporate announcements and employee birthdays are emailed to unintended external companies.

### Priority 4: Medium (Regular Expression Denial of Service / Crash in Search)
- **Location**: `web/app/api/search/route.ts` (line 16)
- **Vulnerability**: Unsanitized user search input is directly passed to `new RegExp(q, 'i')`.
- **Impact**: Searching for unescaped regex tokens such as `[` causes an uncaught syntax exception and HTTP 500; complex nested quantifiers can stall serverless functions.

### Priority 5: Medium (PII & Branding Leak on Public Contact Page)
- **Location**: `web/app/contact/[token]/page.tsx`
- **Vulnerability**: Hardcoded "DoppelDash · Doppelmayr India" banner appears on all public shared contact cards, even those created by external organizations.

---

## 11. Known Bugs (Confirmed Only)

1. **Bug #1: `/api/auth/register` Returns HTTP 500 on Production**
   - **Status**: CONFIRMED BROKEN (Verified via HTTP POST to `https://doppeldash-crm.netlify.app/api/auth/register`).
   - **Root Cause A**: `EmployeeSchema` has `employeeId: { type: String, required: true, unique: true }`. The auto-increment hook is defined as `pre('save')`, which Mongoose executes **after** document validation. When `Employee.create({...})` runs without `employeeId`, validation fails immediately.
   - **Root Cause B**: `register/route.ts` specifies `privileges: { food: { tier: 'unlimited' }, taxi: { tier: 'unlimited' }, hotel: { tier: 'five_star' } }`. None of these exist in the `PrivilegesSchema` enum definitions (`food`: `none|basic|standard|premium`, `taxi`: `none|standard|ac|ac_premium`, `hotel`: `none|budget|standard|premium`).
   - **Root Cause C**: Partial database writes: `User.create` succeeds before `Employee.create` fails, leaving an orphaned User document and blocking future registration with HTTP 409 Conflict.

2. **Bug #2: Admin User Creation Fails Auto Employee-ID Generation**
   - **Status**: CONFIRMED BROKEN in `web/app/api/admin/users/route.ts` (line 111).
   - **Root Cause**: `Employee.create` is invoked without passing `employeeId`, hitting the same `Path 'employeeId' is required` validation failure.

3. **Bug #3: Web `/sign-up` Page Missing (404)**
   - **Status**: CONFIRMED BROKEN (Verified via HTTP GET returning 404).
   - **Root Cause**: `middleware.ts` whitelists `/sign-up`, but no file exists at `web/app/(auth)/sign-up/page.tsx`.

---

## 12. Registration Investigation Details

### Schema and Route Analysis
```
Registration Flow:
POST /api/auth/register
  │
  ├── 1. Rate limit check (pass)
  ├── 2. Body validation (pass)
  ├── 3. Connect DB (pass)
  ├── 4. User.findOne duplicate check (pass)
  ├── 5. User.create(...) ──────► [SUCCEEDS: User saved in MongoDB]
  ├── 6. OrgSettings.create(...) ─► [SUCCEEDS: OrgSettings saved]
  ├── 7. Employee.create(...) ────► [FAILS FATALLY WITH MONGOOSE VALIDATION ERROR]
                                    ├─ Path 'employeeId' is required
                                    ├─ 'unlimited' is not a valid enum for 'privileges.food.tier'
                                    ├─ 'unlimited' is not a valid enum for 'privileges.taxi.tier'
                                    └─ 'five_star' is not a valid enum for 'privileges.hotel.tier'
```
Because Mongoose transactions are not used, step 5 leaves a persistent user document in MongoDB. A subsequent retry with the same email returns HTTP 409 Conflict.

---

## 13. Testing Status & Build Verifications

| Test Suite / Command | Location / Target | Actual Result | Notes |
| :--- | :--- | :--- | :--- |
| `npm run lint` | `web/` | **PASSED WITH WARNINGS** | 10 image/hook lint warnings; 0 fatal errors |
| `tsc --noEmit` | `web/` | **PASSED (0 Errors)** | TypeScript compiles cleanly |
| `next build` | `web/` | **PASSED (88 Routes Built)**| Static and dynamic bundles generated cleanly |
| Web Automated Tests | `web/` | **NONE** | No test runner or test files exist |
| `flutter analyze` | `DoppelDash-mobile/` | **PASSED (0 Issues)** | Static analysis completely clean |
| `flutter test` | `DoppelDash-mobile/` | **PASSED (132 / 132)** | All unit and widget tests pass |
| `flutter build apk --debug` | `DoppelDash-mobile/` | **PASSED** | `app-debug.apk` built |
| `flutter build apk --release`| `DoppelDash-mobile/` | **PASSED** | `app-release.apk` (60.7MB) built cleanly |

---

## 14. Real Device Status

- **ADB Diagnostics**: `adb devices -l` executed on the host system.
- **Output**: `List of devices attached (empty)`.
- **Verdict**: No physical Android device or emulator is currently attached and accessible over ADB. Real-device hardware testing cannot be performed until a device is connected via USB with USB Debugging enabled, or an Android emulator is started.

---

## 15. Launch Blockers for Public SaaS

1. **[BLOCKER 1] Broken Registration API**: `POST /api/auth/register` throws HTTP 500, preventing any new public user or organization from signing up.
2. **[BLOCKER 2] Missing User/Employee Invitation System**: A new organization admin has no way to invite colleagues or team members into their organization (no invitation links, email invites, or accept-invite onboarding).
3. **[BLOCKER 3] Cross-Tenant Security Vulnerabilities**: Admins can alter users across organizations via `PATCH /api/admin/users/[userId]`, and managers can view cross-tenant analytics via `/api/analytics/software`.
4. **[BLOCKER 4] Cross-Tenant Notification Leak**: Urgents announcements and birthday crons broadcast to all tenants globally.
5. **[BLOCKER 5] Hardcoded Branding Leak in Shared Assets**: Public contact cards (`/contact/[token]`) hardcode "Doppelmayr India".
6. **[BLOCKER 6] Missing Web Sign-Up UI**: Web users attempting to navigate to `/sign-up` encounter a 404 error.

---

## 16. Recommended Execution Order

To take the product from its current state to a secure, public-ready multi-tenant launch without disrupting Doppelmayr India's operations:

### Phase 1: Security & Multi-Tenancy Hardening
1. Patch `PATCH /api/admin/users/[userId]` to strictly scope target lookup and update by `orgId`.
2. Patch `GET /api/analytics/software` to scope user queries and metrics to `orgId`.
3. Fix background crons (`/api/cron/announcements`, `/api/cron/birthday`, `/api/cron/onboarding`) to isolate notifications by organization.
4. Sanitize search regex input in `/api/search` to protect against ReDoS and syntax errors.

### Phase 2: Registration & Core Tenant Creation Fix
1. Fix `web/models/Employee.ts`: Change hook from `pre('save')` to `pre('validate')` so auto-generated `employeeId` is populated before validation; or compute `employeeId` explicitly during creation.
2. Fix `web/app/api/auth/register/route.ts`: Align `privileges` enum values with `PrivilegesSchema` (`premium`, `ac_premium`, `business`).
3. Add compensation / transaction logic to clean up partial records if registration encounters an error.
4. Create the missing `web/app/(auth)/sign-up/page.tsx` for web registration parity.

### Phase 3: Employee Invitation & Onboarding Architecture
1. Design an `Invitation` schema (email, `orgId`, role, token, expiresAt).
2. Create `POST /api/admin/invitations` and `POST /api/auth/accept-invite`.
3. Implement invitation UI sheets in both Web and Mobile.

### Phase 4: Branding Neutralization for Public Tenants
1. Make public contact cards (`/contact/[token]`) dynamically display the organization's own name and logo from `OrgSettings` rather than hardcoded "Doppelmayr India".
2. Update the mobile app launcher icon and splash assets to use neutral DoppelDash branding instead of the Doppelmayr ropeway logo.

### Phase 5: Free / Paid Plan Foundation
1. Introduce `plan` (`free`, `pro`, `enterprise`) and `seatLimit` into `OrgSettings`.
2. Implement centralized permission/entitlement guards on backend API routes.
