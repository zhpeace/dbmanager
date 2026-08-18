import { test, expect, Page, Locator } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
    { id: 'c2', name: 'PG Server', type: 'postgresql', host: 'localhost', port: 5432, user: 'postgres', database: 'pgdb' },
  ],
  dbs: { c1: ['test', 'prod'], c2: ['pgdb'] },
  tables: { test: ['users', 'orders'], prod: [], pgdb: [] },
  queries: {},
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

async function pickOption(dlg: Locator, page: Page, placeholder: string, optionText: string) {
  await dlg.getByRole('combobox').filter({ hasText: placeholder }).first().click()
  await page.getByRole('option', { name: optionText }).click()
}

test('import csv uploads rows and shows success', async ({ page }) => {
  await openApp(page)
  await page.getByText('MySQL A').click()
  // select database so currentTables gets populated for the Import dialog
  await page.locator('span[title="test"]').click()
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Import Data')

  await pickOption(dlg, page, 'Select table', 'users')

  await dlg.locator('input[type="file"]').first().setInputFiles({
    name: 'rows.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('id,name,email\n1,Alice,alice@x.com\n2,Bob,bob@x.com\n'),
  })
  await expect(dlg).toContainText(/Successfully imported 2 rows into users/, { timeout: 10_000 })
})

test('backup runs against selected tables and reports success', async ({ page }) => {
  await openApp(page)
  await page.getByText('MySQL A').click()
  await page.getByRole('button', { name: 'Backup', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Backup Database')

  await pickOption(dlg, page, 'Select source', 'MySQL A (mysql)')
  await pickOption(dlg, page, 'Select source database', 'test')
  await dlg.getByRole('checkbox', { name: 'users' }).check()
  await dlg.getByRole('textbox').first().fill('/tmp/backup_test.sql')
  await dlg.getByRole('button', { name: 'Start Backup' }).click()
  await expect(dlg).toContainText('Backup complete', { timeout: 10_000 })
  await expect(dlg).toContainText('Backed up 5 tables in 2.3s')
})

test('restore executes statements from sql file', async ({ page }) => {
  await openApp(page)
  await page.getByText('MySQL A').click()
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Restore Database')

  await pickOption(dlg, page, 'Select target', 'MySQL A (mysql)')
  await pickOption(dlg, page, 'Select target database', 'test')
  await dlg.getByRole('textbox').first().fill('/tmp/backup_test.sql')
  await dlg.getByRole('button', { name: 'Start Restore' }).click()
  await expect(dlg).toContainText('Restore complete', { timeout: 10_000 })
})

test('transfer moves tables between connections', async ({ page }) => {
  await openApp(page)
  await page.getByText('MySQL A').click()
  await page.getByRole('button', { name: 'Transfer', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Data Transfer')

  // source connection + db
  await pickOption(dlg, page, 'Select source', 'MySQL A (mysql)')
  await pickOption(dlg, page, 'Select source database', 'test')
  // select users table
  await dlg.getByRole('checkbox', { name: 'users' }).check()

  // target connection + db
  await pickOption(dlg, page, 'Select target', 'PG Server (postgresql)')
  await pickOption(dlg, page, 'Select target db', 'pgdb')

  await dlg.getByRole('button', { name: 'Start Transfer' }).click()
  await expect(dlg).toContainText(/Transferred 100 rows across 1 tables/, { timeout: 10_000 })
  const opts = await page.evaluate(() => (window as any).__lastTransferOpts || null)
  expect(opts).not.toBeNull()
  expect(opts.source_id).toBe('c1')
  expect(opts.target_id).toBe('c2')
  expect(opts.source_database).toBe('test')
  expect(opts.target_database).toBe('pgdb')
  expect(opts.tables).toEqual(['users'])
  expect(opts.conflict_strategy).toBe('error')
})