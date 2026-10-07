import { useMemo, useState, type MouseEvent, type PointerEvent } from 'react'
import type { LeaderboardRow } from '../../api/types'
import { useBoard } from '../../shared/board/BoardContext'
import { costPer1k, displayName, shortName } from '../../shared/board/model'
import { formatCost1k, formatCostTick, formatInt } from '../../shared/lib/format'
import { measureText, useFontsReady } from '../../shared/lib/hooks'
import { cssVar } from '../../shared/lib/tokens'
import type { LatencyMetric } from '../../shared/state/searchParams'
import { CHART_TEXT, ChartFrame } from '../../shared/ui/ChartFrame'
import { LineKey, OrgDot } from '../../shared/ui/marks'
import { Tip, TooltipRows } from '../../shared/ui/Tooltip'
import { buildScatter, dominatedBy, nearestPoint, placeLabels, type Datum, type Placed } from './scatterLayout'

export const LATENCY: Record<LatencyMetric, { label: string; short: string; get: (r: LeaderboardRow) => number | undefined }> = {
  e2e_p95: { label: 'E2E p95 · client', short: 'E2E p95', get: (r) => r.perf.e2e_ms?.p95 },
  e2e_p50: { label: 'E2E p50 · client', short: 'E2E p50', get: (r) => r.perf.e2e_ms?.p50 },
  ttft_p50: { label: 'TTFT p50 · server', short: 'TTFT p50', get: (r) => r.perf.ttft_ms?.p50 },
}

const HEIGHT = 440
const M = { top: 16, right: 24, bottom: 52, left: 64 }
const R = 6
/** How far from a dot the pointer may be and still hover or click it. */
const HIT = 14
const LINE_H = 14

// Direct-label type. The same values style the <text> and feed measurement, so
// collision layout always matches what renders.
const LABEL_TYPE = {
  name: { fontSize: CHART_TEXT.label, fontWeight: 600 },
  variant: { fontSize: CHART_TEXT.small, fontWeight: 400 },
}
const fontFamily = () => getComputedStyle(document.documentElement).getPropertyValue('--font-sans') || 'sans-serif'
const cssFont = (t: { fontSize: number; fontWeight: number }) => `${t.fontWeight} ${t.fontSize}px ${fontFamily()}`

type Point = Placed<LeaderboardRow>

export function LatencyCostScatter({ rows, metric }: { rows: LeaderboardRow[]; metric: LatencyMetric }) {
  const board = useBoard()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const data = useMemo(
    () =>
      rows.flatMap<Datum<LeaderboardRow>>((r) => {
        const cost = costPer1k(r)
        const value = LATENCY[metric].get(r)
        return cost != null && value != null ? [{ item: r, cost, value }] : []
      }),
    [rows, metric],
  )

  const presentColors = new Set(data.map((d) => board.palette.color(d.item.organization)))
  const legend = board.palette.legend.filter((l) => presentColors.has(l.color))
  const selected = data.find((d) => d.item.id === selectedId)
  const beaten = selected ? data.filter(dominatedBy(selected, 'lower')).length : 0

  if (data.length === 0) return <p className="py-24 text-center text-ink-2">No rows report both cost and latency.</p>
  return (
    <div>
      <ChartFrame height={HEIGHT}>
        {(width) => <ScatterPlot data={data} metric={metric} width={width} selectedId={selectedId} onSelect={setSelectedId} />}
      </ChartFrame>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-meta text-ink-2">
        {legend.map((l) => (
          <span key={l.org} className="inline-flex items-center gap-1.5">
            <OrgDot color={l.color} size={9} />
            {l.org}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <LineKey color={cssVar.accent} dash="5 4" width={22} />
          Value frontier
        </span>
        {selected && (
          <span className="inline-flex items-center gap-1.5">
            <OrgDot color={cssVar.dim} size={9} />
            Beaten by {displayName(selected.item)} ({beaten})
          </span>
        )}
      </div>
    </div>
  )
}

function ScatterPlot({
  data,
  metric,
  width,
  selectedId,
  onSelect,
}: {
  data: Datum<LeaderboardRow>[]
  metric: LatencyMetric
  width: number
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const board = useBoard()
  const fontsReady = useFontsReady()
  // Pointer hover and keyboard focus are tracked apart, so leaving one doesn't
  // clear the other. Focus wins when both point somewhere.
  const [pointerId, setPointerId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const activeId = focusId ?? pointerId

  const plot = useMemo(() => ({ x: M.left, y: M.top, w: Math.max(0, width - M.left - M.right), h: HEIGHT - M.top - M.bottom }), [width])
  const chart = useMemo(() => buildScatter(data, plot, 'lower'), [data, plot])

  const selected = chart?.points.find((p) => p.item.id === selectedId)
  // Slower and more expensive than the selection (inlined: the compiler can't see through dominatedBy here).
  const dominated = (p: Point) => !!selected && p.value > selected.value && p.cost > selected.cost

  const labels = useMemo(() => {
    // Measuring before the web font loads would lay labels out with fallback metrics.
    if (!chart || !fontsReady) return []
    const frontierIds = new Set(chart.frontier.map((p) => p.item.id))
    const wanted = [...(selected && !frontierIds.has(selected.item.id) ? [selected] : []), ...[...chart.frontier].sort((a, b) => a.value - b.value)]
    const nameFont = cssFont(LABEL_TYPE.name)
    const variantFont = cssFont(LABEL_TYPE.variant)
    const sized = wanted.map((p) => {
      const name = shortName(p.item)
      // Second line: the provider. Several providers serve one model, so it tells their points apart.
      const variant = p.item.routing === 'fixed' ? `(${p.item.provider})` : undefined
      const w = Math.max(measureText(name, nameFont), variant ? measureText(variant, variantFont) : 0)
      return { x: p.x, y: p.y, w, h: variant ? LINE_H * 2 + 2 : LINE_H + 2, id: p.item.id, name, variant }
    })
    return placeLabels(sized, chart.points, plot, R)
  }, [chart, selected, plot, fontsReady])

  if (!chart) return null
  const label = LATENCY[metric].label
  const toggleSelect = (id: string) => onSelect(selectedId === id ? null : id)

  // Pointer input goes through one overlay that picks the nearest dot, so a click
  // always lands on the dot under the pointer even where dots overlap.
  const pointAt = (e: PointerEvent<SVGRectElement> | MouseEvent<SVGRectElement>) => {
    const box = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
    return nearestPoint(chart.points, e.clientX - box.left, e.clientY - box.top, HIT)
  }

  return (
    <svg
      width={width}
      height={HEIGHT}
      role="img"
      aria-label={`Scatter of ${label} latency versus cost per 1K requests for ${data.length} rows`}
      className="block overflow-visible select-none"
    >
      {chart.yTicks.map((v) => (
        <g key={`y${v}`}>
          <line x1={plot.x} x2={plot.x + plot.w} y1={chart.sy(v)} y2={chart.sy(v)} className="stroke-grid" />
          <text x={plot.x - 12} y={chart.sy(v)} dy="0.32em" textAnchor="end" fontSize={CHART_TEXT.tick} className="fill-muted font-mono tabular-nums">
            {formatInt(v)}
          </text>
        </g>
      ))}
      {chart.xTicks.map((t) => (
        <g key={`x${t.v}`}>
          <line x1={chart.sx(t.v)} x2={chart.sx(t.v)} y1={plot.y} y2={plot.y + plot.h} className="stroke-grid" />
          {(t.major || chart.labelMinor) && (
            <text x={chart.sx(t.v)} y={plot.y + plot.h + 18} textAnchor="middle" fontSize={CHART_TEXT.tick} className="fill-muted font-mono tabular-nums">
              {formatCostTick(t.v)}
            </text>
          )}
        </g>
      ))}
      <text x={plot.x + plot.w} y={HEIGHT - 6} textAnchor="end" fontSize={CHART_TEXT.tick} className="fill-muted font-mono">
        Cost per 1K requests (log) →
      </text>
      <text transform={`translate(16 ${plot.y + plot.h}) rotate(-90)`} fontSize={CHART_TEXT.tick} className="fill-muted font-mono">
        {label} (ms) — lower is better
      </text>

      {/* kill zone: everything slower and more expensive than the selection (up and right) */}
      {selected && (
        <rect x={selected.x} y={plot.y} width={plot.x + plot.w - selected.x} height={selected.y - plot.y} className="fill-ink/[0.045] stroke-line-strong" />
      )}

      <polyline
        points={chart.frontier.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        strokeWidth={2}
        strokeDasharray="5 4"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="stroke-accent"
      />

      {/* dominated points first so live points stay on top */}
      {[...chart.points]
        .sort((a, b) => Number(dominated(b)) - Number(dominated(a)))
        .map((p) => {
          const r = p.item
          const isSel = r.id === selectedId
          return (
            <Tip
              key={r.id}
              open={r.id === activeId}
              content={
                <>
                  <div className="flex items-center gap-2 font-semibold text-ink">
                    <OrgDot color={board.palette.color(r.organization)} />
                    <span className="truncate">{displayName(r)}</span>
                  </div>
                  <div className="mt-0.5 mb-2 text-xs text-muted">{r.organization}</div>
                  <TooltipRows
                    rows={[
                      [LATENCY[metric].short, `${formatInt(p.value)} ms`],
                      ['Cost / 1K requests', formatCost1k(p.cost)],
                    ]}
                  />
                  <div className="mt-2 text-micro text-muted">{isSel ? 'Click to clear kill zone' : 'Click to show kill zone'}</div>
                </>
              }
            >
              {/* Each dot is a keyboard stop (Tab, then Enter/Space). Pointer input is
                  handled by the overlay below, so the dot itself ignores it. */}
              <g
                tabIndex={0}
                role="button"
                aria-pressed={isSel}
                aria-label={`${displayName(r)}: ${formatInt(p.value)} ms at ${formatCost1k(p.cost)}`}
                className="pointer-events-none outline-none"
                onFocus={() => setFocusId(r.id)}
                onBlur={() => setFocusId(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleSelect(r.id)
                  }
                }}
              >
                {(isSel || r.id === activeId) && <circle cx={p.x} cy={p.y} r={R + 4} fill="none" strokeWidth={1.5} className="stroke-ink" />}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={R}
                  fill={dominated(p) ? cssVar.dim : board.palette.color(r.organization)}
                  strokeWidth={2}
                  className="stroke-surface"
                />
              </g>
            </Tip>
          )
        })}

      <rect
        aria-hidden
        x={plot.x - HIT}
        y={plot.y - HIT}
        width={plot.w + 2 * HIT}
        height={plot.h + 2 * HIT}
        fill="transparent"
        className={pointerId ? 'cursor-pointer' : undefined}
        onPointerMove={(e) => setPointerId(pointAt(e)?.item.id ?? null)}
        onPointerLeave={() => setPointerId(null)}
        onClick={(e) => {
          // A click on a dot toggles its kill zone; a click on empty space clears it.
          const p = pointAt(e)
          if (p) toggleSelect(p.item.id)
          else onSelect(null)
        }}
      />

      {labels.map(({ id, box, name, variant }) => (
        <g key={`l${id}`} className="pointer-events-none">
          <text x={box.x} y={box.y + LINE_H - 2} style={LABEL_TYPE.name} className="fill-ink-2">
            {name}
          </text>
          {variant && (
            <text x={box.x + box.w} y={box.y + LINE_H * 2} textAnchor="end" style={LABEL_TYPE.variant} className="fill-muted">
              {variant}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}
