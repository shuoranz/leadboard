// Panels that describe how a deployment behaved, shared by the leaderboard's
// expanded rows and the run detail page.
import type { ReactNode } from 'react'
import type { Capabilities, ErrorBreakdown, RunStatus } from '../../api/types'
import { STATUS_LABEL } from '../board/model'
import { cn } from '../lib/cn'
import { formatInt, formatTokens } from '../lib/format'

export function PanelTitle({ children }: { children: ReactNode }) {
  return <h4 className="mb-3 font-mono text-sm tracking-wider text-accent uppercase">{children}</h4>
}

const FEATURES: [keyof Capabilities, string][] = [
  ['streaming', 'Streaming'],
  ['tool_calling', 'Tool calling'],
  ['json_mode', 'JSON mode'],
  ['vision', 'Vision'],
  ['prompt_caching', 'Prompt caching'],
  ['batch_api', 'Batch API'],
]

/** Declared capabilities. Unsupported features are shown struck through, so "no" reads differently from "unknown" (omitted). */
export function CapabilityBadges({ caps, title = true }: { caps: Capabilities; title?: boolean }) {
  const limits = [
    caps.context_window != null && `${formatTokens(caps.context_window)} context`,
    caps.max_output_tokens != null && `${formatTokens(caps.max_output_tokens)} max output`,
  ].filter((x): x is string => !!x)
  return (
    <section aria-label="Capabilities">
      {title && <PanelTitle>Capabilities</PanelTitle>}
      <ul className="flex flex-wrap gap-1.5">
        {limits.map((l) => (
          <li key={l} className="rounded-md border border-line-strong px-2 py-0.5 font-mono text-xs text-ink">
            {l}
          </li>
        ))}
        {FEATURES.filter(([k]) => caps[k] != null).map(([k, label]) => {
          const yes = caps[k] === true
          return (
            <li
              key={k}
              className={cn('rounded-md border px-2 py-0.5 font-mono text-xs', yes ? 'border-good/50 text-good' : 'border-line text-muted line-through')}
            >
              <span className="sr-only">{yes ? 'Supports ' : 'No '}</span>
              {label}
            </li>
          )
        })}
      </ul>
      {title && caps.regions && caps.regions.length > 0 && <p className="mt-3 text-sm text-ink-2">Regions: {caps.regions.join(', ')}</p>}
    </section>
  )
}

const ERROR_CAUSES: [keyof ErrorBreakdown, string][] = [
  ['rate_limited', 'Rate limited (429)'],
  ['server_error', 'Server error (5xx)'],
  ['timeout', 'Timeout'],
  ['dropped_stream', 'Dropped stream'],
  ['refused', 'Refused (content filter)'],
  ['other', 'Other'],
]

/** Errors by cause: each needs a different fix (back off, retry, switch provider, change the prompt). */
export function ErrorCauses({ breakdown }: { breakdown: ErrorBreakdown }) {
  const rows = ERROR_CAUSES.flatMap(([k, label]) => (breakdown[k] != null ? [{ k, label, n: breakdown[k] }] : []))
  const total = rows.reduce((sum, r) => sum + r.n, 0)
  return (
    <section aria-label="Errors by cause">
      <PanelTitle>Errors by cause</PanelTitle>
      {total === 0 ? (
        <p className="text-sm text-ink-2">No errors recorded.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.k} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_3rem] items-center gap-3 text-sm">
              <span className="truncate text-ink-2">{r.label}</span>
              <span className="h-2 rounded-[2px] bg-surface" aria-hidden>
                <span className="block h-2 rounded-r-[2px] bg-bad/70" style={{ width: `${(r.n / total) * 100}%` }} />
              </span>
              <span className="text-right font-mono text-ink tabular-nums">{formatInt(r.n)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Median TTFT at each prompt size: how much long context costs in waiting. */
export function TtftByInput({ points }: { points: { input_tokens: number; p50_ms: number }[] }) {
  const sorted = [...points].sort((a, b) => a.input_tokens - b.input_tokens)
  const max = Math.max(...sorted.map((p) => p.p50_ms))
  return (
    <section aria-label="TTFT by prompt length">
      <PanelTitle>TTFT by prompt length (p50)</PanelTitle>
      {sorted.length === 0 ? (
        <p className="text-sm text-ink-2">Not enough requests per prompt size.</p>
      ) : (
        <ul className="space-y-1.5">
          {sorted.map((p) => (
            <li key={p.input_tokens} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
              <span className="font-mono text-ink-2 tabular-nums">{formatTokens(p.input_tokens)} in</span>
              <span className="h-2 rounded-[2px] bg-surface" aria-hidden>
                <span className="block h-2 rounded-r-[2px] bg-accent/70" style={{ width: `${(p.p50_ms / max) * 100}%` }} />
              </span>
              <span className="text-right font-mono whitespace-nowrap text-ink tabular-nums">{formatInt(p.p50_ms)} ms</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Share bars, e.g. how an auto-routed run split its requests across models. */
export function ShareBars({ rows, label }: { rows: { key: string; label: ReactNode; share: number; color?: string }[]; label: string }) {
  return (
    <ul aria-label={label} className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_3.5rem] items-center gap-3 text-sm">
          <span className="truncate text-ink-2">{r.label}</span>
          <span className="h-2 rounded-[2px] bg-surface-2" aria-hidden>
            <span className="block h-2 rounded-r-[2px] bg-accent/70" style={{ width: `${r.share * 100}%`, background: r.color }} />
          </span>
          <span className="text-right font-mono text-ink tabular-nums">{Math.round(r.share * 100)}%</span>
        </li>
      ))}
    </ul>
  )
}

const STATUS_TONE: Record<RunStatus, string> = {
  queued: 'border-line-strong text-ink-2',
  starting: 'border-accent/60 text-accent',
  running: 'border-accent bg-accent/10 text-accent',
  collecting: 'border-accent/60 text-accent',
  completed: 'border-good/60 text-good',
  failed: 'border-bad/60 text-bad',
  cancelled: 'border-line-strong text-muted',
}

/** A run's status; in-flight states pulse. */
export function StatusBadge({ status, progress }: { status: RunStatus; progress?: number }) {
  const live = status === 'starting' || status === 'running' || status === 'collecting'
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-xs whitespace-nowrap', STATUS_TONE[status])}>
      {live && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />}
      {STATUS_LABEL[status]}
      {status === 'running' && progress != null && <span className="tabular-nums opacity-80">{progress}%</span>}
    </span>
  )
}

/** Labels which system a number came from: they measure from different vantage points. */
export function SourceBadge({ source }: { source: 'blazemeter' | 'splunk' }) {
  return (
    <span className="rounded-md border border-line-strong px-1.5 py-px font-mono text-micro leading-4 tracking-wider text-muted uppercase">
      {source === 'blazemeter' ? 'BlazeMeter · client side' : 'Splunk · server side'}
    </span>
  )
}

/** A row of headline numbers. */
export function KpiGrid({ items }: { items: { label: string; value: string; hint?: string }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
      {items.map((k) => (
        <div key={k.label} className="bg-surface px-4 py-3">
          <dt className="font-mono text-micro tracking-widest text-muted uppercase">{k.label}</dt>
          <dd className="mt-1 font-mono text-xl font-semibold text-ink tabular-nums">{k.value}</dd>
          {k.hint && <dd className="text-xs text-muted">{k.hint}</dd>}
        </div>
      ))}
    </dl>
  )
}

/** Compact label/value list, e.g. a source's full set of numbers. */
export function FactList({ facts }: { facts: [string, string | undefined][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
      {facts
        .filter(([, v]) => v != null)
        .map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right font-mono text-ink tabular-nums sm:text-left">{v}</dd>
          </div>
        ))}
    </dl>
  )
}
