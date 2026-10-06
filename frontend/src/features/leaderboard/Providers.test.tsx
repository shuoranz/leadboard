import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Leaderboard } from '../../api/types'
import { board, model } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { LeaderboardSection } from './LeaderboardSection'

// One model served by two providers, plus a single-provider model.
const nimbus = (provider: string, ttft: number, overall: number) =>
  model({
    id: `nimbus--${provider.toLowerCase()}`,
    model_id: 'nimbus',
    name: 'Nimbus 4',
    provider,
    overall,
    perf: { ttft_ms: { p50: ttft, p95: ttft * 2 }, e2e_ms: { p50: 5000, p95: 9000, p99: 15000 } },
  })
const fixture: Leaderboard = {
  ...board([
    nimbus('Swiftserve', 200, 80),
    nimbus('Cloudhaven', 450, 81),
    model({ id: 'orbit--orbit-labs', model_id: 'orbit', name: 'Orbit 2', provider: 'Orbit Labs', overall: 70, perf: { ttft_ms: { p50: 300 } } }),
  ]),
  run: {
    started_at: '2026-09-22T12:00:00Z',
    ended_at: '2026-09-24T12:00:00Z',
    client_region: 'us-east (Virginia)',
    concurrency: [1, 8, 32],
    requests_per_model: 5000,
    stall_threshold_ms: 1000,
    profiles: [{ name: 'Short chat', input_tokens: 800, output_tokens: 350, share: 0.5 }],
  },
}

const rows = () =>
  within(screen.getByRole('table', { name: 'Leaderboard' }))
    .getAllByRole('rowheader')
    .map((th) => th.textContent?.replace(/open|finetune/g, '').replace(/\s+/g, ' ').trim())

describe('providers, column groups and test conditions', () => {
  it('shows each provider’s row with "via <provider>" and a group header row', () => {
    renderWithProviders(<LeaderboardSection />, { board: fixture })
    expect(rows()).toEqual(['Nimbus 4via Cloudhaven', 'Nimbus 4via Swiftserve', 'Orbit 2via Orbit Labs'])
    for (const g of ['Quality', 'Reliability', 'Latency', 'Throughput', 'Cost']) {
      expect(screen.getByRole('columnheader', { name: g })).toHaveAttribute('scope', 'colgroup')
    }
  })

  it('filters by provider', async () => {
    renderWithProviders(<LeaderboardSection />, { board: fixture })
    await userEvent.selectOptions(screen.getByLabelText('Provider'), 'Swiftserve')
    expect(rows()).toEqual(['Nimbus 4via Swiftserve'])
  })

  it('"One row per model" keeps the best provider under the current sort', async () => {
    renderWithProviders(<LeaderboardSection />, { board: fixture })
    await userEvent.click(screen.getByRole('button', { name: 'One row per model' }))
    // by Overall, Cloudhaven's Nimbus wins
    expect(rows()).toEqual(['Nimbus 4via Cloudhaven', 'Orbit 2via Orbit Labs'])
    // by TTFT (lower is better), Swiftserve's wins
    await userEvent.click(screen.getByRole('button', { name: /^TTFT client p50/ }))
    expect(rows()).toEqual(['Nimbus 4via Swiftserve', 'Orbit 2via Orbit Labs'])
  })

  it('starts with less essential columns hidden, and toggles a whole group', async () => {
    renderWithProviders(<LeaderboardSection />, { board: fixture })
    expect(screen.queryByRole('columnheader', { name: /E2E client p99/ })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /Choose columns/ }))
    const latency = screen.getByRole('group', { name: 'Latency columns' })
    const groupBox = within(latency).getByRole('checkbox', { name: 'Latency' })
    expect((groupBox as HTMLInputElement).indeterminate).toBe(true)

    await userEvent.click(groupBox) // partly shown -> show all
    expect(screen.getByRole('columnheader', { name: /E2E client p99/ })).toBeInTheDocument()
    await userEvent.click(groupBox) // all shown -> hide all
    expect(screen.queryByRole('columnheader', { name: /TTFT client p50/ })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Latency' })).toBeNull()
  })

  it('summarizes the test conditions and expands to the full setup', async () => {
    renderWithProviders(<LeaderboardSection />, { board: fixture })
    const summary = screen.getByText(/Sep 22, 2026 – Sep 24, 2026 · from us-east \(Virginia\) · concurrency 1 \/ 8 \/ 32/)
    await userEvent.click(summary)
    expect(screen.getByText('gap > 1,000 ms')).toBeVisible()
    expect(screen.getByRole('rowheader', { name: 'Short chat' })).toBeVisible()
  })

  it('renders no conditions panel when the backend sends none', () => {
    renderWithProviders(<LeaderboardSection />, { board: { ...fixture, run: undefined } })
    expect(screen.queryByText('Test conditions')).toBeNull()
  })
})
