import type { Run } from '../../api/types'
import type { CatalogIndex } from '../../shared/catalog/catalogIndex'
import { cn } from '../../shared/lib/cn'
import { formatCost1k, formatDateTime, formatDuration, formatInt, formatPercent } from '../../shared/lib/format'
import { StatusBadge } from '../../shared/perf/PerfPanels'
import { canCancel, elapsedSeconds, routingLabel } from './runs'

const th = 'bg-surface px-3 py-3 font-mono text-xs font-semibold tracking-wider text-ink-2 uppercase shadow-[inset_0_-1px_0_var(--line)]'
const td = 'px-3 py-3 whitespace-nowrap'

/** External report links open in a new tab; the fake systems serve simple pages for them. */
export function SourceLinks({ run, empty = '—' }: { run: Run; empty?: string | null }) {
  const links = [
    run.blazemeter.report_url && { href: run.blazemeter.report_url, label: 'BlazeMeter' },
    run.splunk.search_url && { href: run.splunk.search_url, label: 'Splunk' },
  ].filter((l): l is { href: string; label: string } => !!l)
  if (!links.length) return empty == null ? null : <span className="text-muted">{empty}</span>
  return (
    <span className="inline-flex gap-3">
      {links.map((l) => (
        <a
          key={l.label}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-xs text-accent hover:underline"
        >
          {l.label} ↗
        </a>
      ))}
    </span>
  )
}

export function RunsTable({
  runs,
  catalog,
  onOpen,
  onCancel,
  cancelling,
}: {
  runs: Run[]
  catalog: CatalogIndex | undefined
  onOpen: (id: string) => void
  onCancel: (id: string) => void
  cancelling?: string
}) {
  return (
    // As tall as its rows (the list shows 50 until "Show all"); scrolls only sideways.
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <table aria-label="Runs" className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th scope="col" className={cn(th, 'pl-5 text-left')}>Status</th>
            <th scope="col" className={cn(th, 'text-left')}>Run</th>
            <th scope="col" className={cn(th, 'text-left')}>Model / routing</th>
            <th scope="col" className={cn(th, 'text-left')}>Load</th>
            <th scope="col" className={cn(th, 'text-left')}>Created</th>
            <th scope="col" className={cn(th, 'text-right')}>Took</th>
            <th scope="col" className={cn(th, 'text-right')}>Requests</th>
            <th scope="col" className={cn(th, 'text-right')}>Errors</th>
            <th scope="col" className={cn(th, 'text-right')}>E2E p95</th>
            <th scope="col" className={cn(th, 'text-right')}>TTFT p50</th>
            <th scope="col" className={cn(th, 'text-right')}>$ / 1K</th>
            <th scope="col" className={cn(th, 'text-left')}>Reports</th>
            <th scope="col" className={cn(th, 'pr-5')}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.length === 0 && (
            <tr>
              <td colSpan={13} className="px-6 py-12 text-center text-ink-2">
                No runs match.
              </td>
            </tr>
          )}
          {runs.map((r) => {
            const h = r.headline
            return (
              <tr key={r.id} onClick={() => onOpen(r.id)} className="group cursor-pointer hover:bg-surface-2 [&>*]:border-b [&>*]:border-line">
                <td className={cn(td, 'pl-5')}>
                  <StatusBadge status={r.status} progress={r.progress} />
                  {r.status === 'running' && (
                    <span aria-hidden className="mt-1.5 block h-1 w-24 rounded-full bg-line">
                      <span className="block h-1 rounded-full bg-accent transition-[width]" style={{ width: `${r.progress}%` }} />
                    </span>
                  )}
                </td>
                <th scope="row" className={cn(td, 'text-left font-normal')}>
                  {/* The row's click handler opens the run; a second one here would push it twice. */}
                  <button type="button" className="font-mono text-ink group-hover:text-accent">
                    {r.id}
                  </button>
                  {r.label && <div className="max-w-56 truncate text-xs text-muted">{r.label}</div>}
                </th>
                <td className={cn(td, 'text-ink')}>{routingLabel(r, catalog)}</td>
                <td className={cn(td, 'text-ink-2')}>
                  {r.load.name} · {r.load.concurrency} VU · {formatDuration(r.load.duration_s)}
                </td>
                <td className={cn(td, 'text-ink-2')}>{formatDateTime(r.created_at)}</td>
                <td className={cn(td, 'text-right font-mono text-ink-2 tabular-nums')}>{formatDuration(elapsedSeconds(r))}</td>
                <td className={cn(td, 'text-right font-mono text-ink tabular-nums')}>{formatInt(h?.requests)}</td>
                <td className={cn(td, 'text-right font-mono text-ink tabular-nums')}>{formatPercent(h?.error_rate)}</td>
                <td className={cn(td, 'text-right font-mono text-ink tabular-nums')}>{formatInt(h?.e2e_p95_ms)}</td>
                <td className={cn(td, 'text-right font-mono text-ink tabular-nums')}>{formatInt(h?.ttft_p50_ms)}</td>
                <td className={cn(td, 'text-right font-mono text-ink tabular-nums')}>{formatCost1k(h?.cost_per_1k)}</td>
                <td className={td}>
                  <SourceLinks run={r} />
                </td>
                <td className={cn(td, 'pr-5 text-right')}>
                  {canCancel(r) && (
                    <button
                      type="button"
                      disabled={cancelling === r.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        onCancel(r.id)
                      }}
                      className="font-mono text-xs text-bad hover:underline disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
