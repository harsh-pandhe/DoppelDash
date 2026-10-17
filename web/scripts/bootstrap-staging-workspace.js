/**
 * DoppelDash — STAGING-ONLY bootstrap of the Doppelmayr workspace and its first Admin.
 *
 * Why: on an empty staging database nothing creates `org_doppelmayr` (the entitlement/brand scripts deliberately never create an organisation,
 * `/api/auth/setup` needs an existing one, `/api/auth/register` makes ordinary Free tenants, and the dev seed is disabled outside local use).
 * This operator script creates exactly that workspace, once, auditably — and refuses to run against anything that is not a staging database.
 *
 *   dry run (default, writes nothing):
 *     MONGODB_URI="<staging connection string ending /<db>>" node web/scripts/bootstrap-staging-workspace.js --admin-email=<owner email>
 *   apply:
 *     MONGODB_URI="…" node web/scripts/bootstrap-staging-workspace.js --admin-email=<owner email> --admin-first=<first> --admin-last=<last> \
 *       --apply --confirm-db=<db name> --actor="<name>" --reason="<why>"
 *
 * Safety: the database NAME must contain "staging" and be typed again with --confirm-db; a URI/DD_DEPLOY_CONTEXT that says production is refused; an existing
 * account with the admin e-mail that is not already this workspace's admin is never taken over; re-running changes nothing. The Admin is created with a random
 * one-time password printed ONCE to this terminal (never written to a file or log) and must change it at first sign-in; sign-in still requires the e-mailed OTP.
 * Never prints the connection string.
 */
const path = require('node:path'), crypto = require('node:crypto')
const mongoose = require('mongoose')
const args = process.argv.slice(2); const flag = n => (args.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3)
const apply = args.includes('--apply'); const fail = m => { console.error(`[REFUSING] ${m}`); process.exit(2) }

async function main() {
  const uri = process.env.MONGODB_URI
  if (!uri || !/^mongodb(\+srv)?:\/\//.test(uri)) fail('MONGODB_URI is missing or invalid.')
  const dbName = decodeURIComponent((uri.replace(/^mongodb(\+srv)?:\/\/[^/]*\//, '').split('?')[0]) || '')
  if (!dbName) fail('MONGODB_URI must name the database explicitly (…/<database>).')
  if (!/staging/i.test(dbName)) fail(`the database name must contain "staging" (got "${dbName}"). This script never runs against any other database.`)
  if (/prod/i.test(dbName) || /prod/i.test(uri.replace(/^mongodb(\+srv)?:\/\/[^@]*@/, '').split('/')[0])) fail('the target looks like production.')
  if ((process.env.DD_DEPLOY_CONTEXT || '').toLowerCase() === 'production') fail('DD_DEPLOY_CONTEXT=production is set in this shell.')
  const email = flag('admin-email').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('--admin-email=<address> is required.')
  const first = flag('admin-first').trim() || 'Owner', last = flag('admin-last').trim() || 'Admin'
  if (apply) {
    if (flag('confirm-db') !== dbName) fail(`--apply requires --confirm-db=${dbName} (typed exactly).`)
    if (!flag('actor').trim() || !flag('reason').trim()) fail('--apply requires --actor="<name>" and --reason="<why>" (written to the audit log).')
  }
  process.env.MONGODB_URI = uri
  const jiti = require('jiti')(__filename, { alias: { '@': path.resolve(__dirname, '..') } })
  const Organization = jiti('../models/Organization.ts').default, OrgSettings = jiti('../models/OrgSettings.ts').default
  const User = jiti('../models/User.ts').default, Employee = jiti('../models/Employee.ts').default, LeaveBalance = jiti('../models/LeaveBalance.ts').default
  const AuditLog = jiti('../models/AuditLog.ts').default
  const { ensureLifetimeEntitlement, DOPPELMAYR_ENTITLEMENT } = jiti('../lib/provisioning/doppelmayrEntitlement.ts')
  const { ensureDoppelmayrBrand } = jiti('../lib/provisioning/doppelmayrBrand.ts')
  const orgId = DOPPELMAYR_ENTITLEMENT.orgId

  console.log(`[1/4] Target database: "${dbName}"  workspace: "${orgId}"  mode: ${apply ? 'APPLY' : 'DRY RUN (nothing is written)'}`)
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 })
  try {
    const org = await Organization.findOne({ orgId }).lean()
    const existingUser = await User.findOne({ email }).lean()
    const anyAdmin = await User.countDocuments({ orgId, role: 'admin' })
    console.log(`[2/4] workspace exists: ${!!org}; admins in workspace: ${anyAdmin}; account with the owner e-mail exists: ${!!existingUser}${existingUser ? ` (orgId ${existingUser.orgId === orgId ? 'matches' : 'DIFFERS'}, role ${existingUser.role})` : ''}`)
    if (existingUser && !(existingUser.orgId === orgId && existingUser.role === 'admin')) fail('an account with that e-mail already exists and is not this workspace\'s Admin — it will not be taken over. Use a different e-mail or resolve it by hand.')
    const plan = []
    if (!org) plan.push('create organization (Doppelmayr India, premium / lifetime_grant / web+android enabled)')
    else plan.push('verify/repair entitlement fields (audited, only if they differ)')
    plan.push('ensure brand settings (only missing values)')
    if (!existingUser) plan.push('create Admin user + employee record + leave balance (one-time password printed once)')
    if (!apply) { console.log('[3/4] DRY RUN — would: ' + plan.join('; ') + '.'); console.log(`[4/4] Re-run with --apply --confirm-db=${dbName} --actor="…" --reason="…" --admin-first=… --admin-last=…`); return }

    const actor = flag('actor').trim().slice(0, 80), reason = flag('reason').trim().slice(0, 300)
    if (!org) {
      await Organization.create({ orgId, name: 'Doppelmayr India', slug: 'doppelmayr', setupRequired: false, plan: 'free', entitlementSource: 'none', lifetimeGrant: false, webEnabled: false, androidEnabled: true, subscriptionStatus: 'none', trialStatus: 'none' })
      await AuditLog.create({ orgId, action: 'staging.workspace_created', performedBy: `operator:${actor}`, performedByName: actor, targetId: orgId, targetType: 'organization', metadata: { reason, database: dbName, at: new Date().toISOString() } })
    }
    const ent = await ensureLifetimeEntitlement({ orgId }, { dryRun: false, actor, reason })
    const brand = await ensureDoppelmayrBrand(undefined, { dryRun: false })
    let tempPassword = null
    if (!existingUser) {
      tempPassword = crypto.randomBytes(18).toString('base64url') + 'aA1!'
      const passwordHash = await User.hashPassword(tempPassword)
      const u = await User.create({ orgId, email, passwordHash, role: 'admin', firstName: first, lastName: last, mustChangePassword: true, isReviewer: false, isActive: true, sessionVersion: 1,
        permissions: ['users:read', 'users:write', 'leaves:read', 'leaves:write', 'expenses:read', 'expenses:write', 'travel:read', 'travel:write', 'crm:read', 'crm:write', 'mail:read', 'mail:write', 'analytics:read', 'audit:read'] })
      const uid = u._id.toString()
      await Employee.create({ clerkUserId: uid, orgId, createdByUserId: uid, firstName: first, lastName: last, email, phone: '', department: 'Executive', designation: 'Workspace Admin', employeeType: 'full_time', joiningDate: new Date(), onboardingComplete: true, onboardingStep: 3,
        privileges: { food: { tier: 'premium', dailyLimit: 5000 }, taxi: { tier: 'ac_premium', perKmLimit: 50 }, flight: { tier: 'business', enabled: true }, hotel: { tier: 'premium', perNightLimit: 15000 }, travelAdvance: 50000 } })
      await LeaveBalance.create({ userId: uid, orgId, year: new Date().getFullYear(), casual: 12, sick: 6, earned: 15, privilege: 2, restricted: 2, lwpDays: 0 })
      await Organization.updateOne({ orgId, $or: [{ ownerId: { $exists: false } }, { ownerId: null }, { ownerId: '' }] }, { $set: { ownerId: uid } })
      await AuditLog.create({ orgId, action: 'staging.admin_bootstrapped', performedBy: `operator:${actor}`, performedByName: actor, targetId: uid, targetType: 'user', metadata: { reason, database: dbName, role: 'admin', at: new Date().toISOString() } })
    }
    console.log(`[3/4] Applied. entitlement fields changed: ${ent.changed.join(', ') || 'none'}; brand fields written: ${brand.changed.join(', ') || 'none'}; admin created: ${!!tempPassword}.`)
    if (tempPassword) {
      console.log('[4/4] ONE-TIME PASSWORD for the new Admin (shown once, in this terminal only — do not paste it anywhere; you must change it at first sign-in):')
      console.log(`      ${tempPassword}`)
    } else console.log('[4/4] No new account was created (already the workspace Admin) — nothing secret to show.')
  } finally { await mongoose.disconnect() }
}
main().catch(err => { console.error('[ERROR]', err && err.message ? err.message : err); process.exit(1) })
