import React from 'react'
import Link from 'next/link'
import { Shield, Lock, ArrowLeft, Eye, Server, UserCheck, AlertCircle } from 'lucide-react'

export const metadata = {
  title: 'Privacy Policy | DoppelDash — Doppelmayr India',
  description: 'Privacy policy and data governance for DoppelDash enterprise application.',
}

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-blue-600 selection:text-white pb-20">
      {/* Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/50 backdrop-blur sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition">
            <ArrowLeft className="w-4 h-4" /> Back to DoppelDash
          </Link>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-500" />
            <span className="font-semibold text-slate-200">Privacy Policy</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 pt-12">
        <div className="mb-10 text-center sm:text-left">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium mb-4">
            <Lock className="w-3.5 h-3.5" /> Doppelmayr India Enterprise Data Policy
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-2">
            DoppelDash Privacy Policy
          </h1>
          <p className="text-slate-400 text-sm">
            Effective Date: September 1, 2026 • Last updated: September 1, 2026
          </p>
        </div>

        <div className="space-y-10 text-slate-300 text-sm leading-relaxed">
          {/* Section 1 */}
          <section className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Eye className="w-5 h-5 text-blue-400" /> 1. Overview and Scope
            </h2>
            <p>
              DoppelDash is an internal operations, enterprise resource management, and workforce automation portal operated by <strong>Doppelmayr India</strong>. This Privacy Policy governs data collected through both the web platform (<code className="text-blue-300 bg-slate-800 px-1.5 py-0.5 rounded">doppeldash.com</code>) and the DoppelDash mobile application for Android.
            </p>
            <p>
              DoppelDash is intended strictly for authorized employees, contractors, managers, and administrators of Doppelmayr India.
            </p>
          </section>

          {/* Section 2 */}
          <section className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Server className="w-5 h-5 text-blue-400" /> 2. Information We Collect
            </h2>
            <ul className="list-disc pl-5 space-y-2 text-slate-300">
              <li>
                <strong>Identity & Authentication:</strong> Name, work email address, department, designation, employee ID, phone number, and password hashes / TOTP two-factor secret keys.
              </li>
              <li>
                <strong>Operational & HR Records:</strong> Leave applications, expense claims and uploaded receipt images, business travel requests, project milestones, and company announcements.
              </li>
              <li>
                <strong>CRM & Business Cards:</strong> Client contact information, contact notes, and OCR-extracted data from business cards scanned using the mobile camera.
              </li>
              <li>
                <strong>Device & Biometrics:</strong> Biometric authentication (Fingerprint / Face ID) is processed locally on-device by Android BiometricPrompt and is never transmitted to or stored on our servers.
              </li>
              <li>
                <strong>Audit & Security Logs:</strong> IP address, timestamp, action type, and user agent for administrative actions to ensure compliance and prevent unauthorized access.
              </li>
            </ul>
          </section>

          {/* Section 3 */}
          <section className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Lock className="w-5 h-5 text-blue-400" /> 3. How We Use and Protect Your Data
            </h2>
            <p>We process enterprise data strictly to:</p>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-300">
              <li>Authenticate authorized personnel and enforce role-based access control (RBAC).</li>
              <li>Facilitate managerial leave approvals, expense reimbursements, and travel authorisations.</li>
              <li>Deliver push notifications and organizational announcements.</li>
              <li>Provide IMAP/SMTP email synchronisation for approved internal communications.</li>
            </ul>
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 mt-4 text-xs text-blue-300">
              <strong>Security Standards:</strong> All data in transit is encrypted using TLS 1.3. Sensitive tokens and credentials stored on mobile devices utilize AES-256 GCM encrypted shared preferences backed by hardware Keystore.
            </div>
          </section>

          {/* Section 4 */}
          <section className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-blue-400" /> 4. Data Sharing & Third Parties
            </h2>
            <p>
              We do <strong>not</strong> sell, rent, or monetize employee or corporate data. Data is shared exclusively with verified operational infrastructure providers:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-300">
              <li><strong>Cloud Storage:</strong> Encrypted cloud storage for uploaded receipts and document attachments.</li>
              <li><strong>Email Delivery:</strong> Enterprise SMTP servers (e.g. Office 365) configured by your organization.</li>
              <li><strong>Push Notifications:</strong> Google Firebase Cloud Messaging (FCM) for operational alerts.</li>
            </ul>
          </section>

          {/* Section 5 */}
          <section className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-blue-400" /> 5. Data Retention & Account Deletion
            </h2>
            <p>
              Employee data is retained for the duration of the employee&apos;s active engagement with Doppelmayr India and in accordance with applicable statutory employment and tax laws.
            </p>
            <p>
              To request account deletion, data extraction, or access log inspection, please contact your organization administrator or write to <a href="mailto:privacy@doppelmayr.com" className="text-blue-400 hover:underline">privacy@doppelmayr.com</a>.
            </p>
          </section>

          {/* Contact Footer */}
          <div className="pt-6 border-t border-slate-800 text-center text-xs text-slate-500">
            © {new Date().getFullYear()} Doppelmayr India • DoppelDash Enterprise Operations • All rights reserved.
          </div>
        </div>
      </main>
    </div>
  )
}
