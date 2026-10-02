# DoppelDash Google Play Launch Mode Audit Report

**Date of Audit**: October 2, 2026  
**Auditor**: Antigravity Autonomous Engineering Agent  
**Target**: Google Play Internal/Closed Testing Readiness  
**Web & Backend Repository**: `/home/harsh-pandhe/GitHub/DoppelDash`  
**Android / Flutter Repository**: `/home/harsh-pandhe/GitHub/DoppelDash-mobile`  
**Target Build Artifact**: `build/app/outputs/bundle/release/app-release.aab`  

---

## 1. Executive Summary

This audit assesses the readiness of the DoppelDash Android application for Google Play Console submission and internal/closed testing tracks. 

The application compiles cleanly with Flutter 3.44.7 / Dart 3.12.2 and Gradle 9.1.0, and a release Android App Bundle (AAB) was successfully compiled (`build/app/outputs/bundle/release/app-release.aab`, 59.5 MB). All 160 Flutter unit, repository, and widget tests pass, and `flutter analyze` reports zero errors or warnings.

However, several critical blocking and readiness issues were identified across branding, configuration, store compliance, and public endpoints that must be resolved prior to store submission.

---

## 2. Technical Audit Checklist (19 Points)

| # | Inspection Item | Current State | Audit Evaluation |
|---|---|---|---|
| **1** | **Package / Application ID** | `com.doppelmayr.doppeldash_mobile` | Stable across `build.gradle.kts` and `MainActivity.kt`. **Note:** Mismatch in `lib/core/config/billing_config.dart` where `packageName` was hardcoded to `com.doppeldash.app`. |
| **2** | **Target SDK Version** | API 36 | Configured via `flutter.targetSdkVersion` (defaults to 36 in Flutter 3.44.7). Meets Google Play 2025/2026 requirements (API 35+ required). |
| **3** | **Compile SDK Version** | API 37 | Explicitly configured in `android/app/build.gradle.kts` (required for `flutter_secure_storage`). |
| **4** | **Min SDK Version** | API 24 | Configured via `flutter.minSdkVersion` (defaults to 24 in Flutter 3.44.7). Supports Android 7.0+. |
| **5** | **Version Name** | `1.0.0` | Sourced from `pubspec.yaml` (`1.0.0+1`). |
| **6** | **Version Code** | `1` | Sourced from `pubspec.yaml` (`1.0.0+1`). |
| **7** | **Production API URL** | `https://doppeldash-crm.netlify.app/api` | Enforces HTTPS. Configured in `lib/data/services/api_config.dart` with `--dart-define=API_BASE_URL` override support. |
| **8** | **Release/Debug Configuration** | Gradle release signing configured | `buildTypes.release` signs with `signingConfigs.release` when `key.properties` is present. |
| **9** | **Signing Configuration** | Configured with local upload key | `android/key.properties` references `android/app/upload-keystore.jks` with alias `upload`. |
| **10** | **Firebase Configuration** | Not configured | App does not depend on `firebase_core` or `firebase_messaging`. No `google-services.json` required. |
| **11** | **Google Play Billing Configuration** | `in_app_purchase: ^3.3.1` | Product ID: `doppeldash_premium_monthly`. Server-side validation via `POST /api/billing/play/verify`. Deep link URL needed fix for package ID. |
| **12** | **App Name** | `DoppelDash` | Configured in `AndroidManifest.xml` (`android:label`), `lib/app.dart`, and `pubspec.yaml`. |
| **13** | **Launcher Icon** | Old Doppelmayr icon (`#0057A8`) | Currently generated from `assets/branding/icon-512.png` which depicts Doppelmayr branding. **Must be updated** to the new DoppelDash brand icon. |
| **14** | **Splash Screen** | Plain white (`@android:color/white`) | `launch_background.xml` has no logo or branding centered. Needs branded dark navy / modern splash. |
| **15** | **Public-Facing Branding** | Dual brand confusion | Primary color in `theme.dart` was `0xFF0057A8` (Doppelmayr blue). Needs alignment with DoppelDash SaaS identity (dark navy base + cyan/blue accent). |
| **16** | **Internal Branding Leakage** | Asset & Legal leaks | Old `icon-512.png` appears on Auth sign-in screen and Settings. `assets/branding/doppelmayr-logo.svg` in asset bundle. Web `/privacy` and `/terms` explicitly stated restricted use for Doppelmayr India. |
| **17** | **Debug Logging & Test Endpoints** | Gated / None | Zero `print()` or `debugPrint` calls in `lib/`. No test credentials stored. |
| **18** | **HTTP / Non-HTTPS Endpoints** | Strictly HTTPS | `network_security_config.xml` enforces HTTPS default, cleartext allowed only for localhost/10.0.2.2 emulator debugging. |
| **19** | **Release Build Generation** | Verified Successful | `flutter build appbundle --release` produced `app-release.aab` (59.5 MB) cleanly. |

---

## 3. Blocking Issues for Google Play Launch

1. **Brand Asset Leakage in Launcher & In-App UI**:
   - The launcher icon and the in-app logo rendered in `SignInView` and `SettingsView` use `assets/branding/icon-512.png`, which is the old Doppelmayr logo on `#0057A8`.
   - **Resolution**: Replace `assets/branding/icon-512.png` with the official DoppelDash icon (1024x1024 deep navy with electric cyan/blue glyph) and re-run `flutter_launcher_icons`.
2. **Package Name Mismatch in Billing Deep Link**:
   - `lib/core/config/billing_config.dart` specifies `packageName = 'com.doppeldash.app'`, whereas the real Android application ID is `com.doppelmayr.doppeldash_mobile`.
   - **Resolution**: Fix `packageName` in `billing_config.dart`.
3. **Missing Public Support & Account Deletion Pages**:
   - Google Play policy requires a publicly accessible Account Deletion URL and Support contact URL.
   - Currently, `/support` and `/delete-account` do not exist on the web backend, and `web/middleware.ts` intercepts non-authenticated requests to those paths.
   - **Resolution**: Implement `/privacy`, `/terms`, `/support`, and `/delete-account` public pages in `web/app/` with clean DoppelDash branding and register them in `PUBLIC_EXACT` in `middleware.ts`.
4. **Self-Service Account Deletion Flow**:
   - Google Play requires users to be able to request or execute account deletion from both within the app and via a public URL.
   - **Resolution**: Implement `DELETE /api/user/account` backend endpoint handling tenant/member isolation and add in-app deletion UI in mobile settings.
5. **Support Email Centralization**:
   - Hardcoded internal emails (`harsh.pandhe@doppelmayr.com`, `IT-NaviMumbai@doppelmayr.com`, `privacy@doppelmayr.com`) were scattered across the codebase.
   - **Resolution**: Centralize public contact email to `DoppelDash support Gmail` placeholder configuration, easily updatable to `support@doppeldash.app`.

---

## 4. Non-Blocking Issues / Post-Launch Roadmap

- Purchase of custom domain `doppeldash.app`.
- Google Play Developer API service account credentials for real-time server-to-server RTDN verification in production.
- Migration from Gmail relay to dedicated SMTP infrastructure (`@doppeldash.app`).
- Firebase Cloud Messaging (FCM) integration for push notifications (currently uses polling/webhooks).
- Advanced automated screenshot capture pipeline.

---

## 5. Verification Commands and Baseline Results

```bash
# Flutter release bundle build
cd /home/harsh-pandhe/GitHub/DoppelDash-mobile && flutter build appbundle --release
# Result: ✓ Built build/app/outputs/bundle/release/app-release.aab (59.5MB) [Exit: 0]

# Flutter test suite
cd /home/harsh-pandhe/GitHub/DoppelDash-mobile && flutter test
# Result: 00:10 +160: All tests passed! [Exit: 0]

# Flutter static analysis
cd /home/harsh-pandhe/GitHub/DoppelDash-mobile && flutter analyze
# Result: No issues found! [Exit: 0]

# Web TypeScript compilation
cd /home/harsh-pandhe/GitHub/DoppelDash/web && npx tsc --noEmit
# Result: Exit 0 (Zero type errors)

# Web Linting
cd /home/harsh-pandhe/GitHub/DoppelDash/web && npm run lint
# Result: Exit 0 (Zero errors, minor next/image warnings)

# Web Production Build
cd /home/harsh-pandhe/GitHub/DoppelDash/web && npm run build
# Result: ✓ Generating static pages (100/100), Exit 0
```
