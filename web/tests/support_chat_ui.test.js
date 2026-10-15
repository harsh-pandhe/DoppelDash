/**
 * Support-chat entry points (Phase 1G): the data-minimisation warning is shown, the input is bounded like the server,
 * and the request the UI sends stays inside the server contract. jsdom + Testing Library, fetch mocked — no network.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { load, rtl, userEvent, React } = require('./helpers/domKit')
const { render, screen, cleanup, waitFor } = rtl
const h = React.createElement

const SignInHelp = load('components/auth/SignInHelp.tsx').default
const { SUPPORT_CHAT_NOTICE, SUPPORT_INPUT_MAX, toRequestMessages } = load('lib/support/chatClient.ts')

test.afterEach(() => { cleanup(); delete globalThis.fetch })

test('U1 the sign-in help dialog warns about secrets and names the external AI provider', async () => {
  render(h(SignInHelp, { open: true, onOpenChange() {} }))
  assert.ok(await screen.findByText(SUPPORT_CHAT_NOTICE))
  assert.match(SUPPORT_CHAT_NOTICE, /passwords, verification codes/i)
  assert.match(SUPPORT_CHAT_NOTICE, /Gemini/)
  assert.doesNotMatch(SUPPORT_CHAT_NOTICE, /\b(days|hours|months|deleted after|retain)/i, 'no retention promise the app cannot verify')
})

test('U2 the message box is bounded to the server limit and a long chat is trimmed to what the server accepts', async () => {
  const sent = []
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { json: async () => ({ text: 'm'.repeat(2500) }) } }
  render(h(SignInHelp, { open: true, onOpenChange() {} }))
  const box = await screen.findByLabelText('Your message')
  assert.equal(box.getAttribute('maxlength'), String(SUPPORT_INPUT_MAX))
  const user = userEvent.setup()
  for (let i = 0; i < 8; i++) {   // 8 user turns + 8 long assistant replies + greeting = far more than the server's 12
    await user.type(box, `question ${i}`)
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => assert.equal(sent.length, i + 1))
    await screen.findAllByText(/^m{100,}/)
  }
  const last = sent.at(-1).messages
  assert.ok(last.length <= 12, `at most 12 messages, got ${last.length}`)
  assert.ok(last.every(m => (m.role === 'user' || m.role === 'model') && Object.keys(m).sort().join() === 'role,text'))
  assert.ok(last.every(m => Array.from(m.text).length <= (m.role === 'user' ? 800 : 2000)), 'model replies are cut to the server limit')
  assert.equal(last.at(-1).role, 'user')
})

test('U3 toRequestMessages: role+text only, newest turns kept, limits applied', () => {
  const hist = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'model' : 'user', text: 'x'.repeat(5000), extra: 'drop me' }))
  const out = toRequestMessages(hist)
  assert.equal(out.length, 12)
  for (const m of out) assert.deepEqual(Object.keys(m).sort(), ['role', 'text'])
  assert.ok(out.every(m => m.text.length === (m.role === 'user' ? 800 : 2000)))
})

test('U4 the sign-in page chat uses the same notice, bound and trimming (source wiring)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../app/(auth)/sign-in/page.tsx'), 'utf8')
  assert.match(src, /SUPPORT_CHAT_NOTICE/)
  assert.match(src, /maxLength=\{SUPPORT_INPUT_MAX\}/)
  assert.match(src, /messages: toRequestMessages\(next\)/)
  assert.doesNotMatch(src, /messages: next\b/, 'the raw history is never posted')
  const privacy = fs.readFileSync(path.resolve(__dirname, '../app/privacy/page.tsx'), 'utf8')
  assert.match(privacy, /Sign-in help chat/)
  assert.match(privacy, /do not store the conversation/)
})
