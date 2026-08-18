import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
  ],
  dbs: { c1: ['test'] },
  tables: { test: ['users', 'orders'] },
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

async function pickOption(dlg: any, page: any, placeholder: string, optionText: string) {
  await dlg.getByRole('combobox').filter({ hasText: placeholder }).first().click()
  await page.getByRole('option', { name: optionText }).click()
}

async function openScheduler(page: import('@playwright/test').Page) {
  await openApp(page)
  await page.getByText('MySQL A').click()
  await page.getByRole('button', { name: 'Schedule', exact: true }).click()
  await expect(page.locator('[role="dialog"]')).toContainText('Scheduled Tasks')
  return page.locator('[role="dialog"]')
}

async function createBackupTask(dlg: any, page: any) {
  await dlg.getByRole('button', { name: 'Create Scheduled Task' }).click()
  await dlg.getByPlaceholder('Nightly backup').fill('Nightly backup')
  await pickOption(dlg, page, 'Select source', 'MySQL A (mysql)')
  await pickOption(dlg, page, 'Select database', 'test')
  await dlg.getByRole('checkbox', { name: 'users' }).check()
  await dlg.getByRole('textbox').nth(2).fill('/tmp/backup.sql')
  await dlg.getByRole('button', { name: 'Add Task' }).click()
}

test('create a backup scheduled task and list it', async ({ page }) => {
  const dlg = await openScheduler(page)
  await expect(dlg.getByText('No scheduled tasks yet')).toBeVisible()
  await createBackupTask(dlg, page)

  await expect(dlg.getByText('Nightly backup').first()).toBeVisible({ timeout: 10_000 })
  await expect(dlg.getByText('0 0 2 * * *').first()).toBeVisible()
  await expect(dlg.getByText('Backup', { exact: true }).first()).toBeVisible()

  const args = await page.evaluate(() => (window as any).__scheduledArgs || null)
  expect(args).not.toBeNull()
  expect(args.name).toBe('Nightly backup')
  expect(args.cronExpr).toBe('0 0 2 * * *')
  expect(args.config).toMatchObject({
    type: 'Backup',
    source_id: 'c1',
    database: 'test',
    tables: ['users'],
    output_path: '/tmp/backup.sql',
  })
})

test('toggle enabled switch calls toggle and reflects state', async ({ page }) => {
  const dlg = await openScheduler(page)
  await createBackupTask(dlg, page)
  const row = dlg.locator('tr').filter({ hasText: 'Nightly backup' })
  const toggle = row.getByRole('switch')
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).not.toBeChecked({ timeout: 10_000 })
})

test('edit task prefills the form and saves changes', async ({ page }) => {
  const dlg = await openScheduler(page)
  await createBackupTask(dlg, page)
  const row = dlg.locator('tr').filter({ hasText: 'Nightly backup' })
  await row.locator('button:not([role="switch"])').first().click()
  await expect(dlg.getByPlaceholder('Nightly backup')).toHaveValue('Nightly backup')
  await dlg.getByPlaceholder('Nightly backup').fill('Weekly backup')
  await dlg.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dlg.getByText('Weekly backup').first()).toBeVisible({ timeout: 10_000 })
  const args = await page.evaluate(() => (window as any).__scheduledArgs || null)
  expect(args.name).toBe('Weekly backup')
})

test('delete task removes it from the list', async ({ page }) => {
  const dlg = await openScheduler(page)
  await createBackupTask(dlg, page)
  await expect(dlg.getByText('Nightly backup').first()).toBeVisible()
  const row = dlg.locator('tr').filter({ hasText: 'Nightly backup' })
  await row.locator('button:not([role="switch"])').nth(1).click()
  await expect(dlg.getByText('No scheduled tasks yet')).toBeVisible({ timeout: 10_000 })
})