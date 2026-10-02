# Google Play Store Asset & Metadata Checklist

**Application**: DoppelDash  
**Application ID**: `com.doppeldash.app`  
**Target Release**: Google Play Internal & Closed Testing  
**Status**: Store-Ready (Pending Console Entry)  

---

## 1. Graphic Assets

| Asset Type | Dimension / Specs | File Location | Status |
|---|---|---|---|
| **App Icon** | 512 × 512 px, 32-bit PNG, max 1MB, no transparency | `assets/branding/icon-512.png` | **Ready** |
| **High-Res Icon (Console)** | 1024 × 1024 px, 32-bit PNG | `assets/branding/icon-1024.png` | **Ready** |
| **Feature Graphic** | 1024 × 500 px, JPG or 24-bit PNG (no alpha) | `docs/assets/feature_graphic_1024x500.png` | **Ready** |
| **Screenshots (Phone)** | Min 2, Max 8 per form factor (1080 × 2400 recommended) | Story documented in Section 3 | **Ready** |

---

## 2. Store Listing Copy

### App Name (max 30 characters)
```text
DoppelDash
```

### Short Description (max 80 characters)
```text
Unified enterprise CRM, travel, expense tracking, leave, and team operations.
```

### Full Description (max 4,000 characters)
```text
DoppelDash is the all-in-one operations, customer relationship management (CRM), and workforce toolsuite built for modern organizations, field teams, and expanding enterprises.

Designed for agility, speed, and privacy, DoppelDash streamlines day-to-day administrative overhead into a single, intuitive mobile platform:

• MODERN CRM & CLIENT PIPELINE
Manage client profiles, prospect interactions, and contact timelines on the go. Digitize business cards in seconds with on-device camera OCR scanning. Share contact cards seamlessly across your team.

• EXPENSE MANAGEMENT & RECEIPT SCANNING
Capture expense receipts instantly using camera OCR. Submit reimbursement claims with categorical breakdown (Food, Hotel, Taxi, Travel), track approval statuses in real time, and eliminate lost paperwork.

• TRAVEL REQUESTS & ITINERARIES
Plan corporate travel with structured multi-leg itineraries. Submit travel authorization requests to managers, receive instant status updates, and auto-generate linked reimbursement claims upon return.

• LEAVE MANAGEMENT & WORKPLACE CALENDARS
View real-time leave balances (Casual, Sick, Privilege), submit time-off requests, track approval workflows, and synchronize with national and organizational holiday calendars.

• SECURE ANNOUNCEMENTS & TEAM DIRECTORY
Keep your entire organization connected with targeted broadcast announcements, priority pinned bulletins, and a searchable employee directory with verified roles and designations.

• ENTERPRISE-GRADE SECURITY & PRIVACY
Protected with end-to-end TLS 1.3 transit encryption, AES-256 field-level encryption for sensitive contact records, multi-tenant isolation, optional TOTP two-factor authentication, and biometrics.

• FLEXIBLE PLANS & WORKSPACE MANAGEMENT
Register your company workspace directly from the app. Enjoy our full standard feature set with our Free tier, or upgrade your organization to Premium via Google Play Billing for expanded member capacity, high-volume CRM storage, and mass communications.

Transform how your company operates with DoppelDash.
```

---

## 3. Store Screenshot Story & Specifications

**Recommended Dimensions**: 1080 × 2400 (aspect ratio 9:20 or 9:16, min 1080px along shortest side).  
**Minimum Required**: 2 phone screenshots.  
**Recommended Story (8 Screens)**:

1. **Screen 1 — Welcome & Authentication**:
   - Visual: DoppelDash splash branding & secure sign-in with biometrics.
   - Caption: *Enterprise Operations & Modern CRM at Your Fingertips*
2. **Screen 2 — Executive Dashboard**:
   - Visual: KPI cards (Active Leaves, Pending Expenses, CRM Leads, Recent Updates).
   - Caption: *Real-Time Organizational Health at a Glance*
3. **Screen 3 — Contact & CRM Pipeline**:
   - Visual: Contact cards with tags, phone/email shortcuts, and timeline notes.
   - Caption: *Manage Client Relationships & Interactions Effortlessly*
4. **Screen 4 — Business Card Camera OCR**:
   - Visual: Camera scanner interface extracting contact details from a card.
   - Caption: *Digitize Business Cards in Seconds with AI Scanning*
5. **Screen 5 — Travel Planning & Itineraries**:
   - Visual: Multi-leg travel requests with status badges (Approved, Pending).
   - Caption: *Plan Trips & Authorize Business Travel Seamlessly*
6. **Screen 6 — Expense Claims & Reimbursements**:
   - Visual: Categorized expense list with receipts and approval audit trail.
   - Caption: *Track Reimbursements with Instant Receipt Capture*
7. **Screen 7 — Leave Balances & Company Calendar**:
   - Visual: Interactive leave calendar, holiday list, and balance tracker.
   - Caption: *Transparent Leave Approvals & Public Holidays*
8. **Screen 8 — Organization Settings & Premium Plan**:
   - Visual: Workspace management, role privileges, and Google Play subscription tier.
   - Caption: *Scale Your Workspace with Powerful Premium Capabilities*

*Screenshot demo data guidelines: Use only realistic synthetic names, mock company domains (`@acme.example`), and placeholder contact numbers. Never capture real internal company employee PII.*

---

## 4. Store URLs & Policy Links

The canonical DoppelDash web backend is deployed on Netlify at `https://doppeldash-crm.netlify.app`. The canonical public routes are:

| Policy Requirement | Relative Path | Canonical Production URL |
|---|---|---|
| **Privacy Policy URL** | `/privacy` | `https://doppeldash-crm.netlify.app/privacy` |
| **Terms of Service URL** | `/terms` | `https://doppeldash-crm.netlify.app/terms` |
| **Support URL** | `/support` | `https://doppeldash-crm.netlify.app/support` |
| **Account Deletion URL** | `/delete-account` | `https://doppeldash-crm.netlify.app/delete-account` |

*Note: All four routes are public, statically generated in Next.js, and exempt from authentication middleware.*

---

## 5. Contact Information

- **Support Email**: `<configured Gmail>` (Provided via `NEXT_PUBLIC_SUPPORT_EMAIL` in Netlify site environment variables and registered in Google Play Console Account Settings).
- **Website**: `https://doppeldash-crm.netlify.app`
- **Developer Name**: DoppelDash Technologies
- **Physical Address**: (Enter your registered business or developer address as configured in your Google Play Console Developer Account).

---

## 6. App Access & Reviewer Instructions

For Google Play App Review:
- **Credentials Required**: Yes
- **Reviewer Instructions**:
  ```text
  DoppelDash is a multi-tenant business productivity application.
  Reviewers can test the application using one of the following methods:
  
  Method A (Instant Self-Service Registration):
  1. Open the application.
  2. Tap "Create CRM" on the login screen.
  3. Register a test organization workspace (e.g., "Google Play QA Team", valid email, password).
  4. The test workspace is created instantly with full administrative privileges to review all features (CRM, Leaves, Expenses, Travel, Settings).

  Method B (Pre-provisioned Demo Account):
  - Email: reviewer@doppeldash.app (or test account provided in Console)
  - 2FA/OTP: If prompted for email verification code in test mode, the verification screen accepts standard test OTP: 123456.
  ```

---

## 7. Declarations & Questionnaire Responses

### Content Rating (IARC)
- **Category**: Productivity / Business Utility
- **Violence, Sexual Content, Controlled Substances**: None (No)
- **User-Generated Content**: Yes (Workplace contacts and notes, restricted to authenticated organizational members)
- **Expected Rating**: Everyone (PEGI 3, USK 0, ESRB Everyone)

### Target Audience & Content
- **Target Age**: 18 and older (Workplace productivity)
- **Children's Online Privacy Protection (COPPA)**: Not designed for children under 13.

### Ads Declaration
- **Contains Ads**: **No** (DoppelDash contains zero third-party advertisements or advertising SDKs).

### Financial Features Declaration
- **Financial Features**: **Reimbursement & Corporate Expense Reporting**.
- **Declaration**: DoppelDash provides organizational expense management and reimbursement workflow tracking for corporate employees. It does not provide banking, loans, or consumer financial services. In-app subscription payments for software access are handled exclusively through Google Play Billing.

### Data Safety Form Declarations

| Data Type | Collected | Shared with Third Parties | Purpose | Ephemeral / Stored | Can User Request Deletion? |
|---|---|---|---|---|---|
| **Name** | Yes | No | App functionality, Account management | Stored | **Yes** (In-app + External URL) |
| **Email Address** | Yes | No | Account management, Authentication, Security | Stored | **Yes** (In-app + External URL) |
| **User IDs** | Yes | No | Account management | Stored | **Yes** |
| **Phone Number** | Optional | No | Account management, Directory | Stored | **Yes** |
| **Photos / Receipt Images** | Yes | No | Expense reimbursement documentation | Stored | **Yes** (Expense deletion) |
| **Contacts** | Yes | No | User-entered CRM client directory | Stored | **Yes** |
| **Purchase History** | Yes | No | Google Play subscription verification | Stored | **Yes** |
| **Device or other IDs** | Yes | No | Security audit log & fraud prevention | Stored | **Yes** |

- **Encryption**: All data is encrypted in transit via HTTPS / TLS.
- **Account Deletion Link**: `https://<DEPLOYMENT-URL>/delete-account`

### Device Permissions Declaration

| Permission | Android API Usage | Justification for Reviewer |
|---|---|---|
| `android.permission.INTERNET` | All versions | Sync with cloud database and authenticate user |
| `android.permission.CAMERA` | Optional feature | Scan business cards for CRM and capture expense receipts |
| `android.permission.USE_BIOMETRIC` | Android 9+ | Allow user to securely unlock app with local fingerprint/face |
| `android.permission.READ_MEDIA_IMAGES` | Android 13+ | Select receipt photos from gallery for expense submission |
| `android.permission.READ_EXTERNAL_STORAGE` | `maxSdkVersion="32"` | Legacy photo selection for receipts on Android 12 and below |
