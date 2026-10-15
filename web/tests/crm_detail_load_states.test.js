/**
 * CRM contact detail page: a failed load (404 other tenant / unknown id, 403, network) is shown as an error, never as an empty contact
 * with Edit/Share actions (found in browser acceptance: the 404 JSON body was treated as the contact). jsdom + fetch mock.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { load, rtl, React, dom } = require('./helpers/domKit')
const { render, screen, cleanup, waitFor } = rtl
const h = React.createElement

const stubs = {
  'next/navigation': { useRouter: () => ({ replace() {}, push() {}, refresh() {} }), useParams: () => ({ id: 'abc123' }), usePathname: () => '/crm/abc123', useSearchParams: () => new URLSearchParams() },
  'next/link': { __esModule: true, default: ({ href, children, ...r }) => h('a', { href, ...r }, children) },
  'next/dynamic': { __esModule: true, default: () => () => null },
  '@/components/layout/Header': { __esModule: true, default: ({ title }) => h('header', null, title) },
}
const orig = Module._load
Module._load = function (request, ...rest) { return stubs[request] ?? orig.call(this, request, ...rest) }
test.afterEach(() => cleanup())

const mockFetch = (status, json) => { globalThis.fetch = dom.window.fetch = async () => ({ ok: status < 400, status, json: async () => json }) }
const Page = () => load('app/(app)/crm/[id]/page.tsx').default

for (const [status, body] of [[404, { error: 'Not found' }], [403, { error: 'Forbidden' }], [500, { error: 'boom' }]]) {
  test(`C1. a ${status} on load shows the error with a way back — not a blank contact with Edit / Share`, async () => {
    mockFetch(status, body)
    render(h(Page()))
    await screen.findByText(/Failed to load contact/)
    assert.ok(screen.getByText(/Back to CRM/))
    assert.equal(screen.queryByText(/Edit Contact/), null); assert.equal(screen.queryByText(/Log Activity/), null)
  })
}

test('C2. a successful load still renders the contact', async () => {
  mockFetch(200, { _id: 'abc123', name: 'Real Person', email: 'r@x.test', tags: [] })
  render(h(Page()))
  await screen.findAllByText(/Real Person/)
  assert.equal(screen.queryByText(/Failed to load contact/), null)
})
