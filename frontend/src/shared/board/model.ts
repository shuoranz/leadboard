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

/** Identity of the underlying model, shared by every provider's row for it. */
export const modelKey = (m: ModelEntry) => m.model_id ?? m.id

/** Full name plus provider, for anywhere rows are listed outside the table (selects, tooltips). */
export const displayName = (m: ModelEntry) => (m.provider ? `${m.name} · ${m.provider}` : m.name)

/** Input:output token ratio used for the blended price, a common shorthand for chat traffic. */
export const BLEND_INPUT_PER_OUTPUT = 3

/** List price per 1M tokens at a 3:1 input:output mix. */
export function blendedPrice(m: ModelEntry): number | undefined {
  const input = m.cost?.input_per_million
  const output = m.cost?.output_per_million
  if (input == null || output == null) return undefined
  return (BLEND_INPUT_PER_OUTPUT * input + output) / (BLEND_INPUT_PER_OUTPUT + 1)
}

/** Share of billed output tokens that are hidden reasoning tokens, 0–1. */
export function reasoningShare(m: ModelEntry): number | undefined {
  const reasoning = m.cost?.avg_reasoning_tokens
  const output = m.cost?.avg_output_tokens
  if (reasoning == null || !output) return undefined
  return Math.min(1, reasoning / output)
}
