import mongoose, { Schema, Document, Model } from 'mongoose'
import bcrypt from 'bcryptjs'

export type UserRole = 'admin' | 'manager' | 'employee'

export interface IUserPublic {
  id: string
  email: string
  orgId: string
  role: UserRole
  firstName: string
  lastName: string
  fullName: string
  permissions: string[]
  isActive: boolean
  isBanned: boolean
  mustChangePassword: boolean
  totpEnabled: boolean
  tourSeen: boolean
  mailAccess: boolean
  lastLoginAt?: Date
  loginCount: number
  unsafeMetadata: { role: UserRole; permissions: string[] }
}

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId
  email: string
  orgId: string
  passwordHash: string
  role: UserRole
  firstName: string
  lastName: string
  createdByUserId?: string
  permissions: string[]
  isActive: boolean
  isBanned: boolean
  mustChangePassword: boolean
  mailAccess: boolean
  otp?: string
  otpExpiry?: Date
  otpAttempts: number
  totpSecret?: string          // AES-encrypted base32 secret (pending until totpEnabled)
  totpEnabled: boolean
  webauthnChallenge?: string   // pending WebAuthn challenge (registration or login)
  webauthnChallengeExpiry?: Date
  tourSeen: boolean
  lastLoginAt?: Date
  lastActiveAt?: Date
  loginCount: number
  createdAt: Date
  updatedAt: Date
  checkPassword(plain: string): Promise<boolean>
  toPublic(): IUserPublic
}

interface UserModel extends Model<IUser> {
  hashPassword(plain: string): Promise<string>
}

export const DEFAULT_ORG_ID = 'org_doppelmayr'

const UserSchema = new Schema<IUser, UserModel>(
  {
    email:              { type: String, required: true, unique: true, lowercase: true, trim: true },
    orgId:              { type: String, required: true, default: DEFAULT_ORG_ID, index: true },
    passwordHash:       { type: String, required: true },
    role:               { type: String, enum: ['admin','manager','employee'], required: true },
    mailAccess:         { type: Boolean, default: false },  // 10B: grant employee mass-mail access
    firstName:          { type: String, required: true, trim: true },
    lastName:           { type: String, required: true, trim: true },
    createdByUserId:    { type: String },
    permissions:        [{ type: String }],
    isActive:           { type: Boolean, default: true },
    isBanned:           { type: Boolean, default: false },
    mustChangePassword: { type: Boolean, default: true },
    otp:                { type: String },
    otpExpiry:          { type: Date },
    otpAttempts:        { type: Number, default: 0 },
    totpSecret:         { type: String },
    totpEnabled:        { type: Boolean, default: false },
    webauthnChallenge:  { type: String },
    webauthnChallengeExpiry: { type: Date },
    tourSeen:           { type: Boolean, default: false },
    lastLoginAt:        { type: Date },
    lastActiveAt:       { type: Date },
    loginCount:         { type: Number, default: 0 },
  },
  { timestamps: true }
)

UserSchema.methods.checkPassword = function (plain: string) {
  return bcrypt.compare(plain, this.passwordHash)
}

UserSchema.methods.toPublic = function (): IUserPublic {
  return {
    id:                 this._id.toString(),
    email:              this.email,
    orgId:              this.orgId || DEFAULT_ORG_ID,
    role:               this.role,
    firstName:          this.firstName,
    lastName:           this.lastName,
    fullName:           `${this.firstName} ${this.lastName}`.trim(),
    permissions:        this.permissions || [],
    isActive:           this.isActive,
    isBanned:           this.isBanned,
    mustChangePassword: this.mustChangePassword,
    mailAccess:         this.mailAccess ?? false,
    totpEnabled:        this.totpEnabled ?? false,
    tourSeen:           this.tourSeen ?? false,
    lastLoginAt:        this.lastLoginAt,
    loginCount:         this.loginCount,
    unsafeMetadata:     { role: this.role, permissions: this.permissions || [] },
  }
}

UserSchema.statics.hashPassword = function (plain: string) {
  return bcrypt.hash(plain, 12)
}

const User = (mongoose.models.User as UserModel) || mongoose.model<IUser, UserModel>('User', UserSchema)
export default User
