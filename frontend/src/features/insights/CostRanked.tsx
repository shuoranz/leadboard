import { useMemo, useState } from 'react'
import type { LeaderboardRow } from '../../api/types'
import { useBoard } from '../../shared/board/BoardContext'
import { costPer1k, displayName, e2eP95 } from '../../shared/board/model'
import { formatCost1k, formatInt, formatPrice } from '../../shared/lib/format'
import { OrgDot } from '../../shared/ui/marks'
import { SelectPill } from '../../shared/ui/SelectPill'
import { Tip, TooltipRows } from '../../shared/ui/Tooltip'

const DEFAULT_COUNT = 12

export function CostRanked({ rows: all }: { rows: LeaderboardRow[] }) {
  const { palette } = useBoard()
  // null = the default set (the fastest rows); otherwise an explicit pick
  const [ids, setIds] = useState<string[] | null>(null)

  const withCost = useMemo(() => all.filter((m) => costPer1k(m) != null), [all])
  const defaultIds = useMemo(
    () =>
      [...withCost]
        .sort((a, b) => (e2eP95(a) ?? Infinity) - (e2eP95(b) ?? Infinity))
        .slice(0, DEFAULT_COUNT)
        .map((m) => m.id),
    [withCost],
  )

  const current = new Set(ids ?? defaultIds)
  const rows = withCost.filter((m) => current.has(m.id)).sort((a, b) => costPer1k(a)! - costPer1k(b)!)
  const max = Math.max(...rows.map((m) => costPer1k(m)!), 0)
  const addable = withCost.filter((m) => !current.has(m.id)).sort((a, b) => displayName(a).localeCompare(displayName(b)))

  return (
    <div>
      <div className="flex items-center gap-3">
        <SelectPill label="Add a model" value="" onChange={(id) => id && setIds([...current, id])} className="w-full max-w-md">
          <option value="">Add a model…</option>
          {addable.map((m) => (
            <option key={m.id} value={m.id}>
              {displayName(m)}
            </option>
          ))}
        </SelectPill>
        {ids && (
          <button type="button" onClick={() => setIds(null)} className="shrink-0 font-mono text-xs text-accent">
            Reset
          </button>
        )}
      </div>

      {rows.length === 0 && <p className="py-10 text-center text-ink-2">No models to rank.</p>}
      <ol className="mt-4 grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_4.5rem_1.25rem] items-center gap-x-3 gap-y-1">
        {rows.map((m) => {
          const cost = costPer1k(m)!
          const color = palette.color(m.organization)
          return (
            <li key={m.id} className="group col-span-4 grid grid-cols-subgrid items-center">
              {/* The row itself is the (focusable) tooltip trigger; remove sits outside it. */}
              <Tip
                side="bottom"
                content={
                  <TooltipRows
                    rows={[
                      ['$ / 1M output', formatPrice(m.cost.output_per_million)],
                      ['Avg tokens in / out', `${formatInt(m.perf.avg_input_tokens)} / ${formatInt(m.perf.avg_output_tokens)}`],
                      ['E2E p95', `${formatInt(e2eP95(m))} ms`],
                    ]}
                  />
                }
              >
                <button
                  type="button"
                  aria-label={`${displayName(m)}: ${formatCost1k(cost)} per 1K successful requests`}
                  className="col-span-3 grid grid-cols-subgrid items-center rounded-md py-1.5 text-left focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span className="flex min-w-0 items-center gap-2.5 text-body text-ink">
                    <OrgDot color={color} />
                    <span className="truncate" title={displayName(m)}>
                      {m.name}
                      {m.routing === 'fixed' && <span className="text-muted"> · {m.provider}</span>}
                    </span>
                  </span>
                  <span className="h-5 rounded-[4px] bg-surface-2">
                    <span className="block h-5 rounded-r-[4px]" style={{ width: `${Math.max(1.2, (cost / max) * 100)}%`, background: color }} />
                  </span>
                  <span className="text-right font-mono text-body text-ink tabular-nums">{formatCost1k(cost)}</span>
                </button>
              </Tip>
              <button
                type="button"
                aria-label={`Remove ${displayName(m)}`}
                onClick={() => setIds([...current].filter((id) => id !== m.id))}
                className="text-muted opacity-0 group-hover:opacity-100 hover:text-ink focus:opacity-100"
              >
                ×
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
