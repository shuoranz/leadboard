// Domain accessors: how to read a score or cost for a view, and display names.
import type { Category, ModelEntry } from '../../api/types'

/**
 * The dimension a score/cost is read along: a category id, or `OVERALL` (null).
 * Using null rather than a sentinel string means no category id can collide with it.
 */
export type View = string | null
export const OVERALL = null

export function scoreFor(m: ModelEntry, view: View): number | undefined {
  return view === OVERALL ? m.overall : m.categories[view]
}

/** Cost per successful task; non-positive values count as unknown (they can't sit on a log axis). */
export function costFor(m: ModelEntry, view: View): number | undefined {
  const ps = m.cost?.per_success
  const v = view === OVERALL ? ps?.overall : ps?.categories[view]
  return v != null && v > 0 ? v : undefined
}

/** The finetune rule every view applies: finetunes are opt-in. */
export const passesFinetune = (m: ModelEntry, includeFinetunes: boolean) => includeFinetunes || !m.finetune

export const shortName = (m: ModelEntry) => m.short_name ?? m.name
export const chipLabel = (c: Category) => c.short_name ?? c.name
export const abbrLabel = (c: Category) => c.abbr ?? c.name.slice(0, 3)
