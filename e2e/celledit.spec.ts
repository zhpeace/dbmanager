import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const LONG = 'BEGIN:' + 'x'.repeat(300)

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
  ],
  dbs: { c1: ['test'] },
  tables: { test: ['users'] },
  tableData: {
    users: {
      columns: [
        { name: 'id', data_type: 'int', nullable: false, key: 'PRI', default_value: null, extra: '' },
        { name: 'name', data_type: 'varchar', nullable: true, key: '', default_value: null, extra: '' },
        { name: 'bio', data_type: 'text', nullable: true, key: '', default_value: null, extra: '' },
        { name: 'data', data_type: 'BLOB', nullable: true, key: '', default_value: null, extra: '' },
      ],
      rows: [
        { id: 1, name: 'Alice', bio: LONG, data: '0x6869' },
      ],
      total: 1,
    },
  },
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

async function openTable(page: import('@playwright/test').Page) {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').click()
  await page.locator('span[title="test"]').click()
  await page.locator('span[title="users"]').first().waitFor({ state: 'visible' })
  await page.locator('span[title="users"]').first().dblclick()
  await expect(page.getByText('Alice').first()).toBeVisible({ timeout: 15_000 })
}

test('inline edit commits on Enter and saves an UPDATE', async ({ page }) => {
  await openTable(page)
  await page.getByText('Alice').first().dblclick()
  const input = page.locator('input.border-primary')
  await expect(input).toBeVisible()
  await expect(input).toHaveValue('Alice')
  await input.fill('Alicia')
  await input.press('Enter')
  await expect(page.getByText('Alicia').first()).toBeVisible()
  await expect(page.getByText('1 row(s) pending').first()).toBeVisible()

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/pending/)).toHaveCount(0, { timeout: 10_000 })
  const batch = await page.evaluate(() => (window as any).__batchQueries || [])
  expect(batch.some((q: string) =>
    q === 'UPDATE `users` SET `name` = \'Alicia\' WHERE `id` = 1')).toBe(true)
})

test('large value opens value editor dialog and saves', async ({ page }) => {
  await openTable(page)
  // the long bio cell opens the ValueEditorDialog on double click
  await page.getByText(/^BEGIN:/).first().dblclick()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Edit bio — users')
  const textarea = dlg.locator('textarea')
  await expect(textarea).toHaveValue(LONG)
  await textarea.fill(LONG + 'END')
  await dlg.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/pending/)).toHaveCount(0, { timeout: 10_000 })
  const batch = await page.evaluate(() => (window as any).__batchQueries || [])
  expect(batch.some((q: string) =>
    /UPDATE `users` SET `bio` = 'BEGIN:.*END' WHERE `id` = 1/.test(q))).toBe(true)
})

test('binary column opens hex editor and saves literal', async ({ page }) => {
  await openTable(page)
  await page.getByText('0x6869', { exact: true }).first().dblclick()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Binary — data (users)')
  const textarea = dlg.locator('textarea')
  await expect(textarea).toHaveValue('6869')
  await textarea.fill('4845')
  await dlg.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(/pending/)).toHaveCount(0, { timeout: 10_000 })
  const batch = await page.evaluate(() => (window as any).__batchQueries || [])
  expect(batch.some((q: string) =>
    q === 'UPDATE `users` SET `data` = X\'4845\' WHERE `id` = 1')).toBe(true)
})