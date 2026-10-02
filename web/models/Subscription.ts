import mongoose, { Schema, Document, Model } from 'mongoose'

export type SubscriptionProvider = 'google_play'
export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'grace_period'
  | 'on_hold'
  | 'canceled'
  | 'expired'
  | 'revoked'
  | 'pending'

export type AcknowledgementState = 'acknowledged' | 'to_be_acknowledged'
export type BillingEnvironment = 'production' | 'test' | 'sandbox'

export interface ISubscription extends Document {
  orgId: string
  provider: SubscriptionProvider
  productId: string
  basePlanId?: string
  purchaseToken: string
  orderId?: string
  subscriptionId?: string
  status: SubscriptionStatus
  acknowledgementState: AcknowledgementState
  autoRenewing: boolean
  startTime: Date
  currentPeriodEnd: Date
  canceledAt?: Date
  linkedUserId?: string
  rawEventId?: string
  lastVerifiedAt: Date
  environment: BillingEnvironment
  createdAt: Date
  updatedAt: Date
}

export interface ISubscriptionModel extends Model<ISubscription> {
  findByPurchaseToken(token: string): Promise<ISubscription | null>
  findActiveByOrg(orgId: string): Promise<ISubscription | null>
}

const SubscriptionSchema = new Schema<ISubscription>(
  {
    orgId: {
      type: String,
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ['google_play'],
      default: 'google_play',
      required: true,
    },
    productId: {
      type: String,
      required: true,
      index: true,
    },
    basePlanId: {
      type: String,
      default: 'monthly',
    },
    purchaseToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    orderId: {
      type: String,
      index: true,
    },
    subscriptionId: {
      type: String,
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'trialing', 'grace_period', 'on_hold', 'canceled', 'expired', 'revoked', 'pending'],
      default: 'active',
      index: true,
      required: true,
    },
    acknowledgementState: {
      type: String,
      enum: ['acknowledged', 'to_be_acknowledged'],
      default: 'to_be_acknowledged',
    },
    autoRenewing: {
      type: Boolean,
      default: true,
    },
    startTime: {
      type: Date,
      default: Date.now,
    },
    currentPeriodEnd: {
      type: Date,
      required: true,
      index: true,
    },
    canceledAt: {
      type: Date,
    },
    linkedUserId: {
      type: String,
      index: true,
    },
    rawEventId: {
      type: String,
      index: true,
    },
    lastVerifiedAt: {
      type: Date,
      default: Date.now,
    },
    environment: {
      type: String,
      enum: ['production', 'test', 'sandbox'],
      default: 'production',
    },
  },
  { timestamps: true }
)

SubscriptionSchema.statics.findByPurchaseToken = function (token: string): Promise<ISubscription | null> {
  return this.findOne({ purchaseToken: token })
}

SubscriptionSchema.statics.findActiveByOrg = function (orgId: string): Promise<ISubscription | null> {
  return this.findOne({
    orgId,
    status: { $in: ['active', 'trialing', 'canceled'] },
    currentPeriodEnd: { $gte: new Date() },
  }).sort({ currentPeriodEnd: -1 })
}

const Subscription: ISubscriptionModel =
  (mongoose.models.Subscription as ISubscriptionModel) ||
  mongoose.model<ISubscription, ISubscriptionModel>('Subscription', SubscriptionSchema)

export default Subscription
