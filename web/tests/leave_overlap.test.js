/**
 * Owner decision P-01 (approved 2026-10-25): the same user may not hold two pending/approved leaves that cover the same day (409 leave_overlap).
 * Rejected leave never blocks; another user's leave never blocks; a morning + afternoon half-day pair on one day is allowed.
 * Real routes, throwaway DB. A refusal stores nothing.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const mongoose = require('mongoose')
const kit = require('./helpers/authTestKit')

let db, A, B, tok
test.before(async () => {
  db = await kit.connect()
  A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true }); B = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  tok = {}
  for (const [k, org] of [['A', A], ['B', B]]) for (const r of ['admin', 'manager', 'employee']) tok[`${k}${r}`] = (await kit.login(org[r].email)).accessToken
})
test.after(async () => { await kit.cleanupAll(db); await kit.disconnect() })

const day = n => new Date(Date.UTC(2031, 0, 1 + n)).toISOString()          // a private calendar: every case uses its own day numbers
const leave = (k, o) => kit.api('/api/lms', { method: 'POST', token: tok[k], body: { type: 'lwp', reason: 'overlap test', days: 1, startDate: day(0), endDate: day(0), ...o } })
const uid = k => ({ A, B })[k[0]][k.slice(1)].id
const total = k => db.collection('leaves').countDocuments({ userId: uid(k) })

test('L1. the same dates twice → 201 then 409 leave_overlap, and nothing is stored for the refused one', async () => {
  const first = await leave('Aemployee', { startDate: day(0), endDate: day(1), days: 2 }); assert.equal(first.status, 201, first.text)
  const before = await total('Aemployee')
  const second = await leave('Aemployee', { startDate: day(0), endDate: day(1), days: 2 })
  assert.equal(second.status, 409, second.text); assert.equal(second.json.code, 'leave_overlap')
  assert.equal(await total('Aemployee'), before)
})

test('L2. partial overlaps are refused (inside, straddling the start, straddling the end, enclosing)', async () => {
  assert.equal((await leave('Aemployee', { startDate: day(10), endDate: day(13), days: 4 })).status, 201)
  for (const [s, e, d] of [[11, 12, 2], [9, 10, 2], [13, 14, 2], [9, 14, 6], [12, 12, 1]]) {
    const r = await leave('Aemployee', { startDate: day(s), endDate: day(e), days: d })
    assert.equal(r.status, 409, `${s}-${e}: ${r.text}`); assert.equal(r.json.code, 'leave_overlap')
  }
})

test('L3. adjacent leave (the day before / the day after) is allowed', async () => {
  assert.equal((await leave('Aemployee', { startDate: day(20), endDate: day(21), days: 2 })).status, 201)
  assert.equal((await leave('Aemployee', { startDate: day(18), endDate: day(19), days: 2 })).status, 201, 'ends the day before')
  assert.equal((await leave('Aemployee', { startDate: day(22), endDate: day(22), days: 1 })).status, 201, 'starts the day after')
})

test('L4. rejected leave does not block; a pending/approved one does', async () => {
  const a = await leave('Aemployee', { startDate: day(30), endDate: day(30) }); assert.equal(a.status, 201, a.text)
  assert.equal((await leave('Aemployee', { startDate: day(30), endDate: day(30) })).status, 409, 'pending blocks')
  await db.collection('leaves').updateOne({ _id: new mongoose.Types.ObjectId(a.json._id) }, { $set: { status: 'approved' } })
  assert.equal((await leave('Aemployee', { startDate: day(30), endDate: day(30) })).status, 409, 'approved blocks')
  await db.collection('leaves').updateOne({ _id: new mongoose.Types.ObjectId(a.json._id) }, { $set: { status: 'rejected' } })
  assert.equal((await leave('Aemployee', { startDate: day(30), endDate: day(30) })).status, 201, 'rejected leave frees the day')
})

test('L5. another user (same org) and another tenant are never blocked by this user’s leave', async () => {
  assert.equal((await leave('Aemployee', { startDate: day(40), endDate: day(41), days: 2 })).status, 201)
  assert.equal((await leave('Amanager', { startDate: day(40), endDate: day(41), days: 2 })).status, 201, 'colleague')
  assert.equal((await leave('Bemployee', { startDate: day(40), endDate: day(41), days: 2 })).status, 201, 'other tenant')
})

test('L6. a morning + afternoon half-day pair on one day is allowed; same period, or a half-day over a full day, is not', async () => {
  const am = await leave('Aemployee', { startDate: day(50), endDate: day(50), days: 0.5, isHalfDay: true, halfDayPeriod: 'morning' }); assert.equal(am.status, 201, am.text)
  assert.equal(am.json.isHalfDay, true); assert.equal(am.json.halfDayPeriod, 'morning')
  assert.equal((await leave('Aemployee', { startDate: day(50), endDate: day(50), days: 0.5, isHalfDay: true, halfDayPeriod: 'morning' })).status, 409, 'same period')
  assert.equal((await leave('Aemployee', { startDate: day(50), endDate: day(50), days: 1 })).status, 409, 'a full day over a half-day')
  const pm = await leave('Aemployee', { startDate: day(50), endDate: day(50), days: 0.5, isHalfDay: true, halfDayPeriod: 'afternoon' }); assert.equal(pm.status, 201, pm.text)
  assert.equal((await leave('Aemployee', { startDate: day(50), endDate: day(50), days: 0.5, isHalfDay: true, halfDayPeriod: 'afternoon' })).status, 409, 'the afternoon is taken')
})

test('L7. half-day declarations are validated: one day, 0.5 days, a known period', async () => {
  for (const o of [
    { isHalfDay: true, halfDayPeriod: 'noon', startDate: day(60), endDate: day(60), days: 0.5 },
    { isHalfDay: true, halfDayPeriod: 'morning', startDate: day(60), endDate: day(61), days: 0.5 },
    { isHalfDay: true, halfDayPeriod: 'morning', startDate: day(60), endDate: day(60), days: 1 },
    { isHalfDay: true, startDate: day(60), endDate: day(60), days: 0.5 },
    { isHalfDay: 'yes', halfDayPeriod: 'morning', startDate: day(60), endDate: day(60), days: 0.5 },
  ]) { const r = await leave('Aemployee', o); assert.equal(r.status, 400, JSON.stringify(o) + r.text) }
})
