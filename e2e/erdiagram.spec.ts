import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
    { id: 'c2', name: 'Empty DB', type: 'mysql', host: 'localhost', port: 3307, user: 'root', database: 'empty_db' },
  ],
  dbs: { c1: ['test', 'prod'], c2: ['empty_db'] },
  tables: { test: ['users', 'orders'], prod: [], empty_db: [] },
  tableData: {
    users: {
      columns: [
        { name: 'id', data_type: 'int', nullable: false, key: 'PRI', default_value: null, extra: 'auto_increment' },
        { name: 'name', data_type: 'varchar(100)', nullable: false, key: '', default_value: null, extra: '' },
        { name: 'email', data_type: 'varchar(255)', nullable: false, key: '', default_value: null, extra: '' },
      ],
      rows: [],
      total: 0,
    },
  },
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

test('er diagram renders table boxes with columns', async ({ page }) => {
  await openApp(page)
  await page.getByText('MySQL A').click()
  await page.locator('span[title="test"]').click()
  await page.getByRole('button', { name: 'ER Diagram' }).click()

  const svg = page.locator('svg', { hasText: 'users' })
  await expect(svg).toBeVisible({ timeout: 10_000 })
  await expect(svg.locator('text', { hasText: 'orders' })).toBeVisible()
  await expect(svg.locator('text', { hasText: 'email' })).toBeVisible()
  await expect(svg.locator('text', { hasText: 'name' })).toBeVisible()
})

test('er diagram toggle returns to the editor', async ({ page }) => {
  await openApp(page)
  await page.getByText('MySQL A').click()
  await page.locator('span[title="test"]').click()
  await page.getByRole('button', { name: 'ER Diagram' }).click()
  await expect(page.locator('svg', { hasText: 'users' })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: 'ER Diagram' }).click()
  await expect(page.locator('svg', { hasText: 'users' })).toHaveCount(0)
  await expect(page.locator('.monaco-editor').first()).toBeVisible()
})

test('er diagram shows empty state when db has no tables', async ({ page }) => {
  await openApp(page)
  await page.getByText('Empty DB').click()
  await page.getByRole('button', { name: 'ER Diagram' }).click()
  await expect(page.getByText('No tables found')).toBeVisible({ timeout: 10_000 })
})