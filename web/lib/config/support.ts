/**
 * Centralized Public Support Configuration for DoppelDash
 * 
 * Supports initial free Gmail workflow without breaking production or requiring paid domain/SMTP.
 * Configured via NEXT_PUBLIC_SUPPORT_EMAIL environment variable.
 */

export const UNCONFIGURED_SUPPORT_GMAIL = '__REQUIRED_SET_SUPPORT_GMAIL_IN_ENV__'

const envEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim()

export const SUPPORT_CONFIG = {
  // Public contact / support configuration
  rawEmail: envEmail || UNCONFIGURED_SUPPORT_GMAIL,
  isConfigured: Boolean(envEmail && envEmail !== UNCONFIGURED_SUPPORT_GMAIL && envEmail.includes('@')),
  
  get supportEmail(): string {
    return this.isConfigured ? envEmail! : UNCONFIGURED_SUPPORT_GMAIL
  },
  
  // Display details
  brandName: 'DoppelDash',
  brandTagline: 'Modern Operations, Travel, Expenses & CRM Platform',
  developerName: 'DoppelDash Technologies',
  
  // Public store policy endpoints
  routes: {
    privacy: '/privacy',
    terms: '/terms',
    support: '/support',
    deleteAccount: '/delete-account',
  },
} as const

/**
 * Pre-deployment verification check.
 * Throws if NEXT_PUBLIC_SUPPORT_EMAIL is unconfigured or invalid.
 */
export function assertSupportEmailConfigured(): void {
  if (!SUPPORT_CONFIG.isConfigured) {
    throw new Error(
      `[Play Launch Configuration Error] NEXT_PUBLIC_SUPPORT_EMAIL is unconfigured. ` +
      `Set NEXT_PUBLIC_SUPPORT_EMAIL=<your-designated-gmail> in your Netlify deployment environment variables before deploying to production.`
    )
  }
}
