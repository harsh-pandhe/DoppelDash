import React from 'react'
import Link from 'next/link'
import { Shield, Lock, ArrowLeft, Eye, Server, Trash2, Mail } from 'lucide-react'
import { SUPPORT_CONFIG } from '@/lib/config/support'

export const metadata = {
  title: 'Privacy Policy | DoppelDash',
  description: 'Privacy policy and data governance for DoppelDash mobile application and platform.',
}

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-sky-600 selection:text-white pb-20">
      {/* Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/50 backdrop-blur sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition">
            <ArrowLeft className="w-4 h-4" /> Back to DoppelDash
          </Link>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-sky-400" />
            <span className="font-semibold text-slate-200">Privacy Policy</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 pt-12">
        <div className="mb-10 text-center sm:text-left">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-medium mb-4">
            <Lock className="w-3.5 h-3.5" /> DoppelDash Data Governance & Protection
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-2">
            DoppelDash Privacy Policy
          </h1>
          <p className="text-slate-400 text-sm">
            Effective Date: October 1, 2026 • Last updated: October 2, 2026
          </p>
        </div>

        <div className="space-y-8 text-slate-300 text-sm leading-relaxed">
          {/* Section 1 */}
          <section className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Eye className="w-5 h-5 text-sky-400" /> 1. Overview and Scope
            </h2>
            <p>
              DoppelDash (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) provides unified organizational operations, modern customer relationship management (CRM), travel management, receipt reimbursements, team communications, and administrative services via our Android mobile application and web portal.
            </p>
            <p>
              This Privacy Policy explains how we collect, process, store, and protect user data when you use the DoppelDash mobile application or register an organization workspace. We are committed to transparency, compliance with the Digital Personal Data Protection (DPDP) Act, GDPR, and Google Play Store Developer policies.
            </p>
          </section>

          {/* Section 2 */}
          <section className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Server className="w-5 h-5 text-sky-400" /> 2. Information We Collect
            </h2>
            <ul className="list-disc pl-5 space-y-2 text-slate-300">
              <li>
                <strong>Account & Profile Information:</strong> Name, work email address, phone number, designated company/organization, department, designation, and password hashes (bcrypt hashed).
              </li>
              <li>
                <strong>Operational & CRM Data:</strong> Contact lists, company client entries, notes, interaction timelines, and business card OCR text captured at your instruction.
              </li>
              <li>
                <strong>Expense & Travel Data:</strong> Travel request details (dates, destinations, estimated costs), expense reimbursement claims, amounts, categories, and uploaded receipt images.
              </li>
              <li>
                <strong>Device & Security Tokens:</strong> Biometric authentication state (processed strictly on-device via Android BiometricPrompt and Keystore; raw biometric fingerprints or face data are never transmitted or stored on our servers), session tokens, and IP addresses for audit log compliance.
              </li>
            </ul>
          </section>

          {/* Section 3 */}
          <section className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Lock className="w-5 h-5 text-sky-400" /> 3. Data Protection and Security
            </h2>
            <p>
              All communication between the Android application and our backend endpoints is encrypted in transit using industry-standard TLS / HTTPS (TLS 1.3). Sensitive contact fields and tokens are protected using AES-256 field-level encryption at rest. Multi-tenant isolation ensures data belonging to your organization is inaccessible to other tenants.
            </p>
          </section>

          {/* Section 4 */}
          <section className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-sky-400" /> 4. Data Retention and Account Deletion
            </h2>
            <p>
              You have the right to request deletion of your account and personal data at any time. We provide an automated self-service account deletion mechanism directly in the DoppelDash Android app (Settings &rarr; Account &rarr; Delete Account) as well as an external account deletion request procedure at <Link href="/delete-account" className="text-sky-400 hover:underline">/delete-account</Link>.
            </p>
            <p>
              Upon account deletion, your user credentials, personal employee profile, leave balances, and authentication tokens are immediately and permanently purged. Financial and approval records (such as approved company expense claims) may be retained in anonymized form strictly to satisfy statutory accounting and tax regulations.
            </p>
          </section>

          {/* Section 5 */}
          <section className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Mail className="w-5 h-5 text-sky-400" /> 5. Contact Information & Privacy Queries
            </h2>
            <p>
              If you have any questions, concerns, or requests regarding this Privacy Policy or your personal information, please contact our support team at:
            </p>
            {SUPPORT_CONFIG.isConfigured ? (
              <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 font-mono text-sm text-sky-300">
                {SUPPORT_CONFIG.supportEmail}
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-400">
                Contact information is published in our official Google Play Store developer listing and available in-app via Settings.
              </div>
            )}
            <p className="text-xs text-slate-400">
              For support inquiries, you can also visit our <Link href="/support" className="text-sky-400 hover:underline">Support Center</Link>.
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
