import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import Organization from '@/models/Organization'
import Employee from '@/models/Employee'
import LeaveBalance from '@/models/LeaveBalance'
import Leave from '@/models/Leave'
import Expense from '@/models/Expense'
import TravelRequest from '@/models/TravelRequest'
import Contact from '@/models/Contact'
import Announcement from '@/models/Announcement'
import AuditLog from '@/models/AuditLog'
import PublicHoliday from '@/models/PublicHoliday'
import OrgSettings from '@/models/OrgSettings'
import UserEmailConfig from '@/models/UserEmailConfig'
import OutlookToken from '@/models/OutlookToken'
import SyncState from '@/models/SyncState'
import { encrypt, encryptBankDetails } from '@/lib/encrypt'

/**
 * DEV-ONLY full reset + seed.
 * Wipes everything, then creates a realistic org: 1 boss, 2 managers, 6 employees,
 * with leave balances, leaves, expenses, travel, CRM contacts, announcements, holidays.
 *
 * Run:
 *   POST /api/dev/seed        header  x-seed-secret: <DEV_SEED_SECRET>   (never in the URL)
 *
 * Default password for every seeded account: `Pass1234!`
 * Admin email: harshpandhehome@gmail.com (testable inbox for OTP)
 */

const DEFAULT_PASSWORD = 'Pass1234!'

const today = new Date()
const yr    = today.getFullYear()
const D     = (offsetDays: number) => {
  const d = new Date(today); d.setDate(d.getDate() + offsetDays); d.setHours(9, 0, 0, 0); return d
}
const dob = (y: number, m: number, d: number) => new Date(y, m - 1, d)

/**
 * Fake receipt as a base64 SVG data-URI — renders anywhere, Netlify-safe
 * (no Cloudinary / no local-FS upload). Used to populate seeded expenses so
 * the receipt viewer + print sheet have real images to show.
 */
const fakeReceipt = (vendor: string, amount: number, dateStr: string) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="420" viewBox="0 0 320 420">
    <rect width="320" height="420" fill="#ffffff"/>
    <rect x="0" y="0" width="320" height="56" fill="#0057A8"/>
    <text x="20" y="36" font-family="Arial" font-size="20" font-weight="bold" fill="#ffffff">${vendor}</text>
    <text x="20" y="92" font-family="Arial" font-size="12" fill="#555">TAX INVOICE / RECEIPT</text>
    <line x1="20" y1="104" x2="300" y2="104" stroke="#ddd"/>
    <text x="20" y="136" font-family="Arial" font-size="13" fill="#222">Date: ${dateStr}</text>
    <text x="20" y="160" font-family="Arial" font-size="13" fill="#222">GSTIN: 27AABCD1234E1Z5</text>
    <line x1="20" y1="180" x2="300" y2="180" stroke="#eee"/>
    <text x="20" y="210" font-family="Arial" font-size="13" fill="#222">Description</text>
    <text x="240" y="210" font-family="Arial" font-size="13" fill="#222">Amount</text>
    <text x="20" y="240" font-family="Arial" font-size="13" fill="#444">Service charge</text>
    <text x="220" y="240" font-family="Arial" font-size="13" fill="#444">Rs. ${(amount * 0.82).toFixed(0)}</text>
    <text x="20" y="266" font-family="Arial" font-size="13" fill="#444">GST 18%</text>
    <text x="220" y="266" font-family="Arial" font-size="13" fill="#444">Rs. ${(amount * 0.18).toFixed(0)}</text>
    <line x1="20" y1="286" x2="300" y2="286" stroke="#ddd"/>
    <text x="20" y="316" font-family="Arial" font-size="16" font-weight="bold" fill="#0057A8">TOTAL</text>
    <text x="200" y="316" font-family="Arial" font-size="16" font-weight="bold" fill="#0057A8">Rs. ${amount.toLocaleString('en-IN')}</text>
    <text x="20" y="368" font-family="Arial" font-size="11" fill="#888">Thank you for your business.</text>
    <text x="20" y="392" font-family="Arial" font-size="10" fill="#aaa">Paid via Corporate Card • Auth #${Math.floor(Math.random()*900000+100000)}</text>
  </svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

/** The seed provisions the Doppelmayr demo organisation explicitly — it is a data script, not a runtime default. */
const SEED_ORG_ID = 'org_doppelmayr'
const withOrg = <T extends object>(rows: T[]) => rows.map(r => ({ orgId: SEED_ORG_ID, ...r }))

export async function POST(req: NextRequest) {
  const required = process.env.DEV_SEED_SECRET
  // This endpoint wipes EVERY collection. In production it stays fully disabled
  // unless explicitly opted in with ALLOW_DEV_SEED=true — so a leaked
  // DEV_SEED_SECRET alone cannot erase the production database.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_SEED !== 'true') {
    return NextResponse.json({ error: 'Destructive seed is disabled in production' }, { status: 403 })
  }
  if (!required) {
    return NextResponse.json({ error: 'DEV_SEED_SECRET must be configured to run seed' }, { status: 403 })
  }
  const provided = req.headers.get('x-seed-secret')   // header only: a query string would be written to access logs
  if (provided !== required) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()

  /* ─── 1) Wipe everything ──────────────────────────────────────────── */
  await Promise.all([
    User.deleteMany({}),
    Employee.deleteMany({}),
    LeaveBalance.deleteMany({}),
    Leave.deleteMany({}),
    Expense.deleteMany({}),
    TravelRequest.deleteMany({}),
    Contact.deleteMany({}),
    Announcement.deleteMany({}),
    AuditLog.deleteMany({}),
    PublicHoliday.deleteMany({}),
    OrgSettings.deleteMany({}),
    UserEmailConfig.deleteMany({}),
    OutlookToken.deleteMany({}),
    SyncState.deleteMany({}),
  ])

  /* ─── 2) Users ────────────────────────────────────────────────────── */
  const hash = await User.hashPassword(DEFAULT_PASSWORD)

  // 1 admin — uses the testable gmail inbox so OTP login works as admin
  const boss = await User.create({ orgId: SEED_ORG_ID,
    email:              'harshpandhehome@gmail.com',
    passwordHash:       hash,
    role:               'admin',
    firstName:          'Harsh',
    lastName:           'Pandhe',
    mustChangePassword: false,
    isActive:           true,
    lastLoginAt:        D(-1),
    loginCount:         42,
  })

  // 2 managers
  const managerA = await User.create({ orgId: SEED_ORG_ID,
    email: 'harshpandhepcs@gmail.com', passwordHash: hash, role: 'manager',
    firstName: 'Priya', lastName: 'Iyer',
    createdByUserId: boss._id.toString(),
    mustChangePassword: false, isActive: true,
    lastLoginAt: D(-1), loginCount: 27,
  })
  const managerB = await User.create({ orgId: SEED_ORG_ID,
    email: 'rohan.kapoor@doppelmayr.com', passwordHash: hash, role: 'manager',
    firstName: 'Rohan', lastName: 'Kapoor',
    createdByUserId: boss._id.toString(),
    mustChangePassword: false, isActive: true,
    lastLoginAt: D(-2), loginCount: 19,
  })

  // 6 employees
  const empSeeds = [
    { f: 'Aarav',   l: 'Sharma',   email: 'harsh.pandhe@doppelmayr.com',   dept: 'Engineering',  desig: 'Senior Engineer',   mgr: managerA, dob: dob(1991, 4, 17), join: dob(2021, 6, 15), city: 'Mumbai',     state: 'Maharashtra' },
    { f: 'Diya',    l: 'Menon',    email: 'diya.menon@doppelmayr.com',     dept: 'Engineering',  desig: 'Project Engineer',  mgr: managerA, dob: dob(1994, 11, 8), join: dob(2022, 1, 10), city: 'Navi Mumbai',state: 'Maharashtra' },
    { f: 'Vikram',  l: 'Singh',    email: 'vikram.singh@doppelmayr.com',   dept: 'Operations',   desig: 'Operations Lead',   mgr: managerB, dob: dob(1988, 7, 22), join: dob(2019, 9, 1),  city: 'Pune',       state: 'Maharashtra' },
    { f: 'Sneha',   l: 'Reddy',    email: 'sneha.reddy@doppelmayr.com',    dept: 'Operations',   desig: 'Field Engineer',    mgr: managerB, dob: dob(1996, 3, 3),  join: dob(2023, 2, 20), city: 'Hyderabad',  state: 'Telangana' },
    { f: 'Karan',   l: 'Verma',    email: 'karan.verma@doppelmayr.com',    dept: 'Sales',        desig: 'Account Manager',   mgr: managerA, dob: dob(1992, 9, 30), join: dob(2020, 11, 5), city: 'Delhi',      state: 'Delhi' },
    { f: 'Anjali',  l: 'Bose',     email: 'anjali.bose@doppelmayr.com',    dept: 'Sales',        desig: 'Sales Executive',   mgr: managerA, dob: dob(1997, 12, 14),join: dob(2024, 3, 1),  city: 'Kolkata',    state: 'West Bengal' },
  ]
  const employees = await Promise.all(empSeeds.map(async (e, i) => {
    return User.create({ orgId: SEED_ORG_ID,
      email: e.email, passwordHash: hash, role: 'employee',
      firstName: e.f, lastName: e.l,
      createdByUserId: e.mgr._id.toString(),
      mustChangePassword: false, isActive: true,
      lastLoginAt: D(-(i + 1)), loginCount: 5 + i,
    })
  }))

  /* ─── 3) Employee profiles ────────────────────────────────────────── */
  const PRIV_LEVELS = [
    { food: { tier: 'standard',  dailyLimit: 800 },  taxi: { tier: 'ac',          perKmLimit: 18 }, flight: { tier: 'economy',  enabled: true  }, hotel: { tier: 'standard', perNightLimit: 4500 }, travelAdvance: 25000 },
    { food: { tier: 'basic',     dailyLimit: 500 },  taxi: { tier: 'standard',    perKmLimit: 14 }, flight: { tier: 'none',     enabled: false }, hotel: { tier: 'budget',   perNightLimit: 2500 }, travelAdvance: 10000 },
    { food: { tier: 'premium',   dailyLimit: 1200 }, taxi: { tier: 'ac_premium',  perKmLimit: 22 }, flight: { tier: 'business', enabled: true  }, hotel: { tier: 'premium',  perNightLimit: 8000 }, travelAdvance: 50000 },
    { food: { tier: 'basic',     dailyLimit: 500 },  taxi: { tier: 'ac',          perKmLimit: 16 }, flight: { tier: 'economy',  enabled: true  }, hotel: { tier: 'standard', perNightLimit: 4000 }, travelAdvance: 20000 },
    { food: { tier: 'standard',  dailyLimit: 800 },  taxi: { tier: 'ac',          perKmLimit: 18 }, flight: { tier: 'economy',  enabled: true  }, hotel: { tier: 'standard', perNightLimit: 4500 }, travelAdvance: 30000 },
    { food: { tier: 'basic',     dailyLimit: 500 },  taxi: { tier: 'standard',    perKmLimit: 14 }, flight: { tier: 'none',     enabled: false }, hotel: { tier: 'budget',   perNightLimit: 2500 }, travelAdvance: 8000  },
  ]

  // Boss
  await Employee.create({ orgId: SEED_ORG_ID,
    clerkUserId: boss._id.toString(), employeeId: 'EMP-001',
    createdByUserId: boss._id.toString(),
    firstName: 'Harsh', lastName: 'Pandhe', email: boss.email,
    phone: '+91 90000 00001', gender: 'male',
    dateOfBirth: dob(1990, 2, 28), workAnniversary: dob(2018, 4, 1),
    department: 'Leadership', designation: 'Managing Director', employeeType: 'full_time',
    joiningDate: dob(2018, 4, 1),
    onboardingComplete: true, onboardingStep: 4,
    address: '1 Marina Drive', city: 'Mumbai', state: 'Maharashtra',
    privileges: { food: { tier: 'premium', dailyLimit: 2000 }, taxi: { tier: 'ac_premium', perKmLimit: 25 }, flight: { tier: 'business', enabled: true }, hotel: { tier: 'premium', perNightLimit: 12000 }, travelAdvance: 100000 },
    emergencyContacts: [{ name: 'Anita Pandhe', phone: '+91 98000 00001', relationship: 'Spouse' }],
    medicalDetails: { bloodGroup: 'O+', allergies: [], medications: [], conditions: [] },
    bankDetails: encryptBankDetails({ bankName: 'HDFC Bank', accountNumber: '50100123456789', ifscCode: 'HDFC0000123', accountHolderName: 'Harsh Pandhe', accountType: 'savings' }) as Record<string, unknown>,
    lastLoginAt: D(-1), loginCount: 42,
  })

  // Managers
  await Employee.create({ orgId: SEED_ORG_ID,
    clerkUserId: managerA._id.toString(), employeeId: 'EMP-002',
    createdByUserId: boss._id.toString(),
    firstName: 'Priya', lastName: 'Iyer', email: managerA.email,
    phone: '+91 90000 00002', gender: 'female',
    dateOfBirth: dob(1986, 6, 11), workAnniversary: dob(2019, 8, 5),
    department: 'Engineering', designation: 'Engineering Manager', employeeType: 'full_time',
    joiningDate: dob(2019, 8, 5), reportingManagerId: boss._id.toString(),
    onboardingComplete: true, onboardingStep: 4,
    address: '12B Linking Road', city: 'Mumbai', state: 'Maharashtra',
    privileges: { food: { tier: 'standard', dailyLimit: 1000 }, taxi: { tier: 'ac_premium', perKmLimit: 22 }, flight: { tier: 'business', enabled: true }, hotel: { tier: 'premium', perNightLimit: 7500 }, travelAdvance: 60000 },
    emergencyContacts: [{ name: 'Karthik Iyer', phone: '+91 98000 00002', relationship: 'Spouse' }],
    medicalDetails: { bloodGroup: 'A+', allergies: ['Peanuts'], medications: [], conditions: [] },
    lastLoginAt: D(-1), loginCount: 27,
  })
  await Employee.create({ orgId: SEED_ORG_ID,
    clerkUserId: managerB._id.toString(), employeeId: 'EMP-003',
    createdByUserId: boss._id.toString(),
    firstName: 'Rohan', lastName: 'Kapoor', email: managerB.email,
    phone: '+91 90000 00003', gender: 'male',
    dateOfBirth: dob(1984, 10, 25), workAnniversary: dob(2020, 1, 20),
    department: 'Operations', designation: 'Operations Manager', employeeType: 'full_time',
    joiningDate: dob(2020, 1, 20), reportingManagerId: boss._id.toString(),
    onboardingComplete: true, onboardingStep: 4,
    address: '7 Aundh Road', city: 'Pune', state: 'Maharashtra',
    privileges: { food: { tier: 'standard', dailyLimit: 1000 }, taxi: { tier: 'ac', perKmLimit: 20 }, flight: { tier: 'business', enabled: true }, hotel: { tier: 'standard', perNightLimit: 5500 }, travelAdvance: 50000 },
    emergencyContacts: [{ name: 'Meera Kapoor', phone: '+91 98000 00003', relationship: 'Spouse' }],
    medicalDetails: { bloodGroup: 'B+', allergies: [], medications: [], conditions: ['Hypertension'] },
    lastLoginAt: D(-2), loginCount: 19,
  })

  // Employees
  await Promise.all(empSeeds.map(async (e, i) => {
    const u = employees[i]
    const prvIndex = i % PRIV_LEVELS.length
    return Employee.create({ orgId: SEED_ORG_ID,
      clerkUserId: u._id.toString(), employeeId: `EMP-${String(i + 4).padStart(3, '0')}`,
      createdByUserId: e.mgr._id.toString(),
      firstName: e.f, lastName: e.l, email: e.email,
      phone: `+91 90000 ${String(10 + i).padStart(5, '0')}`,
      gender: i % 2 === 0 ? 'male' : 'female',
      dateOfBirth: e.dob, workAnniversary: e.join,
      department: e.dept, designation: e.desig, employeeType: 'full_time',
      joiningDate: e.join, reportingManagerId: e.mgr._id.toString(),
      onboardingComplete: i !== empSeeds.length - 1,    // last employee = onboarding pending
      onboardingStep:     i !== empSeeds.length - 1 ? 4 : 1,
      address: `${10 + i} ${['MG Road','FC Road','Jubilee Hills','CP','Park Street'][i % 5]}`,
      city: e.city, state: e.state,
      privileges: PRIV_LEVELS[prvIndex],
      emergencyContacts: i % 2 === 0
        ? [{ name: `${e.f}'s Spouse`, phone: `+91 98000 ${String(10 + i).padStart(5, '0')}`, relationship: 'Spouse' }]
        : [{ name: `${e.f}'s Parent`, phone: `+91 98000 ${String(10 + i).padStart(5, '0')}`, relationship: 'Parent' }],
      medicalDetails: { bloodGroup: ['A+','B+','O+','AB+','O-','A-'][i], allergies: [], medications: [], conditions: [] },
      bankDetails: i % 2 === 0 ? encryptBankDetails({
        bankName: 'ICICI Bank', accountNumber: `00${i}123456789${i}`, ifscCode: `ICIC000123${i}`,
        accountHolderName: `${e.f} ${e.l}`, accountType: 'savings',
      }) as Record<string, unknown> : undefined,
      lastLoginAt: D(-(i + 1)), loginCount: 5 + i,
    })
  }))

  /* ─── 4) Leave balances ───────────────────────────────────────────── */
  const allUsers = [boss, managerA, managerB, ...employees]
  await Promise.all(allUsers.map(u => LeaveBalance.create({ orgId: SEED_ORG_ID,
    userId: u._id.toString(), year: yr,
    casual: 12, sick: 6, earned: 15, privilege: 2, restricted: 2, lwpDays: 0,
  })))

  /* ─── 5) Leaves ──────────────────────────────────────────────────── */
  const leaveSeeds: Array<{ u: typeof boss; type: string; from: number; to: number; reason: string; status: string }> = [
    // Aarav — approved sick
    { u: employees[0], type: 'sick',   from: -30, to: -28, reason: 'Viral fever, doctor advised rest.', status: 'approved' },
    // Aarav — pending casual
    { u: employees[0], type: 'casual', from: 7,   to: 7,   reason: "Sister's engagement.",              status: 'pending'  },
    // Diya — approved earned
    { u: employees[1], type: 'earned', from: -14, to: -10, reason: 'Annual vacation to Goa.',           status: 'approved' },
    // Vikram — rejected
    { u: employees[2], type: 'casual', from: -45, to: -45, reason: 'Personal errand.',                  status: 'rejected' },
    // Sneha — pending sick
    { u: employees[3], type: 'sick',   from: 1,   to: 2,   reason: 'Migraine, doctor-prescribed rest.', status: 'pending'  },
    // Karan — approved earned upcoming
    { u: employees[4], type: 'earned', from: 14,  to: 18,  reason: 'Wedding anniversary trip.',         status: 'approved' },
    // Anjali — approved casual
    { u: employees[5], type: 'casual', from: -7,  to: -7,  reason: 'Family function.',                  status: 'approved' },
    // Priya (manager) — approved earned
    { u: managerA,     type: 'earned', from: -21, to: -19, reason: 'Family wedding in Chennai.',        status: 'approved' },
    // Rohan (manager) — pending privilege
    { u: managerB,     type: 'privilege', from: 21, to: 22, reason: 'Conference attendance.',          status: 'pending'  },
  ]
  await Promise.all(leaveSeeds.map(l => Leave.create({ orgId: SEED_ORG_ID,
    userId: l.u._id.toString(), userName: `${l.u.firstName} ${l.u.lastName}`,
    type: l.type, startDate: D(l.from), endDate: D(l.to),
    days: Math.max(1, l.to - l.from + 1),
    reason: l.reason, status: l.status,
    approvedBy: l.status === 'approved' ? (l.u === managerA || l.u === managerB ? boss._id.toString() : (l.u === employees[0] || l.u === employees[1] || l.u === employees[4] || l.u === employees[5] ? managerA._id.toString() : managerB._id.toString())) : undefined,
    managerNote: l.status === 'rejected' ? 'Insufficient business justification — please plan ahead.' : undefined,
    createdAt: D(l.from - 3),
  })))

  /* ─── 6) Expenses ────────────────────────────────────────────────── */
  const expSeeds = [
    { u: employees[0], title: 'Mumbai → BKC site survey',     reason: 'Client site visit, taxi + meals.',                amount: 2450, status: 'paid',            mgr: managerA, days: -40, from: 'Mumbai', to: 'BKC'      },
    { u: employees[0], title: 'AutoCAD subscription',          reason: 'Annual renewal for design workstation.',         amount: 45000,status: 'pending_admin',    mgr: managerA, days: -7,  from: '',       to: ''         },
    { u: employees[1], title: 'Pune site inspection',          reason: 'Travel + lodging for 2-day inspection.',         amount: 8600, status: 'paid',            mgr: managerA, days: -20, from: 'Mumbai', to: 'Pune'     },
    { u: employees[2], title: 'Conference: Ropeway Asia 2026', reason: 'Registration, flight, hotel.',                   amount: 32500,status: 'pending_admin',    mgr: managerB, days: -5,  from: 'Pune',   to: 'Singapore'},
    { u: employees[2], title: 'Team lunch — Q1 closeout',      reason: 'Department team lunch, 8 people.',               amount: 6400, status: 'paid',            mgr: managerB, days: -50, from: '',       to: ''         },
    { u: employees[3], title: 'Hyderabad office supplies',     reason: 'Stationery + printer cartridges.',               amount: 3200, status: 'returned',        mgr: managerB, days: -3,  from: '',       to: '',        managerNote: 'Attach itemised bill from vendor.' },
    { u: employees[4], title: 'Client dinner — Delhi NCR',     reason: 'Dinner with L&T procurement team.',              amount: 9800, status: 'pending_manager', mgr: managerA, days: -2,  from: '',       to: ''         },
    { u: employees[4], title: 'Delhi metro travel pass',       reason: 'Monthly pass for client meetings.',              amount: 1200, status: 'rejected',        mgr: managerA, days: -10, from: '',       to: '',        managerNote: 'Reimbursed only for project-specific travel.' },
    { u: employees[5], title: 'Kolkata client visit',          reason: 'WB Transit feasibility meeting travel.',         amount: 14200,status: 'pending_manager', mgr: managerA, days: -1,  from: 'Mumbai', to: 'Kolkata'  },
    { u: managerA,     title: 'Leadership offsite',            reason: 'Team building offsite in Lonavala.',             amount: 28000,status: 'paid',            mgr: boss,     days: -35, from: 'Mumbai', to: 'Lonavala' },
  ]
  await Promise.all(expSeeds.map((e, idx) => {
    const dateStr = D(e.days).toLocaleDateString('en-IN')
    const vendor  = e.title.split(/[—→:]/)[0].trim().slice(0, 22) || 'Vendor'
    // Every other expense uses table mode with itemised line items + per-item receipts;
    // the rest are simple with one top-level receipt.
    const tableMode = idx % 2 === 0
    const lineItems = tableMode ? [
      { description: `${vendor} — base charge`, amount: Math.round(e.amount * 0.6), date: D(e.days),
        category: 'travel', receiptUrl: fakeReceipt(vendor, Math.round(e.amount * 0.6), dateStr),
        status: e.status === 'paid' ? 'approved' : e.status === 'rejected' ? 'rejected' : 'pending' },
      { description: `${vendor} — incidentals`, amount: e.amount - Math.round(e.amount * 0.6), date: D(e.days),
        category: 'misc', receiptUrl: fakeReceipt(vendor + ' (2)', e.amount - Math.round(e.amount * 0.6), dateStr),
        status: e.status === 'paid' ? 'approved' : 'pending' },
    ] : []
    return Expense.create({ orgId: SEED_ORG_ID,
      userId: e.u._id.toString(), userName: `${e.u.firstName} ${e.u.lastName}`,
      title: e.title, reason: e.reason, amount: e.amount,
      travelFrom: e.from || undefined, travelTo: e.to || undefined,
      startDate: D(e.days), endDate: e.from ? D(e.days + 1) : undefined,
      receipts: tableMode ? [] : [fakeReceipt(vendor, e.amount, dateStr)],
      lineItems, hasLineItems: tableMode,
      status: e.status,
      managerNote: (e as { managerNote?: string }).managerNote,
      approvedBy: ['pending_admin', 'paid'].includes(e.status) ? e.mgr._id.toString() : undefined,
      paidBy:     e.status === 'paid' ? boss._id.toString() : undefined,
      paymentMethod: e.status === 'paid' ? 'bank_transfer' : undefined,
      paidAt:     e.status === 'paid' ? D(e.days + 5) : undefined,
      createdAt:  D(e.days - 1),
    })
  }))

  /* ─── 7) Travel requests ─────────────────────────────────────────── */
  const travelSeeds = [
    {
      u: employees[0], purpose: 'BKC ropeway corridor walkthrough', destination: 'Mumbai',
      depart: 5, ret: 6, est: 7500, adv: 5000, status: 'pending_manager',
    },
    {
      u: employees[2], purpose: 'Ropeway Asia 2026 conference', destination: 'Singapore',
      depart: 21, ret: 25, est: 145000, adv: 75000, status: 'pending_admin',
      mgrNote: 'High value — please review carefully.',
    },
    {
      u: employees[4], purpose: 'L&T procurement quarterly review', destination: 'Delhi',
      depart: -3, ret: -1, est: 28000, adv: 15000, status: 'approved',
    },
    {
      u: employees[5], purpose: 'WB Transit Kolkata site visit', destination: 'Kolkata',
      depart: 12, ret: 14, est: 22000, adv: 10000, status: 'approved',
    },
    {
      u: employees[3], purpose: 'Tirupati ropeway kick-off',  destination: 'Tirupati',
      depart: -20, ret: -18, est: 19500, adv: 8000, status: 'rejected',
      mgrNote: 'Defer — kick-off rescheduled to Q3.',
    },
  ]
  await Promise.all(travelSeeds.map(t => TravelRequest.create({ orgId: SEED_ORG_ID,
    userId: t.u._id.toString(), userName: `${t.u.firstName} ${t.u.lastName}`,
    purpose: t.purpose, destination: t.destination,
    departureDate: D(t.depart), returnDate: D(t.ret),
    legs: [],
    itineraryDocs: t.est > 50000 ? [fakeReceipt('Flight Itinerary', t.est, D(t.depart).toLocaleDateString('en-IN'))] : [],
    estimatedTotal:   t.est,
    advanceRequested: t.adv,
    status: t.status,
    managerNote: (t as { mgrNote?: string }).mgrNote,
    approvedBy: t.status === 'approved' ? boss._id.toString() : (t.status === 'pending_admin' ? managerA._id.toString() : undefined),
    approvedAt: t.status === 'approved' ? D(t.depart - 5) : undefined,
    rejectedBy: t.status === 'rejected' ? managerB._id.toString() : undefined,
    rejectedAt: t.status === 'rejected' ? D(t.depart - 2) : undefined,
  })))

  /* ─── 8) CRM contacts (under boss + manager A) ────────────────────── */
  const contactSeeds: Array<{ owner: typeof boss; data: Record<string, unknown> }> = [
    { owner: boss, data: {
      name: 'Sanjay Kapoor', email: 'sanjay@jindalsteel.com', phone: '+91 98765 55555',
      company: 'Jindal Steel & Power', designation: 'GM Mining Logistics',
      tags: ['private', 'mining'], visibility: 'org',
      religion: encrypt('Hindu'), birthday: dob(1972, 9, 12),
      timeline: [
        { type: 'meeting', title: 'Initial discovery call', date: D(-90), source: 'manual' },
        { type: 'email',   title: 'Sent commercial proposal', date: D(-45), source: 'manual' },
      ],
      colorLabel: { color: '#22c55e', label: 'Hot Lead' },
    }},
    { owner: boss, data: {
      name: 'Suresh Reddy', email: 'suresh.reddy@apsrtc.gov.in', phone: '+91 98765 11111',
      company: 'Andhra Pradesh State Govt', designation: 'Deputy Director',
      tags: ['govt', 'tier-1'], visibility: 'org',
      religion: encrypt('Hindu'), caste: encrypt('Reddy'),
      timeline: [{ type: 'meeting', title: 'Q1 review at Vijayawada', date: D(-30), source: 'manual' }],
    }},
    { owner: boss, data: {
      name: 'Harsh Bose', email: 'harsh@tatasteel.com', phone: '+91 98765 77777',
      company: 'Tata Steel', designation: 'Logistics Head',
      tags: ['private', 'steel'], visibility: 'org',
      religion: encrypt('Hindu'), birthday: dob(1985, 5, 5),
      reminderDate: D(3), reminderNote: 'Follow up on Q2 procurement plan',
    }},
    { owner: managerA, data: {
      name: 'Meera Krishnan', email: 'meera@chennai-metro.in', phone: '+91 98765 22222',
      company: 'Chennai Metro Rail Ltd', designation: 'Project Director',
      tags: ['govt', 'metro'], visibility: 'team',
      religion: encrypt('Hindu'),
    }},
    { owner: managerA, data: {
      name: 'Rajesh Iyer', email: 'rajesh.i@bangaloremetro.gov.in', phone: '+91 98765 66666',
      company: 'BMRCL', designation: 'Chief Engineer',
      tags: ['govt', 'metro'], visibility: 'team',
      religion: encrypt('Hindu'), caste: encrypt('Brahmin'),
    }},
    { owner: managerA, data: {
      name: 'Priya Mehta', email: 'priya.mehta@l-t.com', phone: '+91 98765 33333',
      company: 'Larsen & Toubro', designation: 'VP, Infrastructure',
      tags: ['tier-1', 'epc'], visibility: 'org',
      religion: encrypt('Hindu'), birthday: dob(1980, 12, 1),
    }},
    { owner: boss, data: {
      name: 'David Fernandes', email: 'd.fernandes@garuda-infra.com', phone: '+91 91234 56789',
      company: 'Garuda Infrastructure', designation: 'Managing Director',
      tags: ['md', 'decision-maker'], visibility: 'boss_only',
      religion: encrypt('Christian'), anniversary: dob(2003, 2, 14),
    }},
    { owner: managerA, data: {
      name: 'Amita Joshi', email: 'amita@joshi-consulting.in', phone: '+91 88001 23456',
      company: 'Joshi Consulting Group', designation: 'Lead Consultant',
      tags: ['consultant'], visibility: 'team',
      religion: encrypt('Hindu'),
    }},
  ]
  await Promise.all(contactSeeds.map(c => Contact.create({ orgId: SEED_ORG_ID,
    createdBy: c.owner._id.toString(), ...c.data,
  })))

  /* ─── 9) Announcements ────────────────────────────────────────────── */
  await Announcement.insertMany(withOrg([
    {
      authorId: boss._id.toString(), authorName: 'Harsh Pandhe',
      title: 'Tirupati Ropeway Project Awarded',
      body: 'Excited to announce that Doppelmayr India has been awarded the Tirupati-Tirumala urban ropeway connectivity project by AP Infrastructure Corp. Kick-off meeting scheduled later this quarter. All team members please review the project brief on the shared drive.',
      pinned: true, priority: 'urgent',
      createdAt: D(-5),
    },
    {
      authorId: boss._id.toString(), authorName: 'Harsh Pandhe',
      title: 'Updated Leave Policy FY 2026–27',
      body: 'HR has updated the leave policy. Casual leave remains 12 days. Earned leave carry-forward capped at 30 days. Privilege leave bumped to 3 days/year for managers. Full policy on shared drive.',
      pinned: true, priority: 'important',
      createdAt: D(-12),
    },
    {
      authorId: managerA._id.toString(), authorName: 'Priya Iyer',
      title: 'Engineering Town Hall — Friday 3 PM',
      body: 'Mandatory engineering town hall this Friday at 3 PM. Q1 review, Q2 priorities, and Tirupati project deep-dive on agenda.',
      pinned: false, priority: 'normal',
      createdAt: D(-2),
    },
    {
      authorId: boss._id.toString(), authorName: 'Harsh Pandhe',
      title: 'Office closed — May Day',
      body: 'Office will remain closed on 1st May (Maharashtra Day / Labour Day). Optional WFH for critical project deliverables.',
      pinned: false, priority: 'normal',
      createdAt: D(-8),
    },
  ]))

  /* ─── 10) Public holidays (current year) ──────────────────────────── */
  await PublicHoliday.insertMany(withOrg([
    { name: 'Republic Day',       date: new Date(yr, 0, 26), type: 'national',   year: yr },
    { name: 'Holi',               date: new Date(yr, 2, 14), type: 'national',   year: yr },
    { name: 'Good Friday',        date: new Date(yr, 3, 18), type: 'national',   year: yr },
    { name: 'Maharashtra Day',    date: new Date(yr, 4, 1),  type: 'regional',   year: yr },
    { name: 'Eid al-Fitr',        date: new Date(yr, 4, 21), type: 'national',   year: yr },
    { name: 'Independence Day',   date: new Date(yr, 7, 15), type: 'national',   year: yr },
    { name: 'Janmashtami',        date: new Date(yr, 7, 25), type: 'restricted', year: yr },
    { name: 'Gandhi Jayanti',     date: new Date(yr, 9, 2),  type: 'national',   year: yr },
    { name: 'Dussehra',           date: new Date(yr, 9, 21), type: 'national',   year: yr },
    { name: 'Diwali',             date: new Date(yr, 10, 9), type: 'national',   year: yr },
    { name: 'Christmas',          date: new Date(yr, 11, 25),type: 'national',   year: yr },
  ]))

  /* ─── 11) Org settings ────────────────────────────────────────────── */
  await OrgSettings.create({
    orgId:   SEED_ORG_ID,
    name:    'Doppelmayr India Pvt Ltd',
    companyName: 'Doppelmayr India Pvt Ltd',
    brandName:  'Doppelmayr India',   // outbound-mail brand (organisation configuration, not code)
    address: 'Navi Mumbai, Maharashtra, India',
    website: 'https://www.doppelmayr.com',
    phone:   '+91 22 0000 0000',
    email:   'info@doppelmayr.com',
    brandColor: '#0057A8',   // outbound-mail brand colour (organisation configuration, not code)
    updatedBy: boss._id.toString(),
  })

  /* ─── 12) Seed audit log entries ─────────────────────────────────── */
  await AuditLog.insertMany(withOrg([
    { action: 'user.role_changed', performedBy: boss._id.toString(), performedByName: 'Harsh Pandhe',
      targetId: managerA._id.toString(), targetType: 'user',
      metadata: { newRole: 'manager', employeeName: 'Priya Iyer' }, createdAt: D(-60) },
    { action: 'leave.approved', performedBy: managerA._id.toString(), performedByName: 'Priya Iyer',
      targetId: 'seed-leave-1', targetType: 'leave',
      metadata: { employeeName: 'Aarav Sharma', days: 3, status: 'approved' }, createdAt: D(-28) },
    { action: 'expense.paid', performedBy: boss._id.toString(), performedByName: 'Harsh Pandhe',
      targetId: 'seed-exp-1', targetType: 'expense',
      metadata: { employeeName: 'Aarav Sharma', amount: 2450, status: 'paid' }, createdAt: D(-38) },
    { action: 'travel.approved', performedBy: boss._id.toString(), performedByName: 'Harsh Pandhe',
      targetId: 'seed-tr-1', targetType: 'travel_request',
      metadata: { employeeName: 'Karan Verma', destination: 'Delhi', amount: 28000 }, createdAt: D(-5) },
    { action: 'user.reporting_manager_changed', performedBy: boss._id.toString(), performedByName: 'Harsh Pandhe',
      targetId: employees[0]._id.toString(), targetType: 'user',
      metadata: { reportingManagerId: managerA._id.toString(), employeeName: 'Aarav Sharma' }, createdAt: D(-60) },
  ]))

  await Organization.ensureDoppelmayr()

  return NextResponse.json({
    ok: true,
    accounts: [
      { role: 'admin',     email: boss.email,     password: DEFAULT_PASSWORD },
      { role: 'manager',  email: managerA.email, password: DEFAULT_PASSWORD },
      { role: 'manager',  email: managerB.email, password: DEFAULT_PASSWORD },
      ...empSeeds.map((e, i) => ({
        role: 'employee', email: e.email, password: DEFAULT_PASSWORD,
        onboardingComplete: i !== empSeeds.length - 1,
      })),
    ],
    seeded: {
      users:        allUsers.length,
      employees:    allUsers.length,
      leaveBalances:allUsers.length,
      leaves:       leaveSeeds.length,
      expenses:     expSeeds.length,
      travel:       travelSeeds.length,
      contacts:     contactSeeds.length,
      announcements:4,
      holidays:     11,
      auditEntries: 5,
    },
  })
}
