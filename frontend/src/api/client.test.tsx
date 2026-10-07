import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run } from '../test/fixtures'
import { fetchStub } from '../test/render'
import type { Run } from './types'
import { queryKeys, useRun, useRuns } from './client'

afterEach(() => vi.unstubAllGlobals())

function setup(routes: Record<string, () => [number, unknown]>) {
  vi.stubGlobal('fetch', fetchStub(routes).fn)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const invalidated = () => invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey))
  return { wrapper, invalidated, invalidate }
}

describe('refreshing the leaderboard when runs finish', () => {
  it('the run list refreshes the leaderboard when one of its runs finishes', async () => {
    let runs: Run[] = [run({ id: 'r1', status: 'running' }), run({ id: 'r0', status: 'completed' })]
    const { wrapper, invalidated, invalidate } = setup({ '/runs?service_id=svc&limit=200': () => [200, runs] })
    const { result } = renderHook(() => useRuns('svc'), { wrapper })
    await waitFor(() => expect(result.current.data).toHaveLength(2))
    expect(invalidate).not.toHaveBeenCalled() // already-finished runs on first load don't count

    runs = [run({ id: 'r1', status: 'completed' }), run({ id: 'r0', status: 'completed' })]
    await result.current.refetch()
    await waitFor(() => expect(invalidated()).toEqual([JSON.stringify(queryKeys.leaderboards)]))
  })

  it('one run’s page refreshes the leaderboard and that service’s run list', async () => {
    let current = run({ id: 'r1', status: 'collecting' })
    const { wrapper, invalidated } = setup({ '/runs/r1': () => [200, current] })
    const { result } = renderHook(() => useRun('r1'), { wrapper })
    await waitFor(() => expect(result.current.data?.status).toBe('collecting'))

    current = run({ id: 'r1', status: 'completed' })
    await result.current.refetch()
    await waitFor(() => expect(invalidated()).toEqual([JSON.stringify(queryKeys.leaderboards), JSON.stringify(queryKeys.runs('svc'))]))
  })
})
