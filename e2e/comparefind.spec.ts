import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
    { id: 'c2', name: 'PG Server', type: 'postgresql', host: 'localhost', port: 5432, user: 'postgres', database: 'pgdb' },
    { id: 'c3', name: 'No DB Server', type: 'mysql', host: 'localhost', port: 3307, user: 'root', database: null },
  ],
  dbs: { c1: ['test', 'prod'], c2: ['pgdb'], c3: [] },
  tables: { test: ['users', 'orders'], prod: [], pgdb: [] },
  queries: {},
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

async function pickOption(dlg: any, page: any, placeholder: string, optionText: string) {
  await dlg.getByRole('combobox').filter({ hasText: placeholder }).first().click()
  await page.getByRole('option', { name: optionText }).click()
}

test('compare schemas shows diffs and sync sql', async ({ page }) => {
  await openApp(page)
  await page.getByText('MySQL A').click()
  await page.getByRole('button', { name: 'Compare', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Compare Schemas')

  // source connection + db
  await pickOption(dlg, page, 'Select source', 'MySQL A (mysql)')
  await pickOption(dlg, page, 'Select database', 'test')
  // target connection + db
  await pickOption(dlg, page, 'Select target', 'PG Server (postgresql)')
  await pickOption(dlg, page, 'Select database', 'pgdb')

  await dlg.getByRole('button', { name: 'Compare', exact: true }).click()
  // summary line
  await expect(dlg.getByText(/1 table differs/).first()).toBeVisible({ timeout: 10_000 })
  // table row with status
  await expect(dlg.getByText('users', { exact: true }).first()).toBeVisible()
  // only-in-source / only-in-target chips
  await expect(dlg.getByText('archive', { exact: true }).first()).toBeVisible()
  await expect(dlg.getByText('backup', { exact: true }).first()).toBeVisible()

  // expand the users row to see column diff + sync sql
  await dlg.getByText('users', { exact: true }).first().click()
  await expect(dlg.getByText('email', { exact: true }).first()).toBeVisible()
  await expect(dlg.getByText('type_mismatch', { exact: true }).first()).toBeVisible()
  await expect(dlg.getByText(/ALTER TABLE `users` MODIFY/).first()).toBeVisible()
})

test('compare requires both databases selected before enabling', async ({ page }) => {
  await openApp(page)
  await page.getByText('MySQL A').click()
  await page.getByRole('button', { name: 'Compare', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  // initially disabled
  await expect(dlg.getByRole('button', { name: 'Compare', exact: true })).toBeDisabled()
  // select only source
  await pickOption(dlg, page, 'Select source', 'MySQL A (mysql)')
  await pickOption(dlg, page, 'Select database', 'test')
  await expect(dlg.getByRole('button', { name: 'Compare', exact: true })).toBeDisabled()
  // select target
  await pickOption(dlg, page, 'Select target', 'PG Server (postgresql)')
  await pickOption(dlg, page, 'Select database', 'pgdb')
  await expect(dlg.getByRole('button', { name: 'Compare', exact: true })).toBeEnabled()
})

test('find in tables requires a database selected', async ({ page }) => {
  await openApp(page)
  // button only exists once a connection is active
  await expect(page.getByRole('button', { name: 'Find in Tables', exact: true })).toHaveCount(0)
  await page.getByText('No DB Server').click()
  await page.getByRole('button', { name: 'Find in Tables', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Find in Tables')
  await expect(dlg.getByText('Select a connection and database first')).toBeVisible()
  await expect(dlg.getByRole('button', { name: 'Search', exact: true })).toBeDisabled()
})

test('find in tables searches and lists matches', async ({ page }) => {
  await openApp(page)
  await page.getByText('MySQL A').click()
  await page.locator('span[title="test"]').click()
  await page.getByRole('button', { name: 'Find in Tables', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Find in Tables')

  await dlg.getByPlaceholder('Enter text to search across tables...').fill('alice')
  await dlg.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(dlg.getByText('users', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
  await expect(dlg.getByText('alice@x.com').first()).toBeVisible()
  await expect(dlg.getByText('orders', { exact: true }).first()).toBeVisible()
  await expect(dlg.getByText('alice order').first()).toBeVisible()
})

test('find in tables clicking a match opens the table', async ({ page }) => {
  await openApp(page)
  await page.getByText('MySQL A').click()
  await page.locator('span[title="test"]').click()
  await page.getByRole('button', { name: 'Find in Tables', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  await dlg.getByPlaceholder('Enter text to search across tables...').fill('alice')
  await dlg.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(dlg.getByText('alice@x.com').first()).toBeVisible({ timeout: 10_000 })

  // click the match -> dialog closes and a browse tab for users opens
  await dlg.getByText('alice@x.com').first().click()
  await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 10_000 })
  await expect(page.locator('div[title="users"]')).toBeVisible()
})