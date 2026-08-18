import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const state = {
  connections: [
    { id: 'm1', name: 'Mongo', type: 'mongodb', host: 'localhost', port: 27017, user: '', database: 'shop' },
    { id: 'o1', name: 'Oracle', type: 'oracle', host: 'localhost', port: 1521, user: 'hr', database: 'orcl' },
    { id: 'r1', name: 'Redis', type: 'redis', host: 'localhost', port: 6379, user: '', database: '0' },
  ],
  dbs: { m1: ['shop'], o1: ['orcl'], r1: [] },
  tables: { shop: ['products'], orcl: ['EMP'] },
  objects: { shop: [{ name: 'products', object_type: 'COLLECTION' }] },
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

test('sidebar badges show type display names', async ({ page }) => {
  await openApp(page)
  const badge = (name: string) => page.locator('aside .inline-flex.rounded-md.border', { hasText: name })
  await expect(badge('MongoDB')).toBeVisible()
  await expect(badge('Oracle')).toBeVisible()
  await expect(badge('Redis')).toBeVisible()
})

test('new database context action appears for oracle but not redis', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="Oracle"]').first().click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'New Database', exact: true })).toBeVisible()

  await page.keyboard.press('Escape')
  await page.locator('span[title="Redis"]').first().click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'New Database', exact: true })).toHaveCount(0)
})

test('mongo collections render under the Collections group', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="Mongo"]').first().click()
  await page.locator('span[title="shop"]').first().click()
  await expect(page.getByText('Collections', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('span[title="products"]')).toBeVisible()
})

test('oracle open in editor inserts FETCH FIRST preview sql', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="Oracle"]').first().click()
  await page.locator('.monaco-editor').first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('span[title="orcl"]').first().click()
  await page.locator('span[title="EMP"]').first().waitFor({ state: 'visible', timeout: 15_000 })
  await page.locator('span[title="EMP"]').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open in Editor', exact: true }).click()
  const txt = (await page.locator('.view-lines').first().innerText()).replace(/\u00A0/g, ' ')
  expect(txt).toContain('SELECT * FROM EMP FETCH FIRST 100 ROWS ONLY')
})

test('connection dialog lists all database types', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: /New Connection/ }).click()
  const dlg = page.locator('[role="dialog"]')
  await dlg.locator('[role="combobox"]').filter({ hasText: 'MySQL' }).first().click()
  await expect(page.getByRole('option', { name: 'PostgreSQL' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'SQLite' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'MongoDB' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Oracle' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Redis' })).toBeVisible()
})
