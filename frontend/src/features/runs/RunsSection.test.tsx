import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import resultsAuto from '../../test/contract/results_auto.json'
import { catalog, run } from '../../test/fixtures'
import { fetchStub, renderWithProviders } from '../../test/render'
import { RunsSection } from './RunsSection'

const service = { id: 'svc', name: 'Summarize API', endpoint_path: '/v1/summarize' }
const profiles = [
  { id: 'smoke', name: 'Smoke', concurrency: 5, ramp_up_s: 10, duration_s: 60, think_time_s: 1 },
  { id: 'baseline', name: 'Baseline', concurrency: 20, ramp_up_s: 30, duration_s: 300, think_time_s: 2 },
]

function stub(routes: Record<string, unknown> = {}) {
  const s = fetchStub({
    '/catalog': catalog,
    '/load-profiles': profiles,
    '/runs?service_id=svc&limit=200': [
      run({ id: 'r_live', status: 'running', progress: 40 }),
      run({ id: 'r_done', status: 'completed', headline: { requests: 900, error_rate: 0.01, e2e_p95_ms: 4200 } }),
    ],
    'POST /runs': (init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      return [201, body.routing.offering_ids.map((o: string, i: number) => run({ id: `r_new${i}`, routing: { mode: 'fixed', offering_id: o } }))]
    },
    ...routes,
  })
  vi.stubGlobal('fetch', s.fn)
  return s
}

afterEach(() => vi.unstubAllGlobals())

describe('runs list', () => {
  it('lists runs with status, progress and headline numbers', async () => {
    stub()
    renderWithProviders(<RunsSection service={service} />)
    const table = await screen.findByRole('table', { name: 'Runs' })
    expect(within(table).getByText('Running')).toBeInTheDocument()
    expect(within(table).getByRole('cell', { name: '4,200' })).toBeInTheDocument()
    expect(within(table).getAllByText('Aurora 4 · Stratus Cloud').length).toBe(2)
    expect(screen.getByText('Refreshing every 2 s while runs are in flight')).toBeInTheDocument()
  })

  it('filters by status', async () => {
    stub()
    renderWithProviders(<RunsSection service={service} />)
    await screen.findByRole('table', { name: 'Runs' })
    await userEvent.click(screen.getByRole('radio', { name: 'Completed' }))
    expect(screen.queryByRole('button', { name: 'r_live' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'r_done' })).toBeInTheDocument()
  })
})

describe('new run form', () => {
  it('picks models by provider, skips unavailable ones, and posts one batch', async () => {
    const s = stub()
    renderWithProviders(<RunsSection service={service} />, { url: '/?new=1' })
    const form = await screen.findByRole('form', { name: 'New run' })
    await userEvent.click(within(form).getByRole('button', { name: /^Models/ }))
    const stratus = await screen.findByRole('group', { name: 'Stratus Cloud' })
    expect(within(stratus).getByRole('checkbox', { name: /Forge 70B/ })).toBeDisabled()
    await userEvent.click(within(stratus).getByRole('checkbox', { name: /^Stratus Cloud/ }))
    await userEvent.click(within(screen.getByRole('group', { name: 'Aurora Labs API' })).getByRole('checkbox', { name: /Aurora 4/ }))
    await userEvent.keyboard('{Escape}')
    expect(within(form).getByRole('list', { name: 'Selected models' }).children).toHaveLength(2)
    await userEvent.click(within(form).getByRole('radio', { name: /Baseline/ }))
    await userEvent.click(within(form).getByRole('button', { name: 'Start 2 runs' }))

    const post = s.calls.find((c) => c.init?.method === 'POST')!
    expect(JSON.parse(String(post.init!.body))).toEqual({
      service_id: 'svc',
      routing: { mode: 'fixed', offering_ids: ['stratus--aurora-4', 'aurora-api--aurora-4'] },
      load_profile_id: 'baseline',
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Started 2 runs')
    expect(window.location.search).toBe('')
  })

  it('auto routing defaults the pool to every usable model; custom load is validated', async () => {
    const s = stub({
      'POST /runs': (init?: RequestInit) => [201, [run({ id: 'r_auto', routing: JSON.parse(String(init?.body)).routing })]],
    })
    renderWithProviders(<RunsSection service={service} />, { url: '/?new=1' })
    const form = await screen.findByRole('form', { name: 'New run' })
    await userEvent.click(within(form).getByRole('radio', { name: 'Auto routing' }))
    expect(within(form).getByRole('list', { name: 'Selected models' }).children).toHaveLength(2)
    await userEvent.click(within(form).getByRole('radio', { name: 'Custom' }))
    const vus = within(form).getByLabelText('Virtual users')
    await userEvent.clear(vus)
    await userEvent.type(vus, '0')
    await userEvent.click(within(form).getByRole('button', { name: 'Start run' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('Virtual users must be between 1 and 500')
    expect(s.calls.some((c) => c.init?.method === 'POST')).toBe(false)
    await userEvent.clear(vus)
    await userEvent.type(vus, '8')
    await userEvent.click(within(form).getByRole('button', { name: 'Start run' }))
    const body = JSON.parse(String(s.calls.find((c) => c.init?.method === 'POST')!.init!.body))
    expect(body.routing).toEqual({ mode: 'auto', pool: ['stratus--aurora-4', 'aurora-api--aurora-4'] })
    expect(body.load).toEqual({ concurrency: 8, ramp_up_s: 20, duration_s: 120, think_time_s: 1 })
  })

  it('shows the backend’s reason when it refuses', async () => {
    stub({ 'POST /runs': () => [422, { detail: 'Not available for this service: stratus--aurora-4' }] })
    renderWithProviders(<RunsSection service={service} />, { url: '/?new=1' })
    const form = await screen.findByRole('form', { name: 'New run' })
    await userEvent.click(within(form).getByRole('radio', { name: 'Auto routing' }))
    await userEvent.click(within(form).getByRole('button', { name: 'Start run' }))
    expect(await within(form).findByText(/Couldn't start the run: Not available for this service/)).toBeInTheDocument()
  })
})

describe('run detail', () => {
  it('shows BlazeMeter and Splunk results side by side, and the routing mix for auto runs', async () => {
    const done = run({
      id: 'r_auto',
      status: 'completed',
      routing: { mode: 'auto', pool: ['stratus--aurora-4', 'aurora-api--aurora-4'] },
      blazemeter: { master_id: 10000017, report_url: 'http://bm.example/app/masters/10000017' },
      splunk: { sid: 's1', search: 'search index=llm_api run_id=r_auto', search_url: 'http://splunk.example/search' },
      headline: { requests: 10 },
    })
    stub({ '/runs/r_auto': done, '/runs/r_auto/results': resultsAuto })
    renderWithProviders(<RunsSection service={service} />, { url: '/?tab=runs&run=r_auto' })
    expect(await screen.findByRole('heading', { name: /r_auto/ })).toBeInTheDocument()
    expect(await screen.findByText('BlazeMeter · client side')).toBeInTheDocument()
    expect(screen.getAllByText('Splunk · server side').length).toBeGreaterThan(0)
    expect(screen.getByRole('img', { name: /BlazeMeter timeline/ })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Routing mix' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'BlazeMeter ↗' })[0]).toHaveAttribute('href', 'http://bm.example/app/masters/10000017')
    expect(within(screen.getByRole('list', { name: 'Progress' })).getAllByRole('listitem')).toHaveLength(5)
  })

  it('a queued run explains the wait and can be cancelled', async () => {
    const s = stub({
      '/runs/r_q': run({ id: 'r_q', status: 'queued' }),
      'POST /runs/r_q/cancel': () => [200, run({ id: 'r_q', status: 'cancelled', cancel_requested: true })],
    })
    renderWithProviders(<RunsSection service={service} />, { url: '/?tab=runs&run=r_q' })
    expect(await screen.findByText(/Waiting for earlier runs/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel run' }))
    expect(s.calls.some((c) => c.path === '/runs/r_q/cancel')).toBe(true)
    expect(await screen.findByText('Cancelled')).toBeInTheDocument()
  })
})
