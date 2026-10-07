import { describe, expect, it } from 'vitest'
import { buildCatalogIndex } from '../../shared/catalog/catalogIndex'
import { catalog, run } from '../../test/fixtures'
import { CUSTOM, buildRunPayload, canCancel, elapsedSeconds, filterRuns, parseCustomLoad, routingLabel, runCount, stepsFor, type RunForm } from './runs'

const form = (patch: Partial<RunForm> = {}): RunForm => ({
  mode: 'fixed',
  picked: new Set(['stratus--aurora-4', 'aurora-api--aurora-4']),
  pool: new Set(),
  profileId: 'smoke',
  custom: { concurrency: '10', ramp_up_s: '20', duration_s: '120', think_time_s: '1.5' },
  label: '  before prompt v2 ',
  ...patch,
})

describe('buildRunPayload', () => {
  it('fixed routing: one run per picked model, preset load', () => {
    const { payload, errors } = buildRunPayload(form(), 'svc')
    expect(errors).toEqual([])
    expect(payload).toEqual({
      service_id: 'svc',
      routing: { mode: 'fixed', offering_ids: ['stratus--aurora-4', 'aurora-api--aurora-4'] },
      load_profile_id: 'smoke',
      label: 'before prompt v2',
    })
    expect(runCount(form())).toBe(2)
  })

  it('auto routing with a custom load', () => {
    const { payload } = buildRunPayload(form({ mode: 'auto', pool: new Set(['a', 'b']), profileId: CUSTOM, label: '' }), 'svc')
    expect(payload).toEqual({
      service_id: 'svc',
      routing: { mode: 'auto', pool: ['a', 'b'] },
      load: { concurrency: 10, ramp_up_s: 20, duration_s: 120, think_time_s: 1.5 },
    })
    expect(runCount(form({ mode: 'auto' }))).toBe(1)
  })

  it('explains what is missing', () => {
    expect(buildRunPayload(form({ picked: new Set() }), 'svc').errors).toEqual(['Pick at least one model'])
    expect(buildRunPayload(form({ mode: 'auto', pool: new Set(['a']) }), 'svc').errors).toEqual([
      'Auto routing needs at least two models in the pool',
    ])
  })
})

describe('parseCustomLoad', () => {
  const base = { concurrency: '10', ramp_up_s: '20', duration_s: '120', think_time_s: '1' }
  it('applies the backend limits', () => {
    expect(parseCustomLoad({ ...base, concurrency: '0' }).errors).toEqual(['Virtual users must be between 1 and 500'])
    expect(parseCustomLoad({ ...base, concurrency: '2.5' }).errors).toEqual(['Virtual users must be a whole number'])
    expect(parseCustomLoad({ ...base, duration_s: '' }).errors).toEqual(['Duration must be a whole number'])
    expect(parseCustomLoad({ ...base, ramp_up_s: '120' }).errors).toEqual(['Ramp-up must be shorter than the duration'])
    expect(parseCustomLoad(base).errors).toEqual([])
  })
})

describe('run helpers', () => {
  const cat = buildCatalogIndex(catalog)

  it('labels routing', () => {
    expect(routingLabel(run({ id: 'r' }), cat)).toBe('Aurora 4 · Stratus Cloud')
    expect(routingLabel(run({ id: 'r', routing: { mode: 'auto', pool: ['a', 'b', 'c'] } }), cat)).toBe('Auto · 3 models')
  })

  it('measures elapsed time, live while in flight', () => {
    expect(elapsedSeconds({ started_at: '2026-10-05T10:00:00Z', ended_at: '2026-10-05T10:01:30Z' })).toBe(90)
    expect(elapsedSeconds({ started_at: '2026-10-05T10:00:00Z' }, Date.parse('2026-10-05T10:00:10Z'))).toBe(10)
    expect(elapsedSeconds({})).toBeUndefined()
  })

  it('filters by status', () => {
    const rs = ['queued', 'running', 'completed', 'failed', 'cancelled'].map((s, i) => run({ id: `r${i}`, status: s as never }))
    expect(filterRuns(rs, 'active').map((r) => r.status)).toEqual(['queued', 'running'])
    expect(filterRuns(rs, 'failed').map((r) => r.status)).toEqual(['failed', 'cancelled'])
    expect(filterRuns(rs, 'all')).toHaveLength(5)
  })
})

describe('stepsFor', () => {
  const states = (r: Parameters<typeof stepsFor>[0]) => stepsFor(r).map((s) => s.state)

  it('marks the current stage', () => {
    expect(states(run({ id: 'r', status: 'running' }))).toEqual(['done', 'done', 'current', 'todo', 'todo'])
    expect(states(run({ id: 'r', status: 'completed' }))).toEqual(['done', 'done', 'done', 'done', 'done'])
  })

  it('marks where a failure happened', () => {
    expect(states(run({ id: 'r', status: 'failed' }))).toEqual(['done', 'failed', 'todo', 'todo', 'todo'])
    expect(states(run({ id: 'r', status: 'failed', blazemeter: { master_id: 1, status: 'ENDED' } }))).toEqual([
      'done',
      'done',
      'done',
      'failed',
      'todo',
    ])
  })

  it('explains cancellation', () => {
    expect(stepsFor(run({ id: 'r', status: 'cancelled' }))[0].label).toBe('Cancelled before start')
    expect(stepsFor(run({ id: 'r', status: 'cancelled', blazemeter: { master_id: 1 } }))[4].label).toMatch(/partial results/)
  })
})

describe('canCancel', () => {
  it('offers cancel until the load test ends, and only once', () => {
    for (const status of ['queued', 'starting', 'running'] as const) expect(canCancel(run({ id: 'r', status }))).toBe(true)
    // Collecting: the test is over and its results are on the way.
    for (const status of ['collecting', 'completed', 'failed', 'cancelled'] as const) expect(canCancel(run({ id: 'r', status }))).toBe(false)
    expect(canCancel(run({ id: 'r', status: 'running', cancel_requested: true }))).toBe(false)
  })
})
