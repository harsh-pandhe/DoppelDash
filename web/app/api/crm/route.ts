import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import { sanitize } from '@/lib/sanitize'
import { encryptContact, decryptContact } from '@/lib/encrypt'
import { getUser } from '@/lib/auth'
import { pick } from '@/lib/pick'
import { CONTACT_WRITE_FIELDS, visibilityClauses, canManageContact, canShareContact, sanitizeSharedWith, validationProblem, escapeRegex } from '@/lib/crm/contactAccess'
import { writeAudit } from '@/lib/audit'
import { getOrganizationLimit, getOrganizationUsage } from '@/lib/entitlements/entitlementService'

export async function GET(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await connectDB()
    const { searchParams } = new URL(req.url)
    const q    = searchParams.get('q') || ''
    const role = user?.role || 'employee'

    // Visibility rules (see lib/crm/contactAccess): owner, org-wide, explicitly shared, team (manager+), boss_only (admin).
    const and: Record<string, unknown>[] = [{ $or: visibilityClauses(role, userId) }]
    const term = q.trim().slice(0, 100)
    if (term) {
      const rx = { $regex: escapeRegex(term), $options: 'i' }
      and.push({ $or: [{ name: rx }, { company: rx }, { email: rx }, { phone: rx }, { tags: rx }] })
    }
    const tag = (searchParams.get('tag') || '').trim()
    if (tag) and.push({ tags: tag })
    const filter: Record<string, unknown> = { orgId, $and: and }
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '200', 10) || 200, 1), 200)
    const skip  = Math.max(parseInt(searchParams.get('skip') || '0', 10) || 0, 0)
    // List view only needs lightweight card fields — skip heavy/encrypted ones
    // (notes, activity, gender/caste/religion). No decrypt pass needed.
    const rows = await Contact.find(filter)
      .select('name company email phone designation tags photo colorLabel visibility createdBy createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
    // Server-authoritative permission flags so clients never guess who may edit/delete/share.
    const contacts = rows.map(c => ({ ...c, canManage: canManageContact(role, userId, c.createdBy), canShare: canShareContact(userId, c.createdBy) }))
    return NextResponse.json(contacts)
  } catch (err) {
    console.error('[CRM GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
  const picked = pick(sanitize(await req.json()), CONTACT_WRITE_FIELDS) as Record<string, unknown>
  if (typeof picked.name !== 'string' || !picked.name.trim()) {
    return NextResponse.json({ error: 'Invalid contact', fields: ['name'] }, { status: 400 })
  }
  if ('sharedWith' in picked) picked.sharedWith = await sanitizeSharedWith(orgId, picked.sharedWith)
  const body = encryptContact(picked)
  let contact
  try {
    contact = await Contact.create({ ...body, orgId, createdBy: userId })
  } catch (err) {
    const problem = validationProblem(err)
    if (problem) return NextResponse.json(problem, { status: 400 })
    throw err
  }

  writeAudit({
    action: 'contact_created',
    performedBy: userId,
    performedByName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.email || userId,
    targetId: contact._id.toString(),
    targetType: 'contact',
    orgId,
    metadata: { name: contact.name, email: contact.email },
  })

  return NextResponse.json({ ...decryptContact(contact.toObject()), canManage: true, canShare: true }, { status: 201 })
}
