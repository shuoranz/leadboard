import { expect, test } from '@playwright/test'

// Runs against the production bundle served by `vite preview` with the mock API
// (seed data from fake_data/, runs simulated on a wall clock).

test('leaderboard loads, sorts, switches profile and keeps its view in the URL', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/')
  await expect(page).toHaveURL(/\?service=summarize-profile/)
  await expect(page.getByLabel('Project')).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Summarize Profile API')
  const table = page.getByRole('table', { name: 'Leaderboard' })
  await expect(table.locator('tbody tr').first()).toBeVisible()
  for (const g of ['Latency', 'Reliability', 'Throughput', 'Cost']) {
    await expect(table.getByRole('columnheader', { name: g, exact: true })).toBeVisible()
  }

  await page.getByRole('radio', { name: /^Baseline/ }).click()
  await expect(page).toHaveURL(/profile=baseline/)
  await table.getByRole('button', { name: /^Errors/ }).click()
  await expect(page).toHaveURL(/sort=perf%3Aerrors%3Aasc/)

  await page.reload()
  await expect(table.getByRole('columnheader', { name: /^Errors/ })).toHaveAttribute('aria-sort', 'ascending')
  await expect(page.getByRole('radio', { name: /^Baseline/ })).toBeChecked()

  await table.getByRole('button', { name: /Show details for Aurora 4 via Stratus Cloud/ }).click()
  await expect(table.getByText('Served by:')).toBeVisible()
  await expect(table.getByRole('region', { name: 'Recent runs' })).toBeVisible()

  await page.getByLabel('Provider').selectOption('Cloudhaven')
  await expect(table.getByText(/^via /).first()).toHaveText(/via Cloudhaven/)

  expect(errors).toEqual([])
})

test('insights render, the kill zone toggles by keyboard and mouse', async ({ page }) => {
  await page.goto('/?service=summarize-profile&profile=baseline')
  await expect(page.getByRole('img', { name: /Scatter of E2E p95/ })).toBeVisible()

  const name = (await page.getByRole('button', { name: / ms at \$/ }).first().getAttribute('aria-label'))!
  const point = page.getByRole('button', { name, exact: true })
  const pointName = name.slice(0, name.lastIndexOf(': '))

  await point.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText(`Beaten by ${pointName}`, { exact: false })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByText(/Beaten by/)).toHaveCount(0)

  const box = (await point.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByText(`Beaten by ${pointName}`, { exact: false })).toBeVisible()

  await page.getByRole('radio', { name: 'TTFT p50' }).click()
  await expect(page).toHaveURL(/lat=ttft_p50/)
  await expect(page.getByRole('img', { name: /Scatter of TTFT p50/ })).toBeVisible()
  await expect(page.getByRole('img', { name: /Radar chart/ })).toBeVisible()
})

test('start a fixed batch: runs queue, progress, finish, and show both sources', async ({ page }) => {
  await page.goto('/?service=ticket-triage&tab=runs')
  await page.getByRole('button', { name: '+ New run' }).click()
  const form = page.getByRole('form', { name: 'New run' })

  // The same LLM from two providers, picked in the LLM → provider view.
  await form.getByRole('button', { name: /^Models/ }).click()
  await page.getByRole('radio', { name: 'By LLM' }).click()
  await page.getByRole('group', { name: 'Gale 3 Mini' }).getByRole('checkbox', { name: /^Gale 3 Mini/ }).check()
  await page.keyboard.press('Escape')
  await expect(form.getByRole('list', { name: 'Selected models' }).getByRole('listitem')).toHaveCount(2)
  await form.getByRole('radio', { name: /^Smoke/ }).click()
  await form.getByLabel('Label (optional)').fill('e2e smoke')
  await form.getByRole('button', { name: 'Start 2 runs' }).click()

  await expect(page.getByRole('status')).toContainText('Started 2 runs')
  const runs = page.getByRole('table', { name: 'Runs' })
  const mine = runs.locator('tbody tr', { hasText: 'e2e smoke' })
  await expect(mine).toHaveCount(2)
  await expect(mine.filter({ hasText: /Running|Starting|Queued/ }).first()).toBeVisible()

  await mine.first().getByRole('button').first().click()
  await expect(page).toHaveURL(/run=r_mock/)
  await expect(page.getByRole('heading', { name: /e2e smoke/ })).toBeVisible()
  await expect(page.getByText('BlazeMeter · client side')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('img', { name: /BlazeMeter timeline/ })).toBeVisible()
  await expect(page.getByText(/request events the service logged/)).toBeVisible()

  await page.getByRole('button', { name: '← All runs' }).click()
  await expect(runs).toBeVisible()
})

test('auto routing run shows its routing mix; switching service navigates and back restores', async ({ page }) => {
  await page.goto('/?service=headline-rewrite&tab=runs&new=1')
  const form = page.getByRole('form', { name: 'New run' })
  await form.getByRole('radio', { name: 'Auto routing' }).click()
  await expect(form.getByRole('list', { name: 'Selected models' }).getByRole('listitem')).toHaveCount(6)
  await form.getByRole('button', { name: 'Start run' }).click()
  await page.getByRole('table', { name: 'Runs' }).locator('tbody tr').first().click()
  await expect(page.getByRole('table', { name: 'Routing mix' })).toBeVisible({ timeout: 20_000 })

  await page.goto('/?service=summarize-profile&profile=smoke')
  await page.getByRole('combobox', { name: /^Service/ }).selectOption('headline-rewrite')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Headline Rewrite API')
  await page.goBack()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Summarize Profile API')
  await expect(page.getByRole('radio', { name: /^Smoke/ })).toBeChecked()

  await page.getByRole('navigation', { name: 'Service sections' }).getByRole('link', { name: 'Models catalog' }).click()
  const catalog = page.getByRole('table', { name: 'Catalog' })
  const groupHeads = catalog.locator('th[scope=rowgroup]')
  await expect(groupHeads.first()).toContainText('Aurora Labs API')
  await page.getByRole('radio', { name: 'LLM → provider' }).click()
  await expect(groupHeads.first()).toContainText('Aurora 4')
})
