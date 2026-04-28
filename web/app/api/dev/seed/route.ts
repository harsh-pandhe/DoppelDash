import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import Leave from '@/models/Leave'
import Expense from '@/models/Expense'
import Announcement from '@/models/Announcement'
import { encrypt } from '@/lib/encrypt'

// DEV ONLY — remove or gate behind env check before production
export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Disabled in production' }, { status: 403 })
  }

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()

  // ── Wipe existing seed data for this user ─────────────────────────
  await Promise.all([
    Contact.deleteMany({ createdBy: userId }),
    Leave.deleteMany({ userId }),
    Expense.deleteMany({ userId }),
    Announcement.deleteMany({}),
  ])

  // ── Contacts ──────────────────────────────────────────────────────
  const contacts = await Contact.insertMany([
    {
      createdBy: userId,
      name: 'Praphulla Sharma',
      email: 'praphulla.sharma@doppelmayr.in',
      phone: '+91 98765 43210',
      company: 'Doppelmayr India Pvt Ltd',
      designation: 'Director, Operations',
      website: 'www.doppelmayr.com',
      religion: encrypt('Hindu'),
      caste: encrypt('Brahmin'),
      tags: ['key-account', 'director'],
      notes: 'Met at Rope Access India 2024. Very interested in urban ropeway projects.',
      timeline: [
        { type: 'meeting', title: 'Initial meeting at RAI 2024', date: new Date('2024-11-15'), source: 'manual' },
        { type: 'call',    title: 'Follow-up call re: Mumbai ropeway RFP', date: new Date('2024-12-03'), source: 'manual' },
        { type: 'email',   title: 'Sent proposal for Phase 2 expansion', date: new Date('2025-01-20'), source: 'manual' },
      ],
      createdAt: new Date('2025-11-10'),
    },
    {
      createdBy: userId,
      name: 'Kavita Nair',
      email: 'kavita.nair@siemens.com',
      phone: '+91 99001 12345',
      company: 'Siemens Mobility India',
      designation: 'Senior Project Manager',
      religion: encrypt('Hindu'),
      tags: ['partner', 'mobility'],
      notes: 'Key contact for joint ventures on metro integration.',
      timeline: [
        { type: 'call', title: 'Intro call via Rohan referral', date: new Date('2025-02-10'), source: 'manual' },
      ],
      createdAt: new Date('2025-12-05'),
    },
    {
      createdBy: userId,
      name: 'Mohammed Farooq',
      email: 'farooq@infra-builders.co.in',
      phone: '+91 97654 32109',
      company: 'Infra Builders & Associates',
      designation: 'Chief Engineer',
      religion: encrypt('Muslim'),
      tags: ['civil', 'contractor'],
      birthday: new Date('1978-08-14'),
      timeline: [],
      createdAt: new Date('2025-12-20'),
    },
    {
      createdBy: userId,
      name: 'Suresh Reddy',
      email: 'sreddy@andhraportal.gov.in',
      phone: '+91 94400 55566',
      company: 'Andhra Pradesh Infrastructure Corp',
      designation: 'Deputy Director',
      religion: encrypt('Hindu'),
      caste: encrypt('Reddy'),
      tags: ['government', 'ap'],
      timeline: [
        { type: 'meeting', title: 'Presentation at AP Infra Summit', date: new Date('2025-03-05'), source: 'manual' },
        { type: 'note',    title: 'Interested in ropeway connectivity to hill temples', body: 'Tirupati-Tirumala corridor discussed specifically. High priority.', date: new Date('2025-03-06'), source: 'manual' },
      ],
      createdAt: new Date('2026-01-08'),
    },
    {
      createdBy: userId,
      name: 'Priya Mehta',
      email: 'priya.mehta@l-t.com',
      phone: '+91 98200 77788',
      company: 'Larsen & Toubro',
      designation: 'VP, Infrastructure Projects',
      religion: encrypt('Hindu'),
      caste: encrypt('Patel'),
      tags: ['tier-1', 'epc'],
      birthday: new Date('1980-12-01'),
      timeline: [
        { type: 'email', title: 'Sent DGS product catalogue', date: new Date('2025-01-08'), source: 'manual' },
        { type: 'call',  title: 'Q1 pipeline discussion', date: new Date('2025-04-02'), source: 'manual' },
      ],
      createdAt: new Date('2026-01-22'),
    },
    {
      createdBy: userId,
      name: 'David Fernandes',
      email: 'd.fernandes@garuda-infra.com',
      phone: '+91 91234 56789',
      company: 'Garuda Infrastructure',
      designation: 'Managing Director',
      religion: encrypt('Christian'),
      tags: ['md', 'decision-maker'],
      anniversary: new Date('2003-02-14'),
      timeline: [],
      createdAt: new Date('2026-02-03'),
    },
    {
      createdBy: userId,
      name: 'Rajat Bose',
      email: 'rajat.bose@wb-transit.gov.in',
      phone: '+91 93300 44422',
      company: 'West Bengal Transit Corp',
      designation: 'Chief Project Officer',
      religion: encrypt('Hindu'),
      caste: encrypt('Kayastha'),
      tags: ['government', 'wb'],
      timeline: [
        { type: 'meeting', title: 'Kolkata ropeway feasibility discussion', date: new Date('2025-04-10'), source: 'manual' },
      ],
      createdAt: new Date('2026-02-18'),
    },
    {
      createdBy: userId,
      name: 'Amita Joshi',
      email: 'amita@joshi-consulting.in',
      phone: '+91 88001 23456',
      company: 'Joshi Consulting Group',
      designation: 'Lead Consultant',
      religion: encrypt('Hindu'),
      caste: encrypt('Brahmin'),
      tags: ['consultant', 'neutral'],
      timeline: [],
      createdAt: new Date('2026-03-12'),
    },
    {
      createdBy: userId,
      name: 'Nikhil Shenoy',
      email: 'nikhil.shenoy@konkan-dev.in',
      phone: '+91 96500 11223',
      company: 'Konkan Development Corp',
      designation: 'Project Director',
      religion: encrypt('Hindu'),
      tags: ['coastal', 'development'],
      timeline: [
        { type: 'meeting', title: 'Coastal ropeway feasibility call', date: new Date('2026-03-28'), source: 'manual' },
      ],
      createdAt: new Date('2026-03-25'),
    },
    {
      createdBy: userId,
      name: 'Sunita Agarwal',
      email: 's.agarwal@railmadad.in',
      phone: '+91 87890 34567',
      company: 'Rail Madad Infrastructure',
      designation: 'General Manager',
      religion: encrypt('Hindu'),
      caste: encrypt('Agarwal'),
      tags: ['rail', 'partner'],
      timeline: [
        { type: 'email', title: 'Sent station-ropeway integration proposal', date: new Date('2026-04-05'), source: 'manual' },
      ],
      createdAt: new Date('2026-04-02'),
    },
  ])

  // ── Leaves — spread across Nov 2025–Apr 2026 ─────────────────────
  const leaveData = [
    {
      userId, userName: 'Harsh Pandhe',
      type: 'casual', startDate: new Date('2025-11-08'), endDate: new Date('2025-11-08'), days: 1,
      reason: 'Diwali extended family gathering.',
      status: 'approved', approvedBy: 'boss-user-id',
      createdAt: new Date('2025-11-06'),
    },
    {
      userId, userName: 'Harsh Pandhe',
      type: 'medical', startDate: new Date('2025-12-02'), endDate: new Date('2025-12-04'), days: 3,
      reason: 'Viral fever with doctor-advised rest.',
      status: 'approved', approvedBy: 'boss-user-id',
      createdAt: new Date('2025-12-02'),
    },
    {
      userId, userName: 'Harsh Pandhe',
      type: 'casual', startDate: new Date('2026-01-26'), endDate: new Date('2026-01-26'), days: 1,
      reason: 'Republic Day — personal travel to Delhi.',
      status: 'rejected', managerNote: 'Republic Day is a national holiday, leave not needed.',
      createdAt: new Date('2026-01-24'),
    },
    {
      userId, userName: 'Harsh Pandhe',
      type: 'earned', startDate: new Date('2026-02-10'), endDate: new Date('2026-02-14'), days: 5,
      reason: 'Annual vacation — Goa trip.',
      status: 'approved', approvedBy: 'boss-user-id',
      createdAt: new Date('2026-02-05'),
    },
    {
      userId, userName: 'Harsh Pandhe',
      type: 'casual', startDate: new Date('2026-03-10'), endDate: new Date('2026-03-11'), days: 2,
      reason: "Sister's engagement ceremony.",
      status: 'approved', approvedBy: 'boss-user-id',
      createdAt: new Date('2026-03-08'),
    },
    {
      userId, userName: 'Harsh Pandhe',
      type: 'medical', startDate: new Date('2026-04-03'), endDate: new Date('2026-04-05'), days: 3,
      reason: 'Back pain — physiotherapy sessions.',
      status: 'pending',
      createdAt: new Date('2026-04-03'),
    },
    {
      userId, userName: 'Harsh Pandhe',
      type: 'earned', startDate: new Date('2026-05-01'), endDate: new Date('2026-05-03'), days: 3,
      reason: 'Coorg trip with family.',
      status: 'pending',
      createdAt: new Date('2026-04-20'),
    },
  ]
  await Leave.insertMany(leaveData)

  // ── Expenses — spread across Nov 2025–Apr 2026 ────────────────────
  const expenseData = [
    {
      userId, userName: 'Harsh Pandhe',
      title: 'Mumbai Site Visit — Travel & Stay',
      reason: 'Client meeting at Andheri office + BKC ropeway corridor site survey.',
      amount: 12450,
      travelFrom: 'Pune', travelTo: 'Mumbai',
      startDate: new Date('2025-11-14'), endDate: new Date('2025-11-15'),
      status: 'paid', approvedBy: 'manager-id', paidBy: 'boss-id',
      createdAt: new Date('2025-11-14'),
    },
    {
      userId, userName: 'Harsh Pandhe',
      title: 'Office Supplies — Q4',
      reason: 'Stationery, printer cartridges, binding material for Q4 proposal documents.',
      amount: 3200,
      startDate: new Date('2025-12-05'),
      status: 'paid', approvedBy: 'manager-id', paidBy: 'boss-id',
      createdAt: new Date('2025-12-05'),
    },
    {
      userId, userName: 'Harsh Pandhe',
      title: 'AP Infra Summit — Registration + Flight',
      reason: 'Attended AP Infrastructure Summit 2026 in Vijayawada. Represented company.',
      amount: 24800,
      travelFrom: 'Mumbai', travelTo: 'Vijayawada',
      startDate: new Date('2026-01-22'), endDate: new Date('2026-01-24'),
      status: 'paid', approvedBy: 'manager-id', paidBy: 'boss-id',
      createdAt: new Date('2026-01-22'),
    },
    {
      userId, userName: 'Harsh Pandhe',
      title: 'Client Dinner — Siemens team',
      reason: 'Business dinner with Kavita Nair + 3 colleagues at Trident BKC.',
      amount: 8200,
      startDate: new Date('2026-02-15'),
      status: 'paid', approvedBy: 'manager-id', paidBy: 'boss-id',
      createdAt: new Date('2026-02-15'),
    },
    {
      userId, userName: 'Harsh Pandhe',
      title: 'Kolkata Site Inspection',
      reason: 'Feasibility inspection for WB Transit ropeway proposal. 2-day trip.',
      amount: 18600,
      travelFrom: 'Mumbai', travelTo: 'Kolkata',
      startDate: new Date('2026-03-10'), endDate: new Date('2026-03-12'),
      status: 'pending_boss', approvedBy: 'manager-id',
      managerNote: 'Approved. Attach transport receipts.',
      createdAt: new Date('2026-03-10'),
    },
    {
      userId, userName: 'Harsh Pandhe',
      title: 'AutoCAD License Renewal',
      reason: 'Annual Autodesk AutoCAD renewal for design team workstation.',
      amount: 45000,
      startDate: new Date('2026-04-01'),
      status: 'pending_manager',
      createdAt: new Date('2026-04-01'),
    },
    {
      userId, userName: 'Harsh Pandhe',
      title: 'Tirupati Kick-off — Travel',
      reason: 'Travel for Tirupati-Tirumala ropeway project kick-off meeting.',
      amount: 9800,
      travelFrom: 'Mumbai', travelTo: 'Tirupati',
      startDate: new Date('2026-04-15'), endDate: new Date('2026-04-16'),
      status: 'pending_manager',
      createdAt: new Date('2026-04-15'),
    },
  ]
  await Expense.insertMany(expenseData)

  // ── Announcements ─────────────────────────────────────────────────
  await Announcement.insertMany([
    {
      authorId: userId, authorName: 'Harsh Pandhe',
      title: 'Office Closed — Maharashtra Day',
      body: 'The office will remain closed on 1st May 2026 (Thursday) for Maharashtra Day. Work from home if required.',
      pinned: true, priority: 'important',
      createdAt: new Date('2026-04-25'),
    },
    {
      authorId: userId, authorName: 'Harsh Pandhe',
      title: 'New Project Awarded — Tirupati Ropeway',
      body: 'Excited to announce that DGS has been awarded the Tirupati-Tirumala Urban Ropeway Connectivity project by AP Infrastructure Corp. Kick-off meeting scheduled for 15th April. All team members please attend.',
      pinned: true, priority: 'urgent',
      createdAt: new Date('2026-04-10'),
    },
    {
      authorId: userId, authorName: 'Harsh Pandhe',
      title: 'Updated Leave Policy FY 2026–27',
      body: 'HR has updated the leave policy for FY 2026–27. Casual leave increased to 12 days. Earned leave carry-forward capped at 30 days. Please review the updated policy document on the shared drive.',
      pinned: false, priority: 'important',
      createdAt: new Date('2026-04-01'),
    },
    {
      authorId: userId, authorName: 'Harsh Pandhe',
      title: 'Q4 All-Hands Meeting — 30th April',
      body: 'Mandatory all-hands meeting on 30th April at 3:00 PM in the main conference room. Agenda: Q4 review, FY2027 targets, and Tirupati project update. Attendance compulsory.',
      pinned: false, priority: 'normal',
      createdAt: new Date('2026-04-22'),
    },
    {
      authorId: userId, authorName: 'Harsh Pandhe',
      title: 'IT: System Maintenance — Saturday 26th April',
      body: 'Planned maintenance on Saturday 26th April from 10 PM to 2 AM. DoppelDash and internal systems will be unavailable. Save your work before EOD Saturday.',
      pinned: false, priority: 'normal',
      createdAt: new Date('2026-04-23'),
    },
  ])

  return NextResponse.json({
    ok: true,
    seeded: {
      contacts: contacts.length,
      leaves: leaveData.length,
      expenses: expenseData.length,
      announcements: 5,
    },
    userId,
  })
}
