import { describe, expect, it } from 'vitest'
import * as T from '../src/api/types.ts'
import { createWorld } from './world.ts'

// The mock stands in for the backend, so it must satisfy the same contract.
describe('mock API', () => {
  const world = createWorld()

  it('serves services, catalog and load profiles that match the contract', () => {
    expect(T.ServiceListSchema.safeParse(world.services()).error?.issues ?? []).toEqual([])
    expect(T.CatalogSchema.safeParse(world.catalog()).error?.issues ?? []).toEqual([])
    expect(T.LoadProfileListSchema.safeParse(world.loadProfiles()).error?.issues ?? []).toEqual([])
  })

  it('serves a valid leaderboard for every service and profile', () => {
    for (const s of world.services())
      for (const profile of [undefined, 'smoke', 'baseline', 'stress', 'custom']) {
        const parsed = T.ServiceLeaderboardSchema.safeParse(world.leaderboard(s.id, profile))
        expect(parsed.error?.issues ?? [], `${s.id}:${profile}`).toEqual([])
        if (profile) expect(parsed.data!.profile).toBe(profile)
      }
  })

  it('serves every seeded run and its results', () => {
    const runs = world.runs({ limit: 1000 })
    expect(runs.length).toBeGreaterThan(50)
    expect(T.RunListSchema.safeParse(runs).error?.issues ?? []).toEqual([])
    for (const r of runs) expect(T.RunResultsSchema.safeParse(world.results(r.id)).error?.issues ?? [], r.id).toEqual([])
  })

  it('has LLMs served by several providers', () => {
    const { offerings } = T.CatalogSchema.parse(world.catalog())
    const perLlm = new Map<string, number>()
    for (const o of offerings) perLlm.set(o.llm_id, (perLlm.get(o.llm_id) ?? 0) + 1)
    expect(Math.max(...perLlm.values())).toBeGreaterThan(2)
  })
})

describe('mock runs', () => {
  it('queue per service and progress queued → running → collecting → completed', () => {
    let t = 1_000_000
    const world = createWorld(() => t)
    const [a, b] = world.createRuns({
      service_id: 'summarize-profile',
      routing: { mode: 'fixed', offering_ids: ['stratus--aurora-4', 'aurora-api--aurora-4'] },
      load_profile_id: 'smoke',
    })
    expect([a.status, b.status]).toEqual(['queued', 'queued'])
    const status = (id: string) => world.run(id)!.status
    t += 1_500
    expect(status(a.id)).toBe('running')
    expect(status(b.id)).toBe('queued')
    t += 4_000
    expect(status(a.id)).toBe('collecting')
    t += 1_500
    expect(status(a.id)).toBe('completed')
    expect(T.RunSchema.parse(world.run(a.id)).headline?.requests).toBeGreaterThan(0)
    expect(T.RunResultsSchema.parse(world.results(a.id)).run_id).toBe(a.id)
    expect(status(b.id)).not.toBe('queued')
  })

  it('validates like the backend and cancels', () => {
    let t = 0
    const world = createWorld(() => t)
    expect(() => world.createRuns({ service_id: 'nope', routing: { mode: 'auto' }, load_profile_id: 'smoke' })).toThrow('Unknown service')
    expect(() =>
      world.createRuns({ service_id: 'headline-rewrite', routing: { mode: 'fixed', offering_ids: ['stratus--aurora-4'] }, load_profile_id: 'smoke' }),
    ).toThrow('Not available')
    const [run] = world.createRuns({ service_id: 'headline-rewrite', routing: { mode: 'auto' }, load_profile_id: 'smoke' })
    expect(world.cancel(run.id)!.status).toBe('cancelled')
    t += 60_000
    expect(world.run(run.id)!.status).toBe('cancelled')
  })
})
