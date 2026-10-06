import type { Capabilities, ErrorBreakdown, ModelEntry } from '../../api/types'
import { useBoard } from '../../shared/board/BoardContext'
import { cn } from '../../shared/lib/cn'
import { formatInt, formatPrice, formatScore, formatTokens } from '../../shared/lib/format'

/**
 * Expanded-row panel: provenance and prices, how the deployment behaves
 * (capabilities, error causes, TTFT by prompt length), then every subtask score.
 */
export function ModelDetail({ model, highlightCategory }: { model: ModelEntry; highlightCategory?: string }) {
  const { categories } = useBoard()
  const cost = model.cost
  const prices = [cost?.input_per_million, cost?.cached_input_per_million, cost?.output_per_million]
  const meta: [string, string | undefined][] = [
    ['From', model.organization],
    ['Served by', model.provider],
    ['Fine-tuned from', model.base_model],
    ['$/1M in / cached / out', prices.some((p) => p != null) ? prices.map(formatPrice).join(' / ') : undefined],
    [
      'Avg output tokens',
      cost?.avg_output_tokens == null
        ? undefined
        : `${formatInt(cost.avg_output_tokens)}${cost.avg_reasoning_tokens != null ? ` (${formatInt(cost.avg_reasoning_tokens)} reasoning)` : ''}`,
    ],
  ]
  const perf = model.perf
  const hasBehavior = model.capabilities || perf?.error_breakdown || perf?.ttft_by_input?.length

  return (
    <div className="px-6 py-7 sm:px-14">
      <dl className="flex flex-wrap gap-x-10 gap-y-2 border-b border-line pb-5 font-mono">
        {meta
          .filter(([, v]) => v != null)
          .map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-2">
              <dt className="text-xs tracking-wider text-muted uppercase">{k}:</dt>
              <dd className="text-body text-ink">{v}</dd>
            </div>
          ))}
      </dl>

      {hasBehavior && (
        <div className="grid grid-cols-1 gap-x-10 gap-y-7 border-b border-line py-6 lg:grid-cols-3">
          {model.capabilities && <CapabilityBadges caps={model.capabilities} />}
          {perf?.error_breakdown && <ErrorCauses breakdown={perf.error_breakdown} />}
          {perf?.ttft_by_input && perf.ttft_by_input.length > 0 && <TtftByInput points={perf.ttft_by_input} />}
        </div>
      )}

      <div className="mt-7 grid grid-cols-1 gap-x-7 gap-y-9 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {categories.map((c) => (
          <section key={c.id} aria-label={`${c.name} subtasks`}>
            <h4
              className={cn(
                'mb-2 font-mono text-sm tracking-wider text-accent uppercase',
                c.id === highlightCategory && 'font-bold underline decoration-2 underline-offset-4',
              )}
            >
              {c.name}
            </h4>
            <ul>
              {c.subtasks.map((s) => (
                <li key={s.id} className="flex items-baseline justify-between gap-3 border-b border-dotted border-line-strong py-2 font-mono text-body">
                  <span className="min-w-0 truncate text-ink-2" title={s.name}>
                    {s.name}
                  </span>
                  <span className="font-bold text-ink tabular-nums">{formatScore(model.subtasks[s.id])}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

function PanelTitle({ children }: { children: string }) {
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
function CapabilityBadges({ caps }: { caps: Capabilities }) {
  const limits = [
    caps.context_window != null && `${formatTokens(caps.context_window)} context`,
    caps.max_output_tokens != null && `${formatTokens(caps.max_output_tokens)} max output`,
  ].filter((x): x is string => !!x)
  return (
    <section aria-label="Capabilities">
      <PanelTitle>Capabilities</PanelTitle>
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
              className={cn(
                'rounded-md border px-2 py-0.5 font-mono text-xs',
                yes ? 'border-good/50 text-good' : 'border-line text-muted line-through',
              )}
            >
              <span className="sr-only">{yes ? 'Supports ' : 'No '}</span>
              {label}
            </li>
          )
        })}
      </ul>
      {caps.regions && caps.regions.length > 0 && <p className="mt-3 text-sm text-ink-2">Regions: {caps.regions.join(', ')}</p>}
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
function ErrorCauses({ breakdown }: { breakdown: ErrorBreakdown }) {
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

/** Median TTFT at each tested prompt size: how much long context costs in waiting. */
function TtftByInput({ points }: { points: { input_tokens: number; p50_ms: number }[] }) {
  const sorted = [...points].sort((a, b) => a.input_tokens - b.input_tokens)
  const max = Math.max(...sorted.map((p) => p.p50_ms))
  return (
    <section aria-label="TTFT by prompt length">
      <PanelTitle>TTFT by prompt length (p50)</PanelTitle>
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
    </section>
  )
}
