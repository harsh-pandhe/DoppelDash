/**
 * One-time setup endpoint — creates the boss account.
 * Protected by SETUP_SECRET env var.
 * Call: POST /api/auth/setup  { secret, email, password, firstName, lastName }
 * Disabled after first boss account exists.
 */
import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import User from '@/models/User'

export async function POST(req: NextRequest) {
  await connectDB()

  // Already have a boss → disabled
  const existing = await User.findOne({ role: 'boss' })
  if (existing) {
    return NextResponse.json({ error: 'Setup already completed' }, { status: 409 })
  }

  const body = await req.json()
  const { secret, email, password, firstName, lastName } = body

  const expectedSecret = process.env.SETUP_SECRET || 'CHANGE_THIS_SECRET'
  if (secret !== expectedSecret) {
    return NextResponse.json({ error: 'Invalid setup secret' }, { status: 403 })
  }

  if (!email || !password || !firstName || !lastName) {
    return NextResponse.json({ error: 'email, password, firstName, lastName required' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  const hash = await User.hashPassword(password)
  const boss  = await User.create({
    email:              email.toLowerCase().trim(),
    passwordHash:       hash,
    role:               'boss',
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
