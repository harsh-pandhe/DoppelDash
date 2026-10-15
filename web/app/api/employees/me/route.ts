import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Employee from '@/models/Employee'
import User from '@/models/User'
import { getUser, getUserById } from '@/lib/auth'
import { encryptBankDetails, decryptBankDetails } from '@/lib/encrypt'

export async function GET() {
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const effectiveOrgId = orgId
  await connectDB()
  const emp = await Employee.findOne({ clerkUserId: userId, orgId: effectiveOrgId }).lean()
  if (!emp) return NextResponse.json(null)

  // Decrypt bank details for the owner
  const empWithDecryptedBank = {
    ...emp,
    bankDetails: decryptBankDetails(emp.bankDetails),
  }

  // Resolve reporting manager
  let reportingManager: { id: string; name: string; designation: string; email: string } | null = null
  if (emp.reportingManagerId) {
    const mgr = await getUserById(emp.reportingManagerId, effectiveOrgId)
    if (mgr) {
      const mgrEmp = await Employee.findOne({ clerkUserId: emp.reportingManagerId, orgId: effectiveOrgId }, 'designation').lean()
      reportingManager = {
        id:          mgr.id,
        name:        mgr.fullName,
        email:       mgr.email,
        designation: mgrEmp?.designation || (mgr.role === 'admin' ? 'Leadership' : 'Manager'),
      }
    }
  }

  return NextResponse.json({ ...empWithDecryptedBank, reportingManager })
}

export async function PATCH(req: NextRequest) {
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()

  const body = await req.json()

  // Prevent overwriting privileged fields employees can't self-edit
  delete body.clerkUserId
  delete body.createdByUserId
  delete body.privileges
  delete body.employeeId
  delete body.isActive
  delete body.reportingManagerId
  delete body.orgId
  delete body.role
  delete body.email

  // Synchronize User profile names if updated on Employee
  if (body.firstName || body.lastName) {
    const userUpdate: Record<string, string> = {}
    if (typeof body.firstName === 'string' && body.firstName.trim()) userUpdate.firstName = body.firstName.trim()
    if (typeof body.lastName === 'string' && body.lastName.trim()) userUpdate.lastName = body.lastName.trim()
    if (Object.keys(userUpdate).length > 0) {
      await User.findByIdAndUpdate(userId, { $set: userUpdate })
    }
  }

  // Encrypt bank details before persisting (account number / IFSC / holder name)
  if (body.bankDetails) {
    body.bankDetails = encryptBankDetails(body.bankDetails)
  }

  const emp = await Employee.findOneAndUpdate(
    { clerkUserId: userId, orgId },
    { $set: body },
    { returnDocument: 'after' }
  )
  if (!emp) return NextResponse.json({ error: 'Employee record not found' }, { status: 404 })

  // Mark onboarding complete if step reaches 4
  if (body.onboardingStep >= 4 && !emp.onboardingComplete) {
    await Employee.updateOne({ clerkUserId: userId, orgId }, { onboardingComplete: true })
  }

  // Return with decrypted bank details so the form refresh stays valid
  const out = emp.toObject ? emp.toObject() : emp
  return NextResponse.json({ ...out, bankDetails: decryptBankDetails(out.bankDetails) })
}
