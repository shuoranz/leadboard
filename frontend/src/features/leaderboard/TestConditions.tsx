import { useBoard } from '../../shared/board/BoardContext'
import { formatDate, formatDuration, formatInt } from '../../shared/lib/format'

/**
 * How the numbers were measured. Latency and reliability figures are only
 * comparable under the same load, so the conditions sit right above the table.
 */
export function TestConditions() {
  const { conditions: run, profile } = useBoard()
  if (!run) return null

  const dates = [formatDate(run.started_at), formatDate(run.ended_at)].filter(Boolean)
  const windowText = dates.length === 2 && dates[0] !== dates[1] ? `${dates[0]} – ${dates[1]}` : dates[0]
  const vus = run.concurrency.length ? `${run.concurrency.join(' / ')} virtual users` : undefined
  const summary = [
    profile?.name,
    vus,
    run.duration_s != null && formatDuration(run.duration_s),
    windowText,
    run.client_region && `from ${run.client_region}`,
  ].filter(Boolean)

  const facts: [string, string | undefined][] = [
    ['Load profile', profile && (profile.description ? `${profile.name} — ${profile.description}` : profile.name)],
    ['Virtual users', run.concurrency.join(', ') || undefined],
    ['Ramp-up', run.ramp_up_s != null ? formatDuration(run.ramp_up_s) : undefined],
    ['Duration', run.duration_s != null ? formatDuration(run.duration_s) : undefined],
    ['Think time', run.think_time_s != null ? `${run.think_time_s}s between requests` : undefined],
    ['Window', windowText],
    ['Load generator', run.client_region],
    ['Streaming', run.streaming == null ? undefined : run.streaming ? 'On' : 'Off'],
    ['Stall threshold', run.stall_threshold_ms != null ? `gap > ${formatInt(run.stall_threshold_ms)} ms` : undefined],
    ['Timeout', run.timeout_ms != null ? `${formatInt(run.timeout_ms)} ms` : undefined],
    ['Runs on this board', formatInt(run.runs)],
  ]

  return (
    <details className="group rounded-xl border border-line bg-surface">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 marker:hidden">
        <span aria-hidden className="text-tiny text-muted transition-transform group-open:rotate-90">
          ▶
        </span>
        <span className="font-mono text-xs font-semibold tracking-widest text-ink-2 uppercase">Test conditions</span>
        <span className="text-sm text-muted">{summary.join(' · ')}</span>
      </summary>
      <div className="grid gap-6 border-t border-line px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          {facts
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd className="text-ink">{v}</dd>
              </div>
            ))}
        </dl>
        {run.notes && <p className="text-sm leading-relaxed text-ink-2">{run.notes}</p>}
      </div>
    </details>
  )
}
