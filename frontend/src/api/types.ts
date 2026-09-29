// API contract between the backend and this frontend.
//
//   GET {API_BASE}/apps                       -> AppSummary[]
//   GET {API_BASE}/apps/{app_id}/leaderboard  -> Leaderboard
//
// Responses are parsed with these schemas at the fetch boundary, so the rest of
// the app can trust the shapes below. Every score is on a 0–100 scale.
// Categories are per-app, so the UI never hard-codes category ids.
//
// Optional fields accept null or absence (Pydantic serializes `None` as null)
// and are normalized to `undefined`. Uses zod/mini to keep the bundle small.
import * as z from 'zod/mini'

const optional = <T extends z.ZodMiniType>(schema: T) =>
  z.optional(z.pipe(z.nullish(schema), z.transform((v) => v ?? undefined)))

/** id -> value; null entries (e.g. a subtask that wasn't run) are dropped. */
const numberMap = z.pipe(
  z.record(z.string(), z.nullable(z.number())),
  z.transform((m) => Object.fromEntries(Object.entries(m).filter((e): e is [string, number] => e[1] != null))),
)

const id = z.string().check(z.minLength(1))

export const AppSummarySchema = z.object({
  id,
  name: z.string(),
  description: optional(z.string()),
  /** ISO-8601 timestamp of the latest benchmark run. */
  updated_at: optional(z.string()),
})

export const SubtaskSchema = z.object({ id, name: z.string() })

export const CategorySchema = z.object({
  id,
  name: z.string(),
  /** Short label for chips, e.g. "IF" for "Instruction Following". Defaults to `name`. */
  short_name: optional(z.string()),
  /** Three-letter label for tight spots such as radar axes, e.g. "Rsn". */
  abbr: optional(z.string()),
  subtasks: z.array(SubtaskSchema),
})

export const ModelCostSchema = z.object({
  /** Cost (USD) per successful task — overall, and per category id. */
  per_success: z.object({
    overall: optional(z.number()),
    categories: z._default(numberMap, {}),
  }),
  /** List price, USD per 1M output tokens. */
  output_per_million: optional(z.number()),
  /** Mean output tokens per task (verbosity). */
  avg_output_tokens: optional(z.number()),
})

const percentiles = z.object({ p50: optional(z.number()), p95: optional(z.number()) })

/** Client-side API performance measured during the benchmark run. Every field is optional. */
export const ModelPerfSchema = z.object({
  /** Requests sent. */
  requests: optional(z.number()),
  /** Fraction of requests that succeeded, 0–1. */
  success_rate: optional(z.number()),
  /** Failed requests. */
  errors: optional(z.number()),
  /** Time to first token, measured by the client (ms). */
  ttft_ms: optional(percentiles),
  /** End-to-end request latency, measured by the client (ms). */
  e2e_ms: optional(percentiles),
  /** Time spent in the client itself, outside the API call (ms). */
  client_overhead_ms: optional(percentiles),
  /** Sustained requests per second. */
  throughput_rps: optional(z.number()),
  /** Output tokens per minute across all requests. */
  tokens_per_min: optional(z.object({ avg: optional(z.number()), peak: optional(z.number()) })),
  /** Median per-request decode speed (output tokens per second). */
  decode_tps_p50: optional(z.number()),
})

export const ModelEntrySchema = z.object({
  id,
  /** Full display name, e.g. "Nimbus 4 Pro Max Effort". */
  name: z.string(),
  /** Compact name for chart labels, e.g. "Nimbus 4 Pro". Defaults to `name`. */
  short_name: optional(z.string()),
  /** Configuration shown beside the short name in charts, e.g. "max". */
  variant: optional(z.string()),
  organization: z.string(),
  open_weights: z.boolean(),
  finetune: z.boolean(),
  /** Model this was fine-tuned from, when `finetune` is true. */
  base_model: optional(z.string()),
  overall: z.number(),
  /** Category average, keyed by category id. */
  categories: numberMap,
  /** Subtask score, keyed by subtask id. */
  subtasks: numberMap,
  cost: optional(ModelCostSchema),
  perf: optional(ModelPerfSchema),
})

export const LeaderboardSchema = z.object({
  app: AppSummarySchema,
  categories: z.array(CategorySchema),
  models: z.array(ModelEntrySchema),
})

export const AppListSchema = z.array(AppSummarySchema)

export type AppSummary = z.output<typeof AppSummarySchema>
export type Subtask = z.output<typeof SubtaskSchema>
export type Category = z.output<typeof CategorySchema>
export type ModelCost = z.output<typeof ModelCostSchema>
export type ModelPerf = z.output<typeof ModelPerfSchema>
export type ModelEntry = z.output<typeof ModelEntrySchema>
export type Leaderboard = z.output<typeof LeaderboardSchema>

/** What the backend sends (before normalization) — used by the mock. */
export type LeaderboardPayload = z.input<typeof LeaderboardSchema>
export type AppSummaryPayload = z.input<typeof AppSummarySchema>
