// The one definition of URL state.
//
// Shareable (in the URL): what the view *is* — app, leaderboard category, sort,
// compare set, and the insights cost view. Local (component state): how you're
// exploring it — search text, filter chips, hidden columns, expanded rows,
// hover, kill-zone selection, and ad-hoc chart picks.
//
// This module only checks shape. Whether an id exists in the current
// leaderboard is checked by the feature that reads it (see useLeaderboardView).
import { useMemo, useSyncExternalStore } from 'react'
import * as z from 'zod/mini'

const text = z.catch(z.optional(z.string().check(z.minLength(1))), undefined)

export const SearchSchema = z.object({
  app: text,
  /** Leaderboard category id. */
  cat: text,
  /** "<column id>:<asc|desc>". Column ids may contain ":". */
  sort: z.catch(z.optional(z.string().check(z.regex(/^.+:(asc|desc)$/))), undefined),
  /** Comma-separated model ids. */
  compare: z.catch(
    z.pipe(
      z.optional(z.string()),
      z.transform((s) => (s ? s.split(',').filter(Boolean) : [])),
    ),
    [],
  ),
  /** Insights cost view (category id); absent = overall. */
  cost: text,
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
  /** Drop every key not in the patch, e.g. when switching apps. */
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
