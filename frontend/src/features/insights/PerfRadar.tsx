import { useState } from 'react'
import type { LeaderboardRow } from '../../api/types'
import { useBoard } from '../../shared/board/BoardContext'
import { costPer1k, displayName } from '../../shared/board/model'
import { formatCost1k, formatDecimal, formatInt, formatPercent } from '../../shared/lib/format'
import { CHART_TEXT, ChartFrame } from '../../shared/ui/ChartFrame'
import { LineKey } from '../../shared/ui/marks'
import { SelectPill } from '../../shared/ui/SelectPill'

const MAX_PICKS = 3
const MAX_SIZE = 420
const LABEL_ROOM = 56
const RINGS = [20, 40, 60, 80, 100]
/** The worst row on an axis still gets a visible sliver, so its shape doesn't collapse to the center. */
const FLOOR = 12
// Color means organization everywhere on the page; the pick's slot sets the line
// style, so two rows from the same organization stay distinguishable.
const DASHES = [undefined, '6 4', '1.5 3.5']

interface Axis {
  key: string
  name: string
  abbr: string
  better: 'higher' | 'lower'
  get: (r: LeaderboardRow) => number | undefined
  format: (v: number | undefined) => string
}

/** Every axis points outward for "better", so a bigger shape is a better deployment. */
export const AXES: Axis[] = [
  { key: 'ttft', name: 'TTFT p50 (ms)', abbr: 'TTFT', better: 'lower', get: (r) => r.perf.ttft_ms?.p50, format: formatInt },
  { key: 'e2e', name: 'E2E p95 (ms)', abbr: 'E2E', better: 'lower', get: (r) => r.perf.e2e_ms?.p95, format: formatInt },
  { key: 'decode', name: 'Decode (tok/s)', abbr: 'Decode', better: 'higher', get: (r) => r.perf.decode_tps_p50, format: formatDecimal },
  { key: 'success', name: 'Success rate', abbr: 'Success', better: 'higher', get: (r) => r.perf.success_rate, format: formatPercent },
  { key: 'cost', name: 'Cost / 1K successful requests', abbr: 'Cost', better: 'lower', get: costPer1k, format: formatCost1k },
]

/** 0–100 position on an axis, relative to the best and worst rows on the board. */
export function normalize(axis: Axis, rows: LeaderboardRow[], v: number | undefined): number {
  if (v == null) return 0
  const vals = rows.map(axis.get).filter((x): x is number => x != null)
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  if (hi === lo) return 100
  const t = axis.better === 'higher' ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo)
  return FLOOR + (100 - FLOOR) * Math.max(0, Math.min(1, t))
}

interface Pick {
  id: string
  /** Line-style slot, kept for the pick's lifetime so removing one never restyles the others. */
  slot: number
}

interface Series {
  r: LeaderboardRow
  color: string
  dash?: string
}

export function PerfRadar({ rows }: { rows: LeaderboardRow[] }) {
  const board = useBoard()
  const [picks, setPicks] = useState<Pick[]>(() => rows.slice(0, 2).map((r, slot) => ({ id: r.id, slot })))

  const series: Series[] = picks.flatMap((p) => {
    const r = board.rowsById.get(p.id)
    return r ? [{ r, color: board.palette.color(r.organization), dash: DASHES[p.slot] }] : []
  })

  const add = (id: string) => {
    if (!id || picks.length >= MAX_PICKS) return
    const used = new Set(picks.map((p) => p.slot))
    const slot = [0, 1, 2].find((s) => !used.has(s))!
    setPicks([...picks, { id, slot }])
  }

  return (
    <div className="flex flex-col items-center gap-8 lg:flex-row lg:items-center">
      <ChartFrame height={(w) => Math.min(w, MAX_SIZE) * 0.86} className="max-w-[26rem] shrink-0">
        {(w, h) => <RadarPlot series={series} rows={board.rows} width={w} height={h} />}
      </ChartFrame>

      <div className="w-full min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          {series.map(({ r, color, dash }) => (
            <span key={r.id} className="inline-flex h-10 items-center gap-2 rounded-full border-2 border-ink/80 pr-2 pl-4 text-body font-semibold text-ink">
              <LineKey color={color} dash={dash} />
              {displayName(r)}
              <button
                type="button"
                aria-label={`Remove ${displayName(r)}`}
                onClick={() => setPicks(picks.filter((p) => p.id !== r.id))}
                className="rounded-full px-1.5 text-muted hover:text-ink"
              >
                ×
              </button>
            </span>
          ))}
          {picks.length < MAX_PICKS && (
            <SelectPill label="Add model" value="" onChange={add} mono={false} className="min-w-64">
              <option value="">+ Add model…</option>
              {rows
                .filter((r) => !picks.some((p) => p.id === r.id))
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {displayName(r)}
                  </option>
                ))}
            </SelectPill>
          )}
        </div>
        <p className="mt-3 text-sm text-muted">Compare any 2–3 rows · each axis scaled from the board's worst (center) to its best (edge)</p>

        {series.length > 0 && (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full max-w-2xl text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="py-2 pr-4 text-left font-mono text-micro font-semibold tracking-wider text-muted uppercase">
                    Metric
                  </th>
                  {series.map(({ r, color, dash }) => (
                    <th key={r.id} scope="col" className="px-3 py-2 text-right font-medium text-ink-2">
                      <span className="inline-flex items-center gap-1.5">
                        <LineKey color={color} dash={dash} width={16} />
                        <span className="max-w-48 truncate" title={displayName(r)}>
                          {r.short_name ?? r.name}
                          {r.routing === 'fixed' && <span className="text-muted"> · {r.provider}</span>}
                        </span>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {AXES.map((a) => {
                  const values = series.map(({ r }) => a.get(r))
                  const known = values.filter((v): v is number => v != null)
                  const best = a.better === 'higher' ? Math.max(...known) : Math.min(...known)
                  return (
                    <tr key={a.key} className="border-b border-line last:border-0">
                      <th scope="row" className="py-1.5 pr-4 text-left font-normal text-ink-2">
                        {a.name}
                      </th>
                      {series.map(({ r }, i) => (
                        <td
                          key={r.id}
                          className={
                            series.length > 1 && values[i] === best
                              ? 'px-3 py-1.5 text-right font-mono font-bold text-ink tabular-nums'
                              : 'px-3 py-1.5 text-right font-mono text-ink-2 tabular-nums'
                          }
                        >
                          {a.format(values[i])}
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
function RadarPlot({ series, rows, width, height }: { series: Series[]; rows: LeaderboardRow[]; width: number; height: number }) {
  const n = AXES.length
  const cx = width / 2
  const cy = height / 2
  const R = Math.max(40, Math.min(width / 2, height / 2) - LABEL_ROOM / 2 - 12)

  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n
  const pt = (i: number, v: number) => {
    const r = (R * Math.max(0, Math.min(100, v))) / 100
    return [cx + Math.cos(angle(i)) * r, cy + Math.sin(angle(i)) * r] as const
  }
  const ring = (v: number) => AXES.map((_, i) => pt(i, v).join(',')).join(' ')

  return (
    <svg width={width} height={height} role="img" aria-label="Radar chart of performance for the selected models" className="block overflow-visible">
      {RINGS.map((v) => (
        <polygon key={v} points={ring(v)} fill="none" className="stroke-grid" />
      ))}
      {AXES.map((a, i) => {
        const [x, y] = pt(i, 100)
        const cos = Math.cos(angle(i))
        return (
          <g key={a.key}>
            <line x1={cx} y1={cy} x2={x} y2={y} className="stroke-grid" />
            <text
              x={cx + cos * (R + 18)}
              y={cy + Math.sin(angle(i)) * (R + 18)}
              dy="0.35em"
              textAnchor={cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle'}
              fontSize={CHART_TEXT.small}
              className="fill-muted font-mono"
            >
              <title>{`${a.name} — ${a.better} is better`}</title>
              {a.abbr}
            </text>
          </g>
        )
      })}
      {series.map(({ r, color, dash }) => (
        <g key={r.id}>
          <polygon
            points={AXES.map((a, i) => pt(i, normalize(a, rows, a.get(r))).join(',')).join(' ')}
            fill={color}
            fillOpacity={0.1}
            stroke={color}
            strokeWidth={2}
            strokeDasharray={dash}
            strokeLinejoin="round"
          />
          {AXES.map((a, i) => {
            const [x, y] = pt(i, normalize(a, rows, a.get(r)))
            return (
              <circle key={a.key} cx={x} cy={y} r={4} fill={color} strokeWidth={1.5} className="stroke-surface">
                <title>{`${displayName(r)} · ${a.name}: ${a.format(a.get(r))}`}</title>
              </circle>
            )
          })}
        </g>
      ))}
    </svg>
  )
}
