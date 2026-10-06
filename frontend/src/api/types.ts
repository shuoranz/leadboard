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
  /** List price, USD per 1M input tokens. */
  input_per_million: optional(z.number()),
  /** List price, USD per 1M input tokens served from the provider's prompt cache. */
  cached_input_per_million: optional(z.number()),
  /** List price, USD per 1M output tokens. */
  output_per_million: optional(z.number()),
  /** Mean billed output tokens per task, including hidden reasoning tokens (verbosity). */
  avg_output_tokens: optional(z.number()),
  /** Mean hidden reasoning ("thinking") tokens per task: billed, but not returned. */
  avg_reasoning_tokens: optional(z.number()),
  /** Output tokens per 1,000 characters of output text. Tokenizers differ, so $/token alone isn't comparable. */
  tokens_per_1k_chars: optional(z.number()),
  /** (billed − independently counted) ÷ counted output tokens. Positive means over-billed. */
  billing_drift: optional(z.number()),
})

const percentiles = z.object({ p50: optional(z.number()), p95: optional(z.number()), p99: optional(z.number()) })

/** Failed requests by cause. */
export const ErrorBreakdownSchema = z.object({
  /** HTTP 429. */
  rate_limited: optional(z.number()),
  /** HTTP 5xx. */
  server_error: optional(z.number()),
  /** No complete response within the run's deadline. */
  timeout: optional(z.number()),
  /** The stream ended before the response finished. */
  dropped_stream: optional(z.number()),
  /** Refused by a content filter or safety policy. */
  refused: optional(z.number()),
  other: optional(z.number()),
})

/** Client-side API performance measured during the benchmark run. Every field is optional. */
export const ModelPerfSchema = z.object({
  /** Requests sent. */
  requests: optional(z.number()),
  /** Fraction of requests that succeeded, 0–1. */
  success_rate: optional(z.number()),
  /** Fraction that succeeded once the client retried per the run's retry policy, 0–1. */
  success_after_retry: optional(z.number()),
  /** Failed requests. */
  errors: optional(z.number()),
  error_breakdown: optional(ErrorBreakdownSchema),
  /** Fraction of responses cut off by the output limit (finish_reason = length), 0–1. */
  truncation_rate: optional(z.number()),
  /** Time to first token, measured by the client (ms). */
  ttft_ms: optional(percentiles),
  /** Median TTFT at each tested prompt size: shows how latency grows with long context. */
  ttft_by_input: optional(z.array(z.object({ input_tokens: z.number(), p50_ms: z.number() }))),
  /** Inter-token latency while streaming (ms): how smooth the stream feels. */
  itl_ms: optional(percentiles),
  /** Fraction of streams with a gap between tokens longer than the run's stall threshold, 0–1. */
  stall_rate: optional(z.number()),
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
  /** Prompt processing speed: input tokens per second before the first token. */
  prefill_tps: optional(z.number()),
})

/** What a deployment supports. Declared by the provider, not measured. */
export const CapabilitiesSchema = z.object({
  context_window: optional(z.number()),
  max_output_tokens: optional(z.number()),
  streaming: optional(z.boolean()),
  tool_calling: optional(z.boolean()),
  json_mode: optional(z.boolean()),
  vision: optional(z.boolean()),
  prompt_caching: optional(z.boolean()),
  batch_api: optional(z.boolean()),
  /** Regions the deployment can run in. */
  regions: optional(z.array(z.string())),
})

/** How the benchmark was run. Without this, latency numbers can't be compared across runs. */
export const RunConditionsSchema = z.object({
  started_at: optional(z.string()),
  ended_at: optional(z.string()),
  /** Where the benchmark client ran, e.g. "us-east (Virginia)". */
  client_region: optional(z.string()),
  /** Baseline network round trip from the client to the providers (ms). */
  network_rtt_ms: optional(z.number()),
  /** Concurrency levels tested. */
  concurrency: optional(z.array(z.number())),
  streaming: optional(z.boolean()),
  /** A gap between tokens longer than this counts as a stall (ms). */
  stall_threshold_ms: optional(z.number()),
  /** Deadline for a request before it counts as a timeout (ms). */
  timeout_ms: optional(z.number()),
  retry_policy: optional(z.string()),
  requests_per_model: optional(z.number()),
  /** The traffic mix. */
  profiles: optional(
    z.array(
      z.object({
        name: z.string(),
        input_tokens: optional(z.number()),
        output_tokens: optional(z.number()),
        /** Share of requests, 0–1. */
        share: optional(z.number()),
      }),
    ),
  ),
  notes: optional(z.string()),
})

export const ModelEntrySchema = z.object({
  id,
  /** Full display name, e.g. "Nimbus 4 Pro Max Effort". */
  name: z.string(),
  /** Compact name for chart labels, e.g. "Nimbus 4 Pro". Defaults to `name`. */
  short_name: optional(z.string()),
  /** Configuration shown beside the short name in charts, e.g. "max". */
  variant: optional(z.string()),
  /** Who serves this row. A model offered by several providers appears once per provider. */
  provider: optional(z.string()),
  /** The underlying model's id, shared by all its providers' rows. Defaults to `id`. */
  model_id: optional(z.string()),
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
  capabilities: optional(CapabilitiesSchema),
})

export const LeaderboardSchema = z.object({
  app: AppSummarySchema,
  categories: z.array(CategorySchema),
  models: z.array(ModelEntrySchema),
  run: optional(RunConditionsSchema),
})

export const AppListSchema = z.array(AppSummarySchema)

export type AppSummary = z.output<typeof AppSummarySchema>
export type Subtask = z.output<typeof SubtaskSchema>
export type Category = z.output<typeof CategorySchema>
export type ModelCost = z.output<typeof ModelCostSchema>
export type ModelPerf = z.output<typeof ModelPerfSchema>
export type ErrorBreakdown = z.output<typeof ErrorBreakdownSchema>
export type Capabilities = z.output<typeof CapabilitiesSchema>
export type RunConditions = z.output<typeof RunConditionsSchema>
export type ModelEntry = z.output<typeof ModelEntrySchema>
export type Leaderboard = z.output<typeof LeaderboardSchema>

/** What the backend sends (before normalization) — used by the mock. */
export type LeaderboardPayload = z.input<typeof LeaderboardSchema>
export type AppSummaryPayload = z.input<typeof AppSummarySchema>
