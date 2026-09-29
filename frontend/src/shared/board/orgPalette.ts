import type { ModelEntry } from '../../api/types'
import { cssVar } from '../lib/tokens'

const SLOTS = 8

export interface OrgPalette {
  color: (org: string) => string
  /** Orgs that own a slot, in slot order, followed by "Other" when any org was folded. */
  legend: { org: string; color: string }[]
}

/**
 * Color follows the organization, never its rank in a filtered view: slots are
 * assigned once per leaderboard (strongest org first). Orgs past the eighth
 * slot fold into a neutral "Other".
 */
export function buildOrgPalette(models: ModelEntry[]): OrgPalette {
  const best = new Map<string, number>()
  for (const m of models) best.set(m.organization, Math.max(best.get(m.organization) ?? -Infinity, m.overall))
  const orgs = [...best.entries()].sort((a, b) => b[1] - a[1]).map(([org]) => org)
  const slotted = new Map(orgs.slice(0, SLOTS).map((org, i) => [org, cssVar.series(i)]))
  const legend = [...slotted.entries()].map(([org, color]) => ({ org, color }))
  if (orgs.length > SLOTS) legend.push({ org: 'Other', color: cssVar.seriesOther })
  return { color: (org) => slotted.get(org) ?? cssVar.seriesOther, legend }
}
