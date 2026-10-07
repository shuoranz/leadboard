import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { board, catalog, row, run } from '../test/fixtures'
import { fetchStub, renderWithProviders } from '../test/render'
import App from './App'

const services = [
  { id: 'summ', name: 'Summarize API', endpoint_path: '/v1/summ' },
  { id: 'head', name: 'Headline API', endpoint_path: '/v1/head' },
]
const boardFor = (id: string, name: string) => board([row({ id: `${id}-row`, name: `${name} model` })], { service: { id, name, endpoint_path: `/v1/${id}` } })

function stub(overrides: Record<string, unknown> = {}) {
  const s = fetchStub({
    '/services': services,
    '/catalog': catalog,
    '/load-profiles': [],
    '/services/summ/leaderboard': boardFor('summ', 'Summarize API'),
    '/services/head/leaderboard': boardFor('head', 'Headline API'),
    '/runs?service_id=summ&limit=200': [run({ id: 'r_1', service_id: 'summ', status: 'completed', headline: { requests: 1234 } })],
    ...overrides,
  })
  vi.stubGlobal('fetch', s.fn)
  return s
}

afterEach(() => vi.unstubAllGlobals())

describe('App', () => {
  it('opens the first service and pins it in the URL', async () => {
    stub()
    renderWithProviders(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Summarize API' })).toBeInTheDocument()
    await waitFor(() => expect(window.location.search).toBe('?service=summ'))
    expect(screen.queryByLabelText('Project')).not.toBeInTheDocument()
    expect(screen.getByText(/POST \/v1\/summ/)).toBeInTheDocument()
  })

  it('the leaderboard refreshes when a run finishes, even while the Runs tab is closed', async () => {
    let status: 'running' | 'completed' = 'running'
    const s = stub({ '/runs?service_id=summ&limit=200': () => [200, [run({ id: 'r_1', service_id: 'summ', status })]] })
    renderWithProviders(<App />, { url: '/?service=summ' })
    await screen.findByRole('heading', { level: 1, name: 'Summarize API' })
    const boardFetches = () => s.calls.filter((c) => c.path === '/services/summ/leaderboard').length
    await waitFor(() => expect(s.calls.some((c) => c.path.startsWith('/runs'))).toBe(true))
    expect(boardFetches()).toBe(1)
    status = 'completed'
    await waitFor(() => expect(boardFetches()).toBe(2), { timeout: 4000 }) // after the next 2 s poll
  })

  it('switching service pushes history and drops the previous view params', async () => {
    stub()
    renderWithProviders(<App />, { url: '/?service=summ&sort=perf:errors:asc' })
    await screen.findByRole('heading', { level: 1, name: 'Summarize API' })
    await userEvent.selectOptions(screen.getByLabelText('Service'), 'head')
    expect(await screen.findByRole('heading', { level: 1, name: 'Headline API' })).toBeInTheDocument()
    expect(window.location.search).toBe('?service=head')
  })

  it('tabs are navigation: runs and catalog', async () => {
    stub()
    renderWithProviders(<App />, { url: '/?service=summ' })
    await screen.findByRole('heading', { level: 1, name: 'Summarize API' })
    await userEvent.click(screen.getByRole('radio', { name: 'Runs' }))
    expect(window.location.search).toBe('?service=summ&tab=runs')
    expect(await screen.findByRole('button', { name: 'r_1' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '1,234' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Models catalog' }))
    expect(await screen.findByRole('table', { name: 'Catalog' })).toBeInTheDocument()
  })

  it('reports a contract violation with the offending field instead of crashing', async () => {
    const bad = structuredClone(boardFor('summ', 'Summarize API')) as { rows: { perf: unknown }[] }
    bad.rows[0].perf = 'fast'
    stub({ '/services/summ/leaderboard': bad })
    renderWithProviders(<App />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't load this service's leaderboard.")
    await waitFor(() => expect(alert).toHaveTextContent('rows.0.perf'))
  })

  it('says so when the URL names an unknown service', async () => {
    stub()
    renderWithProviders(<App />, { url: '/?service=ghost' })
    expect(await screen.findByText(/Unknown service/)).toHaveTextContent('Unknown service ghost.')
  })
})
