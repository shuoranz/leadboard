import { useBoard } from '../../shared/board/BoardContext'
import { formatDate, formatInt, formatPercent, formatTokens } from '../../shared/lib/format'

/**
 * How the numbers were measured. Latency and reliability figures are only
 * comparable within a run, so the conditions sit right above the table.
 */
export function TestConditions() {
  const { run } = useBoard()
  if (!run) return null

  const dates = [formatDate(run.started_at), formatDate(run.ended_at)].filter(Boolean)
  const windowText = dates.length === 2 && dates[0] !== dates[1] ? `${dates[0]} – ${dates[1]}` : dates[0]
  const summary = [
    windowText,
    run.client_region && `from ${run.client_region}`,
    run.concurrency?.length && `concurrency ${run.concurrency.join(' / ')}`,
    run.requests_per_model != null && `${formatInt(run.requests_per_model)} requests per model`,
  ].filter(Boolean)

  const facts: [string, string | undefined][] = [
    ['Window', windowText],
    ['Client region', run.client_region],
    ['Network RTT baseline', run.network_rtt_ms != null ? `${formatInt(run.network_rtt_ms)} ms` : undefined],
    ['Concurrency levels', run.concurrency?.join(', ')],
    ['Streaming', run.streaming == null ? undefined : run.streaming ? 'On' : 'Off'],
    ['Stall threshold', run.stall_threshold_ms != null ? `gap > ${formatInt(run.stall_threshold_ms)} ms` : undefined],
    ['Timeout', run.timeout_ms != null ? `${formatInt(run.timeout_ms)} ms` : undefined],
    ['Retry policy', run.retry_policy],
    ['Requests per model', run.requests_per_model != null ? formatInt(run.requests_per_model) : undefined],
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
        {run.profiles && run.profiles.length > 0 && (
          <div>
            <h4 className="mb-2 font-mono text-xs font-semibold tracking-widest text-muted uppercase">Traffic mix</h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th scope="col" className="py-1.5 pr-3 font-medium">Profile</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">Input tok</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">Output tok</th>
                  <th scope="col" className="py-1.5 text-right font-medium">Share</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {run.profiles.map((p) => (
                  <tr key={p.name} className="border-b border-line last:border-0">
                    <th scope="row" className="py-1.5 pr-3 text-left font-sans font-normal text-ink">
                      {p.name}
                    </th>
                    <td className="py-1.5 pr-3 text-right text-ink-2">{formatTokens(p.input_tokens)}</td>
                    <td className="py-1.5 pr-3 text-right text-ink-2">{formatTokens(p.output_tokens)}</td>
                    <td className="py-1.5 text-right text-ink-2">{formatPercent(p.share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {run.notes && <p className="text-sm text-ink-2 lg:col-span-2">{run.notes}</p>}
      </div>
    </details>
  )
}
