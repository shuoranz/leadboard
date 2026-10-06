// Everything derived from one leaderboard payload, computed once per fetch and
// shared through BoardContext, so no component re-derives lookups on its own.
import type { AppSummary, Category, Leaderboard, ModelEntry, RunConditions } from '../../api/types'
import { buildOrgPalette, type OrgPalette } from './orgPalette'

export interface BoardIndex {
  app: AppSummary
  categories: Category[]
  /** Best overall first. */
  models: ModelEntry[]
  modelsById: ReadonlyMap<string, ModelEntry>
  categoriesById: ReadonlyMap<string, Category>
  /** Alphabetical. */
  organizations: string[]
  /** Alphabetical; empty when no row names a provider. */
  providers: string[]
  palette: OrgPalette
  /** How the benchmark was run, when the backend reports it. */
  run?: RunConditions
}

export function buildBoardIndex(board: Leaderboard): BoardIndex {
  const models = [...board.models].sort((a, b) => b.overall - a.overall)
  return {
    app: board.app,
    categories: board.categories,
    models,
    modelsById: new Map(models.map((m) => [m.id, m])),
    categoriesById: new Map(board.categories.map((c) => [c.id, c])),
    organizations: [...new Set(models.map((m) => m.organization))].sort(),
    providers: [...new Set(models.flatMap((m) => (m.provider ? [m.provider] : [])))].sort(),
    palette: buildOrgPalette(models),
    run: board.run,
  }
}

/** Label for a view: "Overall" or the category's name. */
export function viewLabel(index: BoardIndex, view: string | null) {
  return view == null ? 'Overall' : (index.categoriesById.get(view)?.name ?? view)
}
