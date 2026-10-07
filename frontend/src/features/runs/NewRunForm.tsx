import { useMemo, useState, type FormEvent } from 'react'
import { ApiError, useStartRun } from '../../api/client'
import type { LoadProfile, Run, Service } from '../../api/types'
import { isUsable, offeringLabel, serviceOfferings, type CatalogIndex } from '../../shared/catalog/catalogIndex'
import { formatDuration } from '../../shared/lib/format'
import { ChipRadioGroup } from '../../shared/ui/ChipRadioGroup'
import { pill } from '../../shared/ui/pill'
import { TextInput } from '../../shared/ui/TextInput'
import { OfferingPicker } from './OfferingPicker'
import { CUSTOM, buildRunPayload, loadOf, runCount, type CustomLoad, type RunForm } from './runs'

const CUSTOM_DEFAULT: CustomLoad = { concurrency: '10', ramp_up_s: '20', duration_s: '120', think_time_s: '1' }

/**
 * Starts BlazeMeter tests against the service. Fixed routing runs each picked
 * model as its own test, one after another; auto routing is one test where the
 * service picks a model at random per request.
 */
export function NewRunForm({
  service,
  catalog,
  profiles,
  onClose,
  onStarted,
}: {
  service: Service
  catalog: CatalogIndex
  profiles: LoadProfile[]
  onClose: () => void
  onStarted: (runs: Run[]) => void
}) {
  const offerings = useMemo(() => serviceOfferings(catalog, service), [catalog, service])
  const usable = useMemo(() => new Set(offerings.filter(isUsable).map((o) => o.id)), [offerings])
  const [form, setForm] = useState<RunForm>(() => ({
    mode: 'fixed',
    picked: new Set(),
    pool: usable,
    profileId: profiles.find((p) => p.id === 'smoke')?.id ?? profiles[0]?.id ?? CUSTOM,
    custom: CUSTOM_DEFAULT,
    label: '',
  }))
  const [touched, setTouched] = useState(false)
  const start = useStartRun()
  const set = (patch: Partial<RunForm>) => setForm((f) => ({ ...f, ...patch }))

  const { payload, errors } = buildRunPayload(form, service.id)
  const n = runCount(form)
  const load = loadOf(form, profiles)
  const selection = form.mode === 'fixed' ? form.picked : form.pool

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!payload) return
    start.mutate(payload, { onSuccess: onStarted })
  }

  return (
    <form onSubmit={submit} aria-label="New run" className="rounded-2xl border border-accent/40 bg-surface p-5 shadow-sm shadow-black/[0.02] sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-lg font-semibold text-ink">New run · {service.name}</h3>
        <button type="button" onClick={onClose} className="font-mono text-xs text-muted hover:text-ink">
          Close
        </button>
      </div>
      <p className="mt-1.5 text-body text-ink-2">
        Starts a BlazeMeter load test against <code className="font-mono text-meta">POST {service.endpoint_path}</code>. The service logs every
        request to Splunk; results merge both once the test ends.
      </p>

      <div className="mt-6 space-y-5">
        <ChipRadioGroup<RunForm['mode']>
          label="Routing"
          value={form.mode}
          onChange={(mode) => set({ mode })}
          options={[
            { value: 'fixed', label: 'Fixed models', title: 'One test per picked model' },
            { value: 'auto', label: 'Auto routing', title: 'One test; each request goes to a random model from the pool' },
          ]}
        />

        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <OfferingPicker
              catalog={catalog}
              offerings={offerings}
              selected={selection}
              onChange={(next) => set(form.mode === 'fixed' ? { picked: next } : { pool: next })}
              label={form.mode === 'fixed' ? 'Models' : 'Routing pool'}
            />
            <span className="text-sm text-muted">
              {form.mode === 'fixed'
                ? 'Pick by provider, or by LLM to compare one model across its providers.'
                : 'Each request is routed to a model picked uniformly at random from this pool.'}
            </span>
          </div>
          {selection.size > 0 && (
            <ul aria-label="Selected models" className="mt-3 flex flex-wrap gap-1.5">
              {[...selection].map((id) => (
                <li key={id} className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-surface-2 py-0.5 pr-1 pl-3 text-sm text-ink">
                  {offeringLabel(catalog, id)}
                  <button
                    type="button"
                    aria-label={`Remove ${offeringLabel(catalog, id)}`}
                    onClick={() => {
                      const next = new Set(selection)
                      next.delete(id)
                      set(form.mode === 'fixed' ? { picked: next } : { pool: next })
                    }}
                    className="rounded-full px-1.5 text-muted hover:text-ink"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <ChipRadioGroup<string>
          label="Load"
          value={form.profileId}
          onChange={(profileId) => set({ profileId })}
          options={[
            ...profiles.map((p) => ({
              value: p.id,
              label: `${p.name} · ${p.concurrency} VU · ${formatDuration(p.duration_s)}`,
              title: p.description,
            })),
            { value: CUSTOM, label: 'Custom' },
          ]}
        />
        {form.profileId === CUSTOM && (
          <div className="grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ['concurrency', 'Virtual users'],
                ['ramp_up_s', 'Ramp-up (s)'],
                ['duration_s', 'Duration (s)'],
                ['think_time_s', 'Think time (s)'],
              ] as const
            ).map(([key, label]) => (
              <TextInput
                key={key}
                label={label}
                showLabel
                inputMode="decimal"
                value={form.custom[key]}
                onChange={(e) => set({ custom: { ...form.custom, [key]: e.target.value } })}
              />
            ))}
          </div>
        )}

        <TextInput
          label="Label (optional)"
          showLabel
          value={form.label}
          maxLength={80}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Before the prompt change"
          className="max-w-xl"
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <button type="submit" disabled={start.isPending} className={pill({ tone: 'on', className: 'disabled:opacity-60' })}>
          {start.isPending ? 'Starting…' : n > 1 ? `Start ${n} runs` : 'Start run'}
        </button>
        <span className="text-sm text-muted">
          {n > 1 && 'Runs one after another, so they never load the service at the same time. '}
          {load && `${n > 1 ? `${n} × ` : ''}${formatDuration(load.duration_s)} of load at ${load.concurrency} virtual users.`}
        </span>
      </div>
      {touched && errors.length > 0 && (
        <ul role="alert" className="mt-3 space-y-0.5 text-sm text-bad">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {start.isError && (
        <p role="alert" className="mt-3 text-sm text-bad">
          Couldn't start the run: {start.error instanceof ApiError && start.error.detail ? start.error.detail : start.error.message}
        </p>
      )}
    </form>
  )
}
