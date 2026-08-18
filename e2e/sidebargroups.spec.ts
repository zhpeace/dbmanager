import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const state = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
  ],
  dbs: { c1: ['test'] },
  tables: { test: ['users', 'orders'] },
  objects: {
    test: [
      { name: 'active_users', object_type: 'VIEW' },
      { name: 'count_users', object_type: 'FUNCTION' },
      { name: 'refresh_stats', object_type: 'PROCEDURE' },
      { name: 'users_audit', object_type: 'TRIGGER' },
    ],
  },
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, state)
})

async function expandSidebar(page: any) {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').first().click()
  await page.locator('span[title="test"]').first().click()
  await expect(page.locator('span[title="active_users"]')).toBeVisible({ timeout: 15_000 })
}

async function expectGroup(page: any, label: string, count: string) {
  const h = page.getByText(label, { exact: true })
  await expect(h).toBeVisible()
  await expect(h.locator('..')).toContainText(`(${count})`)
}

test('sidebar groups non-table objects with type headers and counts', async ({ page }) => {
  await expandSidebar(page)
  await expectGroup(page, 'Tables', '2')
  await expectGroup(page, 'Views', '1')
  await expectGroup(page, 'Functions', '1')
  await expectGroup(page, 'Procedures', '1')
  await expectGroup(page, 'Triggers', '1')
  await expect(page.locator('span[title="active_users"]')).toBeVisible()
  await expect(page.locator('span[title="count_users"]')).toBeVisible()
  await expect(page.locator('span[title="refresh_stats"]')).toBeVisible()
  await expect(page.locator('span[title="users_audit"]')).toBeVisible()
})

test('collapsing a type group hides its objects', async ({ page }) => {
  await expandSidebar(page)
  await expect(page.locator('span[title="count_users"]')).toBeVisible()
  await page.getByText('Functions', { exact: true }).click()
  await expect(page.locator('span[title="count_users"]')).toHaveCount(0)
})

test('dropping a view confirms and calls drop_view', async ({ page }) => {
  await expandSidebar(page)
  await page.locator('span[title="active_users"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Drop View', exact: true }).click()

  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Are you sure you want to drop view "active_users"? This cannot be undone.')
  await dlg.getByRole('button', { name: 'Drop Table', exact: true }).click()

  await expect
    .poll(async () => (page as any).evaluate(() => (window as any).__ddlCalls || []))
    .toContainEqual(expect.objectContaining({ cmd: 'drop_view', args: { id: 'c1', database: 'test', view: 'active_users' } }))
})

test('dropping a function calls drop_routine with routineType FUNCTION', async ({ page }) => {
  await expandSidebar(page)
  await page.locator('span[title="count_users"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Drop Function', exact: true }).click()

  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Are you sure you want to drop function "count_users"?')
  await dlg.getByRole('button', { name: 'Drop Table', exact: true }).click()

  await expect
    .poll(async () => (page as any).evaluate(() => (window as any).__ddlCalls || []))
    .toContainEqual(expect.objectContaining({ cmd: 'drop_routine', args: { id: 'c1', database: 'test', routine: 'count_users', routineType: 'FUNCTION' } }))
})

async function editorText(page: any) {
  const txt = await page.locator('.view-lines').first().innerText()
  return txt.replace(/\u00A0/g, ' ')
}

test('view definition inserts SHOW CREATE SQL into the editor', async ({ page }) => {
  await expandSidebar(page)
  await page.locator('.monaco-editor').first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('span[title="count_users"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'View Definition', exact: true }).click()

  await expect.poll(async () => editorText(page)).toContain('SHOW CREATE FUNCTION count_users;')
})

test('group header context menu creates a new function template tab', async ({ page }) => {
  await expandSidebar(page)
  await page.getByText('Functions', { exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'New Functions', exact: true }).click()

  await expect.poll(async () => editorText(page)).toContain('CREATE FUNCTION new_object()')
})

test('dropping a trigger calls drop_trigger', async ({ page }) => {
  await expandSidebar(page)
  await page.locator('span[title="users_audit"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Drop Trigger', exact: true }).click()

  const dlg = page.locator('[role="dialog"]')
  await expect(dlg).toContainText('Are you sure you want to drop trigger "users_audit"?')
  await dlg.getByRole('button', { name: 'Drop Table', exact: true }).click()

  await expect
    .poll(async () => (page as any).evaluate(() => (window as any).__ddlCalls || []))
    .toContainEqual(expect.objectContaining({ cmd: 'drop_trigger', args: { id: 'c1', database: 'test', trigger: 'users_audit' } }))
})
