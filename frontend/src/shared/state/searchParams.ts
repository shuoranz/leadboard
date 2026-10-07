// The one definition of URL state.
//
// Shareable (in the URL): what the view *is* — service, tab, the open
// run, whether the new-run form is open, the leaderboard's load profile, sort,
// compare set, and the insights latency metric. Local (component state): how
// you're exploring it — search text, filter chips, hidden columns, expanded
// rows, hover, kill-zone selection, form inputs, and ad-hoc chart picks.
//
// This module only checks shape. Whether an id exists (a service, a run, a
// profile) is checked by the feature that reads it.
import { useMemo, useSyncExternalStore } from 'react'
import * as z from 'zod/mini'

const text = z.catch(z.optional(z.string().check(z.minLength(1))), undefined)

export const TABS = ['leaderboard', 'runs', 'catalog'] as const
export type Tab = (typeof TABS)[number]

export const LATENCY_METRICS = ['e2e_p95', 'e2e_p50', 'ttft_p50'] as const
export type LatencyMetric = (typeof LATENCY_METRICS)[number]

export const SearchSchema = z.object({
  service: text,
  /** Absent = leaderboard. */
  tab: z.catch(z.optional(z.enum(TABS)), undefined),
  /** Run id whose detail page is open (runs tab). */
  run: text,
  /** "1" when the new-run form is open. */
  new: z.catch(z.optional(z.literal('1')), undefined),
  /** Leaderboard load profile id; absent = the backend's default (latest run's). */
  profile: text,
  /** "<column id>:<asc|desc>". Column ids may contain ":". */
  sort: z.catch(z.optional(z.string().check(z.regex(/^.+:(asc|desc)$/))), undefined),
  /** Comma-separated leaderboard row ids. */
  compare: z.catch(
    z.pipe(
      z.optional(z.string()),
      z.transform((s) => (s ? s.split(',').filter(Boolean) : [])),
    ),
    [],
  ),
  /** Insights latency metric; absent = e2e_p95. */
  lat: z.catch(z.optional(z.enum(LATENCY_METRICS)), undefined),
})

export type SearchState = z.output<typeof SearchSchema>
export type SearchKey = keyof SearchState
type SearchPatch = { [K in SearchKey]?: SearchState[K] | null }

export function parseSearch(search: string): SearchState {
  return SearchSchema.parse(Object.fromEntries(new URLSearchParams(search)))
}

function serialize(value: string | string[] | null | undefined): string | null {
  if (value == null) return null
  const s = Array.isArray(value) ? value.join(',') : value
  return s === '' ? null : s
}

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
  }
}

export interface UpdateOptions {
  /** New history entry (navigation) instead of replacing the current one (view tweaks). */
  push?: boolean
  /** Drop every key not in the patch, e.g. when switching services. */
  reset?: boolean
}

export function updateSearch(patch: SearchPatch, { push = false, reset = false }: UpdateOptions = {}) {
  const params = reset ? new URLSearchParams() : new URLSearchParams(window.location.search)
  for (const [key, value] of Object.entries(patch) as [SearchKey, SearchPatch[SearchKey]][]) {
    const s = serialize(value)
    if (s == null) params.delete(key)
    else params.set(key, s)
  }
  const qs = params.toString()
  const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
  if (push) window.history.pushState(null, '', url)
  else window.history.replaceState(null, '', url)
  listeners.forEach((l) => l())
}

/** The parsed URL state; re-renders when it changes (including back/forward). */
export function useSearch(): SearchState {
  const search = useSyncExternalStore(subscribe, () => window.location.search)
  return useMemo(() => parseSearch(search), [search])
}
