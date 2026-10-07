// The mock backend's state. It serves the same JSON files the fake services
// seed from (../../fake_data/seed), plus leaderboards snapshotted from the real
// API (fixtures/leaderboards.json, refreshed by `make snapshot-fixtures`).
// Runs started here progress on a wall clock and finish with a seeded run's
// results, so the whole flow works without the Python stack.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { RunPayload, RunResultsPayload, ServiceLeaderboardPayload } from '../src/api/types.ts'

const read = <T,>(rel: string): T => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')) as T
const seed = <T,>(name: string) => read<T>(`../../fake_data/seed/${name}.json`)

interface ServiceDoc {
  id: string
  name: string
  description?: string
  endpoint_path: string
  allowed_offering_ids: string[] | null
}
interface OfferingDoc {
  id: string
  status: string
}
interface LoadProfileDoc {
  id: string
  name: string
  concurrency: number
  ramp_up_s: number
  duration_s: number
  think_time_s: number
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail)
  }
}

/** How long a mock run takes in real time, per nominal second of load. */
const MS_PER_NOMINAL_S = 25
const STARTING_MS = 800
const COLLECTING_MS = 1200

interface Sim {
  run: RunPayload
  startMs: number
  durMs: number
  template: string
  cancelled: boolean
}

export function createWorld(now: () => number = Date.now) {
  const services = seed<ServiceDoc[]>('services')
  const providers = seed<unknown[]>('providers')
  const llms = seed<unknown[]>('llms')
  const offerings = seed<OfferingDoc[]>('offerings')
  const loadProfiles = seed<LoadProfileDoc[]>('load_profiles')
  const seedRuns = seed<RunPayload[]>('runs')
  const seedResults = new Map(seed<RunResultsPayload[]>('run_results').map((r) => [r.run_id, r]))
  const boards = read<Record<string, ServiceLeaderboardPayload>>('./fixtures/leaderboards.json')
  const sims: Sim[] = []

  const usable = (s: ServiceDoc) =>
    (s.allowed_offering_ids ?? offerings.map((o) => o.id)).filter((id) => offerings.find((o) => o.id === id)?.status !== 'unavailable')

  /** A sim's run as of now. */
  function view(sim: Sim): RunPayload {
    const t = now() - sim.startMs
    const r = sim.run
    const iso = (ms: number) => new Date(ms).toISOString()
    if (sim.cancelled && t < 0) return { ...r, status: 'cancelled', cancel_requested: true, ended_at: iso(sim.startMs) }
    if (t < 0) return { ...r, status: 'queued', progress: 0 }
    const started = { ...r, started_at: iso(sim.startMs) }
    if (t < STARTING_MS) return { ...started, status: 'starting', progress: 1 }
    const bm = { test_id: 1000 + sims.indexOf(sim), master_id: 2000 + sims.indexOf(sim), report_url: null, status: 'RUNNING' }
    if (t < STARTING_MS + sim.durMs)
      return { ...started, status: 'running', blazemeter: bm, progress: Math.max(2, Math.round(((t - STARTING_MS) / sim.durMs) * 90)) }
    if (t < STARTING_MS + sim.durMs + COLLECTING_MS) return { ...started, status: 'collecting', blazemeter: { ...bm, status: 'ENDED' }, progress: 92 }
    const res = results(r.id)!
    const p = res.perf
    return {
      ...started,
      status: sim.cancelled ? 'cancelled' : 'completed',
      progress: 100,
      ended_at: iso(sim.startMs + STARTING_MS + sim.durMs + COLLECTING_MS),
      blazemeter: { ...bm, status: 'ENDED' },
      splunk: { sid: `mock_${r.id}`, search: `search index=llm_api run_id=${r.id}`, search_url: null, events: res.splunk.events },
      headline: {
        requests: p.requests,
        error_rate: p.success_rate == null ? null : 1 - p.success_rate,
        e2e_p95_ms: p.e2e_ms?.p95,
        ttft_p50_ms: p.ttft_ms?.p50,
        cost_per_1k: res.cost.per_1k_requests,
      },
    }
  }

  function allRuns(): RunPayload[] {
    return [...seedRuns, ...sims.map(view)].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
  }

  function results(id: string): RunResultsPayload | undefined {
    const sim = sims.find((s) => s.run.id === id)
    if (!sim) return seedResults.get(id)
    const template = seedResults.get(sim.template)
    return template && { ...template, run_id: id }
  }

  /** A seeded run whose results stand in for a mock run: same service and routing, same model when possible. */
  function templateFor(serviceId: string, routing: RunPayload['routing']): string {
    const same = seedRuns.filter((r) => r.service_id === serviceId && r.routing.mode === routing.mode)
    const exact = same.find((r) => r.routing.offering_id === routing.offering_id)
    return (exact ?? same[0] ?? seedRuns[0]).id
  }

  return {
    services: () => services,
    service: (id: string) => services.find((s) => s.id === id),
    catalog: () => ({ providers, llms, offerings }),
    loadProfiles: () => loadProfiles,

    leaderboard(serviceId: string, profile?: string): ServiceLeaderboardPayload | undefined {
      const board = (profile && boards[`${serviceId}:${profile}`]) || boards[serviceId]
      if (!board || !profile || board.profile === profile) return board
      return { ...board, profile, rows: [], conditions: null } // e.g. "custom": nothing snapshotted
    },

    runs({ service_id, status, limit }: { service_id?: string; status?: string[]; limit?: number }) {
      return allRuns()
        .filter((r) => (!service_id || r.service_id === service_id) && (!status?.length || status.includes(r.status)))
        .slice(0, limit ?? 100)
    },

    run: (id: string) => allRuns().find((r) => r.id === id),
    results,

    createRuns(body: {
      service_id?: string
      routing?: { mode?: string; offering_ids?: string[]; pool?: string[] }
      load_profile_id?: string
      load?: { concurrency: number; ramp_up_s: number; duration_s: number; think_time_s?: number }
      label?: string
    }): RunPayload[] {
      const service = services.find((s) => s.id === body.service_id)
      if (!service) throw new HttpError(404, 'Unknown service')
      const ok = usable(service)
      let load: RunPayload['load']
      if (body.load_profile_id) {
        const p = loadProfiles.find((x) => x.id === body.load_profile_id)
        if (!p) throw new HttpError(422, `Unknown load profile '${body.load_profile_id}'`)
        load = { concurrency: p.concurrency, ramp_up_s: p.ramp_up_s, duration_s: p.duration_s, think_time_s: p.think_time_s, profile_id: p.id, name: p.name }
      } else if (body.load) {
        load = { think_time_s: 1, ...body.load, profile_id: 'custom', name: 'Custom' }
      } else throw new HttpError(422, 'Give load_profile_id or load')

      let routings: RunPayload['routing'][]
      if (body.routing?.mode === 'fixed') {
        const ids = [...new Set(body.routing.offering_ids ?? [])]
        if (!ids.length) throw new HttpError(422, 'Pick at least one model')
        const bad = ids.filter((id) => !ok.includes(id))
        if (bad.length) throw new HttpError(422, `Not available for this service: ${bad.join(', ')}`)
        routings = ids.map((id) => ({ mode: 'fixed', offering_id: id, pool: null }))
      } else {
        const pool = [...new Set(body.routing?.pool?.length ? body.routing.pool : ok)]
        const bad = pool.filter((id) => !ok.includes(id))
        if (bad.length) throw new HttpError(422, `Not available for this service: ${bad.join(', ')}`)
        if (pool.length < 2) throw new HttpError(422, 'Auto routing needs at least two models in the pool')
        routings = [{ mode: 'auto', offering_id: null, pool }]
      }

      const batch = `b_mock${sims.length}`
      // Runs on one service queue up: each starts after the previous one ends.
      let start = Math.max(
        now() + 600,
        ...sims.filter((s) => s.run.service_id === service.id).map((s) => s.startMs + STARTING_MS + s.durMs + COLLECTING_MS + 200),
      )
      const durMs = Math.min(15_000, Math.max(4_000, load.duration_s * MS_PER_NOMINAL_S))
      return routings.map((routing) => {
        const run: RunPayload = {
          id: `r_mock${String(sims.length).padStart(4, '0')}`,
          batch_id: batch,
          service_id: service.id,
          label: body.label ?? null,
          routing,
          load,
          status: 'queued',
          progress: 0,
          created_at: new Date(now()).toISOString(),
          cancel_requested: false,
          blazemeter: {},
          splunk: {},
          headline: null,
        }
        const sim: Sim = { run, startMs: start, durMs, template: templateFor(service.id, routing), cancelled: false }
        sims.push(sim)
        start += STARTING_MS + durMs + COLLECTING_MS + 200
        return view(sim)
      })
    },

    cancel(id: string): RunPayload | undefined {
      const sim = sims.find((s) => s.run.id === id)
      if (!sim) return seedRuns.find((r) => r.id === id) // already finished
      const t = now() - sim.startMs
      if (t < STARTING_MS + sim.durMs) {
        sim.cancelled = true
        if (t > STARTING_MS) sim.durMs = t - STARTING_MS // stop the load now; keep partial results
        sim.run = { ...sim.run, cancel_requested: true }
      }
      return view(sim)
    },
  }
}

export type MockWorld = ReturnType<typeof createWorld>
