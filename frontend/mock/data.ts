// Deterministic, fictional benchmark data for local development.
// Organization and model names are invented; numbers are random.
import type { AppSummaryPayload, Category, LeaderboardPayload, ModelEntry } from '../src/api/types.ts'

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
}

const APPS: AppSpec[] = [
  {
    id: 'chat-completions',
    name: 'Chat Completions API',
    description: 'General-purpose assistant traffic: reasoning, code, math, analysis and writing.',
    updated_at: '2026-09-24T12:00:00Z',
    seed: 11,
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
}

const ORGS: OrgSpec[] = [
  { name: 'Aurora Labs', families: ['Aurora'], open: false, skill: 8, price: 1.4 },
  { name: 'Northwind AI', families: ['Gale', 'Zephyr'], open: false, skill: 7, price: 1.1 },
  { name: 'Helix Research', families: ['Helix'], open: false, skill: 6, price: 1 },
  { name: 'Kestrel', families: ['Kestrel'], open: false, skill: 3, price: 0.7 },
  { name: 'OpenForge', families: ['Forge'], open: true, skill: 4, price: 0.2 },
  { name: 'Lumen', families: ['Lumen'], open: false, skill: 2, price: 0.6 },
  { name: 'Quanta', families: ['Quanta'], open: true, skill: 1, price: 0.3 },
  { name: 'Tidal', families: ['Tide'], open: false, skill: 0, price: 0.9 },
  { name: 'Cobalt', families: ['Cobalt'], open: true, skill: -1, price: 0.15 },
  { name: 'Meridian', families: ['Meridian'], open: true, skill: -3, price: 0.25 },
]

const TIERS = [
  { name: 'Ultra', skill: 6, price: 4, speed: 0.6 },
  { name: 'Pro', skill: 3, price: 1.8, speed: 0.8 },
  { name: '', skill: 0, price: 1, speed: 1 },
  { name: 'Flash', skill: -3, price: 0.25, speed: 1.8 },
  { name: 'Mini', skill: -7, price: 0.12, speed: 2.4 },
]

const EFFORTS = [
  { name: 'Max Effort', variant: 'max', skill: 3, tokens: 2.4 },
  { name: 'xHigh Effort', variant: 'xhigh', skill: 2, tokens: 1.7 },
  { name: 'High Effort', variant: 'high', skill: 1, tokens: 1.2 },
  { name: 'Low Effort', variant: 'low', skill: -3, tokens: 0.5 },
]

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

    const versionBoost = (parseFloat(version) - 4) * 4
    const ability = 76 + org.skill + tier.skill + effort.skill + versionBoost + noise(4)
    const catScores: Record<string, number> = {}
    const subScores: Record<string, number> = {}
    const catCost: Record<string, number> = {}

    const outputPrice = round1(clamp(org.price * tier.price * 12 * (0.8 + rand() * 0.4), 0.3, 90))
    const tokens = Math.round(1800 * effort.tokens * (0.7 + rand() * 0.6))
    const baseTaskCost = ((tokens * outputPrice) / 1e6) * 4

    spec.categories.forEach((c, i) => {
      const cat = categories[i]
      const catAbility = ability - c.difficulty + noise(5) + (opts.finetune ? noise(6) : 0)
      const subs = cat.subtasks.map((s) => {
        const v = round1(clamp(catAbility + noise(8), 5, 99.5))
        subScores[s.id] = v
        return v
      })
      const avg = round1(subs.reduce((a, b) => a + b, 0) / subs.length)
      catScores[cat.id] = avg
      catCost[cat.id] = +((baseTaskCost * c.costFactor) / Math.max(avg / 100, 0.05)).toFixed(4)
    })

    const overall = round1(Object.values(catScores).reduce((a, b) => a + b, 0) / categories.length)

    // Client-side load-test numbers. Faster tiers decode quicker; more effort means
    // more output tokens, so longer end-to-end latency. Finetunes weren't load-tested.
    const perf = opts.finetune
      ? undefined
      : (() => {
          const decode = round1(95 * tier.speed * (0.75 + rand() * 0.5))
          const ttft = Math.round((180 + 700 / tier.speed) * (0.6 + effort.tokens * 0.3) * (0.8 + rand() * 0.4))
          const e2e = Math.round(ttft + (tokens / decode) * 1000)
          const overhead = Math.round(4 + rand() * 30)
          const p95 = (v: number) => Math.round(v * (1.6 + rand() * 1.4))
          const requests = 2000 + Math.round(rand() * 36) * 500
          const successRate = +(0.97 + rand() * 0.0295).toFixed(4)
          const throughput = round1(Math.min(80, tier.speed * 12 * (0.6 + rand() * 0.8)))
          const tpm = Math.round(throughput * 60 * tokens)
          return {
            requests,
            success_rate: successRate,
            errors: Math.round(requests * (1 - successRate)),
            ttft_ms: { p50: ttft, p95: p95(ttft) },
            e2e_ms: { p50: e2e, p95: p95(e2e) },
            client_overhead_ms: { p50: overhead, p95: p95(overhead) },
            throughput_rps: throughput,
            tokens_per_min: { avg: tpm, peak: Math.round(tpm * (1.3 + rand() * 0.7)) },
            decode_tps_p50: decode,
          }
        })()

    models.push({
      id: slug(name),
      name,
      short_name: shortName,
      variant: opts.finetune ? undefined : effort.variant,
      organization: opts.finetune?.org ?? org.name,
      open_weights: opts.finetune ? true : org.open,
      finetune: !!opts.finetune,
      base_model: opts.finetune?.base.name,
      overall,
      categories: catScores,
      subtasks: subScores,
      cost: {
        per_success: { overall: +(baseTaskCost / Math.max(overall / 100, 0.05)).toFixed(4), categories: catCost },
        output_per_million: outputPrice,
        avg_output_tokens: tokens,
      },
      perf,
    })
  }

  for (const org of ORGS) {
    const count = 3 + Math.floor(rand() * 4)
    for (let i = 0; i < count; i++) addModel(org)
  }

  const openBases = models.filter((m) => m.open_weights)
  for (const suffix of ['Instruct-FT', 'Coder-FT', 'Reasoner-FT', 'Chat-FT']) {
    const base = pick(openBases)
    addModel(ORGS.find((o) => o.name === base.organization)!, {
      finetune: { base, suffix, org: pick(['Community', 'Stackwise', 'Riverbend Research']) },
    })
  }

  models.sort((a, b) => b.overall - a.overall)
  const { seed: _seed, categories: _cats, ...app } = spec
  return { app, categories, models }
}

export const mockApps: AppSummaryPayload[] = APPS.map(({ seed: _seed, categories: _cats, ...app }) => app)

const cache = new Map<string, LeaderboardPayload>()

export function mockLeaderboard(appId: string): LeaderboardPayload | undefined {
  const spec = APPS.find((a) => a.id === appId)
  if (!spec) return undefined
  if (!cache.has(appId)) cache.set(appId, buildLeaderboard(spec))
  return cache.get(appId)
}
