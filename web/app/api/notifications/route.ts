import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getUser, listUsers } from '@/lib/auth'
import { connectDB } from '@/lib/db'
import Leave from '@/models/Leave'
import Expense from '@/models/Expense'
import TravelRequest from '@/models/TravelRequest'
import Announcement from '@/models/Announcement'
import Contact from '@/models/Contact'
import Employee from '@/models/Employee'
import { writeAudit } from '@/lib/audit'
import { getUserEmail, emailExpenseStatusChanged, emailExpensePendingPayout } from '@/lib/email'
import { selfApprovalCheck } from '@/lib/permissions'

export interface NotifItem {
  id:       string
  kind:     'leave' | 'expense' | 'travel' | 'announcement' | 'reminder' | 'birthday' | 'anniversary'
  title:    string
  subtitle: string
  href:     string
  ts:       string
  urgent?:  boolean
}

export async function GET() {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role  = user?.role || 'employee'
  const isMgr = role === 'manager' || role === 'admin'
  const isBoss = role === 'admin'
  const effectiveOrgId = orgId

  await connectDB()
  const items: NotifItem[] = []

  if (isMgr) {
    // Pending leaves needing approval
    const pendingLeaves = await Leave.find({ orgId: effectiveOrgId, status: 'pending' }).sort({ createdAt: -1 }).limit(10).lean()
    pendingLeaves.forEach(l => items.push({
      id: `leave-${String(l._id)}`, kind: 'leave',
      title: `${l.userName} — ${l.type} leave`,
      subtitle: `${l.days} day${l.days !== 1 ? 's' : ''} · ${l.reason?.slice(0, 60) || ''}`,
      href: '/lms',
      ts: l.createdAt instanceof Date ? l.createdAt.toISOString() : String(l.createdAt),
    }))

    // Expenses awaiting manager approval (non-boss) or pending_admin (boss)
    const expStatus = isBoss ? 'pending_admin' : 'pending_manager'
    const pendingExp = await Expense.find({ orgId: effectiveOrgId, status: expStatus }).sort({ createdAt: -1 }).limit(10).lean()
    pendingExp.forEach(e => items.push({
      id: `exp-${String(e._id)}`, kind: 'expense',
      title: `${e.userName} — ${e.title}`,
      subtitle: `₹${e.amount.toLocaleString('en-IN')}${isBoss ? ' · ready to pay' : ' · awaiting review'}`,
      href: '/rms',
      ts: e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt),
    }))

    // Travel requests
    const trStatus = isBoss ? 'pending_admin' : 'pending_manager'
    const pendingTr = await TravelRequest.find({ orgId: effectiveOrgId, status: trStatus }).sort({ createdAt: -1 }).limit(10).lean()
    pendingTr.forEach(t => items.push({
      id: `tr-${String(t._id)}`, kind: 'travel',
      title: `${t.userName} → ${t.destination}`,
      subtitle: `${t.purpose?.slice(0, 60) || ''} · ₹${t.estimatedTotal?.toLocaleString('en-IN') || 0}`,
      href: '/travel',
      ts: t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
    }))
  }

  // Status changes on MY items (employee + manager + boss)
  const myReturned = await Expense.find({ orgId: effectiveOrgId, userId, status: 'returned' }).sort({ updatedAt: -1 }).limit(5).lean()
  myReturned.forEach(e => items.push({
    id: `exp-ret-${String(e._id)}`, kind: 'expense',
    title: `${e.title} returned for revision`,
    subtitle: e.managerNote?.slice(0, 70) || 'See manager note',
    href: '/rms',
    ts: e.updatedAt instanceof Date ? e.updatedAt.toISOString() : String(e.updatedAt),
    urgent: true,
  }))

  // Pinned + recent announcements (7 days)
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const annos = await Announcement.find({ orgId: effectiveOrgId, $or: [{ pinned: true }, { createdAt: { $gte: since } }] })
    .sort({ pinned: -1, createdAt: -1 }).limit(5).lean()
  annos.forEach(a => items.push({
    id: `ann-${String(a._id)}`, kind: 'announcement',
    title: a.title,
    subtitle: `${a.pinned ? '📌 Pinned · ' : ''}${(a.body || '').replace(/<[^>]*>/g, '').slice(0, 60)}`,
    href: '/announcements',
    ts: a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt),
    urgent: a.priority === 'urgent',
  }))

  // Contact reminders due in next 7 days (mine only)
  const dueSoon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const reminders = await Contact.find({
    orgId: effectiveOrgId,
    createdBy: userId,
    reminderDate: { $exists: true, $lte: dueSoon }
  }, 'name company reminderDate reminderNote').sort({ reminderDate: 1 }).limit(5).lean()
  reminders.forEach(r => {
    const overdue = r.reminderDate && new Date(r.reminderDate) < new Date()
    items.push({
      id: `rem-${String(r._id)}`, kind: 'reminder',
      title: `Reminder: ${r.name}`,
      subtitle: r.reminderNote || r.company || (overdue ? 'Overdue' : 'Due soon'),
      href: `/crm/${r._id}`,
      ts: r.reminderDate instanceof Date ? r.reminderDate.toISOString() : String(r.reminderDate),
      urgent: !!overdue,
    })
  })

  // Upcoming employee birthdays + anniversaries (next 7 days) — team-wide
  const today = new Date(); today.setHours(0,0,0,0)
  const employees = await Employee.find(
    {
      orgId: effectiveOrgId,
      $or: [
        { dateOfBirth:     { $exists: true, $ne: null } },
        { workAnniversary: { $exists: true, $ne: null } },
      ],
      isActive: true,
    },
    'clerkUserId firstName lastName dateOfBirth workAnniversary',
  ).lean()

  const daysUntil = (d: Date) => {
    const thisYear = new Date(today.getFullYear(), d.getMonth(), d.getDate())
    const diff = Math.ceil((thisYear.getTime() - today.getTime()) / 86400000)
    return diff < 0 ? diff + 365 : diff
  }

  for (const e of employees) {
    const fullName = `${e.firstName} ${e.lastName}`.trim()
    if (e.dateOfBirth) {
      const du = daysUntil(new Date(e.dateOfBirth))
      if (du <= 7) {
        const when = du === 0 ? 'today' : du === 1 ? 'tomorrow' : `in ${du} days`
        const eta = new Date(today); eta.setDate(today.getDate() + du)
        items.push({
          id: `bday-${String(e.clerkUserId)}`, kind: 'birthday',
          title: `🎂 ${fullName}'s birthday ${when}`,
          subtitle: new Date(e.dateOfBirth).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }),
          href: '/reports',
          ts: eta.toISOString(),
          urgent: du === 0,
        })
      }
    }
    if (e.workAnniversary) {
      const du = daysUntil(new Date(e.workAnniversary))
      if (du <= 7) {
        const years = today.getFullYear() - new Date(e.workAnniversary).getFullYear()
        const when = du === 0 ? 'today' : du === 1 ? 'tomorrow' : `in ${du} days`
        const eta = new Date(today); eta.setDate(today.getDate() + du)
        items.push({
          id: `annv-${String(e.clerkUserId)}`, kind: 'anniversary',
          title: `🎉 ${fullName} — ${years} year${years !== 1 ? 's' : ''} ${when}`,
          subtitle: `Work anniversary · joined ${new Date(e.workAnniversary).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`,
          href: '/reports',
          ts: eta.toISOString(),
        })
      }
    }
  }

  // Sort by recency (urgent first within same day)
  items.sort((a, b) => {
    if (!!a.urgent !== !!b.urgent) return a.urgent ? -1 : 1
    return new Date(b.ts).getTime() - new Date(a.ts).getTime()
  })

  return NextResponse.json({ items, count: items.length, urgentCount: items.filter(i => i.urgent).length })
}

// Bulk-approve pending expenses straight from the notifications panel.
// Manager: pending_manager -> pending_admin. Boss: pending_admin -> paid.
export async function POST(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role !== 'manager' && role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const isBoss = role === 'admin'
  const effectiveOrgId = orgId

  const body = await req.json().catch(() => ({}))
  const rawIds: string[] = Array.isArray(body.expenseIds) ? body.expenseIds : []
  const ids = rawIds.filter(id => typeof id === 'string' && mongoose.isValidObjectId(id))
  if (ids.length === 0) return NextResponse.json({ error: 'No valid expense IDs' }, { status: 400 })

  await connectDB()
  const fromStatus = isBoss ? 'pending_admin' : 'pending_manager'
  const toStatus   = isBoss ? 'paid' : 'pending_admin'
  const actorName  = user?.fullName || user?.firstName || (isBoss ? 'Boss' : 'Manager')

  const expenses = await Expense.find({ _id: { $in: ids }, orgId: effectiveOrgId, status: fromStatus })
  let approved = 0
  const approvedExpenses: typeof expenses = []

  for (const e of expenses) {
    const check = selfApprovalCheck(userId, role, e.userId)
    if (check.blocked) continue

    const selfApproved = check.selfApproved
    e.status = toStatus
    if (isBoss) { e.paidBy = userId; e.paidAt = new Date() } else { e.approvedBy = userId }
    await e.save()
    approved++
    approvedExpenses.push(e)

    writeAudit({
      action: selfApproved ? `expense.${toStatus}.self_approved` : `expense.${toStatus}`,
      performedBy: userId, performedByName: actorName,
      targetId: String(e._id), targetType: 'expense',
      metadata: { status: toStatus, employeeName: e.userName, amount: e.amount, bulk: true, ...(selfApproved ? { selfApproved: true } : {}) },
      orgId: effectiveOrgId,
    })
    if (isBoss) {
      getUserEmail(e.userId).then(email => {
        if (email) emailExpenseStatusChanged({ orgId, employeeEmail: email, status: 'paid', title: e.title, amount: e.amount })
      })
    }
  }

  // Manager bulk-approve -> notify bosses
  if (!isBoss && approved > 0) {
    ;(async () => {
      try {
        const users = await listUsers({ limit: 500, orgId: effectiveOrgId })
        const bosses = users.filter(u => u.role === 'admin')
        for (const e of approvedExpenses) {
          for (const b of bosses) {
            if (b.email) emailExpensePendingPayout({ orgId, bossEmail: b.email, employeeName: e.userName, title: e.title, amount: e.amount })
          }
        }
      } catch { /* best-effort */ }
    })()
  }

  return NextResponse.json({ approved, skipped: rawIds.length - approved })
}
