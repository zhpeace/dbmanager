import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const makeRows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `user${i + 1}` }))

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
  ],
  dbs: { c1: ['test'] },
  tables: { test: ['users'] },
  tableData: {
    users: {
      columns: [
        { name: 'id', data_type: 'int', nullable: false, key: 'PRI', default_value: null, extra: '' },
        { name: 'name', data_type: 'varchar', nullable: true, key: '', default_value: null, extra: '' },
      ],
      rows: [
        { id: 2, name: 'Bob' },
        { id: 1, name: 'Alice' },
        { id: 3, name: 'Carol' },
      ],
      total: 3,
    },
  },
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

async function openTable(page: any, waitText = 'Bob') {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').first().click()
  await page.locator('span[title="test"]').first().click()
  await page.locator('span[title="users"]').first().waitFor({ state: 'visible' })
  await page.locator('span[title="users"]').first().dblclick()
  await expect(page.getByText(waitText).first()).toBeVisible({ timeout: 15_000 })
}

async function lastTableArgs(page: any) {
  return page.evaluate(() => (window as any).__lastTableArgs)
}

test('sorting a column refetches asc then desc', async ({ page }) => {
  await openTable(page)
  await page.getByRole('button', { name: 'name', exact: true }).click()
  await expect
    .poll(async () => (await lastTableArgs(page)).sortColumn)
    .toBe('name')
  expect((await lastTableArgs(page)).sortOrder).toBe('asc')
  await expect(page.locator('tbody tr').first()).toContainText('Alice')

  await page.getByRole('button', { name: 'name', exact: true }).click()
  await expect
    .poll(async () => (await lastTableArgs(page)).sortOrder)
    .toBe('desc')
  await expect(page.locator('tbody tr').first()).toContainText('Carol')
})

test('pagination moves to the next page and refetches', async ({ page }) => {
  await installBackend(page, {
    ...state,
    tableData: { users: { ...state.tableData.users, rows: makeRows(105), total: 105 } },
  })
  await openTable(page, 'user1')
  await expect(page.getByText('1 / 2').first()).toBeVisible()
  await expect(page.getByText('user1', { exact: true }).first()).toBeVisible()

  const next = page.getByText('1 / 2').first().locator('..').getByRole('button').last()
  await next.click()
  await expect(page.getByText('2 / 2').first()).toBeVisible()
  expect((await lastTableArgs(page)).page).toBe(2)
  await expect(page.getByText('user101', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('user1', { exact: true }).first()).toHaveCount(0)
})

test('filtering by column value refetches with whereClause and clear resets', async ({ page }) => {
  await openTable(page)
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.locator('input[placeholder="name"]').fill('Alice')

  await expect
    .poll(async () => (await lastTableArgs(page)).whereClause)
    .toContain('`name` = \'Alice\'')
  await expect(page.getByText('Alice').first()).toBeVisible()
  await expect(page.getByText('Bob')).toHaveCount(0)
  await expect(page.getByText('Carol')).toHaveCount(0)

  await page.getByTitle('Clear filters').click()
  await expect
    .poll(async () => (await lastTableArgs(page)).whereClause)
    .toBeNull()
  await expect(page.getByText('Bob').first()).toBeVisible()
  await expect(page.getByText('Carol').first()).toBeVisible()
})
