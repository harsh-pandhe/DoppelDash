import mongoose from 'mongoose'

const URI = 'mongodb://localhost:27017/doppeldash'
await mongoose.connect(URI)
const db = mongoose.connection
const Users    = db.collection('users')
const Expenses = db.collection('expenses')
const Leaves   = db.collection('leaves')
const Travel   = db.collection('travelrequests')

// Placeholder doc URLs that resolve in browser
const RECEIPT_IMAGES = [
  'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=600&q=70',   // receipt
  'https://images.unsplash.com/photo-1593672715438-d88a70629abe?w=600&q=70', // invoice
  'https://images.unsplash.com/photo-1542744095-291d1f67b221?w=600&q=70',    // bill
  'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=600&q=70', // hotel
  'https://images.unsplash.com/photo-1556740738-b6a63e27c4df?w=600&q=70',    // food
]
const MEDICAL_DOCS = [
  'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=600&q=70', // medical
  'https://images.unsplash.com/photo-1631815589068-31a1aaadb15b?w=600&q=70', // prescription
]
const FLIGHT_TICKETS = [
  'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=600&q=70', // boarding pass
]
const r = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]

const users = await Users.find({}).toArray()
const find  = (email: string) => users.find(u => u.email === email)
const rahul   = find('rahul.sharma@doppelmayr.in')
const aisha   = find('aisha.khan@doppelmayr.in')
const sneha   = find('sneha.patel@doppelmayr.in')
const karan   = find('karan.singh@doppelmayr.in')
const ananya  = find('ananya.mehta@doppelmayr.in')
const vikram  = find('vikram.reddy@doppelmayr.in')
const rohit   = find('rohit.gupta@doppelmayr.in')
const priya   = find('priya.iyer@doppelmayr.in')   // manager
const arjun   = find('arjun.kapoor@doppelmayr.in') // manager

if (!rahul || !aisha || !sneha) { console.error('Seed users missing — run _seed_demo first'); process.exit(1) }

// Wipe pending/in-flight items so demo starts fresh on those
await Expenses.deleteMany({ status: { $in: ['pending_manager', 'pending_boss', 'returned'] } })
await Leaves.deleteMany({ status: 'pending' })
await Travel.deleteMany({ status: { $in: ['pending_manager', 'pending_boss'] } })
console.log('Wiped pending items')

const now = new Date()
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000)

/* ─── New expenses WITH documents (mix of statuses for demo) ────────── */
const expenses = [
  // 1. Rahul — table mode with 4 line items, full doc set, pending manager
  {
    user: rahul,
    title: 'Bangalore Metro client visit — 3-day trip',
    reason: 'Site survey + tender presentation to BMRCL. Met with Chief Engineer, finalised scope for 2.3km feeder cable car phase 2.',
    status: 'pending_manager',
    startDate: daysAgo(5),
    travelFrom: 'Pune', travelTo: 'Bangalore',
    hasLineItems: true,
    lineItems: [
      { description: 'Flight Pune → Bangalore (Indigo 6E-241)',  amount: 4850, date: daysAgo(7), category: 'flight', receiptUrl: r(FLIGHT_TICKETS),  status: 'pending' },
      { description: 'Taj MG Road — 2 nights AC deluxe',          amount: 8400, date: daysAgo(6), category: 'hotel',  receiptUrl: r(RECEIPT_IMAGES), status: 'pending' },
      { description: 'Ola Outstation — site to hotel (3 trips)',  amount: 1680, date: daysAgo(5), category: 'taxi',   receiptUrl: r(RECEIPT_IMAGES), status: 'pending' },
      { description: 'Client dinner — Karavalli restaurant',      amount: 3200, date: daysAgo(5), category: 'food',   receiptUrl: r(RECEIPT_IMAGES), status: 'pending' },
      { description: 'Return flight Bangalore → Pune',            amount: 5100, date: daysAgo(4), category: 'flight', receiptUrl: r(FLIGHT_TICKETS), status: 'pending' },
    ],
    receipts: [r(RECEIPT_IMAGES)],
  },
  // 2. Aisha — simple expense pending boss, has receipts
  {
    user: aisha,
    title: 'Doppelmayr-branded site safety gear',
    reason: 'Helmets, hi-vis vests, branded backpacks for engineering team. Approved by Priya, awaiting payout.',
    status: 'pending_boss', amount: 18450,
    startDate: daysAgo(3),
    receipts: [r(RECEIPT_IMAGES), r(RECEIPT_IMAGES)],
    approvedBy: priya?._id?.toString(),
    managerNote: 'Approved — needed for Phase 2 kickoff.',
  },
  // 3. Sneha — table mode, returned with note
  {
    user: sneha,
    title: 'Q1 client meet — Mumbai',
    reason: 'Pitch meeting with L&T Metro team',
    status: 'returned',
    startDate: daysAgo(12),
    hasLineItems: true,
    lineItems: [
      { description: 'Uber to airport',          amount: 850,  date: daysAgo(13), category: 'taxi',  receiptUrl: r(RECEIPT_IMAGES), status: 'pending' },
      { description: 'Lunch with client (3 ppl)',amount: 4200, date: daysAgo(12), category: 'food',  receiptUrl: r(RECEIPT_IMAGES), status: 'pending' },
      { description: 'Misc',                     amount: 1500, date: daysAgo(12), category: 'misc',  receiptUrl: '', status: 'pending' },
    ],
    receipts: [],
    managerNote: 'Need itemised bill for client lunch — current receipt unreadable. Pls upload clearer version of Karavalli bill.',
  },
  // 4. Karan — pending manager, with mid-trip line items + bills
  {
    user: karan,
    title: 'Hyderabad metro recce',
    reason: 'Initial site survey, met with HMRL ops head',
    status: 'pending_manager',
    startDate: daysAgo(2),
    hasLineItems: true,
    lineItems: [
      { description: 'Bus Hyderabad volvo sleeper',  amount: 1850, date: daysAgo(3), category: 'taxi',  receiptUrl: r(RECEIPT_IMAGES), status: 'pending' },
      { description: 'Hotel Trident — 1 night',       amount: 5200, date: daysAgo(3), category: 'hotel', receiptUrl: r(RECEIPT_IMAGES), status: 'pending' },
      { description: 'Local taxi 2 trips',            amount: 920,  date: daysAgo(2), category: 'taxi',  receiptUrl: r(RECEIPT_IMAGES), status: 'pending' },
      { description: 'Lunch at Paradise biryani',     amount: 480,  date: daysAgo(2), category: 'food',  receiptUrl: r(RECEIPT_IMAGES), status: 'pending' },
    ],
    receipts: [],
  },
  // 5. Vikram — simple, pending manager
  {
    user: vikram,
    title: 'Diesel + tolls for site truck',
    reason: 'Round trip Pune-Mumbai for equipment ferry',
    status: 'pending_manager', amount: 3450,
    startDate: daysAgo(1),
    receipts: [r(RECEIPT_IMAGES)],
  },
  // 6. Rohit — pending manager
  {
    user: rohit,
    title: 'Office printer cartridges + stationery',
    reason: 'Q2 supply restock',
    status: 'pending_manager', amount: 4280,
    startDate: daysAgo(4),
    receipts: [r(RECEIPT_IMAGES), r(RECEIPT_IMAGES)],
  },
  // 7. Ananya — pending boss, paid manager-approved already
  {
    user: ananya,
    title: 'New hire welcome kits (4 nos.)',
    reason: 'Branded merch + onboarding folders for Karan, Vikram, Rohit, Ananya',
    status: 'pending_boss', amount: 12600,
    startDate: daysAgo(6),
    receipts: [r(RECEIPT_IMAGES)],
    approvedBy: priya?._id?.toString(),
    managerNote: 'Approved — Aisha checked invoice line by line.',
  },
]

let total = 0
for (const e of expenses) {
  const amt = e.amount ?? (e.lineItems?.reduce((s: number, l: { amount: number }) => s + l.amount, 0) || 0)
  await Expenses.insertOne({
    userId:   e.user._id.toString(),
    userName: `${e.user.firstName} ${e.user.lastName}`,
    title: e.title, reason: e.reason, amount: amt,
    startDate: e.startDate,
    status: e.status,
    hasLineItems: !!e.hasLineItems,
    lineItems:    e.lineItems || [],
    receipts:     e.receipts || [],
    travelFrom:   e.travelFrom, travelTo: e.travelTo,
    managerNote:  e.managerNote,
    approvedBy:   e.approvedBy,
    createdAt: daysAgo(Math.random() * 7 + 1), updatedAt: now,
  })
  total++
}
console.log(`Inserted ${total} expenses with line items + receipts`)

/* ─── Leaves with medical docs ──────────────────────────────────────── */
const leaves = [
  // Sick leave with doctor note — pending
  {
    user: aisha, type: 'sick',
    startDate: daysAgo(-2), endDate: daysAgo(-4), days: 3,
    reason: 'Viral fever and throat infection — doctor advised 3 days rest',
    medicalDocs: [r(MEDICAL_DOCS), r(MEDICAL_DOCS)],
    status: 'pending',
  },
  // Casual pending
  {
    user: rahul, type: 'casual',
    startDate: daysAgo(-7), endDate: daysAgo(-7), days: 1,
    reason: 'Family function in hometown',
    status: 'pending',
  },
  // Earned pending — long
  {
    user: sneha, type: 'earned',
    startDate: daysAgo(-15), endDate: daysAgo(-21), days: 7,
    reason: 'Annual family vacation to Kerala — pre-booked tickets attached',
    medicalDocs: [r(RECEIPT_IMAGES)],
    status: 'pending',
  },
  // Sick half-day pending
  {
    user: karan, type: 'sick',
    startDate: daysAgo(0), endDate: daysAgo(0), days: 0.5,
    isHalfDay: true, halfDayPeriod: 'afternoon',
    reason: 'Doctor appointment — root canal follow-up',
    medicalDocs: [r(MEDICAL_DOCS)],
    status: 'pending',
  },
  // Privilege leave pending
  {
    user: vikram, type: 'privilege',
    startDate: daysAgo(-30), endDate: daysAgo(-30), days: 1,
    reason: 'Wedding anniversary',
    status: 'pending',
  },
  // LWP pending — large
  {
    user: ananya, type: 'lwp',
    startDate: daysAgo(-45), endDate: daysAgo(-52), days: 8, isLWP: true,
    reason: 'Brother getting married, family obligations. Will be unreachable.',
    status: 'pending',
  },
]

let lcount = 0
for (const l of leaves) {
  await Leaves.insertOne({
    userId:   l.user._id.toString(),
    userName: `${l.user.firstName} ${l.user.lastName}`,
    type: l.type, startDate: l.startDate, endDate: l.endDate, days: l.days,
    reason: l.reason, status: l.status,
    medicalDocs: l.medicalDocs || [],
    isLWP: !!l.isLWP, isHalfDay: !!l.isHalfDay, halfDayPeriod: l.halfDayPeriod,
    createdAt: daysAgo(Math.random() * 5 + 1), updatedAt: now,
  })
  lcount++
}
console.log(`Inserted ${lcount} pending leaves with medical docs`)

/* ─── Travel requests pending approval ──────────────────────────────── */
const travel = [
  {
    user: rahul,
    purpose: 'Mumbai client demo — proposed 3.4km urban ropeway in BKC',
    destination: 'Mumbai',
    departureDate: daysAgo(-10), returnDate: daysAgo(-12),
    estimatedTotal: 24500, advanceRequested: 15000,
    legs: [
      { from: 'Pune', to: 'Mumbai', date: daysAgo(-10), mode: 'flight', estimatedCost: 5500, notes: 'Morning Indigo flight, demo at 2pm' },
      { from: 'Mumbai', to: 'Pune',  date: daysAgo(-12), mode: 'flight', estimatedCost: 5500 },
    ],
    accommodation: { required: true, city: 'Mumbai', checkIn: daysAgo(-10), checkOut: daysAgo(-12), estimatedCost: 13500 },
    status: 'pending_manager',
  },
  {
    user: sneha,
    purpose: 'Delhi DMRC L4 corridor proposal — Phase 3 expansion',
    destination: 'Delhi',
    departureDate: daysAgo(-14), returnDate: daysAgo(-16),
    estimatedTotal: 32000, advanceRequested: 25000,
    legs: [
      { from: 'Pune', to: 'Delhi',  date: daysAgo(-14), mode: 'flight', estimatedCost: 7800 },
      { from: 'Delhi', to: 'Pune',  date: daysAgo(-16), mode: 'flight', estimatedCost: 7400 },
    ],
    accommodation: { required: true, city: 'Delhi', checkIn: daysAgo(-14), checkOut: daysAgo(-16), estimatedCost: 16800 },
    status: 'pending_boss',
    approvedBy: arjun?._id?.toString(),
    managerNote: 'Approved — strategic client, advance approved up to ₹25k.',
  },
  {
    user: karan,
    purpose: 'Chennai metro site recce',
    destination: 'Chennai',
    departureDate: daysAgo(-20), returnDate: daysAgo(-21),
    estimatedTotal: 8500, advanceRequested: 5000,
    legs: [
      { from: 'Pune', to: 'Chennai', date: daysAgo(-20), mode: 'train',  estimatedCost: 1800 },
      { from: 'Chennai', to: 'Pune', date: daysAgo(-21), mode: 'flight', estimatedCost: 4200 },
    ],
    accommodation: { required: true, city: 'Chennai', checkIn: daysAgo(-20), checkOut: daysAgo(-21), estimatedCost: 2500 },
    status: 'pending_manager',
  },
  {
    user: ananya,
    purpose: 'HR offsite — leadership training in Lonavala',
    destination: 'Lonavala',
    departureDate: daysAgo(-30), returnDate: daysAgo(-32),
    estimatedTotal: 14000, advanceRequested: 8000,
    legs: [
      { from: 'Pune', to: 'Lonavala', date: daysAgo(-30), mode: 'own_vehicle', estimatedCost: 800, notes: 'Carpool with team' },
      { from: 'Lonavala', to: 'Pune', date: daysAgo(-32), mode: 'own_vehicle', estimatedCost: 800 },
    ],
    accommodation: { required: true, city: 'Lonavala', checkIn: daysAgo(-30), checkOut: daysAgo(-32), estimatedCost: 12400 },
    status: 'pending_manager',
  },
]

let tcount = 0
for (const t of travel) {
  await Travel.insertOne({
    userId:   t.user._id.toString(),
    userName: `${t.user.firstName} ${t.user.lastName}`,
    purpose: t.purpose, destination: t.destination,
    departureDate: t.departureDate, returnDate: t.returnDate,
    legs: t.legs, accommodation: t.accommodation,
    estimatedTotal: t.estimatedTotal, advanceRequested: t.advanceRequested,
    status: t.status, approvedBy: t.approvedBy, managerNote: t.managerNote,
    createdAt: daysAgo(Math.random() * 5 + 1), updatedAt: now,
  })
  tcount++
}
console.log(`Inserted ${tcount} pending travel requests`)

console.log('\n=== READY TO REVIEW ===')
console.log('Login as boss: harshpandhehome@gmail.com / BossPass123#')
console.log('Login as manager Priya (Eng): priya.iyer@doppelmayr.in / Demo1234#')
console.log('Login as manager Arjun (Sales): arjun.kapoor@doppelmayr.in / Demo1234#')
console.log('\nPending items waiting:')
console.log(`  ${total} expenses (mix of pending_manager, pending_boss, returned)`)
console.log(`  ${lcount} leaves (mix of sick+docs, casual, earned, half-day, LWP)`)
console.log(`  ${tcount} travel requests (pending_manager + pending_boss)`)
console.log('====================')

await mongoose.disconnect()
