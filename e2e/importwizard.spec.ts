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

async function openImport(page: any) {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').first().click()
  await page.locator('span[title="test"]').first().click()
  await expect(page.locator('span[title="users"]')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Import Data')
  return dlg
}

async function pickOption(page: any, placeholder: string) {
  await page.locator('[role="combobox"]').filter({ hasText: placeholder }).first().click()
  await page.getByRole('option', { name: 'users' }).click()
}

test('import csv select table, upload file and report success', async ({ page }) => {
  const dlg = await openImport(page)
  await pickOption(page, 'Select table')
  await dlg.locator('input[type="file"]').setInputFiles({
    name: 'data.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('id,name\n1,Alice\n2,Bob\n'),
  })

  await expect(dlg).toContainText('Successfully imported 2 rows into users')
  const inserts = await page.evaluate(() => (window as any).__importInserts || [])
  expect(inserts).toContain("INSERT INTO `users` (`id`, `name`) VALUES ('1', 'Alice')")
})

test('import json maps object keys to columns', async ({ page }) => {
  const dlg = await openImport(page)
  await pickOption(page, 'Select table')
  await dlg.locator('input[type="file"]').setInputFiles({
    name: 'data.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }])),
  })

  await expect(dlg).toContainText('Successfully imported 2 rows into users')
  const inserts = await page.evaluate(() => (window as any).__importInserts || [])
  expect(inserts).toContain("INSERT INTO `users` (`id`, `name`) VALUES ('2', 'Bob')")
})

test('import button disabled until a table is chosen', async ({ page }) => {
  const dlg = await openImport(page)
  const choose = dlg.getByRole('button', { name: 'Choose CSV/JSON file', exact: true })
  await expect(choose).toBeDisabled()
  await pickOption(page, 'Select table')
  await expect(choose).toBeEnabled()
})

test('malformed file reports import failed', async ({ page }) => {
  const dlg = await openImport(page)
  await pickOption(page, 'Select table')
  await dlg.locator('input[type="file"]').setInputFiles({
    name: 'broken.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('id,name\n'),
  })

  await expect(dlg).toContainText('Import failed: Error: File must have a header row and at least one data row')
})