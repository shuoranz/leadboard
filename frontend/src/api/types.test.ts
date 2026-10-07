import { describe, expect, it } from 'vitest'
import catalog from '../test/contract/catalog.json'
import leaderboard from '../test/contract/leaderboard.json'
import loadProfiles from '../test/contract/load_profiles.json'
import resultsAuto from '../test/contract/results_auto.json'
import resultsFixed from '../test/contract/results_fixed.json'
import run from '../test/contract/run.json'
import runs from '../test/contract/runs.json'
import services from '../test/contract/services.json'
import {
  CatalogSchema,
  LoadProfileListSchema,
  RunListSchema,
  RunResultsSchema,
  RunSchema,
  ServiceLeaderboardSchema,
  ServiceListSchema,
  isActive,
} from './types'

// Real responses from the backend (scripts/snapshot_fixtures.py), so the two
// sides of the contract can't drift apart unnoticed.
describe('contract samples from the backend', () => {
  const cases: [string, { safeParse: (v: unknown) => { error?: { issues: unknown[] } } }, unknown][] = [
    ['services', ServiceListSchema, services],
    ['catalog', CatalogSchema, catalog],
    ['load profiles', LoadProfileListSchema, loadProfiles],
    ['runs', RunListSchema, runs],
    ['run', RunSchema, run],
    ['fixed results', RunResultsSchema, resultsFixed],
    ['auto results', RunResultsSchema, resultsAuto],
    ['leaderboard', ServiceLeaderboardSchema, leaderboard],
  ]
  for (const [name, schema, sample] of cases) {
    it(`${name} parses`, () => expect(schema.safeParse(sample).error?.issues ?? []).toEqual([]))
  }

  it('an auto run is split per offering', () => {
    const r = RunResultsSchema.parse(resultsAuto)
    expect(r.splunk.by_offering.length).toBeGreaterThan(1)
    expect(r.splunk.by_offering.reduce((s, b) => s + b.share, 0)).toBeCloseTo(1, 2)
  })
})

describe('normalization', () => {
  it('turns nulls into undefined and null lists into []', () => {
    const r = RunSchema.parse({
      id: 'r1',
      batch_id: 'b',
      service_id: 's',
      label: null,
      routing: { mode: 'auto', offering_id: null, pool: ['a', 'b'] },
      load: { profile_id: 'custom', name: 'Custom', concurrency: 2, ramp_up_s: 0, duration_s: 30, think_time_s: 1 },
      status: 'queued',
      created_at: '2026-10-05T00:00:00Z',
      headline: null,
    })
    expect(r.label).toBeUndefined()
    expect(r.routing.offering_id).toBeUndefined()
    expect(r.blazemeter).toEqual({})
    expect(r.progress).toBe(0)
    expect(r.headline).toBeUndefined()
  })

  it('keeps only http(s) links into other systems', () => {
    const withLinks = (report_url: string, search_url: string) =>
      RunSchema.parse({
        id: 'r1',
        batch_id: 'b',
        service_id: 's',
        routing: { mode: 'fixed', offering_id: 'o' },
        load: { profile_id: 'custom', name: 'Custom', concurrency: 2, ramp_up_s: 0, duration_s: 30, think_time_s: 1 },
        status: 'completed',
        created_at: '2026-10-05T00:00:00Z',
        blazemeter: { report_url },
        splunk: { search_url },
      })
    const ok = withLinks('https://a.blazemeter.com/app/#/masters/1', 'http://splunk:8000/en-US/app/search/search?q=x')
    expect(ok.blazemeter.report_url).toBe('https://a.blazemeter.com/app/#/masters/1')
    expect(ok.splunk.search_url).toBe('http://splunk:8000/en-US/app/search/search?q=x')
    for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<script>alert(1)</script>', '/relative', 'not a url']) {
      const r = withLinks(bad, bad)
      expect(r.blazemeter.report_url).toBeUndefined()
      expect(r.splunk.search_url).toBeUndefined()
    }
  })

  it('rejects unknown statuses', () => {
    expect(RunSchema.safeParse({ ...RunSchema.parse(run), status: 'exploded' }).success).toBe(false)
  })

  it('knows which statuses are in flight', () => {
    expect(['queued', 'starting', 'running', 'collecting'].every((s) => isActive(s as never))).toBe(true)
    expect(isActive('completed')).toBe(false)
  })
})
