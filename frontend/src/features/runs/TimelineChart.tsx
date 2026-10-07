import { useMemo, useState } from 'react'
import type { BlazeMeterResults } from '../../api/types'
import { formatDuration, formatInt } from '../../shared/lib/format'
import { cssVar, tint } from '../../shared/lib/tokens'
import { CHART_TEXT, ChartFrame } from '../../shared/ui/ChartFrame'
import { LineKey } from '../../shared/ui/marks'
import { Tip, TooltipRows } from '../../shared/ui/Tooltip'
import { niceStep } from '../insights/scatterLayout'

type Point = BlazeMeterResults['timeline'][number]

const HEIGHT = 260
const M = { top: 14, right: 48, bottom: 36, left: 56 }

/** Response time (left axis) over the test, with active virtual users (right axis) behind it. */
export function TimelineChart({ points, interval }: { points: Point[]; interval: number }) {
  if (points.length === 0) return <p className="py-10 text-center text-ink-2">No samples were recorded.</p>
  return (
    <div>
      <ChartFrame height={HEIGHT}>{(w) => <Plot points={points} interval={interval} width={w} />}</ChartFrame>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-meta text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <LineKey color={cssVar.accent} />
          Avg response
        </span>
        <span className="inline-flex items-center gap-1.5">
          <LineKey color={cssVar.accent} dash="4 3" />
          p90 response
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-4 rounded-sm" style={{ background: tint(cssVar.ink, 10) }} />
          Active virtual users
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-1 rounded-sm bg-bad" />
          Errors
        </span>
      </div>
    </div>
  )
}

function Plot({ points, interval, width }: { points: Point[]; interval: number; width: number }) {
  const [active, setActive] = useState<number | null>(null)
  const plot = { x: M.left, y: M.top, w: Math.max(0, width - M.left - M.right), h: HEIGHT - M.top - M.bottom }

  const g = useMemo(() => {
    const tMax = Math.max(...points.map((p) => p.t_s)) + interval
    const msMax = Math.max(1, ...points.map((p) => p.p90_ms ?? p.avg_ms ?? 0))
    const msStep = niceStep(msMax, 4)
    const msTop = Math.ceil(msMax / msStep) * msStep
    const usersTop = Math.max(1, ...points.map((p) => p.users))
    const errMax = Math.max(1, ...points.map((p) => p.errors))
    const tStep = niceStep(tMax, Math.max(2, Math.floor(plot.w / 90)))
    const sx = (t: number) => plot.x + (t / tMax) * plot.w
    const sy = (ms: number) => plot.y + plot.h - (ms / msTop) * plot.h
    const su = (u: number) => plot.y + plot.h - (u / usersTop) * plot.h * 0.92
    const msTicks: number[] = []
    for (let v = 0; v <= msTop + 1e-9; v += msStep) msTicks.push(v)
    const tTicks: number[] = []
    for (let v = 0; v <= tMax + 1e-9; v += tStep) tTicks.push(v)
    return { tMax, msTop, usersTop, errMax, sx, sy, su, msTicks, tTicks }
  }, [points, interval, plot.w, plot.h, plot.x, plot.y])

  const mid = (p: Point) => g.sx(p.t_s + interval / 2)
  const line = (key: 'avg_ms' | 'p90_ms') =>
    points
      .filter((p) => p[key] != null)
      .map((p) => `${mid(p)},${g.sy(p[key]!)}`)
      .join(' ')
  // Users as a step area: flat across each interval.
  const area = [
    `${g.sx(0)},${plot.y + plot.h}`,
    ...points.flatMap((p) => [`${g.sx(p.t_s)},${g.su(p.users)}`, `${g.sx(p.t_s + interval)},${g.su(p.users)}`]),
    `${g.sx(points.at(-1)!.t_s + interval)},${plot.y + plot.h}`,
  ].join(' ')
  const bandW = Math.max(1, g.sx(interval) - g.sx(0))

  return (
    <svg width={width} height={HEIGHT} role="img" aria-label="BlazeMeter timeline: response time and active users over the test" className="block overflow-visible">
      <polygon points={area} fill={tint(cssVar.ink, 7)} />
      {g.msTicks.map((v) => (
        <g key={`y${v}`}>
          <line x1={plot.x} x2={plot.x + plot.w} y1={g.sy(v)} y2={g.sy(v)} className="stroke-grid" />
          <text x={plot.x - 10} y={g.sy(v)} dy="0.32em" textAnchor="end" fontSize={CHART_TEXT.tick} className="fill-muted font-mono tabular-nums">
            {formatInt(v)}
          </text>
        </g>
      ))}
      {g.tTicks.map((t) => (
        <text key={`x${t}`} x={g.sx(t)} y={plot.y + plot.h + 18} textAnchor="middle" fontSize={CHART_TEXT.tick} className="fill-muted font-mono tabular-nums">
          {formatDuration(t)}
        </text>
      ))}
      <text x={plot.x} y={plot.y - 2} fontSize={CHART_TEXT.small} className="fill-muted font-mono">
        ms
      </text>
      <text x={plot.x + plot.w + 8} y={g.su(g.usersTop)} dy="0.32em" fontSize={CHART_TEXT.small} className="fill-muted font-mono tabular-nums">
        {g.usersTop} VU
      </text>
      {points.map(
        (p, i) =>
          p.errors > 0 && (
            <rect
              key={`e${i}`}
              x={mid(p) - 1.5}
              y={plot.y + plot.h - Math.max(3, (p.errors / g.errMax) * 18)}
              width={3}
              height={Math.max(3, (p.errors / g.errMax) * 18)}
              className="fill-bad"
            />
          ),
      )}
      <polyline points={line('p90_ms')} fill="none" stroke={cssVar.accent} strokeWidth={1.5} strokeDasharray="4 3" strokeLinejoin="round" />
      <polyline points={line('avg_ms')} fill="none" stroke={cssVar.accent} strokeWidth={2} strokeLinejoin="round" />

      {active != null && <line x1={mid(points[active])} x2={mid(points[active])} y1={plot.y} y2={plot.y + plot.h} className="stroke-line-strong" />}
      {points.map((p, i) => (
        <Tip
          key={i}
          open={active === i}
          content={
            <TooltipRows
              rows={[
                ['Time', `${formatDuration(p.t_s)} – ${formatDuration(p.t_s + interval)}`],
                ['Virtual users', formatInt(p.users)],
                ['Hits', formatInt(p.hits)],
                ['Errors', formatInt(p.errors)],
                ['Avg response', `${formatInt(p.avg_ms)} ms`],
                ['p90 response', `${formatInt(p.p90_ms)} ms`],
              ]}
            />
          }
        >
          <rect
            x={g.sx(p.t_s)}
            y={plot.y}
            width={bandW}
            height={plot.h}
            fill="transparent"
            tabIndex={0}
            aria-label={`${formatDuration(p.t_s)}: ${formatInt(p.avg_ms)} ms average, ${p.users} users, ${p.errors} errors`}
            className="outline-none focus-visible:fill-accent/10"
            onPointerEnter={() => setActive(i)}
            onPointerLeave={() => setActive((a) => (a === i ? null : a))}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          />
        </Tip>
      ))}
    </svg>
  )
}
