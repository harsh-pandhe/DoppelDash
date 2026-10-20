/**
 * CRM contact e-mail validation (Phase 12 live acceptance): the API stored "not-an-email" on create (201) and edit (200); only the browser form checked it.
 * Real server, throwaway DB.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')

let db, A, tok
test.before(async () => { db = await kit.connect(); A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true }); tok = (await kit.login(A.employee.email)).accessToken })
test.after(async () => { await kit.cleanupAll(db); await kit.disconnect() })

test('C-email. create and edit reject a malformed e-mail with 400 {fields:["email"]} and store nothing; valid and blank addresses are accepted', async () => {
  const bad = ['not-an-email', 'a@b', '@x.test', 'a b@x.test', 'a@@x.test', 'x'.repeat(250) + '@x.test', 12345, ['a@b.test']]
  for (const email of bad) {
    const r = await kit.api('/api/crm', { method: 'POST', token: tok, body: { name: 'ZZ bad email', email } })
    assert.equal(r.status, 400, `create with ${JSON.stringify(email).slice(0, 30)} -> ${r.status}`); assert.deepEqual(r.json.fields, ['email'])
  }
  assert.equal(await db.collection('contacts').countDocuments({ orgId: A.orgId, name: 'ZZ bad email' }), 0, 'nothing stored by the rejected creates')
  const ok = await kit.api('/api/crm', { method: 'POST', token: tok, body: { name: 'ZZ good email', email: 'good.person+tag@example.test' } }); assert.equal(ok.status, 201, ok.text)
  const blank = await kit.api('/api/crm', { method: 'POST', token: tok, body: { name: 'ZZ blank email', email: '' } }); assert.equal(blank.status, 201, blank.text)
  const id = ok.json._id || ok.json.id
  for (const email of ['not-an-email', 'a@b']) { const p = await kit.api('/api/crm/' + id, { method: 'PATCH', token: tok, body: { email } }); assert.equal(p.status, 400, `patch ${email} -> ${p.status}`); assert.deepEqual(p.json.fields, ['email']) }
  const row = await db.collection('contacts').findOne({ _id: new (require('mongodb').ObjectId)(id) }); assert.equal(row.email, 'good.person+tag@example.test', 'a rejected edit leaves the stored value untouched')
  const fine = await kit.api('/api/crm/' + id, { method: 'PATCH', token: tok, body: { email: 'new.address@example.test', company: 'Co' } }); assert.equal(fine.status, 200, fine.text)
})

test('C-size. over-long text fields are rejected with 400 naming the field (a 5,000-character name used to be stored); limits sit at the documented maximum', async () => {
  for (const [field, over, atMax] of [['name', 201, 200], ['company', 201, 200], ['designation', 201, 200], ['phone', 51, 50], ['notes', 10001, 10000]]) {
    const r = await kit.api('/api/crm', { method: 'POST', token: tok, body: { name: 'ZZ size', [field]: 'x'.repeat(over) } }); assert.equal(r.status, 400, `${field} ${over} -> ${r.status}`); assert.ok(r.json.fields.includes(field), field)
    const ok = await kit.api('/api/crm', { method: 'POST', token: tok, body: { name: 'ZZ size ok', [field]: 'x'.repeat(atMax) } }); assert.equal(ok.status, 201, `${field} ${atMax} -> ${ok.status} ${ok.text.slice(0, 80)}`)
  }
  const bad = await kit.api('/api/crm', { method: 'POST', token: tok, body: { name: ['not', 'a string'] } }); assert.equal(bad.status, 400)
  assert.equal(await db.collection('contacts').countDocuments({ orgId: A.orgId, name: 'ZZ size' }), 0, 'nothing stored by the rejected creates')
  const made = await kit.api('/api/crm', { method: 'POST', token: tok, body: { name: 'ZZ edit target' } }); const id = made.json._id || made.json.id
  const p = await kit.api('/api/crm/' + id, { method: 'PATCH', token: tok, body: { company: 'y'.repeat(5000) } }); assert.equal(p.status, 400); assert.ok(p.json.fields.includes('company'))
})
