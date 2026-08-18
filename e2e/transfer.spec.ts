import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
    { id: 'c2', name: 'MySQL B', type: 'mysql', host: 'localhost', port: 3306, user: 'root' },
  ],
  dbs: { c1: ['test', 'prod'], c2: ['test2'] },
  tables: { test: ['users', 'orders'], test2: [] },
  queries: {},
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

async function pickOption(dlg: any, page: any, placeholder: string, optionText: string) {
  await dlg.getByRole('combobox').filter({ hasText: placeholder }).first().click()
  await page.getByRole('option', { name: optionText }).click()
}

async function openTransfer(page: import('@playwright/test').Page) {
  await openApp(page)
  await page.getByText('MySQL A').click()
  await page.getByRole('button', { name: 'Transfer', exact: true }).click()
  await expect(page.locator('[role="dialog"]')).toContainText('Data Transfer')
  return page.locator('[role="dialog"]')
}

async function configureSource(dlg: any, page: any) {
  await pickOption(dlg, page, 'Select source', 'MySQL A (mysql)')
  await pickOption(dlg, page, 'Select source database', 'test')
}

async function configureTarget(dlg: any, page: any) {
  await pickOption(dlg, page, 'Select target', 'MySQL B (mysql)')
  await pickOption(dlg, page, 'Select target db', 'test2')
}

test('start transfer is disabled until source, target and table are chosen', async ({ page }) => {
  const dlg = await openTransfer(page)
  const start = dlg.getByRole('button', { name: 'Start Transfer' })
  await expect(start).toBeDisabled()

  await configureSource(dlg, page)
  await expect(start).toBeDisabled()

  await dlg.getByRole('checkbox', { name: 'users' }).check()
  await expect(start).toBeDisabled()

  await configureTarget(dlg, page)
  await expect(start).toBeEnabled()
})

test('full transfer from source to target shows result summary', async ({ page }) => {
  const dlg = await openTransfer(page)
  await configureSource(dlg, page)
  await dlg.getByRole('checkbox', { name: 'users' }).check()
  await configureTarget(dlg, page)

  await dlg.getByRole('button', { name: 'Start Transfer' }).click()
  await expect(dlg.getByText('Transferred 100 rows across 1 tables in 1.2s')).toBeVisible({ timeout: 15_000 })
  await expect(dlg.getByText('users', { exact: true })).toBeVisible()

  const opts = await page.evaluate(() => (window as any).__lastTransferOpts || null)
  expect(opts).not.toBeNull()
  expect(opts.source_id).toBe('c1')
  expect(opts.source_database).toBe('test')
  expect(opts.target_id).toBe('c2')
  expect(opts.target_database).toBe('test2')
  expect(opts.tables).toEqual(['users'])
  expect(opts.mode).toBe('structure_and_data')
  expect(opts.conflict_strategy).toBe('error')
  expect(opts.error_mode).toBe('skip')

  await dlg.getByRole('button', { name: 'Close', exact: true }).first().click()
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)
})

test('options panel mode, conflict and column mappings flow into opts', async ({ page }) => {
  const dlg = await openTransfer(page)
  await configureSource(dlg, page)
  await dlg.getByRole('checkbox', { name: 'orders' }).check()
  await configureTarget(dlg, page)

  await dlg.getByText('Advanced Options').click()
  await dlg.getByRole('combobox').filter({ hasText: 'Structure + Data' }).click()
  await page.getByRole('option', { name: 'Data Only', exact: true }).click()
  await dlg.getByRole('combobox').filter({ hasText: 'Error on Conflict' }).click()
  await page.getByRole('option', { name: 'Ignore (INSERT IGNORE)', exact: true }).click()

  await dlg.getByRole('button', { name: 'Add', exact: true }).click()
  await dlg.getByPlaceholder('Source').fill('email')
  await dlg.getByPlaceholder('Target').fill('email_addr')

  await dlg.getByRole('button', { name: 'Start Transfer' }).click()
  await expect(dlg.getByText('Transferred 100 rows across 1 tables in 1.2s')).toBeVisible({ timeout: 15_000 })

  const opts = await page.evaluate(() => (window as any).__lastTransferOpts || null)
  expect(opts).not.toBeNull()
  expect(opts.tables).toEqual(['orders'])
  expect(opts.mode).toBe('data_only')
  expect(opts.conflict_strategy).toBe('ignore')
  expect(opts.column_mappings).toEqual([
    { source_column: 'email', target_column: 'email_addr', skip: false, default_value: null },
  ])
})

test('existing checkpoint shows resume banner and resumes with checkpoint_id', async ({ page }) => {
  const dlg = await openTransfer(page)
  await page.evaluate(() => {
    ;(window as any).__checkpoint = { completed_tables: ['users'], failed_tables: [], rows_transferred: 50 }
  })
  await configureSource(dlg, page)
  await dlg.getByRole('checkbox', { name: 'users' }).check()
  await configureTarget(dlg, page)

  await expect(dlg.getByText(/tables already completed/)).toBeVisible({ timeout: 15_000 })

  await dlg.getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(dlg.getByText('Transferred 100 rows across 1 tables in 1.2s')).toBeVisible({ timeout: 15_000 })

  const opts = await page.evaluate(() => (window as any).__lastTransferOpts || null)
  expect(opts).not.toBeNull()
  expect(opts.checkpoint_id).toBe('users')
  expect(opts.tables).toEqual(['users'])
  const cleared = await page.evaluate(() => (window as any).__clearedCheckpoint || null)
  expect(cleared).not.toBeNull()
  expect(cleared.sourceId).toBe('c1')
  expect(cleared.targetId).toBe('c2')
})

test('start fresh clears the checkpoint and transfers without checkpoint_id', async ({ page }) => {
  const dlg = await openTransfer(page)
  await page.evaluate(() => {
    ;(window as any).__checkpoint = { completed_tables: ['users'], failed_tables: [], rows_transferred: 50 }
  })
  await configureSource(dlg, page)
  await dlg.getByRole('checkbox', { name: 'orders' }).check()
  await configureTarget(dlg, page)

  await expect(dlg.getByText(/tables already completed/)).toBeVisible({ timeout: 15_000 })

  await dlg.getByRole('button', { name: 'Start Fresh', exact: true }).click()
  await expect(dlg.getByText(/tables already completed/)).toHaveCount(0)

  const cleared = await page.evaluate(() => (window as any).__clearedCheckpoint || null)
  expect(cleared).not.toBeNull()

  await dlg.getByRole('button', { name: 'Start Transfer' }).click()
  await expect(dlg.getByText('Transferred 100 rows across 1 tables in 1.2s')).toBeVisible({ timeout: 15_000 })
  const opts = await page.evaluate(() => (window as any).__lastTransferOpts || null)
  expect(opts).not.toBeNull()
  expect(opts.checkpoint_id).toBeNull()
})

test('target connection selector excludes the selected source connection', async ({ page }) => {
  await installBackend(page, {
    ...state,
    connections: [
      { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
      { id: 'c2', name: 'MySQL B', type: 'mysql', host: 'localhost', port: 3306, user: 'root' },
      { id: 'c3', name: 'Postgres C', type: 'postgresql', host: 'localhost', port: 5432, user: 'root', database: 'app' },
    ],
    dbs: { c1: ['test'], c2: ['test2'], c3: ['app'] },
    tables: { test: ['users'], test2: [], app: [] },
  })
  const dlg = await openTransfer(page)

  await pickOption(dlg, page, 'Select source', 'MySQL A (mysql)')

  await dlg.getByRole('combobox').filter({ hasText: 'Select target' }).click()
  await expect(page.getByRole('option', { name: 'MySQL A (mysql)' })).toHaveCount(0)
  await expect(page.getByRole('option', { name: 'MySQL B (mysql)' })).toHaveCount(1)
  await expect(page.getByRole('option', { name: 'Postgres C (postgresql)' })).toHaveCount(1)
  await page.getByRole('option', { name: 'MySQL B (mysql)' }).click()

  await expect(dlg.getByRole('combobox').filter({ hasText: /MySQL B/ }).first()).toBeVisible()
})

test('transfer lists collections but excludes non-table objects', async ({ page }) => {
  await installBackend(page, {
    connections: [
      { id: 'm1', name: 'Mongo A', type: 'mongodb', host: 'localhost', port: 27017, user: 'root', database: 'shop' },
      { id: 'c2', name: 'MySQL B', type: 'mysql', host: 'localhost', port: 3306, user: 'root' },
    ],
    dbs: { m1: ['shop'], c2: ['test2'] },
    tables: { shop: ['users'], test2: [] },
    objects: {
      shop: [
        { name: 'orders_coll', object_type: 'COLLECTION' },
        { name: 'v_sales', object_type: 'VIEW' },
        { name: 'count_users', object_type: 'FUNCTION' },
      ],
    },
  })
  await openApp(page)
  await page.locator('span[title="Mongo A"]').click()
  await page.getByRole('button', { name: 'Transfer', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Data Transfer')

  await pickOption(dlg, page, 'Select source', 'Mongo A (mongodb)')
  await pickOption(dlg, page, 'Select source database', 'shop')

  await expect(dlg.getByRole('checkbox', { name: 'users' })).toBeVisible()
  await expect(dlg.getByRole('checkbox', { name: 'orders_coll' })).toBeVisible()
  await expect(dlg.getByRole('checkbox', { name: 'v_sales' })).toHaveCount(0)
  await expect(dlg.getByRole('checkbox', { name: 'count_users' })).toHaveCount(0)

  await dlg.getByRole('checkbox', { name: 'orders_coll' }).check()
  await pickOption(dlg, page, 'Select target', 'MySQL B (mysql)')
  await pickOption(dlg, page, 'Select target db', 'test2')

  await dlg.getByRole('button', { name: 'Start Transfer' }).click()
  await expect(dlg.getByText('Transferred 100 rows across 1 tables in 1.2s')).toBeVisible({ timeout: 15_000 })
  const opts = await page.evaluate(() => (window as any).__lastTransferOpts || null)
  expect(opts).not.toBeNull()
  expect(opts.tables).toEqual(['orders_coll'])
})

test('transfer result summarizes migration logs', async ({ page }) => {
  const dlg = await openTransfer(page)
  await configureSource(dlg, page)
  await dlg.getByRole('checkbox', { name: 'users' }).check()
  await configureTarget(dlg, page)

  await dlg.getByRole('button', { name: 'Start Transfer' }).click()
  await expect(dlg.getByText('Transferred 100 rows across 1 tables in 1.2s')).toBeVisible({ timeout: 15_000 })
  await expect(dlg.getByText('Migration Log (2 entries)')).toBeVisible()
})

test('transfer errors show error list and save a partial checkpoint', async ({ page }) => {
  const dlg = await openTransfer(page)
  await configureSource(dlg, page)
  await dlg.getByRole('checkbox', { name: 'users' }).check()
  await dlg.getByRole('checkbox', { name: 'orders' }).check()
  await configureTarget(dlg, page)

  await page.evaluate(() => {
    ;(window as any).__transferOverrides = {
      tables_transferred: ['users'],
      rows_transferred: 50,
      errors: ['Table orders failed'],
      logs: [],
    }
  })
  await dlg.getByRole('button', { name: 'Start Transfer' }).click()
  await expect(dlg.getByText('Transferred 50 rows across 1 tables in 1.2s')).toBeVisible({ timeout: 15_000 })
  await expect(dlg.getByText('Errors: (1)')).toBeVisible()
  await expect(dlg.getByText('Table orders failed')).toBeVisible()

  const cp = await page.evaluate(() => (window as any).__savedCheckpoint || null)
  expect(cp).not.toBeNull()
  expect(cp.sourceId).toBe('c1')
  expect(cp.targetId).toBe('c2')
  expect(cp.completedTables).toEqual(['users'])
  expect(cp.rowsTransferred).toBe(50)
  const cleared = await page.evaluate(() => (window as any).__clearedCheckpoint || null)
  expect(cleared).toBeNull()
})

test('transfer result renders per-table stats', async ({ page }) => {
  const dlg = await openTransfer(page)
  await configureSource(dlg, page)
  await dlg.getByRole('checkbox', { name: 'users' }).check()
  await configureTarget(dlg, page)

  await page.evaluate(() => {
    ;(window as any).__transferOverrides = {
      table_stats: [{ table: 'users', rows: 100, size_bytes: 2048, duration_ms: 350, status: 'ok' }],
      logs: [],
    }
  })
  await dlg.getByRole('button', { name: 'Start Transfer' }).click()
  await expect(dlg.getByText('Transferred 100 rows across 1 tables in 1.2s')).toBeVisible({ timeout: 15_000 })
  await expect(dlg.getByText('Per-table stats')).toBeVisible()
  await expect(dlg.getByText('2.0 KB')).toBeVisible()
  await expect(dlg.getByText('350ms')).toBeVisible()
})