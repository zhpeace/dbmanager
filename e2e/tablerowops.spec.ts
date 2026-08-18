import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

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
      rows: [{ id: 1, name: 'Alice' }],
      total: 1,
    },
  },
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

async function openTable(page: any) {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').first().click()
  await page.locator('span[title="test"]').first().click()
  await page.locator('span[title="users"]').first().waitFor({ state: 'visible' })
  await page.locator('span[title="users"]').first().dblclick()
  await expect(page.getByText('Alice').first()).toBeVisible({ timeout: 15_000 })
}

async function batchQueries(page: any) {
  return page.evaluate(() => (window as any).__batchQueries || [])
}

test('add row appends a pending row and rollback discards it', async ({ page }) => {
  await openTable(page)
  await expect(page.locator('tbody tr:visible')).toHaveCount(1)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('1 row(s) pending')).toBeVisible()
  await expect(page.locator('tbody tr:visible')).toHaveCount(2)

  await page.getByRole('button', { name: 'Revert', exact: true }).click()
  await expect(page.getByText('1 row(s) pending')).toHaveCount(0)
  await expect(page.locator('tbody tr:visible')).toHaveCount(1)
})

test('editing an added row and saving runs an INSERT', async ({ page }) => {
  await openTable(page)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const addedRow = page.locator('tbody tr:visible').last()
  await addedRow.getByText('NULL').nth(1).dblclick()
  const input = page.locator('input.border-primary')
  await expect(input).toBeVisible()
  await input.fill('Bob')
  await page.keyboard.press('Enter')

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(async () => (await batchQueries(page)).length).toBeGreaterThan(0)
  const queries = await batchQueries(page)
  expect(queries).toContain('INSERT INTO `users` (`id`, `name`) VALUES (NULL, \'Bob\')')
})

test('deleting a selected row saves a DELETE statement', async ({ page }) => {
  await openTable(page)
  await page.locator('tbody tr:visible').first().locator('input[type="checkbox"]').check()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText('1 row(s) pending')).toBeVisible()

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(async () => (await batchQueries(page)).length).toBeGreaterThan(0)
  const queries = await batchQueries(page)
  expect(queries).toContain('DELETE FROM `users` WHERE `id` = 1')
})

test('revert restores a deleted row', async ({ page }) => {
  await openTable(page)
  await page.locator('tbody tr:visible').first().locator('input[type="checkbox"]').check()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText('1 row(s) pending')).toBeVisible()
  await page.getByRole('button', { name: 'Revert', exact: true }).click()
  await expect(page.getByText('1 row(s) pending')).toHaveCount(0)
  await expect(page.getByText('Alice').first()).toBeVisible()
  const queries = await batchQueries(page)
  expect(queries).toHaveLength(0)
})
