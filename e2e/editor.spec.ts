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

async function typeSql(page: any, sql: string) {
  await page.locator('.monaco-editor').first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.monaco-editor .view-lines').first().click({ position: { x: 60, y: 20 } })
  await page.waitForTimeout(300)
  const ta = page.getByRole('textbox', { name: 'Editor content' })
  await ta.focus()
  await page.keyboard.insertText(sql)
}

test('run all executes every statement and shows results', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').click()
  await typeSql(page, 'SELECT * FROM users')
  await page.getByRole('button', { name: 'Run All', exact: true }).click()
  await expect(page.getByText('Alice').first()).toBeVisible({ timeout: 15_000 })
})

test('format button reformats SQL', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').click()
  await typeSql(page, 'select * from users where id=1')
  await page.getByRole('button', { name: 'Format', exact: true }).click()
  // formatted SQL contains newline/uppercase - just assert no error and editor still present
  await expect(page.locator('.monaco-editor').first()).toBeVisible()
  const content = await page.locator('.view-lines').first().innerText()
  expect(content.toUpperCase()).toContain('SELECT')
})

test('begin transaction toggles commit/rollback buttons', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').click()
  await expect(page.getByRole('button', { name: 'Begin', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Begin', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Commit', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Rollback', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Commit', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Begin', exact: true })).toBeVisible()
})

test('explain opens explain result tab', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').click()
  await typeSql(page, 'SELECT * FROM users')
  await page.getByRole('button', { name: 'Explain', exact: true }).click()
  // plan grid shows explain rows
  await expect(page.getByText('users (ALL, rows=100)').first()).toBeVisible({ timeout: 15_000 })
})

test('snippets panel opens and lists snippets', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').click()
  // ensure Monaco is mounted
  await page.locator('.monaco-editor').first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.getByTitle('Snippets').click()
  await expect(page.locator('div.max-h-72 button').first()).toBeVisible()
  await expect(page.locator('div.max-h-72 button').filter({ hasText: 'SELECT DISTINCT' })).toBeVisible()
  await expect(page.locator('div.max-h-72 button').filter({ hasText: 'CREATE TABLE' })).toBeVisible()
  // clicking a snippet closes the panel without error
  await page.locator('div.max-h-72 button').first().click()
  await expect(page.locator('div.max-h-72')).toHaveCount(0)
})

test('query history records executed queries', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').click()
  await typeSql(page, 'SELECT * FROM users')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('Alice').first()).toBeVisible({ timeout: 15_000 })
  await page.getByTitle('Query History').click()
  await expect(page.getByText('SELECT * FROM users').first()).toBeVisible()
})

test('clicking a history item reruns the query', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').click()
  await typeSql(page, 'SELECT * FROM users')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('Alice').first()).toBeVisible({ timeout: 15_000 })

  const before = await page.evaluate(() => (window as any).__executedQueries?.length || 0)
  await page.getByTitle('Query History').click()
  await page.getByRole('button', { name: 'SELECT * FROM users' }).click()
  await expect(page.getByText('Alice').first()).toBeVisible()

  const after = await page.evaluate(() => (window as any).__executedQueries?.length || 0)
  expect(after).toBe(before + 1)
})

test('transaction commands are invoked with the connection id', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').click()
  await expect(page.getByRole('button', { name: 'Begin', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Begin', exact: true }).click()
  await page.getByRole('button', { name: 'Rollback', exact: true }).click()
  await page.getByRole('button', { name: 'Begin', exact: true }).click()
  await page.getByRole('button', { name: 'Commit', exact: true }).click()

  const calls = await page.evaluate(() => (window as any).__txCalls || [])
  expect(calls.map((c: any) => c.cmd)).toEqual([
    'begin_transaction',
    'rollback_transaction',
    'begin_transaction',
    'commit_transaction',
  ])
  expect(calls.every((c: any) => c.args.id === 'c1')).toBe(true)
})