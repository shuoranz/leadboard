import { useMemo, useState } from 'react'
import type { ModelEntry } from '../../api/types'
import { useBoard } from '../../shared/board/BoardContext'
import { costFor, scoreFor, type View } from '../../shared/board/model'
import { formatCost, formatInt, formatPrice, formatScore } from '../../shared/lib/format'
import { OrgDot } from '../../shared/ui/marks'
import { SelectPill } from '../../shared/ui/SelectPill'
import { Tip, TooltipRows } from '../../shared/ui/Tooltip'

const DEFAULT_COUNT = 12

export function CostRanked({ models, view }: { models: ModelEntry[]; view: View }) {
  const { palette } = useBoard()
  // null = the default set (top models by score); otherwise an explicit pick
  const [ids, setIds] = useState<string[] | null>(null)

  const withCost = useMemo(() => models.filter((m) => costFor(m, view) != null), [models, view])
  const defaultIds = useMemo(
    () =>
      [...withCost]
        .sort((a, b) => (scoreFor(b, view) ?? 0) - (scoreFor(a, view) ?? 0))
        .slice(0, DEFAULT_COUNT)
        .map((m) => m.id),
    [withCost, view],
  )

  const current = new Set(ids ?? defaultIds)
  const rows = withCost.filter((m) => current.has(m.id)).sort((a, b) => costFor(a, view)! - costFor(b, view)!)
  const max = Math.max(...rows.map((m) => costFor(m, view)!), 0)
  const addable = withCost.filter((m) => !current.has(m.id)).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div>
      <div className="flex items-center gap-3">
        <SelectPill label="Add a model" value="" onChange={(id) => id && setIds([...current, id])} className="w-full max-w-md">
          <option value="">Add a model…</option>
          {addable.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
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
          const cost = costFor(m, view)!
          const color = palette.color(m.organization)
          return (
            <li key={m.id} className="group col-span-4 grid grid-cols-subgrid items-center">
              {/* The row itself is the (focusable) tooltip trigger; remove sits outside it. */}
              <Tip
                side="bottom"
                content={
                  <TooltipRows
                    rows={[
                      ['$ / 1M output', formatPrice(m.cost?.output_per_million)],
                      ['Avg output tokens', formatInt(m.cost?.avg_output_tokens)],
                      ['Score', formatScore(scoreFor(m, view))],
                    ]}
                  />
                }
              >
                <button
                  type="button"
                  aria-label={`${m.name}: ${formatCost(cost)} per successful task`}
                  className="col-span-3 grid grid-cols-subgrid items-center rounded-md py-1.5 text-left focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span className="flex min-w-0 items-center gap-2.5 text-body text-ink">
                    <OrgDot color={color} />
                    <span className="truncate">{m.name}</span>
                  </span>
                  <span className="h-5 rounded-[4px] bg-surface-2">
                    <span className="block h-5 rounded-r-[4px]" style={{ width: `${Math.max(1.2, (cost / max) * 100)}%`, background: color }} />
                  </span>
                  <span className="text-right font-mono text-body text-ink tabular-nums">{formatCost(cost)}</span>
                </button>
              </Tip>
              <button
                type="button"
                aria-label={`Remove ${m.name}`}
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
