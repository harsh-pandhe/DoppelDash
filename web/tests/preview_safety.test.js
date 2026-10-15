/**
 * P0-05 — preview / environment safety. Pure unit tests (no server, no database).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const kit = require('./helpers/authTestKit')
const { dataAccessDecision, assertDataAccessAllowed } = kit.load('lib/deployContext.ts')

test('E1. local development and CI test runs (no hosting-platform marker) are unaffected', () => {
  assert.deepEqual(dataAccessDecision({ NODE_ENV: 'development' }), { allowed: true, context: 'local' })
  assert.deepEqual(dataAccessDecision({ NODE_ENV: 'production' }), { allowed: true, context: 'local' })   // the production-mode test servers
  assert.doesNotThrow(() => assertDataAccessAllowed({}))
})

test('E2. a hosted deploy without an explicit DD_DEPLOY_CONTEXT is refused (previews fail closed), whatever else is set', () => {
  for (const platform of [{ NETLIFY: 'true' }, { VERCEL: '1' }, { AWS_LAMBDA_FUNCTION_NAME: 'f' }]) {
    for (const extra of [{}, { CONTEXT: 'deploy-preview' }, { CONTEXT: 'production' }, { DD_DEPLOY_CONTEXT: '' }, { DD_DEPLOY_CONTEXT: 'preview' }, { DD_DEPLOY_CONTEXT: 'prod' }, { DD_DEPLOY_CONTEXT: 'true' }, { MONGODB_URI: 'mongodb://example.invalid/x' }]) {
      const env = { NODE_ENV: 'production', ...platform, ...extra }
      assert.equal(dataAccessDecision(env).allowed, false, JSON.stringify(env))
      assert.throws(() => assertDataAccessAllowed(env), /\[deploy-context\]/)
    }
  }
})

test('E3. production and staging must be declared explicitly; a production declaration cannot coexist with a visible preview build context', () => {
  assert.deepEqual(dataAccessDecision({ NETLIFY: 'true', DD_DEPLOY_CONTEXT: 'production' }), { allowed: true, context: 'production' })
  assert.deepEqual(dataAccessDecision({ NETLIFY: 'true', DD_DEPLOY_CONTEXT: ' Staging ' }), { allowed: true, context: 'staging' })
  assert.equal(dataAccessDecision({ NETLIFY: 'true', DD_DEPLOY_CONTEXT: 'production', CONTEXT: 'deploy-preview' }).allowed, false)
  assert.equal(dataAccessDecision({ NETLIFY: 'true', DD_DEPLOY_CONTEXT: 'production', CONTEXT: 'branch-deploy' }).allowed, false)
})

test('E4. the refusal message never contains configuration values', () => {
  const env = { NETLIFY: 'true', MONGODB_URI: 'mongodb+srv://user:secretpw@cluster.example/db', JWT_SECRET: 'topsecretvalue' }
  try { assertDataAccessAllowed(env); assert.fail('should throw') } catch (e) { assert.doesNotMatch(String(e.message), /secretpw|topsecretvalue|mongodb|cluster\.example/) }
})

test('E5. connectDB enforces the guard before any connection is attempted, and netlify.toml cancels preview and branch-deploy builds', () => {
  const root = path.resolve(__dirname, '..')
  const db = fs.readFileSync(path.join(root, 'lib/db.ts'), 'utf8')
  assert.ok(db.indexOf('assertDataAccessAllowed()') > -1 && db.indexOf('assertDataAccessAllowed()') < db.indexOf('mongoose\n      .connect') , 'guard precedes mongoose.connect')
  const toml = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8')
  for (const ctx of ['deploy-preview', 'branch-deploy']) assert.match(toml, new RegExp(`\\[context\\.${ctx}\\]\\s*\\n\\s*ignore = "exit 0"`), ctx)
  assert.doesNotMatch(toml, /\[context\.production\][^[]*ignore/, 'production builds are never cancelled')
})
