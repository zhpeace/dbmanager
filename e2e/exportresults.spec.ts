import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
  ],
  dbs: { c1: ['test'] },
  tables: { test: ['users'] },
  queries: {
    'SELECT * FROM users': {
      columns: ['id', 'name'],
      rows: [{ id: 1, name: 'Alice' }],
    },
  },
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

async function runQuery(page: any) {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').first().click()
  await page.locator('.monaco-editor').first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.monaco-editor .view-lines').first().click({ position: { x: 60, y: 20 } })
  await page.waitForTimeout(300)
  const ta = page.getByRole('textbox', { name: 'Editor content' })
  await ta.focus()
  await page.keyboard.insertText('SELECT * FROM users')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('Alice').first()).toBeVisible({ timeout: 15_000 })
}

async function writtenFiles(page: any) {
  return page.evaluate(() => (window as any).__writtenFiles || [])
}

test('export csv writes csv text through the backend', async ({ page }) => {
  await runQuery(page)
  await page.getByRole('button', { name: 'CSV', exact: true }).click()
  await expect.poll(async () => (await writtenFiles(page)).length).toBeGreaterThan(0)
  const files = await writtenFiles(page)
  expect(files[0].path).toBe('/tmp/stub-export.csv')
  expect(files[0].content).toBe('id,name\n1,Alice')
})

test('export json writes pretty-printed rows', async ({ page }) => {
  await runQuery(page)
  await page.getByRole('button', { name: 'JSON', exact: true }).click()
  await expect.poll(async () => (await writtenFiles(page)).length).toBeGreaterThan(0)
  const files = await writtenFiles(page)
  expect(files[0].content).toContain('"name": "Alice"')
  expect(files[0].content).toContain('"id": 1')
})

test('export excel writes a binary xlsx payload', async ({ page }) => {
  await runQuery(page)
  await page.getByRole('button', { name: 'Excel', exact: true }).click()
  await expect.poll(async () => (await writtenFiles(page)).length).toBeGreaterThan(0)
  const files = await writtenFiles(page)
  expect(files[0].path).toBe('/tmp/stub-export.csv')
  expect(Array.isArray(files[0].data)).toBe(true)
  expect(files[0].data.length).toBeGreaterThan(0)
})
