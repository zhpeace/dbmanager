import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
  ],
  dbs: { c1: ['test', 'prod'] },
  tables: { test: ['users', 'orders'] },
  queries: {
    'SELECT * FROM users': { columns: ['id', 'name', 'email'], rows: [{ id: 1, name: 'Alice', email: 'alice@x.com' }] },
  },
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

test('main toolbar opens each operation dialog', async ({ page }) => {
  await openApp(page)
  await page.getByText('MySQL A').click()

  const cases = [
    ['Import', 'Import Data'],
    ['Transfer', 'Data Transfer'],
    ['Compare', 'Compare Schemas'],
    ['Backup', 'Backup Database'],
    ['Restore', 'Restore Database'],
    ['Schedule', 'Scheduled Tasks'],
    ['Find in Tables', 'Find in Tables'],
  ]
  for (const [buttonText, dialogTitle] of cases) {
    await page.getByRole('button', { name: buttonText, exact: true }).click()
    const dlg = page.locator('[role="dialog"]')
    await expect(dlg).toBeVisible({ timeout: 8000 })
    await expect(dlg).toContainText(dialogTitle)
    await dlg.getByRole('button', { name: 'Close' }).last().click()
    await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 8000 })
  }
})

test('new connection dialog opens and cancels', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: /New Connection/ }).click()
  await expect(page.locator('[role="dialog"]')).toContainText('New Connection')
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Close' }).last().click()
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)
})

test('i18n toggle switches language to Chinese and back', async ({ page }) => {
  await openApp(page)
  await page.getByText('MySQL A').click()
  // default English -> toggle shows 中文
  await expect(page.getByText('Connections')).toBeVisible()

  // Toggle to zh (button label reads 中文)
  await page.getByRole('button', { name: '中文', exact: true }).click()
  await expect(page.getByText('连接', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '新建连接' })).toBeVisible()

  // Toggle back (zh toggle label reads EN)
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await expect(page.getByText('Connections')).toBeVisible()
})

test('theme toggle switches dark class on root', async ({ page }) => {
  await openApp(page)
  const html = page.locator('html')
  // default is dark
  await expect(html).toHaveClass(/dark/)

  const themeBtn = page.locator('header button').filter({ has: page.locator('svg') }).filter({ hasNotText: /中文|EN|New Connection|新建连接/ }).first()
  await themeBtn.click()
  await expect(html).not.toHaveClass(/dark/)

  await themeBtn.click()
  await expect(html).toHaveClass(/dark/)
})