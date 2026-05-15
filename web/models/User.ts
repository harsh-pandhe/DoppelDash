import mongoose, { Schema, Document, Model } from 'mongoose'
import bcrypt from 'bcryptjs'

export type UserRole = 'boss' | 'manager' | 'employee'

export interface IUserPublic {
  id: string
  email: string
  role: UserRole
  firstName: string
  lastName: string
  fullName: string
  permissions: string[]
  isActive: boolean
  isBanned: boolean
  mustChangePassword: boolean
  lastLoginAt?: Date
  loginCount: number
  unsafeMetadata: { role: UserRole; permissions: string[] }
}

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId
  email: string
  passwordHash: string
  role: UserRole
  firstName: string
  lastName: string
  createdByUserId?: string
  permissions: string[]
  isActive: boolean
  isBanned: boolean
  mustChangePassword: boolean
  otp?: string
  otpExpiry?: Date
  otpAttempts: number
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

const UserSchema = new Schema<IUser, UserModel>(
  {
    email:              { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash:       { type: String, required: true },
    role:               { type: String, enum: ['boss','manager','employee'], required: true },
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
    role:               this.role,
    firstName:          this.firstName,
    lastName:           this.lastName,
    fullName:           `${this.firstName} ${this.lastName}`.trim(),
    permissions:        this.permissions || [],
    isActive:           this.isActive,
    isBanned:           this.isBanned,
    mustChangePassword: this.mustChangePassword,
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
