import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const SQL = 'SELECT * FROM users'

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
  ],
  dbs: { c1: ['test'] },
  tables: { test: ['users'] },
  queries: {
    [SQL]: { columns: ['id', 'name'], rows: [{ id: 1, name: 'Alice' }] },
  },
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

async function typeSql(page: import('@playwright/test').Page) {
  await page.locator('.monaco-editor').first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.monaco-editor .view-lines').first().click({ position: { x: 60, y: 20 } })
  await page.waitForTimeout(300)
  await page.getByRole('textbox', { name: 'Editor content' }).focus()
  await page.keyboard.insertText(SQL)
}

async function openEditor(page: import('@playwright/test').Page) {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').click()
  await typeSql(page)
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('Alice').first()).toBeVisible({ timeout: 15_000 })
}

test('pinning a query moves it to the favorites section', async ({ page }) => {
  await openEditor(page)
  await page.getByTitle('Query History').click()
  await expect(page.getByText(SQL).first()).toBeVisible()
  await page.getByTitle('Pin to favorites').click()

  await expect(page.getByText('Favorites').first()).toBeVisible()
  await expect(page.getByText(SQL).first()).toBeVisible()
  const saved = await page.evaluate(() => localStorage.getItem('dbmanager-sqlfavorites'))
  expect(JSON.parse(saved || '[]')).toEqual([SQL])
})

test('favorite persists across a reload', async ({ page }) => {
  await openEditor(page)
  await page.getByTitle('Query History').click()
  await page.getByTitle('Pin to favorites').click()
  await expect(page.getByText('Favorites').first()).toBeVisible()

  await page.reload()
  await page.waitForSelector('header >> text=DBManager', { timeout: 15_000 })
  await page.locator('span[title="MySQL A"]').click()
  await page.locator('.monaco-editor').first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.getByTitle('Query History').click()
  await expect(page.getByText('Favorites').first()).toBeVisible()
  await expect(page.getByText(SQL).first()).toBeVisible()
})

test('unpinning a query removes it from favorites', async ({ page }) => {
  await openEditor(page)
  await page.getByTitle('Query History').click()
  await page.getByTitle('Pin to favorites').click()
  await expect(page.getByText('Favorites').first()).toBeVisible()

  await page.getByTitle('Remove from favorites').click()
  await expect(page.getByText('Favorites')).toHaveCount(0)
  const saved = await page.evaluate(() => localStorage.getItem('dbmanager-sqlfavorites'))
  expect(JSON.parse(saved || '[]')).toEqual([])
})