// Domain accessors: how to read a row's metrics, and display names.
import type { LeaderboardRow, RunStatus } from '../../api/types'

export const shortName = (r: LeaderboardRow) => r.short_name ?? r.name

/** Identity of the underlying LLM, shared by every provider's row for it. */
export const modelKey = (r: LeaderboardRow) => r.model_id

/** Full name plus provider, for anywhere rows are listed outside the table (selects, tooltips). */
export const displayName = (r: LeaderboardRow) => (r.routing === 'auto' ? r.name : `${r.name} · ${r.provider}`)

/** Client-side E2E p95: the leaderboard's default ranking. */
export const e2eP95 = (r: LeaderboardRow) => r.perf.e2e_ms?.p95

/** Cost per 1,000 requests; non-positive values count as unknown (they can't sit on a log axis). */
export function costPer1k(r: LeaderboardRow): number | undefined {
  const v = r.cost.per_1k_requests
  return v != null && v > 0 ? v : undefined
}

/** Input:output token ratio used for the blended price, a common shorthand for chat traffic. */
export const BLEND_INPUT_PER_OUTPUT = 3

/** List price per 1M tokens at a 3:1 input:output mix. */
export function blendedPrice(r: LeaderboardRow): number | undefined {
  const input = r.cost.input_per_million
  const output = r.cost.output_per_million
  if (input == null || output == null) return undefined
  return (BLEND_INPUT_PER_OUTPUT * input + output) / (BLEND_INPUT_PER_OUTPUT + 1)
}

export const STATUS_LABEL: Record<RunStatus, string> = {
  queued: 'Queued',
  starting: 'Starting',
  running: 'Running',
  collecting: 'Collecting logs',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}
