import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import type * as z from 'zod/mini'
import { buildBoardIndex } from '../shared/board/boardIndex'
import { buildCatalogIndex } from '../shared/catalog/catalogIndex'
import {
  CatalogSchema,
  LoadProfileListSchema,
  RunListSchema,
  RunResultsSchema,
  RunSchema,
  ServiceLeaderboardSchema,
  ServiceListSchema,
  isActive,
  type Run,
  type RunCreate,
} from './types'

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
    /** The backend's own explanation (FastAPI's `detail`), when it sent one. */
    readonly detail?: string,
  ) {
    super(message)
  }
}

/** FastAPI errors carry `detail`: a string, or a list of validation issues. */
async function errorDetail(res: Response): Promise<string | undefined> {
  try {
    const body = await res.json()
    const d = body?.detail
    if (typeof d === 'string') return d
    if (Array.isArray(d)) return d.map((i) => `${(i.loc ?? []).slice(1).join('.')}: ${i.msg}`).join('; ')
  } catch {
    // not JSON
  }
  return undefined
}

async function request<S extends z.ZodMiniType>(path: string, schema: S, init: RequestInit = {}): Promise<z.output<S>> {
  const res = await fetch(`${apiBase()}${path}`, { ...init, headers: { Accept: 'application/json', ...init.headers } })
  if (!res.ok) {
    const detail = await errorDetail(res)
    throw new ApiError(`${res.status} ${res.statusText} — ${path}${detail ? `: ${detail}` : ''}`, res.status, detail)
  }
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

const getJSON = <S extends z.ZodMiniType>(path: string, schema: S, signal?: AbortSignal) => request(path, schema, { signal })

const sendJSON = <S extends z.ZodMiniType>(path: string, schema: S, body?: unknown) =>
  request(path, schema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

export const queryKeys = {
  services: ['services'] as const,
  catalog: ['catalog'] as const,
  loadProfiles: ['load-profiles'] as const,
  leaderboard: (serviceId: string | undefined, profile: string | undefined) => ['leaderboard', serviceId, profile ?? null] as const,
  leaderboards: ['leaderboard'] as const,
  runs: (serviceId: string | undefined) => ['runs', serviceId] as const,
  allRuns: ['runs'] as const,
  run: (id: string | undefined) => ['run', id] as const,
  results: (id: string | undefined) => ['run-results', id] as const,
}

/** How often to poll while something is still in flight. */
export const POLL_MS = 2000

export function useServices() {
  return useQuery({ queryKey: queryKeys.services, queryFn: ({ signal }) => getJSON('/services', ServiceListSchema, signal) })
}

/** The provider → LLM catalog plus lookups, built once per fetch. */
export function useCatalog() {
  return useQuery({
    queryKey: queryKeys.catalog,
    queryFn: ({ signal }) => getJSON('/catalog', CatalogSchema, signal),
    select: buildCatalogIndex,
  })
}

export function useLoadProfiles() {
  return useQuery({ queryKey: queryKeys.loadProfiles, queryFn: ({ signal }) => getJSON('/load-profiles', LoadProfileListSchema, signal) })
}

/** A service's leaderboard plus everything derived from it, built once per fetch (see BoardIndex). */
export function useServiceLeaderboard(serviceId: string | undefined, profile: string | undefined) {
  return useQuery({
    queryKey: queryKeys.leaderboard(serviceId, profile),
    queryFn: ({ signal }) =>
      getJSON(
        `/services/${encodeURIComponent(serviceId!)}/leaderboard${profile ? `?profile=${encodeURIComponent(profile)}` : ''}`,
        ServiceLeaderboardSchema,
        signal,
      ),
    // A stable module-level function, so TanStack Query memoizes the result.
    select: buildBoardIndex,
    enabled: !!serviceId,
    // Keep the old profile's rows on screen while the next one loads.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === serviceId ? prev : undefined),
  })
}

const pollWhileActive = (query: { state: { data: Run[] | Run | undefined } }) => {
  const data = query.state.data
  if (!data) return false
  return (Array.isArray(data) ? data.some((r) => isActive(r.status)) : isActive(data.status)) ? POLL_MS : false
}

/**
 * When a watched run leaves the in-flight states, the leaderboard has new data
 * (and so may the service's run list): refetch them. Lives in the polling
 * hooks, so it works whichever view is watching, the run list or one run.
 */
function useRefreshWhenFinished(data: Run[] | Run | undefined, { runLists }: { runLists: boolean }) {
  const qc = useQueryClient()
  const inFlight = useRef<ReadonlySet<string> | null>(null)
  useEffect(() => {
    if (!data) return
    const runs = Array.isArray(data) ? data : [data]
    const before = inFlight.current
    inFlight.current = new Set(runs.filter((r) => isActive(r.status)).map((r) => r.id))
    const finished = before ? runs.filter((r) => before.has(r.id) && !isActive(r.status)) : []
    if (!finished.length) return
    void qc.invalidateQueries({ queryKey: queryKeys.leaderboards })
    if (runLists) for (const id of new Set(finished.map((r) => r.service_id))) void qc.invalidateQueries({ queryKey: queryKeys.runs(id) })
  }, [data, qc, runLists])
}

/** A service's runs, newest first. Polls while any is still in flight. */
export function useRuns(serviceId: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.runs(serviceId),
    queryFn: ({ signal }) => getJSON(`/runs?service_id=${encodeURIComponent(serviceId!)}&limit=200`, RunListSchema, signal),
    enabled: !!serviceId,
    staleTime: 0,
    refetchInterval: pollWhileActive,
  })
  useRefreshWhenFinished(query.data, { runLists: false })
  return query
}

export function useRun(id: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.run(id),
    queryFn: ({ signal }) => getJSON(`/runs/${encodeURIComponent(id!)}`, RunSchema, signal),
    enabled: !!id,
    staleTime: 0,
    refetchInterval: pollWhileActive,
  })
  useRefreshWhenFinished(query.data, { runLists: true })
  return query
}

/** Results exist once a run has finished collecting (completed, or cancelled with partial data). */
export function useRunResults(id: string | undefined, ready: boolean) {
  return useQuery({
    queryKey: queryKeys.results(id),
    queryFn: ({ signal }) => getJSON(`/runs/${encodeURIComponent(id!)}/results`, RunResultsSchema, signal),
    enabled: !!id && ready,
    // Results never change once written.
    staleTime: Infinity,
  })
}

export function useStartRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: RunCreate) => sendJSON('/runs', RunListSchema, body),
    onSuccess: (runs) => {
      void qc.invalidateQueries({ queryKey: queryKeys.runs(runs[0]?.service_id) })
    },
  })
}

export function useCancelRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => sendJSON(`/runs/${encodeURIComponent(id)}/cancel`, RunSchema),
    onSuccess: (run) => {
      qc.setQueryData(queryKeys.run(run.id), run)
      void qc.invalidateQueries({ queryKey: queryKeys.runs(run.service_id) })
    },
  })
}
