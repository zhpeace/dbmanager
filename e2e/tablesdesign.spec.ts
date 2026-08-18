import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
  ],
  dbs: { c1: ['test'] },
  tables: { test: ['users'] },
  queries: {},
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

async function openDb(page: any) {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').click()
  await page.locator('span[title="test"]').click()
}

test('create table dialog adds columns and creates the table', async ({ page }) => {
  await openDb(page)
  await page.locator('span[title="test"]').click({ button: 'right' })
  await page.getByText('New Table').click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Create Table')

  // default row: name input has value "id"
  await expect(dlg.locator('table input').nth(0)).toHaveValue('id')

  // add a second column; each row has 5 inputs (name, type, nullable cb, pk cb, default)
  await dlg.getByRole('button', { name: 'Add Column' }).click()
  await dlg.locator('table input').nth(5).fill('age')
  await dlg.locator('table input').nth(6).fill('INT')

  await dlg.getByPlaceholder('my_table').fill('profiles')
  await dlg.getByRole('button', { name: 'Create', exact: true }).click()

  await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 10_000 })
  const calls = await page.evaluate(() => (window as any).__ddlCalls || [])
  const create = calls.find((c: any) => c.cmd === 'create_table')
  expect(create).toBeTruthy()
  expect(create.args.table).toBe('profiles')
  expect(create.args.database).toBe('test')
  const colNames = create.args.columns.map((c: any) => c.name)
  expect(colNames).toEqual(['id', 'age'])
})

test('create table requires a table name', async ({ page }) => {
  await openDb(page)
  await page.locator('span[title="test"]').click({ button: 'right' })
  await page.getByText('New Table').click()
  const dlg = page.locator('[role="dialog"]')
  await dlg.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dlg).toContainText('Table name required')
  const calls = await page.evaluate(() => (window as any).__ddlCalls || [])
  expect(calls.filter((c: any) => c.cmd === 'create_table')).toHaveLength(0)
})

test('design table shows columns from schema cache', async ({ page }) => {
  await openDb(page)
  await page.locator('span[title="users"]').first().click({ button: 'right' })
  await page.getByText('Design Table').click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Design Table: users', { timeout: 10_000 })
  // columns tab is default; existing columns render as textbox values (5 inputs/row)
  await expect(dlg.locator('table input').nth(5)).toHaveValue('name')
  await expect(dlg.locator('table input').nth(10)).toHaveValue('email')
})

test('design table adds a column', async ({ page }) => {
  await openDb(page)
  await page.locator('span[title="users"]').first().click({ button: 'right' })
  await page.getByText('Design Table').click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Design Table: users', { timeout: 10_000 })

  // the "add column" form at the bottom has its own name + type inputs
  await dlg.locator('div.flex.items-end input').nth(0).fill('age')
  await dlg.locator('div.flex.items-end input').nth(1).fill('INT')
  await dlg.getByRole('button', { name: 'Add Column' }).last().click()

  // 3 existing rows * 5 inputs = 15, new row name is input #15
  await expect(dlg.locator('table input').nth(15)).toHaveValue('age', { timeout: 10_000 })
  const calls = await page.evaluate(() => (window as any).__ddlCalls || [])
  const add = calls.find((c: any) => c.cmd === 'alter_table_add_column')
  expect(add).toBeTruthy()
  expect(add.args.table).toBe('users')
  expect(add.args.column.name).toBe('age')
  expect(add.args.column.data_type).toBe('INT')
})

test('design table indexes tab adds an index', async ({ page }) => {
  await openDb(page)
  await page.locator('span[title="users"]').first().click({ button: 'right' })
  await page.getByText('Design Table').click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Design Table: users', { timeout: 10_000 })

  await dlg.getByRole('tab', { name: 'Indexes' }).click()
  await expect(dlg.getByText('idx_users').first()).toBeVisible()
  // index add form: name (placeholder idx_users_) + columns (placeholder col1, col2)
  await dlg.getByPlaceholder('idx_users_').fill('idx_name')
  await dlg.getByPlaceholder('col1, col2').fill('name')
  await dlg.getByRole('button', { name: 'Add Index' }).click()
  const calls = await page.evaluate(() => (window as any).__ddlCalls || [])
  const idx = calls.find((c: any) => c.cmd === 'create_index')
  expect(idx).toBeTruthy()
  expect(idx.args.table).toBe('users')
  expect(idx.args.name).toBe('idx_name')
  expect(idx.args.columns).toEqual(['name'])
})

test('design table foreign keys tab lists fks', async ({ page }) => {
  await openDb(page)
  await page.locator('span[title="users"]').first().click({ button: 'right' })
  await page.getByText('Design Table').click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Design Table: users', { timeout: 10_000 })

  await dlg.getByRole('tab', { name: 'Foreign Keys' }).click()
  await expect(dlg.getByText('No foreign keys')).toBeVisible()
})