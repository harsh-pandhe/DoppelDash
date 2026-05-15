import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import Leave from '@/models/Leave'
import Expense from '@/models/Expense'
import Announcement from '@/models/Announcement'
import { getUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = new URL(req.url).searchParams.get('q')?.trim()
  if (!q || q.length < 2) return NextResponse.json({ results: [] })

  await connectDB()
  const re = new RegExp(q, 'i')

  const [contacts, leaves, expenses, announcements] = await Promise.all([
    Contact.find({ createdBy: userId, $or: [{ name: re }, { email: re }, { company: re }, { designation: re }] }, 'name email company designation photo').limit(5).lean(),
    Leave.find({ userId, $or: [{ userName: re }, { reason: re }, { type: re }] }, 'userName type days status startDate').limit(5).lean(),
    Expense.find({ userId, $or: [{ title: re }, { reason: re }, { userName: re }] }, 'title amount status startDate userName').limit(5).lean(),
    Announcement.find({ $or: [{ title: re }, { body: re }] }, 'title priority createdAt').limit(3).lean(),
  ])

  const results = [
    ...contacts.map(c => ({ type: 'contact', id: c._id, title: c.name, sub: [c.designation, c.company].filter(Boolean).join(' · '), href: `/crm/${c._id}` })),
    ...leaves.map(l => ({ type: 'leave', id: l._id, title: `${l.userName} · ${l.days}d ${l.type} leave`, sub: new Date(l.startDate).toLocaleDateString('en-IN'), href: `/lms/${l._id}` })),
    ...expenses.map(e => ({ type: 'expense', id: e._id, title: e.title, sub: `₹${Number(e.amount).toLocaleString('en-IN')} · ${e.status}`, href: `/rms/${e._id}` })),
    ...announcements.map(a => ({ type: 'announcement', id: a._id, title: a.title, sub: new Date(a.createdAt).toLocaleDateString('en-IN'), href: '/announcements' })),
  ]

  return NextResponse.json({ results })
}
