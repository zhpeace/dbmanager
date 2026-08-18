import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
  ],
  dbs: { c1: ['test'] },
  tables: { test: ['users', 'orders'] },
  tableData: {
    users: {
      columns: [
        { name: 'id', data_type: 'int', nullable: false, key: 'PRI', default_value: null, extra: '' },
        { name: 'name', data_type: 'varchar', nullable: true, key: '', default_value: null, extra: '' },
        { name: 'email', data_type: 'varchar', nullable: true, key: '', default_value: null, extra: '' },
      ],
      rows: [{ id: 1, name: 'Alice', email: 'alice@x.com' }],
      total: 1,
    },
  },
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

async function openDesigner(page: any) {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').first().click()
  await page.locator('span[title="test"]').first().click()
  await page.locator('span[title="users"]').first().waitFor({ state: 'visible' })
  await page.locator('span[title="users"]').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Design Table', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Design Table: users')
  return dlg
}

async function ddlCalls(page: any, cmd: string) {
  return page.evaluate((c) => ((window as any).__ddlCalls || []).filter((x: any) => x.cmd === c), cmd)
}

test('design dialog preloads columns and index from schema', async ({ page }) => {
  const dlg = await openDesigner(page)
  await expect(dlg.locator('input[value="id"]')).toBeVisible()
  await expect(dlg.locator('input[value="name"]')).toBeVisible()
  await expect(dlg.locator('input[value="email"]')).toBeVisible()

  await dlg.getByRole('tab', { name: 'Indexes', exact: true }).click()
  await expect(dlg.getByText('idx_users')).toBeVisible()
  await expect(dlg.getByText('id', { exact: true })).toBeVisible()
})

test('adding a column calls alter_add_column and appends a row', async ({ page }) => {
  const dlg = await openDesigner(page)
  const addRow = dlg.locator('div.border.rounded.p-2').last()
  await addRow.locator('input').first().fill('phone')
  await addRow.locator('input').nth(1).fill('VARCHAR(20)')
  await dlg.getByRole('button', { name: 'Add Column', exact: true }).click()

  await expect
    .poll(async () => (await ddlCalls(page, 'alter_table_add_column')).length)
    .toBeGreaterThan(0)
  const calls = await ddlCalls(page, 'alter_table_add_column')
  expect(calls[0].args.column.name).toBe('phone')
  expect(calls[0].args.column.data_type).toBe('VARCHAR(20)')
  await expect(dlg.locator('input[value="phone"]')).toBeVisible()
})

test('dropping a column calls alter_drop_column', async ({ page }) => {
  const dlg = await openDesigner(page)
  await expect(dlg.locator('tbody tr:visible')).toHaveCount(3)
  await dlg.locator('tbody tr:visible').first().getByTitle('Drop').click()

  await expect
    .poll(async () => (await ddlCalls(page, 'alter_table_drop_column')).length)
    .toBeGreaterThan(0)
  const calls = await ddlCalls(page, 'alter_table_drop_column')
  expect(calls[0].args.column).toBe('id')
  await expect(dlg.locator('tbody tr:visible')).toHaveCount(2)
})

test('adding an index calls create_index and lists it', async ({ page }) => {
  const dlg = await openDesigner(page)
  await dlg.getByRole('tab', { name: 'Indexes', exact: true }).click()
  const addRow = dlg.locator('div.border.rounded.p-2').last()
  await addRow.locator('input').first().fill('idx_users_email')
  await addRow.locator('input').nth(1).fill('email')
  await dlg.getByRole('button', { name: 'Add Index', exact: true }).click()

  await expect
    .poll(async () => (await ddlCalls(page, 'create_index')).length)
    .toBeGreaterThan(0)
  const calls = await ddlCalls(page, 'create_index')
  expect(calls[0].args.name).toBe('idx_users_email')
  expect(calls[0].args.columns).toEqual(['email'])
  expect(calls[0].args.unique).toBe(false)
  await expect(dlg.getByText('idx_users_email')).toBeVisible()
})

test('dropping an index calls drop_index', async ({ page }) => {
  const dlg = await openDesigner(page)
  await dlg.getByRole('tab', { name: 'Indexes', exact: true }).click()
  await expect(dlg.locator('tbody tr:visible')).toHaveCount(1)
  await dlg.locator('tbody tr:visible').first().getByTitle('Drop').click()

  await expect
    .poll(async () => (await ddlCalls(page, 'drop_index')).length)
    .toBeGreaterThan(0)
  const calls = await ddlCalls(page, 'drop_index')
  expect(calls[0].args.name).toBe('idx_users')
  await expect(dlg.getByText('No indexes')).toBeVisible()
})

test('adding a foreign key calls add_foreign_key', async ({ page }) => {
  const dlg = await openDesigner(page)
  await dlg.getByRole('tab', { name: 'Foreign Keys', exact: true }).click()

  const addRow = dlg.locator('div.border.rounded.p-2').last()
  await addRow.locator('input').first().fill('fk_users_orders')
  await addRow.locator('[role="combobox"]').nth(0).click()
  await page.getByRole('option', { name: 'email', exact: true }).click()
  await addRow.locator('[role="combobox"]').nth(1).click()
  await page.getByRole('option', { name: 'orders', exact: true }).click()
  await addRow.locator('input').last().fill('id')
  await dlg.getByRole('button', { name: 'Add Foreign Key', exact: true }).click()

  await expect
    .poll(async () => (await ddlCalls(page, 'add_foreign_key')).length)
    .toBeGreaterThan(0)
  const calls = await ddlCalls(page, 'add_foreign_key')
  expect(calls[0].args.name).toBe('fk_users_orders')
  expect(calls[0].args.column).toBe('email')
  expect(calls[0].args.refTable).toBe('orders')
  expect(calls[0].args.refColumn).toBe('id')
  await expect(dlg.getByText('fk_users_orders')).toBeVisible()
})
