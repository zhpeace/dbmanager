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

/** The currently-active table-browser tab panel. Design Table opens a tab view, not a dialog. */
const activePanel = (page: any) => page.locator('[role="tabpanel"][data-state="active"]')

async function openDesigner(page: any) {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').first().click()
  await page.locator('span[title="test"]').first().click()
  await page.locator('span[title="users"]').first().waitFor({ state: 'visible' })
  await page.locator('span[title="users"]').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Design Table', exact: true }).click()
  // Design Table opens the table browser on the Columns tab (no dialog)
  const panel = activePanel(page)
  await expect(panel.getByRole('columnheader', { name: 'Type' })).toBeVisible({ timeout: 10_000 })
  return panel
}

async function ddlCalls(page: any, cmd: string) {
  return page.evaluate((c) => ((window as any).__ddlCalls || []).filter((x: any) => x.cmd === c), cmd)
}

test('design view preloads columns and index from schema', async ({ page }) => {
  const panel = await openDesigner(page)
  await expect(panel.locator('input[value="id"]')).toBeVisible()
  await expect(panel.locator('input[value="name"]')).toBeVisible()
  await expect(panel.locator('input[value="email"]')).toBeVisible()

  await page.getByRole('tab', { name: 'Indexes', exact: true }).click()
  await expect(activePanel(page).getByText('idx_users')).toBeVisible()
  await expect(activePanel(page).getByText('id', { exact: true })).toBeVisible()
})

test('adding a column calls alter_add_column and appends a row', async ({ page }) => {
  const panel = await openDesigner(page)
  const addRow = panel.locator('div.flex.items-end.gap-2.border-t.p-2')
  await addRow.locator('input').first().fill('phone')
  await addRow.locator('input').nth(1).fill('VARCHAR(20)')
  await panel.getByRole('button', { name: 'Add Column', exact: true }).click()
  // the new column appears in the local list before applying (Apply reloads from schema)
  await expect(panel.locator('input[value="phone"]')).toBeVisible()
  await panel.getByRole('button', { name: 'Apply', exact: true }).click()

  await expect
    .poll(async () => (await ddlCalls(page, 'alter_table_add_column')).length)
    .toBeGreaterThan(0)
  const calls = await ddlCalls(page, 'alter_table_add_column')
  expect(calls[0].args.column.name).toBe('phone')
  expect(calls[0].args.column.data_type).toBe('VARCHAR(20)')
})

test('dropping a column calls alter_drop_column', async ({ page }) => {
  const panel = await openDesigner(page)
  await expect(panel.locator('tbody tr:visible')).toHaveCount(3)
  await panel.locator('tbody tr:visible').first().getByTitle('Drop').click()
  // removed from the local list before applying
  await expect(panel.locator('tbody tr:visible')).toHaveCount(2)
  await panel.getByRole('button', { name: 'Apply', exact: true }).click()

  await expect
    .poll(async () => (await ddlCalls(page, 'alter_table_drop_column')).length)
    .toBeGreaterThan(0)
  const calls = await ddlCalls(page, 'alter_table_drop_column')
  expect(calls[0].args.column).toBe('id')
})

test('adding an index calls create_index and lists it', async ({ page }) => {
  await openDesigner(page)
  await page.getByRole('tab', { name: 'Indexes', exact: true }).click()
  const panel = activePanel(page)
  const addRow = panel.locator('div.border.rounded.p-2').last()
  await addRow.locator('input').first().fill('idx_users_email')
  // index columns are picked via the popover checkbox list (no text input)
  await addRow.getByRole('button').filter({ hasText: 'Select columns' }).click()
  await page.getByRole('checkbox', { name: 'email' }).check()
  await page.keyboard.press('Escape')
  await panel.getByRole('button', { name: 'Add Index', exact: true }).click()
  // the index appears in the local list before applying
  await expect(panel.getByText('idx_users_email')).toBeVisible()
  await panel.getByRole('button', { name: 'Apply', exact: true }).click()

  await expect
    .poll(async () => (await ddlCalls(page, 'create_index')).length)
    .toBeGreaterThan(0)
  const calls = await ddlCalls(page, 'create_index')
  expect(calls[0].args.name).toBe('idx_users_email')
  expect(calls[0].args.columns).toEqual(['email'])
  expect(calls[0].args.unique).toBe(false)
})

test('dropping an index calls drop_index', async ({ page }) => {
  await openDesigner(page)
  await page.getByRole('tab', { name: 'Indexes', exact: true }).click()
  const panel = activePanel(page)
  await expect(panel.locator('tbody tr:visible')).toHaveCount(1)
  await panel.locator('tbody tr:visible').first().getByTitle('Drop').click()
  // removed from the local list before applying
  await expect(panel.getByText('No indexes')).toBeVisible()
  await panel.getByRole('button', { name: 'Apply', exact: true }).click()

  await expect
    .poll(async () => (await ddlCalls(page, 'drop_index')).length)
    .toBeGreaterThan(0)
  const calls = await ddlCalls(page, 'drop_index')
  expect(calls[0].args.name).toBe('idx_users')
})

test('adding a foreign key calls add_foreign_key', async ({ page }) => {
  await openDesigner(page)
  await page.getByRole('tab', { name: 'Foreign Keys', exact: true }).click()
  const panel = activePanel(page)
  const addRow = panel.locator('div.border.rounded.p-2').last()
  await addRow.locator('input').first().fill('fk_users_orders')
  await addRow.locator('[role="combobox"]').nth(0).click()
  await page.getByRole('option', { name: 'email', exact: true }).click()
  await addRow.locator('[role="combobox"]').nth(1).click()
  await page.getByRole('option', { name: 'orders', exact: true }).click()
  await addRow.locator('input').last().fill('id')
  await panel.getByRole('button', { name: 'Add Foreign Key', exact: true }).click()
  // the fk appears in the local list before applying
  await expect(panel.getByText('fk_users_orders')).toBeVisible()
  await panel.getByRole('button', { name: 'Apply', exact: true }).click()

  await expect
    .poll(async () => (await ddlCalls(page, 'add_foreign_key')).length)
    .toBeGreaterThan(0)
  const calls = await ddlCalls(page, 'add_foreign_key')
  expect(calls[0].args.name).toBe('fk_users_orders')
  expect(calls[0].args.column).toBe('email')
  expect(calls[0].args.refTable).toBe('orders')
  expect(calls[0].args.refColumn).toBe('id')
})
