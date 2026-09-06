/** Optional browser smoke test for an unmodified Pages starter build.
 * node scripts/test-pages-react-browser.mjs /absolute/path/to/dist/index.html
 * Requires the repository's Playwright Chromium installation.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

if (!process.argv[2]) throw new Error('Pass the built Pages starter HTML path')
const html = await readFile(process.argv[2], 'utf8')
const hostHtml = await readFile(new URL('../apps/electron/src/renderer/index.html', import.meta.url), 'utf8')
const csp = hostHtml.match(/<meta http-equiv="Content-Security-Policy"[^>]+>/i)?.[0]
assert(csp, 'Host CSP must be present')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  const requests = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => requests.push(request.url()))
  await page.setContent('<!doctype html><html><head>' + csp + '</head><body></body></html>')
  await page.evaluate(content => {
    const frame = document.createElement('iframe')
    frame.id = 'page'
    frame.setAttribute('sandbox', 'allow-scripts allow-forms')
    frame.style.cssText = 'width:900px;height:600px'
    const snapshot = { version: 1, generatedAt: 1000, kv: { total: 42 }, series: {} }
    window.addEventListener('message', event => {
      if (event.source === frame.contentWindow && event.data?.type === 'ready') {
        frame.contentWindow.postMessage({ protocol: 'craft-pages/v1', type: 'init', payload: {
          nonce: 'smoke-test-nonce', page: { slug: 'smoke', kind: 'live' }, snapshot, grants: [],
        } }, '*')
      }
    })
    frame.srcdoc = content
    document.body.append(frame)
  }, html)
  const frame = page.frameLocator('#page')
  await frame.getByRole('button', { name: 'Count: 0' }).click()
  await frame.getByRole('button', { name: 'Count: 1' }).waitFor()
  await frame.getByText('"total": 42', { exact: false }).waitFor()
  const padding = await frame.locator('main').evaluate(element => getComputedStyle(element).paddingTop)
  assert.equal(padding, '32px', 'Tailwind styles must be applied')
  const isolated = await frame.locator('main').evaluate(() => {
    try { void window.parent.document; return false } catch { return true }
  })
  assert(isolated, 'Pages must retain an opaque origin')
  await page.evaluate(() => {
    document.querySelector('#page').contentWindow.postMessage({ protocol: 'craft-pages/v1', type: 'data', payload: {
      snapshot: { version: 1, generatedAt: 2000, kv: { total: 99 }, series: {} },
    } }, '*')
  })
  await frame.getByText('"total": 99', { exact: false }).waitFor()
  // Optional fixture extension installed with the official shadcn CLI.
  if (await frame.getByRole('button', { name: 'Open dialog', exact: true }).count()) {
    await frame.getByRole('button', { name: 'Open dialog', exact: true }).click()
    const dialog = frame.getByRole('dialog', { name: 'Framework dialog' })
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    console.log('PASS: official shadcn Dialog portal opens and closes in the sandbox')
  }
  assert.deepEqual(errors, [], 'No browser errors')
  assert.deepEqual(requests, [], 'The built page must make no network requests')
  console.log('PASS: React click, Tailwind styles, initial/live snapshots, opaque sandbox, zero network requests')
} finally {
  await browser.close()
}
