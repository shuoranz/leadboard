// Everything derived from one service leaderboard payload, computed once per
// fetch and shared through BoardContext, so no component re-derives lookups.
import type { LeaderboardRow, ProfileTab, RunConditions, Service, ServiceLeaderboard } from '../../api/types'
import { e2eP95 } from './model'
import { buildOrgPalette, type OrgPalette } from './orgPalette'

export interface BoardIndex {
  service: Service
  profiles: ProfileTab[]
  /** The load profile the rows were measured under. */
  profile?: ProfileTab
  /** Fastest first (client-side E2E p95); rows without it last. */
  rows: LeaderboardRow[]
  rowsById: ReadonlyMap<string, LeaderboardRow>
  /** Alphabetical. */
  organizations: string[]
  /** Alphabetical, excluding the auto-routing row's pseudo-provider. */
  providers: string[]
  palette: OrgPalette
  conditions?: RunConditions
  updatedAt?: string
}

const byLatency = (a: LeaderboardRow, b: LeaderboardRow) => (e2eP95(a) ?? Infinity) - (e2eP95(b) ?? Infinity)

export function buildBoardIndex(board: ServiceLeaderboard): BoardIndex {
  const rows = [...board.rows].sort(byLatency)
  return {
    service: board.service,
    profiles: board.profiles,
    profile: board.profiles.find((p) => p.id === board.profile),
    rows,
    rowsById: new Map(rows.map((r) => [r.id, r])),
    organizations: [...new Set(rows.map((r) => r.organization))].sort(),
    providers: [...new Set(rows.flatMap((r) => (r.routing === 'fixed' ? [r.provider] : [])))].sort(),
    palette: buildOrgPalette(rows),
    conditions: board.conditions,
    updatedAt: board.updated_at,
  }
}
