import type { Catalog, LeaderboardRow, Run, ServiceLeaderboard } from '../api/types'

export function row(partial: Partial<LeaderboardRow> & { id: string }): LeaderboardRow {
  return {
    routing: 'fixed',
    name: partial.id,
    provider: 'Prov',
    provider_id: 'prov',
    model_id: partial.id,
    organization: 'Org',
    open_weights: false,
    run_id: `run-${partial.id}`,
    perf: { ttft_by_input: [] },
    cost: {},
    recent_runs: [],
    ...partial,
  }
}

export const PROFILES: ServiceLeaderboard['profiles'] = [
  { id: 'smoke', name: 'Smoke', concurrency: 5, ramp_up_s: 10, duration_s: 60, think_time_s: 1, runs: 2 },
  { id: 'baseline', name: 'Baseline', concurrency: 20, ramp_up_s: 30, duration_s: 300, think_time_s: 2, runs: 4 },
]

export function board(rows: LeaderboardRow[], extra: Partial<ServiceLeaderboard> = {}): ServiceLeaderboard {
  return {
    service: { id: 'svc', name: 'Summarize API', endpoint_path: '/v1/summarize' },
    profiles: PROFILES,
    profile: 'baseline',
    rows,
    ...extra,
  }
}

export const catalog: Catalog = {
  providers: [
    { id: 'stratus', name: 'Stratus Cloud', kind: 'cloud' },
    { id: 'aurora-api', name: 'Aurora Labs API', kind: 'first_party' },
  ],
  llms: [
    { id: 'aurora-4', name: 'Aurora 4', organization: 'Aurora Labs', open_weights: false },
    { id: 'forge-70b', name: 'Forge 70B', organization: 'OpenForge', open_weights: true },
  ],
  offerings: [
    { id: 'stratus--aurora-4', provider_id: 'stratus', llm_id: 'aurora-4', deployment: 'a4', regions: [], status: 'available', prices: {}, capabilities: {} },
    { id: 'stratus--forge-70b', provider_id: 'stratus', llm_id: 'forge-70b', deployment: 'f70', regions: [], status: 'unavailable', prices: {}, capabilities: {} },
    { id: 'aurora-api--aurora-4', provider_id: 'aurora-api', llm_id: 'aurora-4', deployment: 'a4', regions: [], status: 'degraded', prices: {}, capabilities: {} },
  ],
}

export function run(partial: Partial<Run> & { id: string }): Run {
  return {
    batch_id: 'b1',
    service_id: 'svc',
    routing: { mode: 'fixed', offering_id: 'stratus--aurora-4' },
    load: { profile_id: 'smoke', name: 'Smoke', concurrency: 5, ramp_up_s: 10, duration_s: 60, think_time_s: 1 },
    status: 'queued',
    progress: 0,
    created_at: '2026-10-05T10:00:00Z',
    cancel_requested: false,
    blazemeter: {},
    splunk: {},
    ...partial,
  }
}
