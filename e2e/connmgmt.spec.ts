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

test('edit connection prefills the form and saves changes', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Edit Connection' }).click()

  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Edit Connection')
  const nameInput = dlg.locator('input').first()
  await expect(nameInput).toHaveValue('MySQL A')
  await nameInput.fill('MySQL B')
  await dlg.getByRole('button', { name: 'Save Changes' }).click()
  await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 10_000 })

  await expect(page.locator('span[title="MySQL B"]').first()).toBeVisible()
  await expect(page.locator('span[title="MySQL A"]')).toHaveCount(0)
})

test('duplicate connection adds a disconnected copy', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Duplicate Connection' }).click()

  await expect(page.locator('span[title="MySQL A (Copy)"]').first()).toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dbmanager-connections') || '[]'))
  expect(saved.map((c: any) => c.config.name)).toContain('MySQL A (Copy)')
  const copy = saved.find((c: any) => c.config.name === 'MySQL A (Copy)')
  expect(copy.connected).toBe(false)
})

test('delete connection removes it from sidebar and storage', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete Connection' }).click()

  await expect(page.locator('span[title="MySQL A"]')).toHaveCount(0)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dbmanager-connections') || '[]'))
  expect(saved.length).toBe(0)
})

test('disconnect then reconnect toggles context menu action', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').first().click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Disconnect', exact: true })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Disconnect', exact: true }).click()

  await page.locator('span[title="MySQL A"]').first().click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Connect', exact: true })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Connect', exact: true }).click()

  await page.locator('span[title="MySQL A"]').first().click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Disconnect', exact: true })).toBeVisible()
})