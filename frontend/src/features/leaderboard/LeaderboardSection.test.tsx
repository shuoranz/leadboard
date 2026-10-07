import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { board, catalog, row } from '../../test/fixtures'
import { fetchStub, renderWithProviders } from '../../test/render'
import { LeaderboardSection } from './LeaderboardSection'

const perf = (e2e: number, ttft: number, extra = {}) => ({ ttft_by_input: [], e2e_ms: { p50: e2e / 2, p95: e2e }, ttft_ms: { p50: ttft, p95: ttft * 2 }, ...extra })

// One LLM served by two providers, an open model, and the auto-routing row.
const fixture = board(
  [
    row({ id: 'stratus--aurora-4', name: 'Aurora 4', model_id: 'aurora-4', provider: 'Stratus Cloud', organization: 'Aurora Labs', perf: perf(6400, 520, { errors: 40, success_rate: 0.993 }), recent_runs: [{ run_id: 'r_old', e2e_p95_ms: 6400 }] }),
    row({ id: 'aurora-api--aurora-4', name: 'Aurora 4', model_id: 'aurora-4', provider: 'Aurora Labs API', organization: 'Aurora Labs', perf: perf(5500, 415, { errors: 9 }), status: 'degraded' }),
    row({ id: 'swiftserve--forge-70b', name: 'Forge 70B', model_id: 'forge-70b', provider: 'Swiftserve', organization: 'OpenForge', open_weights: true, perf: perf(2300, 150, { errors: 12 }) }),
    row({ id: 'auto', routing: 'auto', name: 'Auto routing', model_id: 'auto', provider: 'Random per request', provider_id: 'auto', organization: 'Auto routing', perf: perf(5400, 300), routing_mix: [{ offering_id: 'stratus--aurora-4', share: 0.6 }, { offering_id: 'swiftserve--forge-70b', share: 0.4 }] }),
  ],
  {
    conditions: { concurrency: [20], ramp_up_s: 30, duration_s: 300, runs: 4, client_region: 'us-east', started_at: '2026-10-01T00:00:00Z', ended_at: '2026-10-02T00:00:00Z' },
  },
)

const rowNames = () =>
  within(screen.getByRole('table', { name: 'Leaderboard' }))
    .getAllByRole('rowheader')
    .map((th) => th.firstElementChild?.firstElementChild?.textContent + ' | ' + th.lastElementChild?.textContent?.split(' · ')[0])

beforeEach(() => vi.stubGlobal('fetch', fetchStub({ '/catalog': catalog }).fn))
afterEach(() => vi.unstubAllGlobals())

describe('LeaderboardSection', () => {
  it('ranks by client E2E p95, fastest first, one row per provider', () => {
    renderWithProviders(<LeaderboardSection />, { board: fixture })
    expect(rowNames()).toEqual(['Forge 70B | via Swiftserve', 'Auto routing | 2 models', 'Aurora 4 | via Aurora Labs API', 'Aurora 4 | via Stratus Cloud'])
    expect(screen.getByRole('columnheader', { name: /E2E p95 · client/ })).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByRole('cell', { name: '150 / 300' })).toBeInTheDocument()
  })

  it('load-profile tabs show run counts and switch the profile in the URL', async () => {
    renderWithProviders(<LeaderboardSection />, { board: fixture })
    expect(screen.getByRole('radio', { name: 'Baseline · 4' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: 'Smoke · 2' }))
    expect(new URLSearchParams(window.location.search).get('profile')).toBe('smoke')
  })

  it('sorting writes the sort to the URL; lower-is-better columns start ascending', async () => {
    renderWithProviders(<LeaderboardSection />, { board: fixture })
    await userEvent.click(screen.getByRole('button', { name: /^Errors/ }))
    expect(new URLSearchParams(window.location.search).get('sort')).toBe('perf:errors:asc')
    expect(rowNames()[0]).toBe('Aurora 4 | via Aurora Labs API')
  })

  it('filters by provider and collapses to the best provider per model', async () => {
    renderWithProviders(<LeaderboardSection />, { board: fixture })
    await userEvent.selectOptions(screen.getByLabelText('Provider'), 'Stratus Cloud')
    expect(rowNames()).toEqual(['Aurora 4 | via Stratus Cloud'])
    await userEvent.selectOptions(screen.getByLabelText('Provider'), '')
    await userEvent.click(screen.getByRole('button', { name: 'One row per model' }))
    expect(rowNames()).toEqual(['Forge 70B | via Swiftserve', 'Auto routing | 2 models', 'Aurora 4 | via Aurora Labs API'])
  })

  it('restores compare from the URL and ignores unknown ids', () => {
    renderWithProviders(<LeaderboardSection />, { board: fixture, url: '/?compare=stratus--aurora-4,ghost&sort=junk' })
    expect(rowNames()).toEqual(['Aurora 4 | via Stratus Cloud'])
    expect(screen.getByRole('button', { name: 'Compare · 1' })).toBeInTheDocument()
  })

  it('expands a row into details with its recent runs, which link to the run page', async () => {
    renderWithProviders(<LeaderboardSection />, { board: fixture })
    await userEvent.click(screen.getByRole('button', { name: 'Show details for Aurora 4 via Stratus Cloud' }))
    expect(await screen.findByText('Served by:')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'r_old' }))
    expect(window.location.search).toBe('?tab=runs&run=r_old')
  })

  it('shows the auto row’s routing mix', async () => {
    renderWithProviders(<LeaderboardSection />, { board: fixture })
    await userEvent.click(screen.getByRole('button', { name: 'Show details for Auto routing' }))
    const mix = await screen.findByRole('list', { name: 'Share of requests per model' })
    expect(await within(mix).findByText('Aurora 4 · Stratus Cloud')).toBeInTheDocument()
    expect(within(mix).getByText('60%')).toBeInTheDocument()
  })

  it('shows the test conditions', () => {
    renderWithProviders(<LeaderboardSection />, { board: fixture })
    expect(screen.getByText(/Baseline · 20 virtual users · 5m/)).toBeInTheDocument()
  })

  it('offers to start a run when the profile has no results', async () => {
    renderWithProviders(<LeaderboardSection />, { board: board([], { profile: 'smoke' }) })
    expect(screen.getByText('No completed runs under the Smoke profile yet.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start a run' }))
    expect(window.location.search).toBe('?tab=runs&new=1')
  })
})
