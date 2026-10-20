/**
 * Announcement creation validation (Phase 12 live acceptance): an empty title was a bare 500 (Mongoose ValidationError escaped) and a 5,000-character
 * title was stored (201). Real server, throwaway DB.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')

let db, A, tok
test.before(async () => { db = await kit.connect(); A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true }); tok = { adm: (await kit.login(A.admin.email)).accessToken, emp: (await kit.login(A.employee.email)).accessToken } })
test.after(async () => { await kit.cleanupAll(db); await kit.disconnect() })

test('A-valid. invalid announcements are 400 with field names and store nothing; valid ones are 201; employees stay 403', async () => {
  const post = (b, t = tok.adm) => kit.api('/api/announcements', { method: 'POST', token: t, body: b })
  const cases = [['empty title', { title: '', body: 'b' }, ['title']], ['blank title', { title: '   ', body: 'b' }, ['title']], ['missing title', { body: 'b' }, ['title']], ['huge title', { title: 'x'.repeat(5000), body: 'b' }, ['title']],
    ['non-string title', { title: 123, body: 'b' }, ['title']], ['missing body', { title: 't' }, ['body']], ['blank body', { title: 't', body: '  ' }, ['body']], ['huge body', { title: 't', body: 'y'.repeat(30000) }, ['body']],
    ['bad priority', { title: 't', body: 'b', priority: 'critical' }, ['priority']], ['bad schedule', { title: 't', body: 'b', scheduledFor: 'not-a-date' }, ['scheduledFor']]]
  for (const [label, b, fields] of cases) { const r = await post(b); assert.equal(r.status, 400, `${label} -> ${r.status} ${r.text.slice(0, 80)}`); assert.deepEqual(r.json.fields, fields, label) }
  assert.equal(await db.collection('announcements').countDocuments({ orgId: A.orgId }), 0, 'nothing stored by any rejected request')
  const ok = await post({ title: 'Valid announcement', body: 'Body text', priority: 'normal' }); assert.equal(ok.status, 201, ok.text)
  assert.equal((await post({ title: 'x'.repeat(200), body: 'b' })).status, 201, '200-character title is allowed')
  assert.equal((await post({ title: 'No priority given', body: 'b' })).status, 201, 'priority is optional')
  assert.equal((await post({ title: 't', body: 'b' }, tok.emp)).status, 403, 'employees cannot post')
})
