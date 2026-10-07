import type { LeaderboardRow } from '../../api/types'
import { cssVar } from '../lib/tokens'

const SLOTS = 8

export interface OrgPalette {
  color: (org: string) => string
  /** Orgs that own a slot, in slot order, followed by "Other" when any org was folded. */
  legend: { org: string; color: string }[]
}

/**
 * Color follows the organization (the model's maker), never its rank in a
 * filtered view: slots are assigned once per leaderboard (fastest org first).
 * Orgs past the eighth slot fold into a neutral "Other".
 */
export function buildOrgPalette(rows: LeaderboardRow[]): OrgPalette {
  const best = new Map<string, number>()
  for (const r of rows) best.set(r.organization, Math.min(best.get(r.organization) ?? Infinity, r.perf.e2e_ms?.p95 ?? Infinity))
  const orgs = [...best.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([org]) => org)
  const slotted = new Map(orgs.slice(0, SLOTS).map((org, i) => [org, cssVar.series(i)]))
  const legend = [...slotted.entries()].map(([org, color]) => ({ org, color }))
  if (orgs.length > SLOTS) legend.push({ org: 'Other', color: cssVar.seriesOther })
  return { color: (org) => slotted.get(org) ?? cssVar.seriesOther, legend }
}
