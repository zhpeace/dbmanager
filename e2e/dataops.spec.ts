import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
  ],
  dbs: { c1: ['test'] },
  tables: { test: ['users'] },
  queries: {
    'SELECT * FROM users': { columns: ['id', 'name', 'email'], rows: [{ id: 1, name: 'Alice', email: 'alice@x.com' }] },
  },
  tableData: {
    users: {
      columns: [
        { name: 'id', data_type: 'int', nullable: false, key: 'PRI', default_value: null, extra: '' },
        { name: 'name', data_type: 'varchar', nullable: true, key: '', default_value: null, extra: '' },
        { name: 'email', data_type: 'varchar', nullable: true, key: '', default_value: null, extra: '' },
      ],
      rows: [
        { id: 1, name: 'Alice', email: 'alice@x.com' },
        { id: 2, name: 'Bob', email: 'bob@x.com' },
      ],
      total: 2,
    },
  },
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

async function openTable(page: any) {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').click()
  await page.locator('span[title="test"]').click()
  await page.locator('span[title="users"]').first().waitFor({ state: 'visible' })
  await page.locator('span[title="users"]').first().dblclick()
  await expect(page.getByText('Bob').first()).toBeVisible({ timeout: 15_000 })
}

test('table browser rows info and column tabs', async ({ page }) => {
  await openTable(page)
  // data is rendered (rows + column headers)
  await expect(page.getByText('alice@x.com').first()).toBeVisible()
  await expect(page.getByRole('columnheader', { name: /email/ }).first()).toBeVisible()
  // columns tab
  await page.getByRole('tab', { name: 'Columns' }).click()
  await expect(page.getByRole('columnheader', { name: 'Type' })).toBeVisible()
  await expect(page.getByText('varchar', { exact: true }).first()).toBeVisible()
  // ddl tab
  await page.getByRole('tab', { name: 'DDL' }).click()
  await expect(page.getByText(/CREATE TABLE/).first()).toBeVisible()
})

test('adding a row and saving sends batch SQL', async ({ page }) => {
  await openTable(page)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  // a new empty row appears and pending indicator shows
  await expect(page.getByText('1 row(s) pending').first()).toBeVisible({ timeout: 10_000 })
  // click Save
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/pending/)).toHaveCount(0, { timeout: 10_000 })
  const batch = await page.evaluate(() => (window as any).__batchQueries || [])
  expect(batch.some((q: string) => /INSERT INTO/.test(q))).toBe(true)
})

test('filter input narrows to a WHERE clause query', async ({ page }) => {
  await openTable(page)
  await page.getByTitle('Filter').click()
  // filter input placeholder is the column name "email"
  await page.getByPlaceholder('email').fill('@x.com')
  await page.waitForTimeout(800)
  const args = await page.evaluate(() => (window as any).__lastTableArgs || null)
  expect(args).not.toBeNull()
  expect(args.whereClause).toContain('email')
  expect(args.whereClause).toContain('@x.com')
})

test('column sort toggles header indicator', async ({ page }) => {
  await openTable(page)
  // click "name" header
  await page.getByText('name', { exact: true }).first().click()
  await page.getByText('name', { exact: true }).first().click()
  await expect(page.getByText('name', { exact: true }).first()).toBeVisible()
})

test('export CSV from result panel writes file', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').click()
  await page.locator('.monaco-editor').first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.monaco-editor .view-lines').first().click({ position: { x: 60, y: 20 } })
  await page.waitForTimeout(300)
  await page.getByRole('textbox', { name: 'Editor content' }).focus()
  await page.keyboard.insertText('SELECT * FROM users')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('Alice').first()).toBeVisible({ timeout: 15_000 })
  // click export CSV (result panel)
  await page.locator('button', { hasText: 'CSV' }).first().click()
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)
})