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
    'SELECT * FROM empty_table': { columns: ['id', 'name'], rows: [] },
  },
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

async function typeSql(page: any, sql: string) {
  await page.locator('.monaco-editor').first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.monaco-editor .view-lines').first().click({ position: { x: 60, y: 20 } })
  await page.waitForTimeout(300)
  const ta = page.getByRole('textbox', { name: 'Editor content' })
  await ta.focus()
  await page.keyboard.insertText(sql)
}

test('failed connection shows error banner on boot', async ({ page }) => {
  await installBackend(page, { ...state, fail: { failConnect: ['c1'] } })
  await openApp(page)
  await expect(page.locator('div.bg-red-600')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('div.bg-red-600')).toContainText('Connection failed')
  await expect(page.locator('div.bg-red-600')).toContainText('access denied')
})

test('error banner can be dismissed', async ({ page }) => {
  await installBackend(page, { ...state, fail: { failConnect: ['c1'] } })
  await openApp(page)
  const banner = page.locator('div.bg-red-600')
  await expect(banner).toBeVisible({ timeout: 15_000 })
  await banner.getByText('✕').click()
  await expect(banner).toHaveCount(0)
})

test('sql syntax error is shown in results panel', async ({ page }) => {
  await installBackend(page, { ...state, fail: { failQueries: ['SELEC * FROM users'] } })
  await openApp(page)
  await page.getByText('MySQL A').click()
  await typeSql(page, 'SELEC * FROM users')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText(/SQL error 1064/).first()).toBeVisible({ timeout: 15_000 })
})

test('query with error result field shows error', async ({ page }) => {
  await installBackend(page, {
    ...state,
    fail: { errorQueries: { 'SELECT broken FROM nope': 'Table nope does not exist' } },
  })
  await openApp(page)
  await page.getByText('MySQL A').click()
  await typeSql(page, 'SELECT broken FROM nope')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('Table nope does not exist').first()).toBeVisible({ timeout: 15_000 })
})

test('empty result shows no rows message', async ({ page }) => {
  await openApp(page)
  await page.getByText('MySQL A').click()
  await typeSql(page, 'SELECT * FROM empty_table')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('No rows returned').first()).toBeVisible({ timeout: 15_000 })
})

test('disconnected connection still lists in sidebar', async ({ page }) => {
  await installBackend(page, { ...state, fail: { failConnect: ['c1'] } })
  await openApp(page)
  await expect(page.locator('div.bg-red-600')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('MySQL A')).toBeVisible()
})