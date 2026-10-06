// Deterministic, fictional benchmark data for local development.
// Organization, provider and model names are invented; numbers are random.
import type { AppSummaryPayload, Category, LeaderboardPayload, ModelEntry, RunConditions } from '../src/api/types.ts'

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const round1 = (n: number) => Math.round(n * 10) / 10
const round4 = (n: number) => +n.toFixed(4)
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

interface CategorySpec {
  name: string
  short_name?: string
  abbr: string
  difficulty: number
  costFactor: number
  subtasks: string[]
}

interface AppSpec extends AppSummaryPayload {
  seed: number
  categories: CategorySpec[]
  /** Requests sent to every deployment in the run. */
  requests: number
  profiles: NonNullable<RunConditions['profiles']>
}

const APPS: AppSpec[] = [
  {
    id: 'chat-completions',
    name: 'Chat Completions API',
    description: 'General-purpose assistant traffic: reasoning, code, math, analysis and writing.',
    updated_at: '2026-09-24T12:00:00Z',
    seed: 11,
    requests: 5000,
    profiles: [
      { name: 'Short chat', input_tokens: 800, output_tokens: 350, share: 0.5 },
      { name: 'Long-context RAG', input_tokens: 24_000, output_tokens: 500, share: 0.3 },
      { name: 'Long generation', input_tokens: 1500, output_tokens: 3500, share: 0.2 },
    ],
    categories: [
      { name: 'Reasoning', abbr: 'Rsn', difficulty: 2, costFactor: 1.1, subtasks: ['Logic puzzles', 'Spatial', 'Zebra puzzles', 'Theory of mind'] },
      { name: 'Coding', abbr: 'Cod', difficulty: 4, costFactor: 1.2, subtasks: ['Code generation', 'Code completion', 'Bug fixing'] },
      { name: 'Agentic Coding', abbr: 'Agt', difficulty: 22, costFactor: 3.5, subtasks: ['Repo tasks', 'Terminal tasks'] },
      { name: 'Mathematics', abbr: 'Mth', difficulty: -6, costFactor: 1.4, subtasks: ['Competition', 'Olympiad', 'Proof checking'] },
      { name: 'Data Analysis', abbr: 'Dat', difficulty: 6, costFactor: 0.8, subtasks: ['Table joins', 'Table reformat', 'Column typing'] },
      { name: 'Language', abbr: 'Lng', difficulty: 3, costFactor: 0.6, subtasks: ['Connections', 'Typo fixing', 'Plot unscrambling'] },
      { name: 'Instruction Following', short_name: 'IF', abbr: 'IF', difficulty: 12, costFactor: 0.5, subtasks: ['Format constraints', 'Multi-turn', 'Summarize'] },
    ],
  },
  {
    id: 'code-assist',
    name: 'Code Assist API',
    description: 'IDE completions, code review and autonomous repository edits.',
    updated_at: '2026-09-21T08:30:00Z',
    seed: 29,
    requests: 3000,
    profiles: [
      { name: 'Inline completion', input_tokens: 2000, output_tokens: 120, share: 0.6 },
      { name: 'Code review', input_tokens: 6000, output_tokens: 900, share: 0.25 },
      { name: 'Repository edit', input_tokens: 40_000, output_tokens: 2500, share: 0.15 },
    ],
    categories: [
      { name: 'Completion', abbr: 'Cmp', difficulty: 0, costFactor: 0.4, subtasks: ['Single line', 'Multi line', 'Fill in middle'] },
      { name: 'Code Review', abbr: 'Rev', difficulty: 8, costFactor: 1, subtasks: ['Bug detection', 'Style issues', 'Security'] },
      { name: 'Repo Edits', abbr: 'Rep', difficulty: 18, costFactor: 3, subtasks: ['Refactors', 'Feature work', 'Migrations'] },
      { name: 'Test Writing', abbr: 'Tst', difficulty: 6, costFactor: 1.2, subtasks: ['Unit tests', 'Property tests'] },
      { name: 'Explanation', abbr: 'Exp', difficulty: -4, costFactor: 0.6, subtasks: ['Docstrings', 'Walkthroughs'] },
    ],
  },
  {
    id: 'doc-extract',
    name: 'Document Extraction API',
    description: 'Structured extraction from invoices, contracts and forms.',
    updated_at: '2026-09-18T16:45:00Z',
    seed: 47,
    requests: 2000,
    profiles: [
      { name: 'Invoice', input_tokens: 3000, output_tokens: 400, share: 0.5 },
      { name: 'Contract', input_tokens: 60_000, output_tokens: 1200, share: 0.35 },
      { name: 'Form', input_tokens: 1500, output_tokens: 300, share: 0.15 },
    ],
    categories: [
      { name: 'Field Extraction', abbr: 'Fld', difficulty: -2, costFactor: 0.7, subtasks: ['Invoices', 'Receipts', 'IDs'] },
      { name: 'Table Parsing', abbr: 'Tbl', difficulty: 7, costFactor: 1, subtasks: ['Simple tables', 'Nested tables'] },
      { name: 'Schema Adherence', abbr: 'Sch', difficulty: 4, costFactor: 0.5, subtasks: ['JSON schema', 'Enums'] },
      { name: 'Long Documents', abbr: 'Lng', difficulty: 14, costFactor: 2.2, subtasks: ['Contracts', 'Filings'] },
    ],
  },
]

interface OrgSpec {
  name: string
  families: string[]
  open: boolean
  skill: number
  price: number
  /** Output tokens per 1K characters: tokenizers differ by vendor. */
  tokenizer: number
  vision: boolean
}

const ORGS: OrgSpec[] = [
  { name: 'Aurora Labs', families: ['Aurora'], open: false, skill: 8, price: 1.4, tokenizer: 236, vision: true },
  { name: 'Northwind AI', families: ['Gale', 'Zephyr'], open: false, skill: 7, price: 1.1, tokenizer: 251, vision: true },
  { name: 'Helix Research', families: ['Helix'], open: false, skill: 6, price: 1, tokenizer: 244, vision: true },
  { name: 'Kestrel', families: ['Kestrel'], open: false, skill: 3, price: 0.7, tokenizer: 262, vision: false },
  { name: 'OpenForge', families: ['Forge'], open: true, skill: 4, price: 0.2, tokenizer: 271, vision: false },
  { name: 'Lumen', families: ['Lumen'], open: false, skill: 2, price: 0.6, tokenizer: 248, vision: true },
  { name: 'Quanta', families: ['Quanta'], open: true, skill: 1, price: 0.3, tokenizer: 283, vision: false },
  { name: 'Tidal', families: ['Tide'], open: false, skill: 0, price: 0.9, tokenizer: 255, vision: false },
  { name: 'Cobalt', families: ['Cobalt'], open: true, skill: -1, price: 0.15, tokenizer: 290, vision: false },
  { name: 'Meridian', families: ['Meridian'], open: true, skill: -3, price: 0.25, tokenizer: 277, vision: false },
]

/** How a serving provider shifts a model's numbers relative to its maker's own API. */
interface ProviderSpec {
  name: string
  speed: number
  price: number
  /** Added to success rate. */
  reliability: number
  /** Added to every score (e.g. quantization loss). */
  quality: number
  stall: number
  /** Typical (billed − counted) / counted output tokens. */
  drift: number
  caching: boolean
  batch: boolean
  regions: string[]
  /** Context window cap, if the provider serves a shorter one. */
  maxContext?: number
}

const THIRD_PARTY: ProviderSpec[] = [
  { name: 'Swiftserve', speed: 1.4, price: 0.85, reliability: -0.008, quality: -0.6, stall: 1.6, drift: 0.004, caching: false, batch: false, regions: ['us', 'eu'] },
  { name: 'Cloudhaven', speed: 0.95, price: 1.1, reliability: 0.004, quality: 0, stall: 0.7, drift: 0, caching: true, batch: true, regions: ['us', 'eu', 'apac'] },
  {
    name: 'Relay Compute',
    speed: 0.8,
    price: 0.65,
    reliability: -0.015,
    quality: -1.5,
    stall: 2.4,
    drift: 0.02,
    caching: false,
    batch: true,
    regions: ['us'],
    maxContext: 131_072,
  },
]

const firstParty = (org: OrgSpec): ProviderSpec => ({
  name: org.name,
  speed: 1,
  price: 1,
  reliability: 0,
  quality: 0,
  stall: 1,
  drift: 0,
  caching: true,
  batch: !org.open,
  regions: ['us', 'eu'],
})

const TIERS = [
  { name: 'Ultra', skill: 6, price: 4, speed: 0.6, context: 400_000, maxOutput: 128_000 },
  { name: 'Pro', skill: 3, price: 1.8, speed: 0.8, context: 256_000, maxOutput: 64_000 },
  { name: '', skill: 0, price: 1, speed: 1, context: 200_000, maxOutput: 64_000 },
  { name: 'Flash', skill: -3, price: 0.25, speed: 1.8, context: 1_000_000, maxOutput: 32_000 },
  { name: 'Mini', skill: -7, price: 0.12, speed: 2.4, context: 128_000, maxOutput: 16_000 },
]

const EFFORTS = [
  { name: 'Max Effort', variant: 'max', skill: 3, tokens: 2.4, reasoning: 0.55 },
  { name: 'xHigh Effort', variant: 'xhigh', skill: 2, tokens: 1.7, reasoning: 0.45 },
  { name: 'High Effort', variant: 'high', skill: 1, tokens: 1.2, reasoning: 0.3 },
  { name: 'Low Effort', variant: 'low', skill: -3, tokens: 0.5, reasoning: 0.08 },
]

const TTFT_PROMPT_SIZES = [1_000, 8_000, 32_000, 128_000]

function buildLeaderboard(spec: AppSpec): LeaderboardPayload {
  const rand = mulberry32(spec.seed)
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]
  const noise = (amp: number) => (rand() * 2 - 1) * amp

  const categories: Category[] = spec.categories.map((c) => ({
    id: slug(c.name),
    name: c.name,
    short_name: c.short_name,
    abbr: c.abbr,
    subtasks: c.subtasks.map((s) => ({ id: `${slug(c.name)}.${slug(s)}`, name: s.toLowerCase() })),
  }))

  const models: ModelEntry[] = []
  const seen = new Set<string>()

  const addModel = (org: OrgSpec, opts: { finetune?: { base: ModelEntry; suffix: string; org: string } } = {}) => {
    const family = pick(org.families)
    const version = pick(['3', '3.5', '4', '4.1', '4.5', '5'])
    const tier = pick(TIERS)
    const effort = pick(EFFORTS)
    const shortName = opts.finetune
      ? `${opts.finetune.base.short_name} ${opts.finetune.suffix}`
      : [family, version, tier.name].filter(Boolean).join(' ')
    const name = opts.finetune ? shortName : `${shortName} ${effort.name}`
    if (seen.has(name)) return
    seen.add(name)
    const modelId = slug(name)

    // The model's own ability, before any provider effect.
    const versionBoost = (parseFloat(version) - 4) * 4
    const ability = 76 + org.skill + tier.skill + effort.skill + versionBoost + noise(4)
    const baseSubs = new Map<string, number>()
    spec.categories.forEach((c, i) => {
      const catAbility = ability - c.difficulty + noise(5) + (opts.finetune ? noise(6) : 0)
      for (const s of categories[i].subtasks) baseSubs.set(s.id, catAbility + noise(8))
    })
    const baseOutputPrice = clamp(org.price * tier.price * 12 * (0.8 + rand() * 0.4), 0.3, 90)
    const baseTokens = 1800 * effort.tokens * (0.7 + rand() * 0.6)
    const reasoningShare = tier.name === 'Mini' ? effort.reasoning * 0.5 : effort.reasoning

    // Who serves it: the maker, plus third parties (more often for open weights).
    // Finetunes are served only by whoever made them, and weren't load-tested.
    const providers: ProviderSpec[] = opts.finetune
      ? [{ ...firstParty(org), name: opts.finetune.org, batch: false }]
      : [firstParty(org), ...THIRD_PARTY.filter((p) => (org.open ? rand() < 0.6 : p.name === 'Cloudhaven' && rand() < 0.45))]

    for (const prov of providers) {
      const shift = prov.quality + noise(0.5)
      const catScores: Record<string, number> = {}
      const subScores: Record<string, number> = {}
      const catCost: Record<string, number> = {}
      const outputPrice = round1(clamp(baseOutputPrice * prov.price, 0.3, 90))
      const tokens = Math.round(baseTokens * (0.97 + rand() * 0.06))
      const baseTaskCost = ((tokens * outputPrice) / 1e6) * 4

      spec.categories.forEach((c, i) => {
        const cat = categories[i]
        const subs = cat.subtasks.map((s) => {
          const v = round1(clamp(baseSubs.get(s.id)! + shift, 5, 99.5))
          subScores[s.id] = v
          return v
        })
        const avg = round1(subs.reduce((a, b) => a + b, 0) / subs.length)
        catScores[cat.id] = avg
        catCost[cat.id] = round4((baseTaskCost * c.costFactor) / Math.max(avg / 100, 0.05))
      })
      const overall = round1(Object.values(catScores).reduce((a, b) => a + b, 0) / categories.length)
      const inputPrice = round1(Math.max(0.05, outputPrice * (0.2 + rand() * 0.1)))
      const context = Math.min(tier.context, prov.maxContext ?? Infinity)

      const perf = opts.finetune
        ? undefined
        : (() => {
            const speed = tier.speed * prov.speed
            const decode = round1(95 * speed * (0.75 + rand() * 0.5))
            const ttft = Math.round((180 + 700 / speed) * (0.6 + effort.tokens * 0.3) * (0.8 + rand() * 0.4))
            const e2e = Math.round(ttft + (tokens / decode) * 1000)
            const overhead = Math.round(4 + rand() * 30)
            const p95 = (v: number) => Math.round(v * (1.6 + rand() * 1.4))
            const p99 = (v95: number) => Math.round(v95 * (1.2 + rand() * 0.5 * prov.stall))
            const ttft95 = p95(ttft)
            const e2e95 = p95(e2e)
            const itl = round1(1000 / decode)
            const itl95 = round1(itl * (1.6 + rand() * 1.2) * Math.sqrt(prov.stall))
            const prefill = Math.round(6000 * speed * (0.7 + rand() * 0.6))

            const requests = spec.requests
            const successRate = round4(clamp(0.975 + rand() * 0.0235 + prov.reliability, 0.9, 0.9995))
            const errors = Math.round(requests * (1 - successRate))
            // Split errors by cause; rounding leftovers go to rate limiting.
            const weights = {
              rate_limited: 0.3 + rand() * 0.4,
              server_error: 0.1 + rand() * 0.2,
              timeout: 0.05 + rand() * 0.15,
              dropped_stream: (0.02 + rand() * 0.1) * prov.stall,
              refused: 0.02 + rand() * 0.08,
              other: 0.02,
            }
            const wSum = Object.values(weights).reduce((a, b) => a + b, 0)
            const breakdown = Object.fromEntries(Object.entries(weights).map(([k, w]) => [k, Math.floor((errors * w) / wSum)])) as Record<
              keyof typeof weights,
              number
            >
            breakdown.rate_limited += errors - Object.values(breakdown).reduce((a, b) => a + b, 0)
            // Retries recover most transient failures; refusals and "other" don't go away.
            const unrecoverable = breakdown.refused + breakdown.other + 0.15 * (errors - breakdown.refused - breakdown.other)
            const throughput = round1(Math.min(80, speed * 12 * (0.6 + rand() * 0.8)))
            const tpm = Math.round(throughput * 60 * tokens)

            return {
              requests,
              success_rate: successRate,
              success_after_retry: round4(1 - unrecoverable / requests),
              errors,
              error_breakdown: breakdown,
              truncation_rate: round4(0.002 + rand() * 0.01 * effort.tokens),
              ttft_ms: { p50: ttft, p95: ttft95, p99: p99(ttft95) },
              ttft_by_input: TTFT_PROMPT_SIZES.filter((n) => n <= context).map((n) => ({
                input_tokens: n,
                p50_ms: Math.round(ttft * 0.85 + (n / prefill) * 1000),
              })),
              itl_ms: { p50: itl, p95: itl95, p99: round1(itl95 * (1.3 + rand() * 0.6)) },
              stall_rate: round4(clamp((0.002 + rand() * 0.02) * prov.stall, 0, 0.2)),
              e2e_ms: { p50: e2e, p95: e2e95, p99: p99(e2e95) },
              client_overhead_ms: { p50: overhead, p95: p95(overhead) },
              throughput_rps: throughput,
              tokens_per_min: { avg: tpm, peak: Math.round(tpm * (1.3 + rand() * 0.7)) },
              decode_tps_p50: decode,
              prefill_tps: prefill,
            }
          })()

      models.push({
        id: `${modelId}--${slug(prov.name)}`,
        model_id: modelId,
        name,
        short_name: shortName,
        variant: opts.finetune ? undefined : effort.variant,
        provider: prov.name,
        organization: opts.finetune?.org ?? org.name,
        open_weights: opts.finetune ? true : org.open,
        finetune: !!opts.finetune,
        base_model: opts.finetune?.base.name,
        overall,
        categories: catScores,
        subtasks: subScores,
        cost: {
          per_success: { overall: round4(baseTaskCost / Math.max(overall / 100, 0.05)), categories: catCost },
          input_per_million: inputPrice,
          cached_input_per_million: prov.caching ? round1(Math.max(0.01, inputPrice * (0.1 + rand() * 0.15))) : undefined,
          output_per_million: outputPrice,
          avg_output_tokens: tokens,
          avg_reasoning_tokens: Math.round(tokens * reasoningShare * (0.85 + rand() * 0.3)),
          tokens_per_1k_chars: Math.round(org.tokenizer * (0.97 + rand() * 0.06)),
          billing_drift: round4(prov.drift + noise(0.003)),
        },
        perf,
        capabilities: {
          context_window: context,
          max_output_tokens: tier.maxOutput,
          streaming: true,
          tool_calling: tier.name !== 'Mini' || rand() > 0.3,
          json_mode: prov.name !== 'Relay Compute',
          vision: org.vision && !opts.finetune,
          prompt_caching: prov.caching,
          batch_api: prov.batch,
          regions: prov.regions,
        },
      })
    }
  }

  for (const org of ORGS) {
    const count = 3 + Math.floor(rand() * 4)
    for (let i = 0; i < count; i++) addModel(org)
  }

  // Bases are first-party rows of open-weights models.
  const openBases = models.filter((m) => m.open_weights && m.provider === m.organization)
  for (const suffix of ['Instruct-FT', 'Coder-FT', 'Reasoner-FT', 'Chat-FT']) {
    const base = pick(openBases)
    addModel(ORGS.find((o) => o.name === base.organization)!, {
      finetune: { base, suffix, org: pick(['Community', 'Stackwise', 'Riverbend Research']) },
    })
  }

  models.sort((a, b) => b.overall - a.overall)
  const { seed: _seed, categories: _cats, requests, profiles, ...app } = spec
  const ended = new Date(spec.updated_at!)
  const run: RunConditions = {
    started_at: new Date(ended.getTime() - 2 * 86_400_000).toISOString(),
    ended_at: ended.toISOString(),
    client_region: 'us-east (Virginia)',
    network_rtt_ms: 14,
    concurrency: [1, 8, 32],
    streaming: true,
    stall_threshold_ms: 1000,
    timeout_ms: 120_000,
    retry_policy: 'Up to 3 retries, exponential backoff, honors Retry-After; 4xx other than 429 not retried',
    requests_per_model: requests,
    profiles,
    notes: 'Fictional data generated for local development.',
  }
  return { app, categories, models, run }
}

export const mockApps: AppSummaryPayload[] = APPS.map(({ seed: _seed, categories: _cats, requests: _r, profiles: _p, ...app }) => app)

const cache = new Map<string, LeaderboardPayload>()

export function mockLeaderboard(appId: string): LeaderboardPayload | undefined {
  const spec = APPS.find((a) => a.id === appId)
  if (!spec) return undefined
  if (!cache.has(appId)) cache.set(appId, buildLeaderboard(spec))
  return cache.get(appId)
}
