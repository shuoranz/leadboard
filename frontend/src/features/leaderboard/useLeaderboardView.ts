// URL-backed leaderboard view state, validated against the current leaderboard:
// unknown columns or row ids fall back instead of breaking the view.
import { useMemo } from 'react'
import type { BoardIndex } from '../../shared/board/boardIndex'
import { updateSearch, useSearch } from '../../shared/state/searchParams'
import { formatSort, parseSort, type SortState } from './table'

export function useLeaderboardView(board: BoardIndex) {
  const search = useSearch()
  const sort = parseSort(search.sort ?? null)
  const compare = useMemo(() => new Set(search.compare.filter((id) => board.rowsById.has(id))), [search.compare, board.rowsById])

  return {
    sort,
    compare,
    // A different load profile is a different set of runs, so the compare picks reset.
    setProfile: (id: string) => updateSearch({ profile: id, compare: null }),
    setSort: (s: SortState) => updateSearch({ sort: formatSort(s) }),
    setCompare: (ids: Set<string>) => updateSearch({ compare: [...ids] }),
  }
}
