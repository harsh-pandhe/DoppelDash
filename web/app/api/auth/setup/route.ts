/**
 * One-time setup endpoint — creates the boss account.
 * Protected by SETUP_SECRET env var.
 * Call: POST /api/auth/setup  { secret, email, password, firstName, lastName }
 * Disabled after first boss account exists.
 */
import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import Organization from '@/models/Organization'

async function POST_handler(req: NextRequest) {
  await connectDB()

  // Already have a boss → disabled
  const existing = await User.findOne({ role: 'admin' })
  if (existing) {
    return NextResponse.json({ error: 'Setup already completed' }, { status: 409 })
  }

  const body = await req.json()
  const { secret, email, password, firstName, lastName, orgId } = body

  const expectedSecret = process.env.SETUP_SECRET
  if (!expectedSecret) {
    // No fallback — a hardcoded default here would let anyone create the
    // first admin account on a freshly deployed, not-yet-configured prod.
    return NextResponse.json({ error: 'Setup is not configured' }, { status: 503 })
  }
  if (secret !== expectedSecret) {
    return NextResponse.json({ error: 'Invalid setup secret' }, { status: 403 })
  }

  if (!email || !password || !firstName || !lastName) {
    return NextResponse.json({ error: 'email, password, firstName, lastName required' }, { status: 400 })
  }
  // Operator-supplied tenant: an admin must belong to an EXISTING organisation. There is no default.
  if (typeof orgId !== 'string' || !orgId || !(await Organization.exists({ orgId }))) {
    return NextResponse.json({ error: 'orgId of an existing organization is required' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  const hash = await User.hashPassword(password)
  const boss  = await User.create({
    orgId,
    email:              email.toLowerCase().trim(),
    passwordHash:       hash,
    role:               'admin',
    firstName,
    lastName,
    mustChangePassword: false,
    isActive:           true,
  })

  return NextResponse.json({
    message:   'Boss account created',
    id:        boss._id.toString(),
    email:     boss.email,
    firstName: boss.firstName,
  }, { status: 201 })
}

export const POST = dbGuard(POST_handler)
