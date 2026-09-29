import { useMemo, useState } from 'react'
import type { ModelEntry } from '../../api/types'
import { useBoard } from '../../shared/board/BoardContext'
import { viewLabel } from '../../shared/board/boardIndex'
import { costFor, scoreFor, shortName, type View } from '../../shared/board/model'
import { formatCost, formatCostTick, formatScore } from '../../shared/lib/format'
import { measureText, useFontsReady } from '../../shared/lib/hooks'
import { cssVar } from '../../shared/lib/tokens'
import { CHART_TEXT, ChartFrame } from '../../shared/ui/ChartFrame'
import { LineKey, OrgDot } from '../../shared/ui/marks'
import { Tip, TooltipRows } from '../../shared/ui/Tooltip'
import { buildScatter, placeLabels, type Datum, type Placed } from './scatterLayout'

const HEIGHT = 440
const M = { top: 16, right: 24, bottom: 52, left: 60 }
const R = 6
const LINE_H = 14

// Direct-label type. The same values style the <text> and feed measurement, so
// collision layout always matches what renders.
const LABEL_TYPE = {
  name: { fontSize: CHART_TEXT.label, fontWeight: 600 },
  variant: { fontSize: CHART_TEXT.small, fontWeight: 400 },
}
const fontFamily = () => getComputedStyle(document.documentElement).getPropertyValue('--font-sans') || 'sans-serif'
const cssFont = (t: { fontSize: number; fontWeight: number }) => `${t.fontWeight} ${t.fontSize}px ${fontFamily()}`

type Point = Placed<ModelEntry>

export function QualityCostScatter({ models, view }: { models: ModelEntry[]; view: View }) {
  const board = useBoard()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const data = useMemo(
    () =>
      models.flatMap<Datum<ModelEntry>>((m) => {
        const cost = costFor(m, view)
        const score = scoreFor(m, view)
        return cost != null && score != null ? [{ item: m, cost, score }] : []
      }),
    [models, view],
  )

  const presentColors = new Set(data.map((d) => board.palette.color(d.item.organization)))
  const legend = board.palette.legend.filter((l) => presentColors.has(l.color))
  const selected = data.find((d) => d.item.id === selectedId)
  const beaten = selected ? data.filter((d) => d.score < selected.score && d.cost > selected.cost).length : 0

  if (data.length === 0) return <p className="py-24 text-center text-ink-2">No models report cost for this view.</p>
  return (
    <div>
      <ChartFrame height={HEIGHT}>
        {(width) => <ScatterPlot data={data} view={view} width={width} selectedId={selectedId} onSelect={setSelectedId} />}
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
            Beaten by {shortName(selected.item)} ({beaten})
          </span>
        )}
      </div>
    </div>
  )
}

function ScatterPlot({
  data,
  view,
  width,
  selectedId,
  onSelect,
}: {
  data: Datum<ModelEntry>[]
  view: View
  width: number
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const board = useBoard()
  const fontsReady = useFontsReady()
  const [hoverId, setHoverId] = useState<string | null>(null)

  const plot = useMemo(() => ({ x: M.left, y: M.top, w: Math.max(0, width - M.left - M.right), h: HEIGHT - M.top - M.bottom }), [width])
  const chart = useMemo(() => buildScatter(data, plot), [data, plot])

  const selected = chart?.points.find((p) => p.item.id === selectedId)
  const dominated = (p: Point) => !!selected && p.score < selected.score && p.cost > selected.cost

  const labels = useMemo(() => {
    // Measuring before the web font loads would lay labels out with fallback metrics.
    if (!chart || !fontsReady) return []
    const frontierIds = new Set(chart.frontier.map((p) => p.item.id))
    const wanted = [
      ...(selected && !frontierIds.has(selected.item.id) ? [selected] : []),
      ...[...chart.frontier].sort((a, b) => b.score - a.score),
    ]
    const nameFont = cssFont(LABEL_TYPE.name)
    const variantFont = cssFont(LABEL_TYPE.variant)
    const sized = wanted.map((p) => {
      const name = shortName(p.item)
      const variant = p.item.variant ? `(${p.item.variant})` : undefined
      const w = Math.max(measureText(name, nameFont), variant ? measureText(variant, variantFont) : 0)
      return { x: p.x, y: p.y, w, h: variant ? LINE_H * 2 + 2 : LINE_H + 2, id: p.item.id, name, variant }
    })
    return placeLabels(sized, chart.points, plot, R)
  }, [chart, selected, plot, fontsReady])

  if (!chart) return null
  const label = viewLabel(board, view)
  const toggleSelect = (id: string) => onSelect(selectedId === id ? null : id)

  return (
    <svg
      width={width}
      height={HEIGHT}
      role="img"
      aria-label={`Scatter of ${label} score versus cost per successful task for ${data.length} models`}
      onClick={() => onSelect(null)}
      className="block overflow-visible select-none"
    >
      {chart.yTicks.map((v) => (
        <g key={`y${v}`}>
          <line x1={plot.x} x2={plot.x + plot.w} y1={chart.sy(v)} y2={chart.sy(v)} className="stroke-grid" />
          <text x={plot.x - 12} y={chart.sy(v)} dy="0.32em" textAnchor="end" fontSize={CHART_TEXT.tick} className="fill-muted font-mono tabular-nums">
            {v}
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
        Cost per successful task (log) →
      </text>
      <text transform={`translate(16 ${plot.y + plot.h}) rotate(-90)`} fontSize={CHART_TEXT.tick} className="fill-muted font-mono">
        {label} score ↑
      </text>

      {/* kill zone: everything that scores lower and costs more than the selection */}
      {selected && (
        <rect
          x={selected.x}
          y={selected.y}
          width={plot.x + plot.w - selected.x}
          height={plot.y + plot.h - selected.y}
          className="fill-ink/[0.045] stroke-line-strong"
        />
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
          const m = p.item
          const isSel = m.id === selectedId
          return (
            <Tip
              key={m.id}
              content={
                <>
                  <div className="flex items-center gap-2 font-semibold text-ink">
                    <OrgDot color={board.palette.color(m.organization)} />
                    <span className="truncate">{m.name}</span>
                  </div>
                  <div className="mt-0.5 mb-2 text-xs text-muted">{m.organization}</div>
                  <TooltipRows
                    rows={[
                      [label, formatScore(p.score)],
                      ['Cost / success', formatCost(p.cost)],
                    ]}
                  />
                  <div className="mt-2 text-micro text-muted">{isSel ? 'Click to clear kill zone' : 'Click to show kill zone'}</div>
                </>
              }
            >
              <g
                tabIndex={0}
                role="button"
                aria-pressed={isSel}
                aria-label={`${m.name}: ${formatScore(p.score)} at ${formatCost(p.cost)}`}
                className="cursor-pointer outline-none"
                onMouseEnter={() => setHoverId(m.id)}
                onMouseLeave={() => setHoverId(null)}
                onFocus={() => setHoverId(m.id)}
                onBlur={() => setHoverId(null)}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleSelect(m.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleSelect(m.id)
                  }
                }}
              >
                <circle cx={p.x} cy={p.y} r={12} fill="transparent" />
                {(isSel || m.id === hoverId) && <circle cx={p.x} cy={p.y} r={R + 4} fill="none" strokeWidth={1.5} className="stroke-ink" />}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={R}
                  fill={dominated(p) ? cssVar.dim : board.palette.color(m.organization)}
                  strokeWidth={2}
                  className="stroke-surface"
                />
              </g>
            </Tip>
          )
        })}

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
