import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
    { id: 'c2', name: 'PG Server', type: 'postgresql', host: 'localhost', port: 5432, user: 'postgres', database: 'pgdb' },
    { id: 'c3', name: 'SQLite File', type: 'sqlite', host: 'localhost', port: 0, user: '', database: 'sqlitedb', filePath: '/tmp/app.db' },
    { id: 'c4', name: 'Mongo Server', type: 'mongodb', host: 'localhost', port: 27017, user: 'mongo', database: 'mongoapp' },
  ],
  dbs: {
    c1: ['test'],
    c2: ['pgdb'],
    c3: ['sqlitedb'],
    c4: ['mongoapp'],
  },
  tables: {
    test: ['users'],
    pgdb: ['accounts', 'products'],
    sqlitedb: ['notes'],
    mongoapp: ['documents'],
  },
  queries: {},
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

test('sidebar shows correct type badges for each connection', async ({ page }) => {
  await openApp(page)
  await expect(page.getByText('MySQL', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('PostgreSQL', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('SQLite', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('MongoDB', { exact: true }).first()).toBeVisible()
})

test('postgres connection loads tables grouped by schema', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="PG Server"]').click()
  await page.locator('span[title="pgdb"]').click()
  await expect(page.getByText('public', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('information_schema', { exact: true }).first()).toBeVisible()
  // expand public schema to see tables
  await page.locator('span[title="public"]').first().click()
  await expect(page.locator('span[title="accounts"]').first()).toBeVisible()
  await expect(page.locator('span[title="products"]').first()).toBeVisible()
})

test('sqlite connection has no user@host meta in header', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="SQLite File"]').click()
  // header meta for sqlite is omitted
  await expect(page.locator('header')).not.toContainText('@localhost:')
  // db still loads
  await page.locator('span[title="sqlitedb"]').click()
  await expect(page.locator('span[title="notes"]').first()).toBeVisible()
})

test('sqlite new connection form shows file path instead of host', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: /New Connection/ }).click()
  const dlg = page.locator('[role="dialog"]')
  // select SQLite type
  await dlg.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'SQLite', exact: true }).click()
  await expect(dlg.getByText('Database File Path', { exact: true })).toBeVisible()
  await expect(dlg.getByText('Host', { exact: true })).toHaveCount(0)
})

test('mongo connection loads databases and tables', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="Mongo Server"]').click()
  await expect(page.locator('header')).toContainText('mongo@localhost:27017')
  await page.locator('span[title="mongoapp"]').click()
  await expect(page.locator('span[title="documents"]').first()).toBeVisible()
})

test('postgres editor explain uses pg plan format', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="PG Server"]').click()
  await page.locator('.monaco-editor').first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.monaco-editor .view-lines').first().click({ position: { x: 60, y: 20 } })
  await page.waitForTimeout(300)
  const ta = page.getByRole('textbox', { name: 'Editor content' })
  await ta.focus()
  await page.keyboard.insertText('SELECT * FROM accounts')
  await page.getByRole('button', { name: 'Explain', exact: true }).click()
  // EXPLAIN prefix matches stub plan output
  await expect(page.getByText(/accounts \(ALL, rows=100\)/).first()).toBeVisible({ timeout: 15_000 })
})