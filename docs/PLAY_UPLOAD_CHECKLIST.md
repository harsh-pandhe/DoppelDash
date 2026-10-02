# DoppelDash — Google Play Upload & Release Checklist

This document details the exact 28 sequential steps to upload, configure, and release the DoppelDash Android application on the Google Play Console for Internal and Closed Testing.

---

### Step-by-Step Release Procedure

#### 1. Confirm Package ID
- **Final Application ID**: `com.doppeldash.app`
- **Status**: Completely and consistently configured across `build.gradle.kts`, `MainActivity.kt` (`com.doppeldash.app`), and billing configurations.
- **Rule**: When creating the application record in Google Play Console, ensure `com.doppeldash.app` is the designated package name.

#### 2. Deploy Web Backend to Netlify
- The web backend is deployed on Netlify at `https://doppeldash-crm.netlify.app`.
- Trigger production deployment via Git push to your repository's connected `main` branch:
  ```bash
  git push origin main
  ```

#### 3. Verify Privacy URL
- Open in a public browser: `https://doppeldash-crm.netlify.app/privacy`
- Verify HTTP 200, proper styling, no broken links, and that contact info matches your chosen channel.

#### 4. Verify Account Deletion URL
- Open in a public browser: `https://doppeldash-crm.netlify.app/delete-account`
- Verify that it clearly details the in-app deletion path (**Settings → Account → Delete Account**) and provides the external email request procedure.

#### 5. Verify Support URL
- Open in a public browser: `https://doppeldash-crm.netlify.app/support`
- Verify FAQ answers, Google Play subscription management link, and support instructions.

#### 6. Set Support Gmail in Netlify
- Set your designated Gmail address in your Netlify site environment variables:
  - **Netlify Dashboard** → Select site **doppeldash-crm** → **Site configuration** → **Environment variables** → **Add a variable**
  - Key: `NEXT_PUBLIC_SUPPORT_EMAIL`
  - Value: `<your-actual-support-gmail>`
  - Scope: All deploy contexts (Production)
- Trigger a redeploy (**Deploys** → **Trigger deploy** → **Clear cache and deploy site**).
- Deploy web so that `/privacy`, `/terms`, `/support`, and `/delete-account` display your live contact address.

#### 7. Create Play App
- Log in to [Google Play Console](https://play.google.com/console).
- Click **Create app**.
- **App name**: `DoppelDash`
- **Default language**: `English (United States)`
- **App or game**: `App`
- **Free or paid**: `Free` (Monetized via Google Play In-app Subscriptions).
- Accept the Developer Program Policies and US Export Laws, then click **Create app**.

#### 8. Store Listing
- Navigate to **Grow → Store presence → Main store listing**.

#### 9. App Icon
- Upload [icon-512.png](file:///home/harsh-pandhe/GitHub/DoppelDash-mobile/assets/branding/icon-512.png):
  - Dimensions: **512 × 512 px**
  - Format: 24-bit PNG without alpha channel (verified).

#### 10. Feature Graphic
- Upload [feature_graphic_1024x500.png](file:///home/harsh-pandhe/GitHub/DoppelDash-mobile/docs/assets/feature_graphic_1024x500.png):
  - Dimensions: **1024 × 500 px**
  - Format: PNG without alpha channel (verified).

#### 11. Screenshots
- Upload phone screenshots (minimum 2, recommended 7):
  1. *Welcome & Mobile Sign In*
  2. *Operational Dashboard & KPIs*
  3. *Employee Directory & Team*
  4. *CRM Contacts & Pipeline*
  5. *Reimbursement Claims & Receipts*
  6. *Travel Requests & Itineraries*
  7. *Leave Management & Organization Settings*
- Required dimensions: 16:9 or 9:16 aspect ratio (e.g., 1080 × 2400 px), PNG or JPEG.

#### 12. App Description
- **Short description** (up to 80 chars):
  `Streamline operations, CRM, employee directory, leave, travel, and expenses.`
- **Full description**:
  Copy the comprehensive description from [docs/PLAY_STORE_ASSETS.md](file:///home/harsh-pandhe/GitHub/DoppelDash/docs/PLAY_STORE_ASSETS.md).

#### 13. Privacy Policy URL
- In **Policy and programs → App content → Privacy policy**:
- Enter: `https://doppeldash-crm.netlify.app/privacy`

#### 14. App Access / Reviewer Credentials
- In **Policy and programs → App content → App access**:
- Select **All or some functionality is restricted**.
- Click **Add instructions**:
  - **Title**: `DoppelDash Demo Workspace`
  - **Username/Email**: `doppeldash.playreview@gmail.com`
  - **Password**: `<PASSWORD>`
  - **Instructions**:
    ```text
    Sign in with:
    Email: doppeldash.playreview@gmail.com
    Password: <PASSWORD>

    If prompted for OTP / verification code on the second screen, enter: 112022.
    Reviewer account has full administrative privileges and an active Premium subscription in "DoppelDash Demo" to review all features (CRM, LMS, RMS, Travel, Settings).
    ```

#### 15. Data Safety Form
- In **Policy and programs → App content → Data safety**:
- **Data Collection**: Yes (Name, Email, Job Title/Department, Expense receipts/photos, Device ID).
- **Data Sharing**: No third-party data sharing.
- **Security Practices**:
  - Data is encrypted in transit over HTTPS (TLS 1.3).
  - Users can request deletion of their data.
  - Deletion link: `https://doppeldash-crm.netlify.app/delete-account`.

#### 16. Content Rating
- In **Policy and programs → App content → Content rating**:
- Complete the IARC questionnaire:
  - Category: `Enterprise / Productivity / Utility`
  - Violence/Sex/Gambling: `None / No`
  - Result: **Everyone / PEGI 3**.

#### 17. Ads Declaration
- In **Policy and programs → App content → Ads**:
- Select: **No, my app does not contain ads**.

#### 18. Target Audience
- In **Policy and programs → App content → Target audience and content**:
- Target age group: **18 and over**.
- Appeal to children: **No**.

#### 19. Permissions Declarations
- In **Policy and programs → App content**:
- `READ_EXTERNAL_STORAGE` is scoped with `android:maxSdkVersion="32"`.
- Camera and Notifications are declared for expense receipt capture and workflow alerts.

#### 20. Create Internal Testing Track
- Navigate to **Testing → Internal testing**.
- Click **Create new release**.

#### 21. Upload AAB
- Drag and drop:
  `DoppelDash-mobile/build/app/outputs/bundle/release/app-release.aab`
- Verify Play Console parses:
  - Version: `1.0.0 (1)`
  - Target SDK: `36`
  - Min SDK: `24`
- Enter Release notes:
  `Initial release for DoppelDash testing: enterprise operations, CRM, expenses, and leave management.`
- Save and review release.

#### 22. Add Tester
- Under **Internal testing → Testers**:
- Create or select an email list containing your Google Play tester account.
- Copy the **Join on Android** or **Join on the web** opt-in URL.

#### 23. Install from Play
- Open the opt-in URL on your Android test device.
- Accept the internal testing invite and install DoppelDash directly from the Play Store.

#### 24. Run Release Smoke Test
- Verify:
  1. Cold app launch into dark navy splash screen.
  2. Sign in with valid credentials.
  3. Explore Dashboard KPIs.
  4. Create a test Contact in CRM.
  5. Submit a sample Reimbursement Expense.
  6. Submit a sample Leave Request.
  7. Check Settings & Organization info.
  8. Test "Forgot password?" flow.
  9. Test "Delete Account" flow on a disposable testing account.
  10. Log out and verify clean session clearing.

#### 25. Fix Any Play / Pre-Launch Issues
- Review the Google Play Pre-Launch Report (automatically generated by Google's Robo test suite on uploaded AABs) for any crash or ANR reports across multiple device configurations.

#### 26. Create Closed Testing Track
- Once internal testing verifies clean performance, navigate to **Testing → Closed testing**.
- Create a new closed testing track (e.g. `Alpha` or `Closed Beta`).

#### 27. Add 12+ Testers
- Under **Closed testing → Testers**:
- Add at least 12 (or 20 for individual developer accounts subject to the 14-day policy) tester Google accounts.

#### 28. Begin the Required Closed-Test Period
- Roll out the release to the Closed Testing track.
- Maintain active tester opt-in and feedback across the continuous 14-day period required before applying for Production access.
