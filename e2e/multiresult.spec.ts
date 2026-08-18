import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
  ],
  dbs: { c1: ['test'] },
  tables: { test: ['users', 'orders'] },
  queries: {
    'SELECT * FROM users': { columns: ['id', 'name'], rows: [{ id: 1, name: 'Alice' }] },
    'SELECT * FROM orders': { columns: ['id', 'note'], rows: [{ id: 9, note: 'order-9' }] },
  },
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

async function typeSql(page: any, sql: string) {
  await page.locator('span[title="MySQL A"]').first().click()
  await page.locator('.monaco-editor').first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.monaco-editor .view-lines').first().click({ position: { x: 60, y: 20 } })
  await page.waitForTimeout(300)
  const ta = page.getByRole('textbox', { name: 'Editor content' })
  await ta.focus()
  await page.keyboard.insertText(sql)
}

test('run all produces multiple result tabs and switching shows each dataset', async ({ page }) => {
  await openApp(page)
  await typeSql(page, 'SELECT * FROM users; SELECT * FROM orders')
  await page.getByRole('button', { name: 'Run All', exact: true }).click()

  await expect(page.getByText('Alice').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Result 1').first()).toBeVisible()
  await expect(page.getByText('Result 2').first()).toBeVisible()

  await page.getByText('Result 2').first().click()
  await expect(page.getByText('order-9').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Alice').first()).toHaveCount(0)

  await page.getByText('Result 1').first().click()
  await expect(page.getByText('Alice').first()).toBeVisible()
})

test('error result tab shows a warning badge and stays switchable', async ({ page }) => {
  await installBackend(page, {
    ...state,
    fail: { failQueries: ['SELECT * FROM orders'] },
  })
  await openApp(page)
  await typeSql(page, 'SELECT * FROM users; SELECT * FROM orders')
  await page.getByRole('button', { name: 'Run All', exact: true }).click()

  await expect(page.getByText('Alice').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Result 2').first()).toBeVisible()

  await page.getByText('Result 2').first().click()
  await expect(page.getByText('SQL error 1064: syntax near').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Alice').first()).toHaveCount(0)
})
