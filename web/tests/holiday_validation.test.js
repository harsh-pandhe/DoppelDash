/**
 * Holiday creation validation (Phase 12 live acceptance): an invalid date was a bare 500 and a 5,000-character name was stored. Real server, throwaway DB.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')

let db, A, tok
test.before(async () => { db = await kit.connect(); A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true }); tok = { adm: (await kit.login(A.admin.email)).accessToken, emp: (await kit.login(A.employee.email)).accessToken } })
test.after(async () => { await kit.cleanupAll(db); await kit.disconnect() })

test('H-valid. invalid holidays are 400 with field names and store nothing; valid ones are created; employees stay 403', async () => {
  const post = (b, t = tok.adm) => kit.api('/api/holidays', { method: 'POST', token: t, body: b })
  const before = await db.collection('publicholidays').countDocuments({ orgId: A.orgId })
  for (const [label, b, fields] of [['bad date', { name: 'x', date: 'nope' }, ['date']], ['object date', { name: 'x', date: {} }, ['date']], ['huge name', { name: 'x'.repeat(201), date: '2027-12-30' }, ['name']], ['non-string name', { name: 123, date: '2027-12-30' }, ['name']],
    ['bad type', { name: 'x', date: '2027-12-30', type: 'banana' }, ['type']], ['huge description', { name: 'x', date: '2027-12-30', description: 'd'.repeat(2001) }, ['description']]]) {
    const r = await post(b); assert.equal(r.status, 400, `${label} -> ${r.status} ${r.text.slice(0, 80)}`); assert.deepEqual(r.json.fields, fields, label)
  }
  assert.equal((await post({ date: '2027-12-31' })).status, 400, 'missing name keeps its 400')
  assert.equal(await db.collection('publicholidays').countDocuments({ orgId: A.orgId }), before, 'nothing stored by any rejected request')
  const ok = await post({ name: 'Valid holiday', date: '2027-12-30', type: 'regional', description: 'ok' }); assert.equal(ok.status, 200, ok.text)
  assert.equal((await post({ name: 'n'.repeat(200), date: '2027-12-29' })).status, 200, '200-character name is allowed')
  assert.equal((await post({ name: 'No type given', date: '2027-12-28' })).status, 200, 'type is optional')
  assert.equal((await post({ name: 'x', date: '2027-12-27' }, tok.emp)).status, 403, 'employees cannot create holidays')
})
