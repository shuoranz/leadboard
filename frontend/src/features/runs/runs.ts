// Pure run logic: turning the new-run form into a POST /runs payload, labels,
// and the lifecycle stepper. Kept free of React so it can be unit-tested.
import type { LoadProfile, Run, RunCreate, RunStatus } from '../../api/types'
import { offeringLabel, type CatalogIndex } from '../../shared/catalog/catalogIndex'

export const CUSTOM = 'custom'

export interface CustomLoad {
  concurrency: string
  ramp_up_s: string
  duration_s: string
  think_time_s: string
}

export interface RunForm {
  mode: 'fixed' | 'auto'
  /** Fixed routing: one run per picked offering. */
  picked: ReadonlySet<string>
  /** Auto routing: the offerings requests are randomly routed between. */
  pool: ReadonlySet<string>
  /** A preset's id, or CUSTOM. */
  profileId: string
  custom: CustomLoad
  label: string
}

/** Same limits as the backend's LoadIn. */
const LIMITS = { concurrency: [1, 500], ramp_up_s: [0, 3600], duration_s: [10, 7200], think_time_s: [0, 60] } as const
const FIELD_LABEL: Record<keyof CustomLoad, string> = {
  concurrency: 'Virtual users',
  ramp_up_s: 'Ramp-up',
  duration_s: 'Duration',
  think_time_s: 'Think time',
}

export function parseCustomLoad(c: CustomLoad): { load?: RunCreate['load']; errors: string[] } {
  const errors: string[] = []
  const out = {} as NonNullable<RunCreate['load']>
  for (const key of Object.keys(LIMITS) as (keyof CustomLoad)[]) {
    const raw = c[key].trim()
    const v = Number(raw)
    const [lo, hi] = LIMITS[key]
    if (raw === '' || !Number.isFinite(v) || (key !== 'think_time_s' && !Number.isInteger(v))) errors.push(`${FIELD_LABEL[key]} must be a whole number`)
    else if (v < lo || v > hi) errors.push(`${FIELD_LABEL[key]} must be between ${lo} and ${hi}`)
    out[key] = v
  }
  if (!errors.length && out.ramp_up_s >= out.duration_s) errors.push('Ramp-up must be shorter than the duration')
  return errors.length ? { errors } : { load: out, errors }
}

/** The request body, or why the form can't be submitted yet. */
export function buildRunPayload(form: RunForm, serviceId: string): { payload?: RunCreate; errors: string[] } {
  const errors: string[] = []
  const routing: RunCreate['routing'] =
    form.mode === 'fixed' ? { mode: 'fixed', offering_ids: [...form.picked] } : { mode: 'auto', pool: [...form.pool] }
  if (form.mode === 'fixed' && form.picked.size === 0) errors.push('Pick at least one model')
  if (form.mode === 'auto' && form.pool.size < 2) errors.push('Auto routing needs at least two models in the pool')
  const payload: RunCreate = { service_id: serviceId, routing }
  if (form.profileId === CUSTOM) {
    const { load, errors: loadErrors } = parseCustomLoad(form.custom)
    errors.push(...loadErrors)
    payload.load = load
  } else {
    payload.load_profile_id = form.profileId
  }
  const label = form.label.trim()
  if (label) payload.label = label.slice(0, 80)
  return errors.length ? { errors } : { payload, errors }
}

/** How many runs the form will create: one per fixed model, or one auto run. */
export const runCount = (form: RunForm) => (form.mode === 'fixed' ? form.picked.size : 1)

export function loadOf(form: RunForm, profiles: LoadProfile[]): { concurrency: number; duration_s: number } | undefined {
  if (form.profileId === CUSTOM) return parseCustomLoad(form.custom).load
  return profiles.find((p) => p.id === form.profileId)
}

/** What a run targets: "Aurora 4 · Stratus Cloud", or "Auto · 6 models". */
export function routingLabel(run: Pick<Run, 'routing'>, catalog: CatalogIndex | undefined) {
  return run.routing.mode === 'auto' ? `Auto · ${run.routing.pool?.length ?? 'all'} models` : offeringLabel(catalog, run.routing.offering_id ?? '')
}

/** Wall-clock seconds from start to end (or to now, while in flight). */
export function elapsedSeconds(run: Pick<Run, 'started_at' | 'ended_at'>, now = Date.now()) {
  if (!run.started_at) return undefined
  const start = Date.parse(run.started_at)
  const end = run.ended_at ? Date.parse(run.ended_at) : now
  return Number.isNaN(start) || Number.isNaN(end) ? undefined : Math.max(0, (end - start) / 1000)
}

/**
 * Whether Cancel is offered. Not once the load test has ended (collecting): its
 * results are on the way and cancelling would only throw them away.
 */
export const canCancel = (run: Pick<Run, 'status' | 'cancel_requested'>) =>
  (run.status === 'queued' || run.status === 'starting' || run.status === 'running') && !run.cancel_requested

export type StatusFilter = 'all' | 'active' | 'completed' | 'failed'

export function filterRuns(runs: Run[], f: StatusFilter): Run[] {
  if (f === 'all') return runs
  if (f === 'active') return runs.filter((r) => ['queued', 'starting', 'running', 'collecting'].includes(r.status))
  if (f === 'completed') return runs.filter((r) => r.status === 'completed')
  return runs.filter((r) => r.status === 'failed' || r.status === 'cancelled')
}

export interface Step {
  id: string
  label: string
  state: 'done' | 'current' | 'todo' | 'failed'
}

const ORDER: RunStatus[] = ['queued', 'starting', 'running', 'collecting', 'completed']
const STEP_LABEL = ['Queued', 'BlazeMeter starting', 'Load test running', 'Collecting Splunk logs', 'Results ready']

/** The lifecycle as a stepper. A failure marks the step it happened in. */
export function stepsFor(run: Pick<Run, 'status' | 'blazemeter'>): Step[] {
  let at: number
  if (run.status === 'failed') {
    // The furthest stage the run reached before failing.
    at = run.blazemeter.master_id ? (run.blazemeter.status === 'ENDED' ? 3 : 2) : 1
  } else if (run.status === 'cancelled') {
    at = run.blazemeter.master_id ? 4 : 0
  } else {
    at = ORDER.indexOf(run.status)
  }
  return STEP_LABEL.map((label, i) => {
    const id = ORDER[i]
    if (run.status === 'failed' && i === at) return { id, label, state: 'failed' }
    if (run.status === 'cancelled' && i === at) return { id, label: at === 0 ? 'Cancelled before start' : 'Stopped early · partial results', state: 'done' }
    if (i < at || (i === at && run.status === 'completed')) return { id, label, state: 'done' }
    if (i === at) return { id, label, state: 'current' }
    return { id, label, state: 'todo' }
  })
}
