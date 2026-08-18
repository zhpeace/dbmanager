import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
  ],
  dbs: { c1: ['test', 'prod'] },
  tables: { test: ['users', 'orders'] },
  queries: {},
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

test('double-clicking a table opens the table browser with data', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').click()
  await page.locator('span[title="test"]').click()
  await expect(page.locator('span[title="users"]').first()).toBeVisible()

  await page.locator('span[title="users"]').first().dblclick()
  // TableBrowser tab appears
  await expect(page.getByText('users', { exact: true }).first()).toBeVisible()
  // rows rendered
  await expect(page.getByText('Alice').first()).toBeVisible()
  await expect(page.getByText('Bob').first()).toBeVisible()
  // column header
  await expect(page.getByText('email', { exact: true }).first()).toBeVisible()
})

test('context menu on table offers browse data / design / export', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').click()
  await page.locator('span[title="test"]').click()
  await page.locator('span[title="users"]').first().waitFor({ state: 'visible' })

  await page.locator('span[title="users"]').first().click({ button: 'right' })
  await expect(page.getByText('Browse Data')).toBeVisible()
  await expect(page.getByText('Design Table')).toBeVisible()
  await expect(page.getByText('Export as CSV')).toBeVisible()
  await expect(page.getByText('Export as JSON')).toBeVisible()
})

test('context menu on database offers create table / drop / duplicate', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').click()
  await page.locator('span[title="test"]').click({ button: 'right' })
  await expect(page.getByText('New Table')).toBeVisible()
  await expect(page.getByText('Drop Database')).toBeVisible()
  await expect(page.getByText('Duplicate Database')).toBeVisible()
  await expect(page.getByText('Open in Editor')).toBeVisible()
})

test('create table dialog opens from context menu', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').click()
  await page.locator('span[title="test"]').click()
  await page.locator('span[title="users"]').first().click({ button: 'right' })
  // Use "New Table" via the database context menu instead (table menu has different items)
  await page.keyboard.press('Escape')
  await page.locator('span[title="test"]').click({ button: 'right' })
  await page.getByText('New Table').click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Create Table')
  await dlg.getByRole('button', { name: 'Close' }).last().click()
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)
})