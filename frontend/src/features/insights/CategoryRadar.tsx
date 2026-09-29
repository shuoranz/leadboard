import { useState } from 'react'
import type { ModelEntry } from '../../api/types'
import { useBoard } from '../../shared/board/BoardContext'
import { abbrLabel } from '../../shared/board/model'
import { formatScore } from '../../shared/lib/format'
import { CHART_TEXT, ChartFrame } from '../../shared/ui/ChartFrame'
import { LineKey } from '../../shared/ui/marks'
import { SelectPill } from '../../shared/ui/SelectPill'

const MAX_PICKS = 3
const MAX_SIZE = 420
const LABEL_ROOM = 56
const RINGS = [20, 40, 60, 80, 100]
// Color means organization everywhere on the page; the pick's slot sets the line
// style, so two models from the same organization stay distinguishable.
const DASHES = [undefined, '6 4', '1.5 3.5']

interface Pick {
  id: string
  /** Line-style slot, kept for the pick's lifetime so removing one never restyles the others. */
  slot: number
}

interface Series {
  m: ModelEntry
  color: string
  dash?: string
}

export function CategoryRadar({ models }: { models: ModelEntry[] }) {
  const board = useBoard()
  const [picks, setPicks] = useState<Pick[]>(() => models.slice(0, 2).map((m, slot) => ({ id: m.id, slot })))

  const series: Series[] = picks.flatMap((p) => {
    const m = board.modelsById.get(p.id)
    return m ? [{ m, color: board.palette.color(m.organization), dash: DASHES[p.slot] }] : []
  })

  const add = (id: string) => {
    if (!id || picks.length >= MAX_PICKS) return
    const used = new Set(picks.map((p) => p.slot))
    const slot = [0, 1, 2].find((s) => !used.has(s))!
    setPicks([...picks, { id, slot }])
  }

  // Keys are namespaced: a category id may be anything, including "overall".
  const rows = [
    { key: 'overall', name: 'Overall', get: (m: ModelEntry) => m.overall },
    ...board.categories.map((c) => ({ key: `cat:${c.id}`, name: c.name, get: (m: ModelEntry) => m.categories[c.id] })),
  ]

  return (
    <div className="flex flex-col items-center gap-8 lg:flex-row lg:items-center">
      {board.categories.length >= 3 ? (
        <ChartFrame height={(w) => Math.min(w, MAX_SIZE) * 0.86} className="max-w-[26rem] shrink-0">
          {(w, h) => <RadarPlot series={series} width={w} height={h} />}
        </ChartFrame>
      ) : (
        <p className="text-ink-2">A radar needs at least three categories — see the table.</p>
      )}

      <div className="w-full min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          {series.map(({ m, color, dash }) => (
            <span key={m.id} className="inline-flex h-10 items-center gap-2 rounded-full border-2 border-ink/80 pr-2 pl-4 text-body font-semibold text-ink">
              <LineKey color={color} dash={dash} />
              {m.name}
              <button
                type="button"
                aria-label={`Remove ${m.name}`}
                onClick={() => setPicks(picks.filter((p) => p.id !== m.id))}
                className="rounded-full px-1.5 text-muted hover:text-ink"
              >
                ×
              </button>
            </span>
          ))}
          {picks.length < MAX_PICKS && (
            <SelectPill label="Add model" value="" onChange={add} mono={false} className="min-w-64">
              <option value="">+ Add model…</option>
              {models
                .filter((m) => !picks.some((p) => p.id === m.id))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </SelectPill>
          )}
        </div>
        <p className="mt-3 text-sm text-muted">Compare any 2–3 models · category averages · ranked by overall</p>

        {series.length > 0 && (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full max-w-2xl text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="py-2 pr-4 text-left font-mono text-micro font-semibold tracking-wider text-muted uppercase">
                    Category
                  </th>
                  {series.map(({ m, color, dash }) => (
                    <th key={m.id} scope="col" className="px-3 py-2 text-right font-medium text-ink-2">
                      <span className="inline-flex items-center gap-1.5">
                        <LineKey color={color} dash={dash} width={16} />
                        <span className="max-w-40 truncate">{m.short_name ?? m.name}</span>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const values = series.map(({ m }) => r.get(m))
                  const best = Math.max(...values.map((v) => v ?? -Infinity))
                  return (
                    <tr key={r.key} className="border-b border-line last:border-0">
                      <th scope="row" className={r.key === 'overall' ? 'py-1.5 pr-4 text-left font-semibold text-ink' : 'py-1.5 pr-4 text-left font-normal text-ink-2'}>
                        {r.name}
                      </th>
                      {series.map(({ m }, i) => (
                        <td
                          key={m.id}
                          className={
                            series.length > 1 && values[i] === best
                              ? 'px-3 py-1.5 text-right font-mono font-bold text-ink tabular-nums'
                              : 'px-3 py-1.5 text-right font-mono text-ink-2 tabular-nums'
                          }
                        >
                          {formatScore(values[i])}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/** Drawn at real pixel size (via ChartFrame), so labels keep their type size on phones. */
function RadarPlot({ series, width, height }: { series: Series[]; width: number; height: number }) {
  const { categories } = useBoard()
  const n = categories.length
  const cx = width / 2
  const cy = height / 2
  const R = Math.max(40, Math.min(width / 2, height / 2) - LABEL_ROOM / 2 - 12)

  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n
  const pt = (i: number, v: number) => {
    const r = (R * Math.max(0, Math.min(100, v))) / 100
    return [cx + Math.cos(angle(i)) * r, cy + Math.sin(angle(i)) * r] as const
  }
  const ring = (v: number) => categories.map((_, i) => pt(i, v).join(',')).join(' ')

  return (
    <svg width={width} height={height} role="img" aria-label="Radar chart of category scores for the selected models" className="block overflow-visible">
      {RINGS.map((v) => (
        <polygon key={v} points={ring(v)} fill="none" className="stroke-grid" />
      ))}
      {categories.map((c, i) => {
        const [x, y] = pt(i, 100)
        const cos = Math.cos(angle(i))
        return (
          <g key={c.id}>
            <line x1={cx} y1={cy} x2={x} y2={y} className="stroke-grid" />
            <text
              x={cx + cos * (R + 18)}
              y={cy + Math.sin(angle(i)) * (R + 18)}
              dy="0.35em"
              textAnchor={cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle'}
              fontSize={CHART_TEXT.small}
              className="fill-muted font-mono"
            >
              <title>{c.name}</title>
              {abbrLabel(c)}
            </text>
          </g>
        )
      })}
      {series.map(({ m, color, dash }) => (
        <g key={m.id}>
          <polygon
            points={categories.map((c, i) => pt(i, m.categories[c.id] ?? 0).join(',')).join(' ')}
            fill={color}
            fillOpacity={0.1}
            stroke={color}
            strokeWidth={2}
            strokeDasharray={dash}
            strokeLinejoin="round"
          />
          {categories.map((c, i) => {
            const [x, y] = pt(i, m.categories[c.id] ?? 0)
            return (
              <circle key={c.id} cx={x} cy={y} r={4} fill={color} strokeWidth={1.5} className="stroke-surface">
                <title>{`${m.name} · ${c.name}: ${formatScore(m.categories[c.id])}`}</title>
              </circle>
            )
          })}
        </g>
      ))}
    </svg>
  )
}
