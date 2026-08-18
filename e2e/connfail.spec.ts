import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
  ],
  dbs: { c1: ['test'] },
  tables: { test: ['users'] },
  queries: {
    'SELECT * FROM users': { columns: ['id', 'name'], rows: [{ id: 1, name: 'Alice' }] },
  },
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

test('failed connection banner appears on boot', async ({ page }) => {
  await installBackend(page, { ...state, fail: { failConnect: ['c1'] } })
  await openApp(page)
  const banner = page.locator('div.bg-red-600')
  await expect(banner).toBeVisible({ timeout: 15_000 })
  await expect(banner).toContainText('Connection failed')
  await expect(banner).toContainText('access denied for user root')
})

test('a disconnected connection offers Connect in the context menu', async ({ page }) => {
  await installBackend(page, { ...state, fail: { failConnect: ['c1'] } })
  await openApp(page)
  await expect(page.locator('div.bg-red-600')).toBeVisible({ timeout: 15_000 })
  await page.locator('span[title="MySQL A"]').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Disconnect', exact: true })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Disconnect', exact: true }).click()
  await page.locator('span[title="MySQL A"]').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Connect', exact: true })).toBeVisible()
})

test('reconnect after a transient failure restores databases', async ({ page }) => {
  await installBackend(page, { ...state, fail: { failConnect: ['c1'] } })
  await openApp(page)
  await expect(page.locator('div.bg-red-600')).toBeVisible({ timeout: 15_000 })

  await page.locator('span[title="MySQL A"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Disconnect', exact: true }).click()

  await page.evaluate(() => { (window as any).__stubFail.failConnect = [] })
  await page.locator('span[title="MySQL A"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Connect', exact: true }).click()

  await page.locator('span[title="MySQL A"]').click()
  await expect(page.locator('span[title="test"]').first()).toBeVisible({ timeout: 15_000 })
  await page.locator('span[title="test"]').first().click()
  await expect(page.locator('span[title="users"]').first()).toBeVisible()
})

test('a query that fails at runtime can be rerun successfully after the outage clears', async ({ page }) => {
  await installBackend(page, {
    ...state,
    fail: { failQueries: ['SELECT * FROM users'] },
  })
  await openApp(page)
  await page.getByText('MySQL A').click()
  await page.locator('.monaco-editor').first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.monaco-editor .view-lines').first().click({ position: { x: 60, y: 20 } })
  await page.waitForTimeout(300)
  const ta = page.getByRole('textbox', { name: 'Editor content' })
  await ta.focus()
  await page.keyboard.insertText('SELECT * FROM users')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText(/SQL error 1064/).first()).toBeVisible({ timeout: 15_000 })

  await page.evaluate(() => { (window as any).__stubFail.failQueries = [] })
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('Alice').first()).toBeVisible({ timeout: 15_000 })
})