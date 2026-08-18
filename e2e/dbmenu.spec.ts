import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
  ],
  dbs: { c1: ['test'] },
  tables: { test: ['users'] },
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

async function openDbMenu(page: any) {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').first().click()
  await page.locator('span[title="test"]').first().waitFor({ state: 'visible' })
  await page.locator('span[title="test"]').first().click({ button: 'right' })
}

test('open in editor inserts USE statement', async ({ page }) => {
  await openDbMenu(page)
  await page.getByRole('menuitem', { name: 'Open in Editor', exact: true }).click()
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 })
  await expect
    .poll(async () => (await page.locator('.view-line').first().innerText()).replace(/\u00A0/g, ' '))
    .toContain('USE `test`;')
})

test('drop database confirms then calls drop_database', async ({ page }) => {
  await openDbMenu(page)
  await page.getByRole('menuitem', { name: 'Drop Database', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Are you sure you want to drop database "test"? This cannot be undone.')
  await dlg.getByRole('button', { name: 'Drop Database', exact: true }).click()

  await expect
    .poll(async () => (page as any).evaluate(() => (window as any).__ddlCalls || []))
    .toContainEqual(expect.objectContaining({ cmd: 'drop_database', args: { id: 'c1', dbName: 'test' } }))
})

test('cancelling the drop dialog does not call drop_database', async ({ page }) => {
  await openDbMenu(page)
  await page.getByRole('menuitem', { name: 'Drop Database', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Are you sure you want to drop database "test"?')
  await dlg.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dlg).toHaveCount(0)
  const calls = await page.evaluate(() => (window as any).__ddlCalls || [])
  expect(calls.filter((c: any) => c.cmd === 'drop_database')).toHaveLength(0)
})

test('duplicate database from db menu opens the dialog and transfers', async ({ page }) => {
  await openDbMenu(page)
  await page.getByRole('menuitem', { name: 'Duplicate Database', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Duplicate Database')
  await expect(dlg.locator('input')).toHaveValue('test_copy')
  await dlg.getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(dlg).toContainText('Done! 1 tables, 100 rows transferred in 1.2s')
  const opts = await page.evaluate(() => (window as any).__lastTransferOpts)
  expect(opts.sourceDb).toBe('test')
  expect(opts.targetDb).toBe('test_copy')
})
