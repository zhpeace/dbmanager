import { test, expect } from '@playwright/test'
import { installBackend, openApp } from './helpers'

const baseState = {
  connections: [
    { id: 'c1', name: 'MySQL A', type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'test' },
  ],
  dbs: { c1: ['test', 'prod'] },
  tables: { test: ['users'] },
  queries: {},
}

test.beforeEach(async ({ page }) => {
  await installBackend(page, baseState)
})

test('hover disconnect button on connection row fires disconnect', async ({ page }) => {
  await openApp(page)
  // expand connection so it is connected & shows databases
  await page.locator('span[title="MySQL A"]').first().click()
  await expect(page.locator('span[title="test"]').first()).toBeVisible()

  // hover the connection row -> hover buttons should become visible
  const row = page.locator('span[title="MySQL A"]').first().locator('xpath=ancestor::div[contains(@class,"group")]').first()
  await row.hover()

  // the unplug (disconnect) button should now be visible and clickable
  const unplug = row.locator('button').filter({ has: page.locator('svg.lucide-unplug') }).last()
  await expect(unplug).toBeVisible()
  await unplug.click()

  // databases should be cleared from the sidebar
  await expect(page.locator('span[title="test"]')).toHaveCount(0)
})

test('hover disconnect button does not toggle connection expansion', async ({ page }) => {
  await openApp(page)
  await page.locator('span[title="MySQL A"]').first().click()
  await expect(page.locator('span[title="test"]').first()).toBeVisible()

  const row = page.locator('span[title="MySQL A"]').first().locator('xpath=ancestor::div[contains(@class,"group")]').first()
  await row.hover()
  const unplug = row.locator('button').filter({ has: page.locator('svg.lucide-unplug') }).last()
  await unplug.click()

  // connection must remain expanded (not collapsed) after disconnect click
  await expect(page.locator('span[title="MySQL A"]')).toHaveCount(1)
})
