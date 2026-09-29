import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { board, model } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { LeaderboardSection } from './LeaderboardSection'

const fixture = board([
  model({
    id: 'alpha',
    name: 'Alpha',
    overall: 80,
    categories: { math: 70, code: 90 },
    subtasks: { 'math.olympiad': 71 },
    perf: { errors: 40, success_rate: 0.99, ttft_ms: { p50: 420, p95: 1100 } },
  }),
  model({
    id: 'beta',
    name: 'Beta',
    overall: 75,
    categories: { math: 95, code: 60 },
    subtasks: { 'math.olympiad': 96 },
    perf: { errors: 5, success_rate: 0.995, ttft_ms: { p50: 250, p95: 600 } },
  }),
  model({ id: 'gamma', name: 'Gamma FT', overall: 70, categories: { math: 50 }, finetune: true }),
])

const rowNames = () => screen.getAllByRole('rowheader').map((th) => th.textContent?.replace(/open|finetune/g, '').trim())

describe('LeaderboardSection', () => {
  it('ranks by overall and hides finetunes by default', () => {
    renderWithProviders(<LeaderboardSection />, { board: fixture })
    expect(rowNames()).toEqual(['Alpha', 'Beta'])
  })

  it('switching category puts it in the URL and shows that category’s subtask columns', async () => {
    renderWithProviders(<LeaderboardSection />, { board: fixture })
    await userEvent.click(screen.getByRole('radio', { name: 'Mathematics' }))
    expect(new URLSearchParams(window.location.search).get('cat')).toBe('math')
    expect(screen.getByRole('columnheader', { name: /olympiad/i })).toBeInTheDocument()
    expect(rowNames()).toEqual(['Beta', 'Alpha'])
  })

  it('shows performance columns instead of category columns in the All view', () => {
    renderWithProviders(<LeaderboardSection />, { board: fixture })
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers.some((h) => h?.includes('Mathematics'))).toBe(false)
    expect(screen.getByRole('columnheader', { name: /TTFT client p50 \/ p95 \(ms\)/ })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '420 / 1,100' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '99.5%' })).toBeInTheDocument()
  })

  it('sorting writes the sort to the URL; lower-is-better columns start ascending', async () => {
    renderWithProviders(<LeaderboardSection />, { board: fixture })
    await userEvent.click(screen.getByRole('button', { name: /^Errors/ }))
    expect(new URLSearchParams(window.location.search).get('sort')).toBe('perf:errors:asc')
    expect(rowNames()).toEqual(['Beta', 'Alpha'])
    await userEvent.click(screen.getByRole('button', { name: /^Errors/ }))
    expect(rowNames()).toEqual(['Alpha', 'Beta'])
  })

  it('restores the view from the URL, and compare bypasses the filters', () => {
    renderWithProviders(<LeaderboardSection />, { board: fixture, url: '/?cat=math&compare=gamma,beta' })
    expect(screen.getByRole('radio', { name: 'Mathematics' })).toBeChecked()
    // gamma is a finetune (normally hidden) but was explicitly compared
    expect(rowNames()).toEqual(['Beta', 'Gamma FT'])
  })

  it('ignores unknown ids and malformed params in the URL', () => {
    renderWithProviders(<LeaderboardSection />, { board: fixture, url: '/?cat=nope&sort=junk&compare=ghost' })
    expect(screen.getByRole('radio', { name: 'All' })).toBeChecked()
    expect(screen.getByRole('columnheader', { name: /overall/i })).toHaveAttribute('aria-sort', 'descending')
    expect(rowNames()).toEqual(['Alpha', 'Beta'])
  })
})
