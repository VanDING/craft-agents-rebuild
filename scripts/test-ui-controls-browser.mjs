/** Focused real-component regression. Start the Electron Vite playground first.
 * node scripts/test-ui-controls-browser.mjs http://127.0.0.1:5189/playground.html
 * Uses isolated browser storage and synthetic fixtures; never touches account data.
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://127.0.0.1:5189/playground.html'
const output = process.argv[3] ?? '.cache/ui-refinement'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) })
const results = { browser: browser.version(), url, assertions: [], timings: {} }
const check = (value, message) => { assert(value, message); results.assertions.push(message) }
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1500 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('playground-selected-component', 'control-system')
    localStorage.setItem('playground-preview-size', JSON.stringify({ width: 800, height: 1400 }))
    localStorage.setItem('playground-variants-sidebar-open', 'false')
  })
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const sample = page.getByTestId('control-system')
  await sample.waitFor({ timeout: 120_000 })
  const invalid = sample.getByLabel('服务地址', { exact: true })
  check(await invalid.getAttribute('aria-invalid') === 'true', 'Invalid field exposes aria-invalid')
  const describedIds = (await invalid.getAttribute('aria-describedby')).split(' ')
  check(describedIds.length === 2, 'Invalid field associates description and error')
  for (const id of describedIds) check(await page.locator(`[id="${id}"]`).count() === 1, `Description target exists: ${id}`)
  const externalIds = (await sample.getByLabel('外部描述', { exact: true }).getAttribute('aria-describedby')).split(' ')
  check(externalIds.includes('external-help') && externalIds.includes('custom-field-description'), 'Caller and field descriptions are merged')
  const name = sample.getByLabel('工作区名称', { exact: true })
  await name.focus()
  check(await name.evaluate(el => getComputedStyle(el.parentElement).outlineWidth) === '2px', 'Composite field has a visible focus outline')
  const secret = sample.getByLabel('访问密钥', { exact: true })
  await secret.focus()
  await page.keyboard.press('Tab')
  check(await page.evaluate(() => document.activeElement.tagName === 'BUTTON' && !!document.activeElement.getAttribute('aria-label')), 'Secret toggle is named and keyboard reachable')
  await page.keyboard.press('Space')
  check(await secret.getAttribute('type') === 'text', 'Keyboard reveals secret')
  await page.keyboard.press('Space')
  check(await secret.getAttribute('type') === 'password', 'Keyboard hides secret')
  for (const label of ['面板设置', '更多操作']) {
    const button = sample.getByRole('button', { name: label, exact: true }).first()
    await button.focus()
    check(await button.evaluate(el => getComputedStyle(el).outlineWidth) === '2px', `${label}: visible keyboard focus`)
  }
  const radioGroups = sample.getByRole('radiogroup')
  for (let i = 0; i < await radioGroups.count(); i++) {
    const group = radioGroups.nth(i)
    check(await group.locator('[role="radio"][tabindex="0"]').count() === 1, `Radio group ${i}: one tab stop`)
    await group.locator('[role="radio"][tabindex="0"]').focus()
    await page.keyboard.press('ArrowRight')
    check(await page.evaluate(() => document.activeElement.getAttribute('aria-checked')) === 'true', `Radio group ${i}: arrow selects focused item`)
    await page.keyboard.press('End')
    check(await group.getByRole('radio').last().getAttribute('aria-checked') === 'true', `Radio group ${i}: End selects last`)
  }
  const save = sample.getByRole('button', { name: '保存设置', exact: true })
  const beforeWidth = (await save.boundingBox()).width
  await save.click()
  check(await save.isDisabled() && await save.getAttribute('aria-busy') === 'true', 'Loading button blocks duplicate submission and exposes busy state')
  check(Math.abs((await save.boundingBox()).width - beforeWidth) < 1, 'Loading preserves button width')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  check(await sample.locator('.craft-button-spinner').evaluate(el => getComputedStyle(el).animationName) === 'none', 'Reduced motion stops loading rotation')
  await sample.getByRole('button', { name: '重置加载' }).click()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const trigger = sample.getByRole('button', { name: '打开对话框' })
  const times = []
  for (let i = 0; i < 6; i++) {
    const started = performance.now()
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: '连接设置' })
    await dialog.waitFor()
    if (i) times.push(performance.now() - started)
    if (i === 0) {
      await dialog.getByRole('combobox').click()
      await page.getByRole('option').first().waitFor()
      await page.keyboard.press('Escape')
      check(await dialog.isVisible(), 'Escape closes inner Select without closing Dialog')
      check(await dialog.getByRole('combobox').evaluate(el => el === document.activeElement), 'Inner overlay restores focus')
    }
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
  }
  check(await trigger.evaluate(el => el === document.activeElement), 'Dialog restores trigger focus')
  results.timings.dialogRoundTripMs = times
  // The searchable menu uses ordinary option buttons, including real keyboard focus.
  const searchTrigger = sample.locator('button[aria-haspopup="dialog"]').filter({ hasText: /均衡|快速|深入/ }).first()
  await searchTrigger.click()
  const popover = page.locator('[data-slot="popover-content"]')
  const search = popover.locator('input')
  await search.fill('no-such-option')
  check(await popover.locator('button[data-option]').count() === 0, 'Search handles empty results')
  await search.fill('')
  await page.keyboard.press('ArrowDown')
  check(await page.evaluate(() => document.activeElement.matches('button[data-option]')), 'ArrowDown enters filtered options')
  await page.keyboard.press('Enter')
  await popover.waitFor({ state: 'hidden' })
  const row = sample.locator('.entity-row-btn')
  await row.focus()
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[data-testid="control-system"] .craft-row-actions')).opacity) > 0.99)
  check(await sample.locator('.craft-row-actions').evaluate(el => Number(getComputedStyle(el).opacity)) > 0.99, 'Row actions reveal on keyboard focus')
  check(await sample.locator('button button').count() === 0, 'No nested buttons in settings or entity row')
  const more = sample.locator('.craft-row-actions button')
  await more.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('menuitem', { name: '查看详情' }).waitFor()
  await page.keyboard.press('Escape')
  check(await more.evaluate(el => el === document.activeElement), 'Entity menu supports keyboard activation and focus restoration')
  await page.mouse.move(0, 0)
  await sample.screenshot({ path: `${output}/settings-light.png` })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await sample.screenshot({ path: `${output}/settings-dark.png` })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  // Test authored theme variables locally; never write user theme files.
  for (const [radius, density] of [['0.25rem', '0.5rem'], ['1rem', '1.125rem']]) {
    await page.evaluate(([radius, density]) => { document.documentElement.style.setProperty('--theme-radius', radius); document.documentElement.style.setProperty('--theme-settings-row-padding-y', density) }, [radius, density])
    check(await name.evaluate(el => !!getComputedStyle(el).borderRadius), `Theme radius ${radius} resolves`)
  }
  await page.evaluate(() => { document.documentElement.style.removeProperty('--theme-radius'); document.documentElement.style.removeProperty('--theme-settings-row-padding-y') })
  check(errors.length === 0, `No page errors: ${errors.join('; ')}`)
  await writeFile(`${output}/controls-browser.json`, JSON.stringify(results, null, 2))
  console.log(`PASS: ${results.assertions.length} real-component assertions`)
} finally {
  await browser.close()
}

