import { useQuery } from '@tanstack/react-query'
import type * as z from 'zod/mini'
import { buildBoardIndex } from '../shared/board/boardIndex'
import { AppListSchema, LeaderboardSchema } from './types'

/**
 * Relative to the page by default, like the bundled assets (`base: './'`), so
 * mounting the app at /benchmark/ talks to /benchmark/api. Override with
 * VITE_API_BASE at build time. Resolved per call, so importing this module
 * needs no DOM.
 */
export function apiBase() {
  return (import.meta.env.VITE_API_BASE ?? new URL('api', document.baseURI).pathname).replace(/\/$/, '')
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

async function getJSON<S extends z.ZodMiniType>(path: string, schema: S, signal?: AbortSignal): Promise<z.output<S>> {
  const res = await fetch(`${apiBase()}${path}`, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ApiError(`${res.status} ${res.statusText} — ${path}`, res.status)
  const parsed = schema.safeParse(await res.json())
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new ApiError(`Unexpected response from ${path} — ${issues}`)
  }
  return parsed.data
}

export const queryKeys = {
  apps: ['apps'] as const,
  leaderboard: (appId: string | undefined) => ['leaderboard', appId] as const,
}

export function useApps() {
  return useQuery({
    queryKey: queryKeys.apps,
    queryFn: ({ signal }) => getJSON('/apps', AppListSchema, signal),
  })
}

/** The leaderboard plus everything derived from it, built once per fetch (see BoardIndex). */
export function useLeaderboard(appId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.leaderboard(appId),
    queryFn: ({ signal }) => getJSON(`/apps/${encodeURIComponent(appId!)}/leaderboard`, LeaderboardSchema, signal),
    // A stable module-level function, so TanStack Query memoizes the result.
    select: buildBoardIndex,
    enabled: !!appId,
  })
}
