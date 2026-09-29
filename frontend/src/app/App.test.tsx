import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { board, model } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import App from './App'

const apps = [
  { id: 'chat', name: 'Chat API' },
  { id: 'code', name: 'Code API' },
]
const boards: Record<string, unknown> = {
  chat: { ...board([model({ id: 'a', name: 'Alpha' })]), app: apps[0] },
  code: { ...board([model({ id: 'b', name: 'Beta' })]), app: apps[1] },
}

function mockFetch(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const path = input.replace(/^.*\/api/, '')
      const body = path === '/apps' ? apps : (overrides[path] ?? boards[path.split('/')[2]])
      return new Response(JSON.stringify(body), { status: body ? 200 : 404 })
    }),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('App', () => {
  it('shows the first app and pins it in the URL', async () => {
    mockFetch()
    renderWithProviders(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Chat API' })).toBeInTheDocument()
    expect(window.location.search).toBe('?app=chat')
  })

  it('switching apps pushes a history entry and drops the previous view params', async () => {
    mockFetch()
    renderWithProviders(<App />, { url: '/?app=chat&cat=math&sort=cat:math:asc' })
    await screen.findByRole('heading', { level: 1, name: 'Chat API' })
    await userEvent.selectOptions(screen.getByLabelText('API app'), 'code')
    expect(await screen.findByRole('heading', { level: 1, name: 'Code API' })).toBeInTheDocument()
    expect(window.location.search).toBe('?app=code')
  })

  it('reports a contract violation with the offending field instead of crashing', async () => {
    const bad = structuredClone(boards.chat) as { models: { overall: unknown }[] }
    bad.models[0].overall = 'high'
    mockFetch({ '/apps/chat/leaderboard': bad })
    renderWithProviders(<App />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't load this leaderboard.")
    await waitFor(() => expect(alert).toHaveTextContent('models.0.overall'))
  })
})
