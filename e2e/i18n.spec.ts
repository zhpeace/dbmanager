import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
  ],
  dbs: { c1: ['test'] },
  tables: { test: ['users'] },
  queries: {
    'SELECT * FROM users': { columns: ['id', 'name'], rows: [{ id: 1, name: 'Alice' }] },
  },
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

async function toChinese(page: any) {
  await page.getByRole('button', { name: '中文', exact: true }).click()
  await expect(page.getByRole('button', { name: '新建连接' })).toBeVisible()
}

test('chinese locale covers sidebar, editor, results and dialogs', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').first().click()
  await toChinese(page)

  // sidebar headers + groups
  await expect(page.getByText('连接', { exact: true }).first()).toBeVisible()
  await page.locator('span[title="test"]').first().click()
  await expect(page.getByText('表', { exact: true }).first()).toBeVisible()
  await expect(page.locator('span[title="users"]')).toBeVisible()

  // editor toolbar labels
  await expect(page.getByRole('button', { name: '运行全部', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '执行计划', exact: true })).toBeVisible()

  // run a query, results header uses zh
  await page.locator('.monaco-editor').first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.monaco-editor .view-lines').first().click({ position: { x: 60, y: 20 } })
  await page.waitForTimeout(300)
  const ta = page.getByRole('textbox', { name: 'Editor content' })
  await ta.focus()
  await page.keyboard.insertText('SELECT * FROM users')
  await page.getByRole('button', { name: '运行', exact: true }).click()
  await expect(page.getByText('Alice').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/结果/).first()).toBeVisible()

  // history panel localized
  await page.getByTitle('查询历史').click()
  await expect(page.getByText('SELECT * FROM users').first()).toBeVisible()
})

test('chinese context menu and drop dialog are localized', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').first().click()
  await toChinese(page)
  await page.locator('span[title="test"]').first().click()
  await expect(page.locator('span[title="users"]')).toBeVisible()

  await page.locator('span[title="users"]').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: '浏览数据', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '复制名称', exact: true })).toBeVisible()

  await page.getByRole('menuitem', { name: '删除表', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('确定要删除 table "users" 吗？此操作不可撤销。')
  await dlg.getByRole('button', { name: '删除表', exact: true }).click()

  await expect
    .poll(async () => (page as any).evaluate(() => (window as any).__ddlCalls || []))
    .toContainEqual(expect.objectContaining({ cmd: 'drop_table', args: { id: 'c1', database: 'test', table: 'users' } }))
})

test('toggling back to english restores english labels', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').first().click()
  await toChinese(page)
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await expect(page.getByText('Connections')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run All', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New Connection' })).toBeVisible()
})

async function pickZhOption(dlg: any, page: any, placeholder: string, optionText: string) {
  await dlg.getByRole('combobox').filter({ hasText: placeholder }).first().click()
  await page.getByRole('option', { name: optionText }).click()
}

test('backup flow is fully localized in chinese', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').first().click()
  await toChinese(page)

  await page.getByRole('button', { name: '备份', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('备份数据库')

  await pickZhOption(dlg, page, '选择源连接', 'MySQL A (mysql)')
  await pickZhOption(dlg, page, '选择源数据库', 'test')
  await dlg.getByRole('checkbox', { name: 'users' }).check()
  await dlg.getByRole('textbox').fill('/tmp/backup_test.sql')

  await dlg.getByRole('button', { name: '开始备份', exact: true }).click()
  await expect(dlg.getByText('备份完成')).toBeVisible({ timeout: 15_000 })
  await expect(dlg.getByText('在 2.3s 内备份了 5 个表')).toBeVisible()
})

test('transfer flow is fully localized in chinese', async ({ page }) => {
  await installBackend(page, {
    ...state,
    connections: [
      { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
      { id: 'c2', name: 'MySQL B', type: 'mysql', host: 'localhost', port: 3306, user: 'root' },
    ],
    dbs: { c1: ['test'], c2: ['test2'] },
    tables: { test: ['users'], test2: [] },
  })
  await openApp(page)
  await page.locator('span[title="MySQL A"]').first().click()
  await toChinese(page)

  await page.getByRole('button', { name: '迁移', exact: true }).click()
  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('数据迁移')

  await pickZhOption(dlg, page, '选择源连接', 'MySQL A (mysql)')
  await pickZhOption(dlg, page, '选择源数据库', 'test')
  await dlg.getByRole('checkbox', { name: 'users' }).check()
  await pickZhOption(dlg, page, '选择目标连接', 'MySQL B (mysql)')
  await pickZhOption(dlg, page, '选择目标数据库', 'test2')

  await dlg.getByRole('button', { name: '开始迁移', exact: true }).click()
  await expect(dlg.getByText('在 1.2s 内迁移了 100 行，涉及 1 个表')).toBeVisible({ timeout: 15_000 })
})
