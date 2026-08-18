import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const baseState = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
  ],
  dbs: { c1: ['test', 'prod'] },
  tables: { test: ['users'] },
  queries: {},
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, baseState)
})

test('new connection dialog saves a connection and shows it in sidebar', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: /New Connection/ }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('New Connection')

  // fill name, host, port, user, password, database
  await dlg.getByPlaceholder('My Database').fill('PG Server')
  await dlg.getByPlaceholder('localhost').fill('localhost')
  await dlg.getByPlaceholder('3306').fill('5432')
  await dlg.getByPlaceholder('root').fill('postgres')
  await dlg.getByPlaceholder('••••••••').fill('secret')
  await dlg.getByPlaceholder(/Leave empty/).fill('postgres')

  await dlg.getByRole('button', { name: 'Connect' }).last().click()
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)

  // sidebar now shows the new connection
  await expect(page.locator('span[title="PG Server"]')).toBeVisible()
})

test('editing an existing connection via context menu prefills fields', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').click({ button: 'right' })
  await page.getByText('Edit Connection').click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Edit Connection')
  await expect(dlg.getByPlaceholder('My Database')).toHaveValue('MySQL A')
  await expect(dlg.getByPlaceholder('localhost')).toHaveValue('localhost')
})

test('delete connection removes it from the sidebar', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').click({ button: 'right' })
  await page.getByText('Delete Connection').click()
  await expect(page.locator('span[title="MySQL A"]')).toHaveCount(0)
  await expect(page.getByText('No connections yet')).toBeVisible()
})

test('duplicate connection adds a copy', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').click({ button: 'right' })
  await page.getByText('Duplicate Connection').click()
  await expect(page.locator('span[title="MySQL A (Copy)"]')).toBeVisible()
})

test('disconnect clears databases from sidebar', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').click()
  await expect(page.locator('span[title="test"]').first()).toBeVisible()
  await page.locator('span[title="MySQL A"]').click({ button: 'right' })
  await page.getByText('Disconnect').click()
  await expect(page.locator('span[title="test"]')).toHaveCount(0)
})