/**
 * Org/admin settings validation (Phase 12 live acceptance): wrong-typed bodies were bare 500s and no length limits applied. Real server, throwaway DB.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')

let db, A, tok
test.before(async () => { db = await kit.connect(); A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true }); tok = { adm: (await kit.login(A.admin.email)).accessToken, emp: (await kit.login(A.employee.email)).accessToken } })
test.after(async () => { await kit.cleanupAll(db); await kit.disconnect() })

test('S-valid. invalid settings are 400 with field names and store nothing; valid ones persist; non-admins stay 403', async () => {
  for (const [path, method] of [['/api/org/settings', 'POST'], ['/api/org/settings', 'PATCH'], ['/api/admin/settings', 'POST'], ['/api/admin/settings', 'PATCH']]) {
    const send = (b, t = tok.adm) => kit.api(path, { method, token: t, body: b })
    for (const [label, b, fields] of [
      ['object name', { name: { $gt: '' } }, ['name']], ['array company', { companyName: ['x'] }, ['companyName']], ['number tz', { timezone: 5 }, ['timezone']],
      ['huge name', { name: 'x'.repeat(201) }, ['name']], ['huge address', { address: 'a'.repeat(1001) }, ['address']], ['bad email', { email: 'nope' }, ['email']],
      ['string workHours', { workHours: 'x' }, ['workHours']], ['bad hhmm', { workHours: { start: '25:00', end: '18:00' } }, ['workHours']],
    ]) {
      const r = await send(b); assert.equal(r.status, 400, `${method} ${path} ${label} -> ${r.status} ${r.text.slice(0, 80)}`); assert.deepEqual(r.json.fields, fields, label)
    }
    assert.equal((await send({ name: 'x' }, tok.emp)).status, 403, 'employees cannot change settings')
  }
  const doc = await db.collection('orgsettings').findOne({ orgId: A.orgId })
  assert.ok(!doc || (doc.name !== 'x' && !String(doc.address || '').startsWith('aaaa')), 'nothing stored by rejected requests')
  const ok = await kit.api('/api/org/settings', { method: 'POST', token: tok.adm, body: { name: 'Valid Co', email: 'a@b.co', workHours: { start: '08:30', end: '17:30' }, orgId: 'evil' } })
  assert.equal(ok.status, 200, ok.text); assert.equal(ok.json.name, 'Valid Co'); assert.deepEqual(ok.json.workHours, { start: '08:30', end: '17:30' }); assert.equal(ok.json.orgId, A.orgId)
})
