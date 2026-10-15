import mongoose, { Schema, Document, Model } from 'mongoose'

export type PrivilegeFoodTier = 'none' | 'basic' | 'standard' | 'premium'
export type PrivilegeTaxiTier = 'none' | 'standard' | 'ac' | 'ac_premium'
export type PrivilegeFlightTier = 'none' | 'economy' | 'business'
export type PrivilegeHotelTier = 'none' | 'budget' | 'standard' | 'premium'

export interface IPrivileges {
  food:   { tier: PrivilegeFoodTier;   dailyLimit: number }   // INR per day
  taxi:   { tier: PrivilegeTaxiTier;   perKmLimit: number }
  flight: { tier: PrivilegeFlightTier; enabled: boolean }
  hotel:  { tier: PrivilegeHotelTier;  perNightLimit: number }
  travelAdvance: number  // max travel advance INR
}

export interface IEmergencyContact {
  name: string
  phone: string
  relationship: string
}

export interface IBankDetails {
  bankName: string
  accountNumber: string   // stored; encrypt at API layer if needed
  ifscCode: string
  accountHolderName: string
  accountType: 'savings' | 'current'
}

export interface IMedicalDetails {
  bloodGroup?: string
  allergies?: string[]
  medications?: string[]
  conditions?: string[]
  insuranceProvider?: string
  insurancePolicyNumber?: string
}

export interface IEmployee extends Document {
  clerkUserId: string           // FK to Clerk user
  employeeId: string            // e.g. "EMP-001"
  createdByUserId: string       // who created (manager's clerkUserId)
  orgId?: string

  // Basic
  firstName: string
  lastName: string
  email: string
  phone?: string
  photo?: string
  gender?: string
  dateOfBirth?: Date
  workAnniversary?: Date        // joining date = anniversary
  personalAnniversary?: Date    // wedding anniversary etc.

  // Employment
  department: string
  designation: string
  employeeType: 'full_time' | 'part_time' | 'contract' | 'intern'
  joiningDate: Date
  reportingManagerId?: string   // clerkUserId of manager

  // Profile completion
  onboardingComplete: boolean
  onboardingStep: number        // 0-4: which step they're on
  onboardingNudgeSentAt?: Date  // last 7-day reminder email sent

  // Extended profile
  address?: string
  city?: string
  state?: string

  privileges: IPrivileges
  bankDetails?: IBankDetails
  emergencyContacts: IEmergencyContact[]
  medicalDetails?: IMedicalDetails

  // Out-of-office auto-reply
  outOfOffice?: {
    enabled: boolean
    message?: string
    from?: Date
    until?: Date
  }

  // Auth / activity
  lastLoginAt?: Date
  lastActiveAt?: Date
  loginCount: number
  isActive: boolean
}

const PrivilegesSchema = new Schema<IPrivileges>({
  food:   { tier: { type: String, enum: ['none','basic','standard','premium'], default: 'none' }, dailyLimit: { type: Number, default: 0 } },
  taxi:   { tier: { type: String, enum: ['none','standard','ac','ac_premium'], default: 'none' }, perKmLimit: { type: Number, default: 0 } },
  flight: { tier: { type: String, enum: ['none','economy','business'], default: 'none' }, enabled: { type: Boolean, default: false } },
  hotel:  { tier: { type: String, enum: ['none','budget','standard','premium'], default: 'none' }, perNightLimit: { type: Number, default: 0 } },
  travelAdvance: { type: Number, default: 0 },
}, { _id: false })

const EmergencyContactSchema = new Schema<IEmergencyContact>({
  name:         { type: String, required: true },
  phone:        { type: String, required: true },
  relationship: { type: String, required: true },
}, { _id: true })

const BankDetailsSchema = new Schema<IBankDetails>({
  bankName:           { type: String },
  accountNumber:      { type: String },
  ifscCode:           { type: String },
  accountHolderName:  { type: String },
  accountType:        { type: String, enum: ['savings','current'], default: 'savings' },
}, { _id: false })

const MedicalSchema = new Schema<IMedicalDetails>({
  bloodGroup:          { type: String },
  allergies:           [{ type: String }],
  medications:         [{ type: String }],
  conditions:          [{ type: String }],
  insuranceProvider:   { type: String },
  insurancePolicyNumber: { type: String },
}, { _id: false })

const EmployeeSchema = new Schema<IEmployee>(
  {
    clerkUserId:      { type: String, required: true, unique: true, index: true },
    employeeId:       { type: String, required: true },
    createdByUserId:  { type: String, required: true },
    orgId:            { type: String, required: true, index: true },

    firstName:        { type: String, required: true, trim: true },
    lastName:         { type: String, required: true, trim: true },
    email:            { type: String, required: true, lowercase: true, trim: true },
    phone:            { type: String, trim: true },
    photo:            { type: String },
    gender:           { type: String },
    dateOfBirth:      { type: Date },
    workAnniversary:  { type: Date },
    personalAnniversary: { type: Date },

    department:       { type: String, required: true },
    designation:      { type: String, required: true },
    employeeType:     { type: String, enum: ['full_time','part_time','contract','intern'], default: 'full_time' },
    joiningDate:      { type: Date, required: true },
    reportingManagerId: { type: String },

    onboardingComplete: { type: Boolean, default: false },
    onboardingStep:     { type: Number, default: 0 },
    onboardingNudgeSentAt: { type: Date },

    address:  { type: String },
    city:     { type: String },
    state:    { type: String },

    privileges:       { type: PrivilegesSchema, default: () => ({
      food:   { tier: 'none', dailyLimit: 0 },
      taxi:   { tier: 'none', perKmLimit: 0 },
      flight: { tier: 'none', enabled: false },
      hotel:  { tier: 'none', perNightLimit: 0 },
      travelAdvance: 0,
    })},
    bankDetails:      { type: BankDetailsSchema },
    emergencyContacts: { type: [EmergencyContactSchema], default: [] },
    medicalDetails:   { type: MedicalSchema },

    outOfOffice: {
      enabled: { type: Boolean, default: false },
      message: { type: String },
      from:    { type: Date },
      until:   { type: Date },
    },

    lastLoginAt:  { type: Date },
    lastActiveAt: { type: Date },
    loginCount:   { type: Number, default: 0 },
    isActive:     { type: Boolean, default: true },
  },
  { timestamps: true }
)

EmployeeSchema.index({ orgId: 1, employeeId: 1 }, { unique: true })

// Auto-generate employeeId before validation if not set (scoped to tenant)
EmployeeSchema.pre('validate', async function () {
  if (!this.isNew || (this.employeeId && this.employeeId.trim())) return
  const ModelConstructor = this.constructor as Model<IEmployee>
  const orgFilter = { orgId: this.orgId }

  // Query highest existing numeric sequence number matching EMP-xxx within this organization
  const lastEmp = await ModelConstructor.findOne({ ...orgFilter, employeeId: /^EMP-\d+$/ })
    .sort({ employeeId: -1 })
    .select('employeeId')
    .lean()

  let nextNum = 1
  if (lastEmp?.employeeId) {
    const match = lastEmp.employeeId.match(/^EMP-(\d+)$/)
    if (match) {
      nextNum = parseInt(match[1], 10) + 1
    }
  } else {
    const count = await ModelConstructor.countDocuments(orgFilter)
    nextNum = count + 1
  }

  // Ensure candidate is unique against any gaps, deletes, or concurrent records in this org
  let candidate = `EMP-${String(nextNum).padStart(3, '0')}`
  while (await ModelConstructor.exists({ ...orgFilter, employeeId: candidate })) {
    nextNum++
    candidate = `EMP-${String(nextNum).padStart(3, '0')}`
  }

  this.employeeId = candidate
})

// Fallback auto-generate in pre('save') if validation was bypassed (scoped to tenant)
EmployeeSchema.pre('save', async function () {
  if (!this.isNew || (this.employeeId && this.employeeId.trim())) return
  const ModelConstructor = this.constructor as Model<IEmployee>
  const orgFilter = { orgId: this.orgId }
  const count = await ModelConstructor.countDocuments(orgFilter)
  let nextNum = count + 1
  let candidate = `EMP-${String(nextNum).padStart(3, '0')}`
  while (await ModelConstructor.exists({ ...orgFilter, employeeId: candidate })) {
    nextNum++
    candidate = `EMP-${String(nextNum).padStart(3, '0')}`
  }
  this.employeeId = candidate
})

const Employee: Model<IEmployee> = mongoose.models.Employee || mongoose.model('Employee', EmployeeSchema)
export default Employee
