import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
  ],
  dbs: { c1: ['test'] },
  tables: { test: ['users', 'orders'] },
  queries: {},
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

async function pickOption(dlg: any, page: any, placeholder: string, optionText: string) {
  await dlg.getByRole('combobox').filter({ hasText: placeholder }).first().click()
  await page.getByRole('option', { name: optionText }).click()
}

async function activateConn(page: import('@playwright/test').Page) {
  await openApp(page)
  await page.getByText('MySQL A').click()
}

test('backup selected tables to a file shows summary', async ({ page }) => {
  await activateConn(page)
  await page.getByRole('button', { name: 'Backup', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Backup Database')

  await pickOption(dlg, page, 'Select source', 'MySQL A (mysql)')
  await pickOption(dlg, page, 'Select source database', 'test')
  await dlg.getByRole('checkbox', { name: 'orders' }).check()
  await dlg.getByRole('textbox').fill('/tmp/backup_test.sql')

  await dlg.getByRole('button', { name: 'Start Backup' }).click()
  await expect(dlg.getByText('Backup complete')).toBeVisible({ timeout: 15_000 })
  await expect(dlg.getByText('Backed up 5 tables in 2.3s')).toBeVisible()
  await expect(dlg.getByText('/tmp/backup_test.sql')).toBeVisible()

  const args = await page.evaluate(() => (window as any).__backupArgs || null)
  expect(args).not.toBeNull()
  expect(args.sourceId).toBe('c1')
  expect(args.database).toBe('test')
  expect(args.tables).toEqual(['orders'])
  expect(args.outputPath).toBe('/tmp/backup_test.sql')

  await dlg.getByRole('button', { name: 'Close', exact: true }).first().click()
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)
})

test('backup start stays disabled until source, database, table and path are set', async ({ page }) => {
  await activateConn(page)
  await page.getByRole('button', { name: 'Backup', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  const start = dlg.getByRole('button', { name: 'Start Backup' })
  await expect(start).toBeDisabled()

  await pickOption(dlg, page, 'Select source', 'MySQL A (mysql)')
  await expect(start).toBeDisabled()
  await pickOption(dlg, page, 'Select source database', 'test')
  await dlg.getByRole('checkbox', { name: 'users' }).check()
  await expect(start).toBeDisabled()
  await dlg.getByRole('textbox').fill('/tmp/backup_test.sql')
  await expect(start).toBeEnabled()
})

test('restore from a sql file shows executed statement count', async ({ page }) => {
  await activateConn(page)
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Restore Database')

  await pickOption(dlg, page, 'Select target', 'MySQL A (mysql)')
  await pickOption(dlg, page, 'Select target database', 'test')
  await dlg.getByPlaceholder('/path/to/backup.sql').fill('/tmp/backup_test.sql')

  await dlg.getByRole('button', { name: 'Start Restore' }).click()
  await expect(dlg.getByText('Restore complete')).toBeVisible({ timeout: 15_000 })
  await expect(dlg.getByText(/Executed 42 statements/)).toBeVisible()

  const args = await page.evaluate(() => (window as any).__restoreArgs || null)
  expect(args).not.toBeNull()
  expect(args.targetId).toBe('c1')
  expect(args.database).toBe('test')
  expect(args.inputPath).toBe('/tmp/backup_test.sql')

  await dlg.getByRole('button', { name: 'Close', exact: true }).first().click()
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)
})

test('failed backup keeps the dialog open and re-enables start', async ({ page }) => {
  await activateConn(page)
  await page.getByRole('button', { name: 'Backup', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Backup Database')

  await pickOption(dlg, page, 'Select source', 'MySQL A (mysql)')
  await pickOption(dlg, page, 'Select source database', 'test')
  await dlg.getByRole('checkbox', { name: 'users' }).check()
  await dlg.getByRole('textbox').fill('/tmp/backup_test.sql')

  await page.evaluate(() => { (window as any).__backupError = 'disk full' })
  await dlg.getByRole('button', { name: 'Start Backup' }).click()
  await expect(dlg.getByText('Backup complete')).toHaveCount(0)
  await expect(page.locator('[role="dialog"]')).toHaveCount(1)
  await expect(dlg.getByRole('button', { name: 'Start Backup' })).toBeEnabled({ timeout: 15_000 })
})

test('restore with backend errors lists them in the result', async ({ page }) => {
  await activateConn(page)
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Restore Database')

  await pickOption(dlg, page, 'Select target', 'MySQL A (mysql)')
  await pickOption(dlg, page, 'Select target database', 'test')
  await dlg.getByPlaceholder('/path/to/backup.sql').fill('/tmp/backup_test.sql')

  await page.evaluate(() => { (window as any).__restoreErrors = ['line 1 failed', 'line 2 failed'] })
  await dlg.getByRole('button', { name: 'Start Restore' }).click()
  await expect(dlg.getByText('Restore complete')).toBeVisible({ timeout: 15_000 })
  await expect(dlg.getByText(/Executed 5 statements/)).toBeVisible()
  await expect(dlg.getByText('Errors (2):')).toBeVisible()
  await expect(dlg.getByText('line 1 failed')).toBeVisible()
  await expect(dlg.getByText('line 2 failed')).toBeVisible()
})

test('backup result shows live migration logs', async ({ page }) => {
  await activateConn(page)
  await page.getByRole('button', { name: 'Backup', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Backup Database')

  await pickOption(dlg, page, 'Select source', 'MySQL A (mysql)')
  await pickOption(dlg, page, 'Select source database', 'test')
  await dlg.getByRole('checkbox', { name: 'users' }).check()
  await dlg.getByRole('textbox').fill('/tmp/backup_test.sql')

  await dlg.getByRole('button', { name: 'Start Backup' }).click()
  await expect(dlg.getByText('Backup complete')).toBeVisible({ timeout: 15_000 })
  await expect(dlg.getByText('Backup Log (2)')).toBeVisible()
  await expect(dlg.getByText('Backing up table: users')).toBeVisible()
  await expect(dlg.getByText('Table users: 100 rows dumped')).toBeVisible()
})

test('restore result shows live migration logs', async ({ page }) => {
  await activateConn(page)
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Restore Database')

  await pickOption(dlg, page, 'Select target', 'MySQL A (mysql)')
  await pickOption(dlg, page, 'Select target database', 'test')
  await dlg.getByPlaceholder('/path/to/backup.sql').fill('/tmp/backup_test.sql')

  await dlg.getByRole('button', { name: 'Start Restore' }).click()
  await expect(dlg.getByText('Restore complete')).toBeVisible({ timeout: 15_000 })
  await expect(dlg.getByText(/Executed 42 statements/)).toBeVisible()
  await expect(dlg.getByText('Restore Log (2)')).toBeVisible()
  await expect(dlg.getByText('Restoring table: users')).toBeVisible()
  await expect(dlg.getByText('Table users: 100 rows loaded')).toBeVisible()
})