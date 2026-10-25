/**
 * Mail drafts (Phase 12): hostile bodies/ids are 4xx never 5xx, nothing partial is stored, valid flows (incl. version history) still work, drafts stay private.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')

let db, A, tok
test.before(async () => { db = await kit.connect(); A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true }); tok = { adm: (await kit.login(A.admin.email)).accessToken, mgr: (await kit.login(A.manager.email)).accessToken } })
test.after(async () => { await kit.cleanupAll(db); await kit.disconnect() })

test('MD1. draft create/update validation, ids and privacy', async () => {
  const send = (u, m, b, t = tok.adm) => kit.api(u, { method: m, token: t, body: b })
  const before = await db.collection('maildrafts').countDocuments({ orgId: A.orgId })
  for (const [label, b, f] of [['obj subject', { subject: { a: 1 } }, ['subject']], ['huge subject', { subject: 's'.repeat(999) }, ['subject']], ['num body', { bodyHtml: 5 }, ['bodyHtml']], ['string recipients', { recipients: 'a@b.co' }, ['recipients']],
    ['no email', { recipients: [{ name: 'x' }] }, ['recipients']], ['bad email', { recipients: [{ email: 'nope' }] }, ['recipients']], ['bad field', { recipients: [{ email: 'a@b.co', field: 'zzz' }] }, ['recipients']],
    ['too many', { recipients: Array.from({ length: 201 }, (_, i) => ({ email: `a${i}@b.co` })) }, ['recipients']]]) {
    const r = await send('/api/mail/drafts', 'POST', b); assert.equal(r.status, 400, `${label} -> ${r.status} ${r.text.slice(0, 80)}`); assert.deepEqual(r.json.fields, f, label)
  }
  assert.equal((await kit.api('/api/mail/drafts', { method: 'POST', token: tok.adm, raw: 'null', headers: { 'Content-Type': 'application/json' } })).status, 400)
  assert.equal(await db.collection('maildrafts').countDocuments({ orgId: A.orgId }), before, 'rejected requests stored nothing')
  const ok = await send('/api/mail/drafts', 'POST', { subject: 'Hello', bodyHtml: '<p>x</p>', recipients: [{ name: 'A', email: 'a@b.co', field: 'cc', evil: 'dropped' }] }); assert.equal(ok.status, 201, ok.text)
  assert.deepEqual(ok.json.recipients.map(r => [r.email, r.field, r.source]), [['a@b.co', 'cc', 'manual']]); assert.equal(ok.json.recipients[0].evil, undefined)
  const id = ok.json._id
  assert.equal((await send(`/api/mail/drafts/${id}`, 'PATCH', { subject: ['x'] })).status, 400)
  const p = await send(`/api/mail/drafts/${id}`, 'PATCH', { subject: 'Changed' }); assert.equal(p.status, 200); assert.equal(p.json.versions.length, 1, 'version history still snapshots')
  for (const bad of ['nope', '%00', 'x'.repeat(300), '0'.repeat(24)]) for (const m of ['GET', 'PATCH', 'DELETE']) {
    const r = await send(`/api/mail/drafts/${encodeURIComponent(bad)}`, m, m === 'PATCH' ? {} : undefined); assert.equal(r.status, 404, `${m} ${bad} -> ${r.status}`)
  }
  for (const m of ['GET', 'PATCH', 'DELETE']) assert.equal((await send(`/api/mail/drafts/${id}`, m, m === 'PATCH' ? { subject: 'steal' } : undefined, tok.mgr)).status, 404, 'drafts are private to their owner')
  assert.equal((await send(`/api/mail/drafts/${id}`, 'DELETE')).status, 200)
})

test('MD2. client-input errors are 4xx via the shared guard (CastError/ValidationError never 500)', async () => {
  const { clientInputResponse } = kit.load('lib/http/dbGuard.ts')
  const mk = (name, extra) => Object.assign(new Error('boom'), { name }, extra)
  assert.equal(clientInputResponse(mk('CastError', { path: '_id' })).status, 404)
  assert.equal(clientInputResponse(mk('CastError', { path: 'startDate' })).status, 400)
  const v = clientInputResponse(mk('ValidationError', { errors: { 'a.b': {}, c: {} } })); assert.equal(v.status, 400); assert.deepEqual((await v.json()).fields, ['a', 'c'])
  assert.equal(clientInputResponse(new Error('other')), null, 'unrelated errors still propagate')
  assert.equal(clientInputResponse(null), null)
})
