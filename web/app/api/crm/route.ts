import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import { sanitize } from '@/lib/sanitize'
import { encryptContact, decryptContact } from '@/lib/encrypt'
import { getUser } from '@/lib/auth'
import { pick } from '@/lib/pick'
import { writeAudit } from '@/lib/audit'
import { getOrganizationLimit, getOrganizationUsage } from '@/lib/entitlements/entitlementService'

// createdBy is derived server-side. shareToken/shareTokenExpiresAt are issued
// only by the share route, and isEmployee/employeeClerkId only by directory sync.
const CONTACT_CREATE_FIELDS = [
  'name', 'email', 'phone', 'company', 'designation', 'gender', 'caste', 'religion',
  'notes', 'tags', 'projects', 'photo', 'birthday', 'anniversary',
  'reminderDate', 'reminderNote', 'timeline', 'visibility', 'sharedWith', 'colorLabel',
] as const

export async function GET(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await connectDB()
    const { searchParams } = new URL(req.url)
    const q    = searchParams.get('q') || ''
    const role = user?.role || 'employee'

    // Visibility rules:
    // - Owner (createdBy === me) always sees own
    // - visibility='org' → everyone in org sees it
    // - visibility='team' → managers + boss see it (employees in same team)
    // - visibility='boss_only' → only boss sees it
    // - sharedWith[] contains me → I see it
    const visClauses: Record<string, unknown>[] = [
      { createdBy: userId },
      { visibility: 'org' },
      { sharedWith: userId },
    ]
    if (role === 'manager' || role === 'admin') visClauses.push({ visibility: 'team' })
    if (role === 'admin')                       visClauses.push({ visibility: 'boss_only' })

    const orgId = user?.orgId || 'org_doppelmayr'
    const filter: Record<string, unknown> = { orgId, $or: visClauses }
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      filter.name = { $regex: escaped, $options: 'i' }
    }
    // List view only needs lightweight card fields — skip heavy/encrypted ones
    // (notes, activity, gender/caste/religion). No decrypt pass needed.
    const contacts = await Contact.find(filter)
      .select('name company email phone designation tags photo colorLabel visibility createdBy createdAt')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean()
    return NextResponse.json(contacts)
  } catch (err) {
    console.error('[CRM GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = user?.orgId || 'org_doppelmayr'
  await connectDB()

  const maxContacts = await getOrganizationLimit(orgId, 'maxContacts')
  const currentContacts = await getOrganizationUsage(orgId, 'contacts')
  if (currentContacts >= maxContacts) {
    return NextResponse.json(
      { error: `Organization contact limit reached (${maxContacts}). Upgrade to Premium for higher contact limits.` },
      { status: 403 }
    )
  }

  // sanitize() only strips $-operators — it does not whitelist, so pick() is
  // what stops a client seeding its own shareToken or faking isEmployee.
  const raw  = pick(sanitize(await req.json()), CONTACT_CREATE_FIELDS)
  const body = encryptContact(raw as Record<string, unknown>)
  const contact = await Contact.create({ ...body, orgId, createdBy: userId })

  writeAudit({
    action: 'contact_created',
    performedBy: userId,
    performedByName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.email || userId,
    targetId: contact._id.toString(),
    targetType: 'contact',
    orgId,
    metadata: { name: contact.name, email: contact.email },
  })

  return NextResponse.json(decryptContact(contact.toObject()), { status: 201 })
}
