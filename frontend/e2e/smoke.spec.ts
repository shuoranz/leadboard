import { expect, test } from '@playwright/test'

// Runs against the production bundle served by `vite preview` with the mock API.

test('leaderboard loads, sorts, expands and keeps its view in the URL', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/')
  await expect(page).toHaveURL(/\?app=chat-completions/)
  const table = page.getByRole('table', { name: 'Leaderboard' })
  await expect(table.locator('tbody tr').first()).toBeVisible()

  await page.getByRole('radio', { name: 'Coding' }).first().click()
  await table.getByRole('button', { name: /bug fixing/i }).click()
  await expect(page).toHaveURL(/cat=coding.*sort=sub%3Acoding\.bug-fixing%3Adesc/)

  await page.reload()
  await expect(table.getByRole('columnheader', { name: /bug fixing/i })).toHaveAttribute('aria-sort', 'descending')

  await table.getByRole('button', { name: /Show subtask scores/ }).first().click()
  await expect(table.getByText('From:')).toBeVisible()

  expect(errors).toEqual([])
})

test('insights charts render, the kill zone toggles, and tooltips work by keyboard', async ({ page }) => {
  await page.goto('/?app=chat-completions')
  const scatter = page.getByRole('img', { name: /Scatter of Overall score/ })
  await expect(scatter).toBeVisible()

  // Pin the exact point: selecting re-orders the points (dominated ones drawn first).
  const name = (await page.getByRole('button', { name: /: .* at \$/ }).first().getAttribute('aria-label'))!
  const point = page.getByRole('button', { name, exact: true })
  const pointName = name.slice(0, name.lastIndexOf(': '))
  const beaten = page.getByText(`Beaten by ${pointName}`, { exact: false })

  // Keyboard: each point is a button.
  await point.focus()
  await page.keyboard.press('Enter')
  await expect(beaten).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByText(/Beaten by/)).toHaveCount(0)

  // Mouse: clicking the dot selects that dot, even where another provider's dot
  // for the same model overlaps it.
  const box = (await point.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(beaten).toBeVisible()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByText(/Beaten by/)).toHaveCount(0)

  // Move the mouse off the chart (as a user heading for the cost list would), then
  // reach a cost row the way a keyboard user does (Tab), not via element.focus().
  await page.mouse.move(0, 0)
  const costRow = page.getByRole('button', { name: /: \$[0-9.]+ per successful task$/ }).first()
  await costRow.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(costRow).toBeFocused()
  await expect(page.getByRole('tooltip')).toContainText('$ / 1M output')

  await expect(page.getByRole('img', { name: /Radar chart/ })).toBeVisible()
})

test('switching apps navigates and back restores the previous view', async ({ page }) => {
  await page.goto('/?app=chat-completions&cat=coding')
  await page.getByLabel('API app').selectOption('code-assist')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Code Assist API')
  await expect(page).toHaveURL(/\?app=code-assist$/)
  await page.goBack()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chat Completions API')
  await expect(page.getByRole('radio', { name: 'Coding' }).first()).toBeChecked()
})

test('providers, column groups and test conditions render from the production bundle', async ({ page }) => {
  await page.goto('/?app=chat-completions')
  const table = page.getByRole('table', { name: 'Leaderboard' })
  for (const g of ['Quality', 'Reliability', 'Latency', 'Throughput', 'Cost']) {
    await expect(table.getByRole('columnheader', { name: g, exact: true })).toBeVisible()
  }
  await expect(table.getByText(/^via /).first()).toBeVisible()

  await page.getByText('Test conditions').click()
  await expect(page.getByRole('cell', { name: /Long-context RAG/ }).or(page.getByRole('rowheader', { name: 'Long-context RAG' }))).toBeVisible()

  const before = await table.locator('tbody > tr').count()
  await page.getByLabel('Provider').selectOption('Cloudhaven')
  await expect(table.getByText(/^via /).first()).toHaveText('via Cloudhaven')
  expect(await table.locator('tbody > tr').count()).toBeLessThan(before)
})
