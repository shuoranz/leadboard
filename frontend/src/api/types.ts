// API contract between the backend (src/app_benchmark/schemas.py) and this frontend.
//
//   GET  {API_BASE}/services                         -> Service[]
//   GET  {API_BASE}/catalog                          -> Catalog (providers, LLMs, offerings)
//   GET  {API_BASE}/load-profiles                    -> LoadProfile[]
//   GET  {API_BASE}/services/{id}/leaderboard?profile -> ServiceLeaderboard
//   GET  {API_BASE}/runs?service_id&status&limit     -> Run[] (newest first)
//   POST {API_BASE}/runs                             -> Run[] (one per fixed model, or one auto run)
//   GET  {API_BASE}/runs/{id}                        -> Run
//   POST {API_BASE}/runs/{id}/cancel                 -> Run
//   GET  {API_BASE}/runs/{id}/results                -> RunResults
//
// Responses are parsed with these schemas at the fetch boundary, so the rest of
// the app can trust the shapes below. Rates are 0–1 fractions, times are ms,
// prices are USD per 1M tokens, timestamps are ISO-8601.
//
// Optional fields accept null or absence (Pydantic serializes `None` as null)
// and are normalized to `undefined`. Uses zod/mini to keep the bundle small.
import * as z from 'zod/mini'

const optional = <T extends z.ZodMiniType>(schema: T) =>
  z.optional(z.pipe(z.nullish(schema), z.transform((v) => v ?? undefined)))

/** A list that may come back null or absent: normalized to []. */
const list = <T extends z.ZodMiniType>(schema: T) =>
  z.pipe(
    z.optional(z.nullable(z.array(schema))),
    z.transform((v) => v ?? []),
  )

const id = z.string().check(z.minLength(1))

// ---- services --------------------------------------------------------------

/** An LLM-backed API service: the unit a benchmark targets. */
export const ServiceSchema = z.object({
  id,
  name: z.string(),
  description: optional(z.string()),
  /** The service's own API path, e.g. "/v1/profile/summarize". */
  endpoint_path: z.string(),
  /** Offerings this service may call; undefined = the whole catalog. */
  allowed_offering_ids: optional(z.array(z.string())),
})

// ---- catalog: provider -> LLM ----------------------------------------------

export const PricesSchema = z.object({
  input_per_million: optional(z.number()),
  /** Input tokens served from the provider's prompt cache. */
  cached_input_per_million: optional(z.number()),
  output_per_million: optional(z.number()),
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
  regions: optional(z.array(z.string())),
})

export const LlmSchema = z.object({
  id,
  name: z.string(),
  /** Who made the model (the color key across charts). */
  organization: z.string(),
  family: optional(z.string()),
  open_weights: z._default(z.boolean(), false),
  context_window: optional(z.number()),
  max_output_tokens: optional(z.number()),
  released: optional(z.string()),
})

export const ProviderKindSchema = z.enum(['first_party', 'cloud', 'inference_host'])

export const ProviderSchema = z.object({
  id,
  name: z.string(),
  kind: ProviderKindSchema,
  description: optional(z.string()),
  console_url: optional(z.string()),
})

export const OfferingStatusSchema = z.enum(['available', 'degraded', 'unavailable'])

/** One LLM served by one provider: what a run targets and a leaderboard row ranks. */
export const OfferingSchema = z.object({
  id,
  provider_id: id,
  llm_id: id,
  /** The provider's deployment / model name. */
  deployment: z.string(),
  regions: list(z.string()),
  status: OfferingStatusSchema,
  prices: PricesSchema,
  capabilities: CapabilitiesSchema,
})

export const CatalogSchema = z.object({
  providers: z.array(ProviderSchema),
  llms: z.array(LlmSchema),
  offerings: z.array(OfferingSchema),
})

export const LoadProfileSchema = z.object({
  id,
  name: z.string(),
  description: optional(z.string()),
  /** Virtual users (BlazeMeter concurrency). */
  concurrency: z.number(),
  ramp_up_s: z.number(),
  /** Total, including ramp-up. */
  duration_s: z.number(),
  think_time_s: z._default(z.number(), 1),
})

// ---- runs ------------------------------------------------------------------

export const RunStatusSchema = z.enum(['queued', 'starting', 'running', 'collecting', 'completed', 'failed', 'cancelled'])
export const RoutingModeSchema = z.enum(['fixed', 'auto'])

/** Still in flight: worth polling. Mirrors ACTIVE_STATUSES in the backend. */
export const ACTIVE_STATUSES: readonly RunStatus[] = ['queued', 'starting', 'running', 'collecting']
export const isActive = (s: RunStatus) => ACTIVE_STATUSES.includes(s)

export const RunSchema = z.object({
  id,
  /** Runs started together (one per picked model) share a batch. */
  batch_id: z.string(),
  service_id: z.string(),
  label: optional(z.string()),
  routing: z.object({
    mode: RoutingModeSchema,
    offering_id: optional(z.string()),
    /** Auto routing: the offerings each request is randomly routed between. */
    pool: optional(z.array(z.string())),
  }),
  load: z.object({
    ...z.pick(LoadProfileSchema, { concurrency: true, ramp_up_s: true, duration_s: true, think_time_s: true }).shape,
    /** A preset's id, or "custom". */
    profile_id: z.string(),
    name: z.string(),
  }),
  status: RunStatusSchema,
  /** 0–100. */
  progress: z._default(z.number(), 0),
  created_at: z.string(),
  started_at: optional(z.string()),
  ended_at: optional(z.string()),
  updated_at: optional(z.string()),
  error: optional(z.string()),
  cancel_requested: z._default(z.boolean(), false),
  blazemeter: z._default(
    z.object({
      test_id: optional(z.number()),
      master_id: optional(z.number()),
      report_url: optional(z.string()),
      status: optional(z.string()),
    }),
    {},
  ),
  splunk: z._default(
    z.object({
      sid: optional(z.string()),
      search: optional(z.string()),
      search_url: optional(z.string()),
      events: optional(z.number()),
    }),
    {},
  ),
  /** The run's key numbers, once completed. */
  headline: optional(
    z.object({
      requests: optional(z.number()),
      error_rate: optional(z.number()),
      e2e_p95_ms: optional(z.number()),
      ttft_p50_ms: optional(z.number()),
      cost_per_1k: optional(z.number()),
    }),
  ),
})

// ---- results ---------------------------------------------------------------

const percentiles = z.object({ p50: optional(z.number()), p95: optional(z.number()), p99: optional(z.number()) })

/** Failed requests by cause (counts), from the service's own logs. */
export const ErrorBreakdownSchema = z.object({
  /** HTTP 429. */
  rate_limited: optional(z.number()),
  /** HTTP 5xx. */
  server_error: optional(z.number()),
  /** No complete response within the deadline. */
  timeout: optional(z.number()),
  /** The stream ended before the response finished. */
  dropped_stream: optional(z.number()),
  /** Refused by a content filter or safety policy. */
  refused: optional(z.number()),
  other: optional(z.number()),
})

/**
 * One run's performance. Volume, errors and `e2e_ms` are client-side (BlazeMeter);
 * TTFT, tokens and error causes are server-side (Splunk). Every field is optional.
 */
export const PerfSchema = z.object({
  requests: optional(z.number()),
  errors: optional(z.number()),
  success_rate: optional(z.number()),
  error_breakdown: optional(ErrorBreakdownSchema),
  /** Responses cut off by the output limit (finish_reason = length). */
  truncation_rate: optional(z.number()),
  ttft_ms: optional(percentiles),
  /** Median TTFT per prompt-size bucket: how latency grows with long context. */
  ttft_by_input: list(z.object({ input_tokens: z.number(), p50_ms: z.number() })),
  /** Inter-token latency while streaming. */
  itl_ms: optional(percentiles),
  /** Streams with a gap between tokens longer than the stall threshold. */
  stall_rate: optional(z.number()),
  /** End-to-end as BlazeMeter measured it (includes the network). */
  e2e_ms: optional(percentiles),
  /** End-to-end as the service logged it. */
  server_e2e_ms: optional(percentiles),
  /** Client minus server: network, TLS, gateways. */
  client_overhead_ms: optional(percentiles),
  throughput_rps: optional(z.number()),
  tokens_per_min: optional(z.object({ avg: optional(z.number()), peak: optional(z.number()) })),
  decode_tps_p50: optional(z.number()),
  /** Input tokens per second before the first token. */
  prefill_tps: optional(z.number()),
  avg_input_tokens: optional(z.number()),
  avg_output_tokens: optional(z.number()),
})

export const CostSchema = z.object({
  ...PricesSchema.shape,
  /** List-price cost per request, from logged token counts. */
  per_request: optional(z.number()),
  per_1k_requests: optional(z.number()),
})

export const BlazeMeterResultsSchema = z.object({
  summary: z.object({
    hits: z.number(),
    failed: z.number(),
    error_rate: optional(z.number()),
    avg_ms: optional(z.number()),
    min_ms: optional(z.number()),
    max_ms: optional(z.number()),
    p50_ms: optional(z.number()),
    p90_ms: optional(z.number()),
    p95_ms: optional(z.number()),
    p99_ms: optional(z.number()),
    throughput_rps: optional(z.number()),
    duration_s: optional(z.number()),
    max_users: optional(z.number()),
    errors_by_code: z._default(z.record(z.string(), z.number()), {}),
  }),
  interval_s: optional(z.number()),
  timeline: list(
    z.object({
      t_s: z.number(),
      users: z.number(),
      hits: z.number(),
      errors: z.number(),
      avg_ms: optional(z.number()),
      p90_ms: optional(z.number()),
    }),
  ),
})

export const OfferingBreakdownSchema = z.object({
  offering_id: z.string(),
  provider_id: optional(z.string()),
  llm_id: optional(z.string()),
  /** Share of the run's requests, 0–1. */
  share: z.number(),
  perf: PerfSchema,
  cost: CostSchema,
})

export const RunResultsSchema = z.object({
  run_id: z.string(),
  blazemeter: BlazeMeterResultsSchema,
  splunk: z.object({
    events: z.number(),
    overall: PerfSchema,
    /** Per model. One entry for a fixed run; the routing mix for an auto run. */
    by_offering: z.array(OfferingBreakdownSchema),
  }),
  /** Merged view: what the leaderboard row shows. */
  perf: PerfSchema,
  cost: CostSchema,
})

// ---- leaderboard -----------------------------------------------------------

export const RecentRunSchema = z.object({
  run_id: z.string(),
  ended_at: optional(z.string()),
  e2e_p95_ms: optional(z.number()),
  ttft_p50_ms: optional(z.number()),
  error_rate: optional(z.number()),
})

/** One offering (provider × LLM) on its latest completed run, or the auto-routing row. */
export const LeaderboardRowSchema = z.object({
  /** The offering id, or "auto". */
  id,
  routing: RoutingModeSchema,
  /** The LLM's name, e.g. "Aurora 4". */
  name: z.string(),
  /** Compact name for chart labels. Defaults to `name`. */
  short_name: optional(z.string()),
  /** Who serves this row. A model offered by several providers appears once per provider. */
  provider: z.string(),
  provider_id: z.string(),
  /** The LLM's id, shared by every provider's row of the same model. */
  model_id: z.string(),
  organization: z.string(),
  open_weights: z._default(z.boolean(), false),
  status: optional(OfferingStatusSchema),
  run_id: z.string(),
  run_at: optional(z.string()),
  perf: PerfSchema,
  cost: CostSchema,
  capabilities: optional(CapabilitiesSchema),
  /** Auto row only: share of requests per offering. */
  routing_mix: optional(z.array(z.object({ offering_id: z.string(), share: z.number() }))),
  /** Newest first, including the run this row shows. */
  recent_runs: list(RecentRunSchema),
})

export const ProfileTabSchema = z.object({ ...LoadProfileSchema.shape, runs: z.number() })

/** How the rows were measured. Latency numbers are only comparable under the same conditions. */
export const RunConditionsSchema = z.object({
  started_at: optional(z.string()),
  ended_at: optional(z.string()),
  client_region: optional(z.string()),
  concurrency: list(z.number()),
  ramp_up_s: optional(z.number()),
  duration_s: optional(z.number()),
  think_time_s: optional(z.number()),
  streaming: optional(z.boolean()),
  stall_threshold_ms: optional(z.number()),
  timeout_ms: optional(z.number()),
  runs: z._default(z.number(), 0),
  notes: optional(z.string()),
})

export const ServiceLeaderboardSchema = z.object({
  service: ServiceSchema,
  /** Load profiles as tabs, with how many completed runs each has. */
  profiles: z.array(ProfileTabSchema),
  /** The profile these rows were measured under. */
  profile: optional(z.string()),
  rows: z.array(LeaderboardRowSchema),
  conditions: optional(RunConditionsSchema),
  updated_at: optional(z.string()),
})

export const ServiceListSchema = z.array(ServiceSchema)
export const LoadProfileListSchema = z.array(LoadProfileSchema)
export const RunListSchema = z.array(RunSchema)

/** POST /runs body. */
export interface RunCreate {
  service_id: string
  routing: { mode: 'fixed'; offering_ids: string[] } | { mode: 'auto'; pool?: string[] }
  load_profile_id?: string
  load?: { concurrency: number; ramp_up_s: number; duration_s: number; think_time_s: number }
  label?: string
}

export type Service = z.output<typeof ServiceSchema>
export type Prices = z.output<typeof PricesSchema>
export type Capabilities = z.output<typeof CapabilitiesSchema>
export type Llm = z.output<typeof LlmSchema>
export type Provider = z.output<typeof ProviderSchema>
export type ProviderKind = z.output<typeof ProviderKindSchema>
export type Offering = z.output<typeof OfferingSchema>
export type OfferingStatus = z.output<typeof OfferingStatusSchema>
export type Catalog = z.output<typeof CatalogSchema>
export type LoadProfile = z.output<typeof LoadProfileSchema>
export type RunStatus = z.output<typeof RunStatusSchema>
export type RoutingMode = z.output<typeof RoutingModeSchema>
export type Run = z.output<typeof RunSchema>
export type Perf = z.output<typeof PerfSchema>
export type Cost = z.output<typeof CostSchema>
export type ErrorBreakdown = z.output<typeof ErrorBreakdownSchema>
export type BlazeMeterResults = z.output<typeof BlazeMeterResultsSchema>
export type OfferingBreakdown = z.output<typeof OfferingBreakdownSchema>
export type RunResults = z.output<typeof RunResultsSchema>
export type RecentRun = z.output<typeof RecentRunSchema>
export type LeaderboardRow = z.output<typeof LeaderboardRowSchema>
export type ProfileTab = z.output<typeof ProfileTabSchema>
export type RunConditions = z.output<typeof RunConditionsSchema>
export type ServiceLeaderboard = z.output<typeof ServiceLeaderboardSchema>

/** What the backend sends (before normalization) — used by the mock and fixtures. */
export type ServiceLeaderboardPayload = z.input<typeof ServiceLeaderboardSchema>
export type RunPayload = z.input<typeof RunSchema>
export type RunResultsPayload = z.input<typeof RunResultsSchema>
