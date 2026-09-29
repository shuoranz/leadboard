// URL-backed leaderboard view state, validated against the current leaderboard:
// unknown categories, columns or model ids fall back instead of breaking the view.
import { useMemo } from 'react'
import type { BoardIndex } from '../../shared/board/boardIndex'
import { OVERALL, type View } from '../../shared/board/model'
import { updateSearch, useSearch } from '../../shared/state/searchParams'
import { columnsFor, formatSort, parseSort, type SortState } from './table'

export function useLeaderboardView(board: BoardIndex) {
  const search = useSearch()

  const view: View = search.cat && board.categoriesById.has(search.cat) ? search.cat : OVERALL
  const columns = useMemo(() => columnsFor(board, view), [board, view])
  const sort = parseSort(search.sort ?? null, columns, view)
  const compare = useMemo(() => new Set(search.compare.filter((id) => board.modelsById.has(id))), [search.compare, board.modelsById])

  return {
    view,
    columns,
    sort,
    compare,
    // Changing category resets sort to that category's primary column.
    setView: (v: View) => updateSearch({ cat: v, sort: null }),
    setSort: (s: SortState) => updateSearch({ sort: formatSort(s) }),
    setCompare: (ids: Set<string>) => updateSearch({ compare: [...ids] }),
  }
}
