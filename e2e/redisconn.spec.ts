import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const state = {
  connections: [
    { id: 'r1', name: 'Redis', type: 'redis', host: 'localhost', port: 6379, user: '', database: '0' },
    { id: 'o1', name: 'Oracle', type: 'oracle', host: 'localhost', port: 1521, user: 'hr', database: 'orcl' },
    { id: 'm1', name: 'MySQL', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'shop' },
  ],
  dbs: { r1: ['0'], o1: ['orcl'], m1: ['shop'] },
  tables: { orcl: ['EMP'], shop: ['abc_newtable_4'] },
  redisKeys: { '0': [
    { name: 'session:user:1', object_type: 'string' },
  ]},
  tableData: {
    EMP: {
      columns: [{ name: 'EMPNO', data_type: 'number', nullable: false, key: 'PRI', default_value: null, extra: '' }],
      rows: [{ EMPNO: 7369 }],
      total: 1,
    },
    abc_newtable_4: {
      columns: [{ name: 'id', data_type: 'int', nullable: false, key: 'PRI', default_value: null, extra: '' }],
      rows: [{ id: 42 }],
      total: 1,
    },
  },
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

test('redis browse tab stays bound to its redis connection across connection switches', async ({ page }) => {
  await openApp(page)

  // Open Redis db 0 and a string key -> Redis value panel appears.
  await page.locator('span[title="Redis"]').first().click()
  await page.locator('span[title="0"]').first().click()
  await page.locator('span[title="session:user:1"]').first().waitFor({ state: 'visible', timeout: 15_000 })
  await page.locator('span[title="session:user:1"]').first().dblclick()
  await expect(page.locator('button:has-text("Refresh")').first()).toBeVisible({ timeout: 15_000 })

  // Switch to Oracle and open EMP -> oracle table browser renders EMPNO.
  await page.locator('span[title="Oracle"]').first().click()
  await page.locator('span[title="orcl"]').first().click()
  await page.locator('span[title="EMP"]').first().waitFor({ state: 'visible', timeout: 15_000 })
  await page.locator('span[title="EMP"]').first().dblclick()
  await expect(page.locator('text=EMPNO').first()).toBeVisible({ timeout: 15_000 })

  // Switch back to Redis by clicking the Redis browse TAB in the tab bar while
  // Oracle is still the active connection. The tab must switch the connection
  // back to Redis and re-render the Redis value panel.
  await page.locator('div[title="session:user:1"]').click()
  await expect(page.locator('button:has-text("Refresh")').first()).toBeVisible({ timeout: 15_000 })
  // The redis key value must render through the redis connection: no OCI/Oracle error.
  await expect(page.locator('text=OCI Error').first()).toHaveCount(0)
  await expect(page.getByText('hello', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
})

test('double-clicking a mysql table while redis is active switches connection and renders its rows', async ({ page }) => {
  await openApp(page)

  // Activate Redis and open a key view.
  await page.locator('span[title="Redis"]').first().click()
  await page.locator('span[title="0"]').first().click()
  await page.locator('span[title="session:user:1"]').first().waitFor({ state: 'visible', timeout: 15_000 })
  await page.locator('span[title="session:user:1"]').first().dblclick()
  await expect(page.locator('button:has-text("Refresh")').first()).toBeVisible({ timeout: 15_000 })

  // Expand MySQL and double-click its table without first activating the connection.
  await page.locator('span[title="MySQL"]').first().click()
  await page.locator('span[title="shop"]').first().click()
  await page.locator('span[title="abc_newtable_4"]').first().waitFor({ state: 'visible', timeout: 15_000 })
  await page.locator('span[title="abc_newtable_4"]').first().dblclick()

  // Must render the table data directly, not a SELECT preview in the SQL editor.
  await expect(page.getByText('abc_newtable_4').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('main table').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('42', { exact: true }).first()).toBeVisible({ timeout: 15_000 })

  // Clicking the Redis CONNECTION (not a table) must restore the Redis browse
  // tab, never the MySQL SELECT preview.
  await page.locator('span[title="Redis"]').first().click()
  await page.waitForTimeout(500)
  await expect(page.locator('button:has-text("Refresh")').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('main').getByText(/SELECT \* FROM/)).toHaveCount(0)

  // Clicking the MySQL CONNECTION again restores the MySQL table browse.
  await page.locator('span[title="MySQL"]').first().click()
  await page.waitForTimeout(500)
  await expect(page.getByText('42', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
})

test('clicking a connection with no browse tab shows a clean SQL editor, not another connection key preview', async ({ page }) => {
  await openApp(page)

  // Open a Redis key browse tab.
  await page.locator('span[title="Redis"]').first().click()
  await page.locator('span[title="0"]').first().click()
  await page.locator('span[title="session:user:1"]').first().waitFor({ state: 'visible', timeout: 15_000 })
  await page.locator('span[title="session:user:1"]').first().dblclick()
  await expect(page.locator('button:has-text("Refresh")').first()).toBeVisible({ timeout: 15_000 })

  // Click the MySQL CONNECTION directly - no MySQL browse tab exists yet.
  await page.locator('span[title="MySQL"]').first().click()
  await page.waitForTimeout(500)

  // Must NOT show the Redis key SELECT preview or any stale table SQL.
  await expect(page.locator('main').getByText(/SELECT \* FROM/)).toHaveCount(0)
  await expect(page.locator('main').getByText('satoken')).toHaveCount(0)
  await expect(page.getByText('Run a query to see results').first()).toBeVisible({ timeout: 15_000 })
})

test('after redis and mysql both have browse tabs, clicking the mysql connection restores its table', async ({ page }) => {
  await openApp(page)

  // Open a MySQL table first.
  await page.locator('span[title="MySQL"]').first().click()
  await page.locator('span[title="shop"]').first().click()
  await page.locator('span[title="abc_newtable_4"]').first().waitFor({ state: 'visible', timeout: 15_000 })
  await page.locator('span[title="abc_newtable_4"]').first().dblclick()
  await expect(page.getByText('42', { exact: true }).first()).toBeVisible({ timeout: 15_000 })

  // Now open a Redis key, then click the MySQL CONNECTION.
  await page.locator('span[title="Redis"]').first().click()
  await page.locator('span[title="0"]').first().click()
  await page.locator('span[title="session:user:1"]').first().waitFor({ state: 'visible', timeout: 15_000 })
  await page.locator('span[title="session:user:1"]').first().dblclick()
  await expect(page.locator('button:has-text("Refresh")').first()).toBeVisible({ timeout: 15_000 })

  await page.locator('span[title="MySQL"]').first().click()
  await page.waitForTimeout(500)
  await expect(page.getByText('42', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('main').getByText(/SELECT \* FROM/)).toHaveCount(0)
})
