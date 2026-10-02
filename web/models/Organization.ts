import mongoose, { Schema, Document, Model } from 'mongoose'
import crypto from 'crypto'

export type PlanType = 'free' | 'premium'
export type EntitlementSource = 'none' | 'subscription' | 'lifetime_grant'
export type SubscriptionStatus =
  | 'none'
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'revoked'
  | 'pending'
  | 'grace_period'
  | 'on_hold'
export type TrialStatus = 'none' | 'active' | 'expired' | 'converted'

export interface IOrganization extends Document {
  orgId: string
  name: string
  slug: string
  ownerId?: string

  // Entitlements & Subscription Architecture (Batch L)
  plan: PlanType
  entitlementSource: EntitlementSource
  lifetimeGrant: boolean

  // Client access control
  webEnabled: boolean
  androidEnabled: boolean

  // Future billing / subscription fields
  subscriptionStatus: SubscriptionStatus
  subscriptionId?: string
  currentPeriodStart?: Date
  currentPeriodEnd?: Date
  cancelAtPeriodEnd?: boolean

  // Trial readiness
  trialStart?: Date
  trialEnd?: Date
  trialStatus: TrialStatus

  createdAt: Date
  updatedAt: Date
}

export interface IOrganizationModel extends Model<IOrganization> {
  generateUniqueSlug(name: string): Promise<string>
  generateOrgId(): string
  ensureDoppelmayr(): Promise<IOrganization>
}

const OrganizationSchema = new Schema<IOrganization>(
  {
    orgId:   { type: String, required: true, unique: true, index: true },
    name:    { type: String, required: true, trim: true },
    slug:    { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    ownerId: { type: String, index: true },

    // Plan & Entitlements
    plan:              { type: String, enum: ['free', 'premium'], default: 'free', index: true },
    entitlementSource: { type: String, enum: ['none', 'subscription', 'lifetime_grant'], default: 'none' },
    lifetimeGrant:     { type: Boolean, default: false },

    // Client access separation
    webEnabled:     { type: Boolean, default: false },
    androidEnabled: { type: Boolean, default: true },

    // Subscription readiness
    subscriptionStatus: {
      type: String,
      enum: ['none', 'active', 'trialing', 'past_due', 'canceled', 'expired', 'revoked', 'pending', 'grace_period', 'on_hold'],
      default: 'none',
      index: true,
    },
    subscriptionId:     { type: String },
    currentPeriodStart: { type: Date },
    currentPeriodEnd:   { type: Date },
    cancelAtPeriodEnd:  { type: Boolean, default: false },

    // Trial readiness
    trialStart:  { type: Date },
    trialEnd:    { type: Date },
    trialStatus: {
      type: String,
      enum: ['none', 'active', 'expired', 'converted'],
      default: 'none',
    },
  },
  { timestamps: true }
)

OrganizationSchema.statics.generateOrgId = function (): string {
  return `org_${crypto.randomBytes(8).toString('hex')}`
}

OrganizationSchema.statics.generateUniqueSlug = async function (name: string): Promise<string> {
  const baseSlug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'org'

  let candidate = baseSlug
  let counter = 1

  while (await this.exists({ slug: candidate })) {
    const suffix = crypto.randomBytes(2).toString('hex')
    candidate = `${baseSlug}-${suffix}`
    counter++
    if (counter > 10) {
      candidate = `${baseSlug}-${Date.now()}`
      break
    }
  }

  return candidate
}

OrganizationSchema.statics.ensureDoppelmayr = async function (): Promise<IOrganization> {
  const existing = await this.findOne({ orgId: 'org_doppelmayr' })
  if (existing) {
    let modified = false
    if (existing.plan !== 'premium') { existing.plan = 'premium'; modified = true }
    if (existing.entitlementSource !== 'lifetime_grant') { existing.entitlementSource = 'lifetime_grant'; modified = true }
    if (!existing.lifetimeGrant) { existing.lifetimeGrant = true; modified = true }
    if (!existing.webEnabled) { existing.webEnabled = true; modified = true }
    if (!existing.androidEnabled) { existing.androidEnabled = true; modified = true }
    if (modified) await existing.save()
    return existing
  }
  return await this.create({
    orgId: 'org_doppelmayr',
    name: 'Doppelmayr India',
    slug: 'doppelmayr',
    plan: 'premium',
    entitlementSource: 'lifetime_grant',
    lifetimeGrant: true,
    webEnabled: true,
    androidEnabled: true,
    subscriptionStatus: 'none',
    trialStatus: 'none',
  })
}

const Organization: IOrganizationModel =
  (mongoose.models.Organization as IOrganizationModel) ||
  mongoose.model<IOrganization, IOrganizationModel>('Organization', OrganizationSchema)

export default Organization
