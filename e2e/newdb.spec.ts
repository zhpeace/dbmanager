import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
  ],
  dbs: { c1: ['test', 'prod'] },
  tables: { test: ['users', 'orders'], prod: [] },
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

test('new database creates and records the db name', async ({ page }) => {
  await openApp(page)
  await page.getByText('MySQL A').click()
  await page.locator('span[title="MySQL A"]').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'New Database' }).click()

  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('New Database')
  await expect(dlg.getByRole('button', { name: 'Create', exact: true })).toBeDisabled()
  await dlg.getByPlaceholder('my_database').fill('analytics')
  await dlg.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 10_000 })

  const calls = await page.evaluate(() => (window as any).__ddlCalls || [])
  expect(calls.some((c: any) => c.cmd === 'create_database' &&
    c.args.id === 'c1' && c.args.dbName === 'analytics')).toBe(true)
})

test('duplicate database prefills name and reports success', async ({ page }) => {
  await openApp(page)
  await page.getByText('MySQL A').click()
  await page.locator('span[title="test"]').first().waitFor({ state: 'visible' })
  await page.locator('span[title="test"]').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Duplicate Database' }).click()

  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Duplicate Database')
  await expect(dlg.locator('input')).toHaveValue('test_copy')
  await dlg.getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(dlg.getByText(/Done! 1 tables, 100 rows transferred in 1.2s/)).toBeVisible({ timeout: 10_000 })

  const opts = await page.evaluate(() => (window as any).__lastTransferOpts || null)
  expect(opts).not.toBeNull()
  expect(opts.sourceDb).toBe('test')
  expect(opts.targetDb).toBe('test_copy')
})

test('duplicate database rejects the same name', async ({ page }) => {
  await openApp(page)
  await page.getByText('MySQL A').click()
  await page.locator('span[title="test"]').first().waitFor({ state: 'visible' })
  await page.locator('span[title="test"]').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Duplicate Database' }).click()

  const dlg = page.locator('[role="dialog"]')
  await expect(dlg.locator('input')).toHaveValue('test_copy')
  await dlg.locator('input').fill('test')
  await expect(dlg.getByText('Target name must be different from the source')).toBeVisible()
  await expect(dlg.getByRole('button', { name: 'Duplicate', exact: true })).toBeDisabled()
})