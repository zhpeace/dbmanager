import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
    { id: 'c2', name: 'MySQL B', type: 'mysql', host: '10.0.0.2', port: 3306, user: 'admin' },
  ],
  dbs: { c1: ['test', 'prod'], c2: ['alpha', 'beta'] },
  tables: { test: ['users', 'orders'], prod: ['inventory'], alpha: ['logs'] },
  queries: {
    'SELECT * FROM users': { columns: ['id', 'name', 'email'], rows: [{ id: 1, name: 'Alice', email: 'alice@x.com' }] },
    'SELECT * FROM orders': { columns: ['id', 'amount'], rows: [{ id: 2, amount: 100 }] },
  },
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

test('empty state shows welcome and no connections', async ({ page }) => {
  await installBackend(page, { ...state, connections: [] })
  await openApp(page)
  await expect(page.getByText('No connections yet')).toBeVisible()
  await expect(page.getByText('Welcome to DBManager')).toBeVisible()
})

test('sidebar lists saved connections with status', async ({ page }) => {
  await openApp(page)
  await expect(page.getByText('MySQL A')).toBeVisible()
  await expect(page.getByText('MySQL B')).toBeVisible()
  await expect(page.getByText('Connections')).toBeVisible()
})

test('selecting a connection loads its databases and connects', async ({ page }) => {
  await openApp(page)
  // App auto-connects saved connections on boot. Click MySQL A row.
  await page.locator('span[title="MySQL A"]').click()
  await expect(page.locator('span[title="test"]').first()).toBeVisible()
  await expect(page.locator('span[title="prod"]').first()).toBeVisible()
  // TopBar shows connection meta
  await expect(page.locator('header')).toContainText('root@localhost:3306')
})

test('expanding a database loads and shows its tables', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').click()
  await page.locator('span[title="test"]').click()
  await expect(page.getByText('Tables', { exact: true }).first()).toBeVisible()
  await expect(page.locator('span[title="users"]').first()).toBeVisible()
  await expect(page.locator('span[title="orders"]').first()).toBeVisible()
})

test('database selector is bound to current connection only', async ({ page }) => {
  await openApp(page)
  await page.getByText('MySQL A').click()
  const selector = page.locator('button[title="Select database"]')
  await expect(selector).toBeVisible()

  // Switch to MySQL B -> selector now shows no current database (unselected)
  await page.getByText('MySQL B').click()
  await expect(selector).toHaveText('Select database')

  // Switch back to MySQL A -> its remembered per-connection DB is still config default 'test'
  await page.getByText('MySQL A').click()
  await expect(selector).toHaveText('test')
})

test('per-tab database selection is isolated across tabs and remembered per connection', async ({ page }) => {
  await openApp(page)
  await page.getByText('MySQL A').click()
  const selector = page.locator('button[title="Select database"]')

  // tab 1 (default tab) -> pick prod
  await selector.click()
  await page.getByRole('option', { name: 'prod' }).click()
  await expect(selector).toHaveText('prod')
  await expect(page.locator('header')).toContainText('/prod')

  // open new tab
  await page.getByTitle('New Query Tab').click()
  await expect(page.locator('header')).toContainText('/test')

  // back to tab 1 -> prod remembered
  await page.getByText('Query 1').click()
  await expect(selector).toHaveText('prod')

  // switch to MySQL B and back -> tab1 prod still remembered
  await page.getByText('MySQL B').click()
  await page.getByText('MySQL A').click()
  await expect(selector).toHaveText('prod')
})

test('running SQL shows results in the results panel', async ({ page }) => {
  await openApp(page)
  await page.getByText('MySQL A').click()
  // Type into Monaco via keyboard
  // Wait until Monaco is fully mounted before typing. Use the editor's
// accessible input (aria-label "Editor content") and click the editor surface.
  await page.locator('.monaco-editor').first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.monaco-editor .view-lines').first().click({ position: { x: 60, y: 20 } })
  await page.waitForTimeout(300)
  const ta = page.getByRole('textbox', { name: 'Editor content' })
  await ta.focus()
  await page.keyboard.insertText('SELECT * FROM users')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('Run a query to see results')).toBeHidden({ timeout: 15000 })
  // result panel shows the columns and row
  await expect(page.getByText('id').first()).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('Alice').first()).toBeVisible()
})

test('new tab button opens a second query tab', async ({ page }) => {
  await openApp(page)
  await page.getByText('MySQL A').click()
  await page.getByTitle('New Query Tab').click()
  await expect(page.getByText('Query 2')).toBeVisible()
  await expect(page.locator('.monaco-editor')).toHaveCount(1)
})
