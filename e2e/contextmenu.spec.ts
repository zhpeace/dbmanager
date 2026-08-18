import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
  ],
  dbs: { c1: ['test', 'prod'] },
  tables: { test: ['users', 'orders'] },
  queries: {
    'SELECT * FROM `test`.`users`': {
      columns: ['id', 'name', 'email'],
      rows: [{ id: 1, name: 'Alice', email: 'alice@x.com' }],
    },
  },
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

async function openUsers(page: import('@playwright/test').Page) {
  await openApp(page)
  await page.getByText('MySQL A').click()
  await page.locator('span[title="test"]').click()
  await page.locator('span[title="users"]').first().waitFor({ state: 'visible' })
}

async function rightClickUsers(page: import('@playwright/test').Page) {
  await page.locator('span[title="users"]').first().click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Design Table' })).toBeVisible()
}

test('table context menu lists all actions', async ({ page }) => {
  await openUsers(page)
  await page.locator('span[title="users"]').first().click({ button: 'right' })
  for (const item of [
    'Design Table', 'Browse Data', 'Open in Editor',
    'Export as CSV', 'Export as JSON', 'Export as INSERT SQL',
    'Truncate Table', 'Rename Table', 'Drop Table', 'Copy Name',
  ]) {
    await expect(page.getByRole('menuitem', { name: item })).toBeVisible()
  }
})

test('truncate table invokes truncate_table', async ({ page }) => {
  await openUsers(page)
  await rightClickUsers(page)
  await page.getByRole('menuitem', { name: 'Truncate Table' }).click()
  const calls = await page.evaluate(() => (window as any).__ddlCalls || [])
  expect(calls.some((c: any) => c.cmd === 'truncate_table' &&
    c.args.id === 'c1' && c.args.database === 'test' && c.args.table === 'users')).toBe(true)
})

test('rename table prefills current name and sends newName', async ({ page }) => {
  await openUsers(page)
  await rightClickUsers(page)
  await page.getByRole('menuitem', { name: 'Rename Table' }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Rename')
  const input = dlg.locator('input')
  await expect(input).toHaveValue('users')
  await input.fill('customers')
  await dlg.getByRole('button', { name: 'Rename', exact: true }).click()
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)
  const calls = await page.evaluate(() => (window as any).__ddlCalls || [])
  expect(calls.some((c: any) => c.cmd === 'rename_table' &&
    c.args.id === 'c1' && c.args.table === 'users' && c.args.newName === 'customers')).toBe(true)
})

test('drop table asks confirmation, cancel keeps it, confirm drops', async ({ page }) => {
  await openUsers(page)
  // cancel path
  await rightClickUsers(page)
  await page.getByRole('menuitem', { name: 'Drop Table' }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText(/Are you sure you want to drop table "users"/)
  await dlg.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)
  let calls = await page.evaluate(() => (window as any).__ddlCalls || [])
  expect(calls.some((c: any) => c.cmd === 'drop_table')).toBe(false)

  // confirm path
  await rightClickUsers(page)
  await page.getByRole('menuitem', { name: 'Drop Table' }).click()
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Drop Table', exact: true }).click()
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)
  calls = await page.evaluate(() => (window as any).__ddlCalls || [])
  expect(calls.some((c: any) => c.cmd === 'drop_table' &&
    c.args.id === 'c1' && c.args.database === 'test' && c.args.table === 'users')).toBe(true)
})

test('copy name copies table name to clipboard', async ({ page }) => {
  await openUsers(page)
  await rightClickUsers(page)
  await page.getByRole('menuitem', { name: 'Copy Name' }).click()
  await expect(page.getByRole('menuitem', { name: 'Copy Name' })).toHaveCount(0)
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toBe('users')
})

test('export table as csv runs select, saves file with content', async ({ page }) => {
  await openUsers(page)
  await rightClickUsers(page)
  await page.getByRole('menuitem', { name: 'Export as CSV' }).click()
  await expect(page.getByRole('menuitem', { name: 'Export as CSV' })).toHaveCount(0)
  const files = await page.evaluate(() => (window as any).__writtenFiles || [])
  expect(files.length).toBeGreaterThan(0)
  expect(files[0].path.endsWith('.csv')).toBe(true)
  expect(files[0].content).toContain('alice@x.com')
})