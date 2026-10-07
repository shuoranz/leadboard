import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { ServiceLeaderboard } from '../api/types'
import { BoardProvider } from '../shared/board/BoardContext'
import { buildBoardIndex } from '../shared/board/boardIndex'
import { TooltipProvider } from '../shared/ui/Tooltip'

/** Renders UI under the app's providers, starting at `url`. */
export function renderWithProviders(ui: ReactNode, { url = '/', board }: { url?: string; board?: ServiceLeaderboard } = {}) {
  window.history.replaceState(null, '', url)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const content = board ? <BoardProvider value={buildBoardIndex(board)}>{ui}</BoardProvider> : ui
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <TooltipProvider>{content}</TooltipProvider>
      </QueryClientProvider>,
    ),
  }
}

/** Routes fetch by API path (after /api) to canned bodies; records every call. */
export function fetchStub(routes: Record<string, unknown | ((init?: RequestInit) => [number, unknown])>) {
  const calls: { path: string; init?: RequestInit }[] = []
  const fn = async (input: string, init?: RequestInit) => {
    const path = input.replace(/^.*\/api/, '')
    calls.push({ path, init })
    const key = Object.keys(routes).find((k) => k === path || k === `${init?.method ?? 'GET'} ${path}`)
    if (!key) return new Response(JSON.stringify({ detail: 'Not found' }), { status: 404 })
    const r = routes[key]
    const [status, body] = typeof r === 'function' ? (r as (init?: RequestInit) => [number, unknown])(init) : [200, r]
    return new Response(JSON.stringify(body), { status })
  }
  return { fn, calls }
}
