import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

test.beforeEach(async ({ page }) => {
  await installBackend(page, {
    connections: [
      { id: 'c1', name: 'PG', type: 'postgresql', host: 'localhost', port: 5432, user: 'root', database: 'test' },
      { id: 'c2', name: 'SQLite', type: 'sqlite', host: 'file', port: 0, user: '', database: 'test' },
      { id: 'c3', name: 'MySQL', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
    ],
    dbs: { c1: ['test'], c2: ['test'], c3: ['test'] },
    tables: { test: ['users'] },
    explainOverrides: {
      'EXPLAIN SELECT * FROM users': {
        columns: ['QUERY PLAN'],
        rows: [
          { 'QUERY PLAN': 'Seq Scan on users (cost=0.00..35.50 rows=2550 width=36)' },
          { 'QUERY PLAN': '  Filter: (age > 18)' },
          { 'QUERY PLAN': '    ->  Removable: age IS NOT NULL' },
        ],
      },
      'EXPLAIN QUERY PLAN SELECT * FROM users': {
        columns: ['id', 'parent', 'notused', 'detail'],
        rows: [
          { id: 1, parent: 0, notused: 0, detail: 'SEARCH users USING INDEX idx_email' },
          { id: 2, parent: 1, notused: 0, detail: 'SCAN users' },
          { id: 3, parent: 2, notused: 0, detail: 'LIST SUBQUERY 1' },
        ],
      },
      'EXPLAIN SELECT * FROM empty': { columns: ['id'], rows: [] },
    },
  })
})

async function typeSql(page: any, connTitle: string, sql: string) {
  await page.locator(`span[title="${connTitle}"]`).first().click()
  await page.locator('.monaco-editor').first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.monaco-editor .view-lines').first().click({ position: { x: 60, y: 20 } })
  await page.waitForTimeout(300)
  const ta = page.getByRole('textbox', { name: 'Editor content' })
  await ta.focus()
  await page.keyboard.insertText(sql)
}

test('postgres indented plan renders a nested tree and collapses', async ({ page }) => {
  await openApp(page)
  await typeSql(page, 'PG', 'SELECT * FROM users')
  await page.getByRole('button', { name: 'Explain', exact: true }).click()

  await expect(page.getByText('Seq Scan on users (cost=0.00..35.50 rows=2550 width=36)')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Filter: (age > 18)')).toBeVisible()
  await expect(page.getByText('Removable: age IS NOT NULL')).toBeVisible()

  const root = page.locator('ul', { hasText: 'Seq Scan on users' }).first()
  await root.locator('button').first().click()
  await expect(page.getByText('Filter: (age > 18)')).toHaveCount(0)
})

test('sqlite explain query plan renders id/parent/detail tree', async ({ page }) => {
  await openApp(page)
  await typeSql(page, 'SQLite', 'SELECT * FROM users')
  await page.getByRole('button', { name: 'Explain', exact: true }).click()

  await expect(page.getByText('SEARCH users USING INDEX idx_email')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('SCAN users')).toBeVisible()
  await expect(page.getByText('LIST SUBQUERY 1')).toBeVisible()
})

test('empty plan rows show the unavailable message', async ({ page }) => {
  await openApp(page)
  await typeSql(page, 'MySQL', 'SELECT * FROM empty')
  await page.getByRole('button', { name: 'Explain', exact: true }).click()

  await expect(page.getByText('Unable to visualize this execution plan')).toBeVisible({ timeout: 15_000 })
})
