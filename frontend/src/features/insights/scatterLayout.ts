// Pure geometry for the latency-vs-cost scatter: log-x / linear-y scales, ticks,
// the value frontier, and collision-avoiding direct labels.

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Datum<T> {
  item: T
  cost: number
  /** The y metric, e.g. E2E p95 in ms. */
  value: number
}

export type Placed<T> = Datum<T> & { x: number; y: number }

/** Which way the y metric improves. Latency: lower. */
export type Better = 'higher' | 'lower'

export interface ScatterGeometry<T> {
  points: Placed<T>[]
  frontier: Placed<T>[]
  sx: (cost: number) => number
  sy: (value: number) => number
  yTicks: number[]
  xTicks: { v: number; major: boolean }[]
  /** Whether the 2x/5x ticks have room for labels, or only the decades do. */
  labelMinor: boolean
}

const MIN_TICK_LABEL_GAP = 40

/** p beats q on the y metric. */
export const beats = (better: Better, p: number, q: number) => (better === 'higher' ? p > q : p < q)

/** Points on the cost/value Pareto frontier, cheapest first: each beats every cheaper point. */
export function paretoFrontier<T extends { cost: number; value: number }>(points: T[], better: Better = 'higher'): T[] {
  const sign = better === 'higher' ? -1 : 1
  const sorted = [...points].sort((a, b) => a.cost - b.cost || (a.value - b.value) * sign)
  const out: T[] = []
  let best = better === 'higher' ? -Infinity : Infinity
  for (const p of sorted) {
    if (beats(better, p.value, best)) {
      out.push(p)
      best = p.value
    }
  }
  return out
}

/** Points the selection dominates: worse on the y metric and more expensive. */
export const dominatedBy = <T extends { cost: number; value: number }>(sel: T, better: Better) => (p: T) =>
  beats(better, sel.value, p.value) && p.cost > sel.cost

/** A 1/2/5 × 10^k step giving roughly `count` intervals over `span`. */
export function niceStep(span: number, count = 5) {
  if (!(span > 0)) return 1
  const raw = span / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  const m = raw / pow
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow
}

export function buildScatter<T>(data: Datum<T>[], plot: Box, better: Better = 'higher'): ScatterGeometry<T> | null {
  if (!data.length || plot.w <= 0 || plot.h <= 0) return null
  const logs = data.map((d) => Math.log10(d.cost))
  const values = data.map((d) => d.value)
  const lo = Math.min(...logs)
  const hi = Math.max(...logs)
  const span = hi - lo || 1
  const x0 = lo - span * 0.06
  const x1 = hi + span * 0.06
  const vMin = Math.min(...values)
  const vMax = Math.max(...values)
  const step = niceStep((vMax - vMin) * 1.1 || Math.abs(vMax) || 1)
  const y0 = Math.max(vMin >= 0 ? 0 : -Infinity, Math.floor((vMin - step * 0.25) / step) * step)
  const y1 = Math.ceil((vMax + step * 0.25) / step) * step
  const sx = (c: number) => plot.x + ((Math.log10(c) - x0) / (x1 - x0)) * plot.w
  const sy = (v: number) => plot.y + ((y1 - v) / (y1 - y0)) * plot.h

  const points = data.map((d) => ({ ...d, x: sx(d.cost), y: sy(d.value) }))

  const yTicks: number[] = []
  for (let v = y0; v <= y1 + step / 1e6; v += step) yTicks.push(Math.round(v * 1e6) / 1e6)

  const xTicks: { v: number; major: boolean }[] = []
  for (let d = Math.floor(x0); d <= Math.ceil(x1); d++) {
    for (const mult of [1, 2, 5]) {
      const v = mult * 10 ** d
      if (Math.log10(v) >= x0 && Math.log10(v) <= x1) xTicks.push({ v, major: mult === 1 })
    }
  }
  const gaps = xTicks.slice(1).map((t, i) => sx(t.v) - sx(xTicks[i].v))
  const labelMinor = gaps.length === 0 || Math.min(...gaps) >= MIN_TICK_LABEL_GAP

  return { points, frontier: paretoFrontier(points, better), sx, sy, yTicks, xTicks, labelMinor }
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const inside = (b: Box, area: Box) => b.x >= area.x && b.y >= area.y && b.x + b.w <= area.x + area.w && b.y + b.h <= area.y + area.h

/**
 * Greedy label placement. Each label tries positions around its point and takes
 * the first that stays inside the area and clear of every point and earlier
 * label. A label with no clear position is dropped (the tooltip still names it):
 * a label sitting on another dot reads as belonging to it.
 */
export function placeLabels<L extends { x: number; y: number; w: number; h: number }>(
  labels: L[],
  obstacles: { x: number; y: number }[],
  area: Box,
  markRadius: number,
): (L & { box: Box })[] {
  const pad = markRadius + 2
  const pointBoxes = obstacles.map((p) => ({ x: p.x - pad, y: p.y - pad, w: pad * 2, h: pad * 2 }))
  const placed: Box[] = []
  const out: (L & { box: Box })[] = []
  for (const l of labels) {
    const { x, y, w, h } = l
    const candidates: Box[] = [
      { x: x - w - 6, y: y - h - 8, w, h }, // above-left
      { x: x + 10, y: y + 6, w, h }, // below-right
      { x: x + 8, y: y - h - 8, w, h }, // above-right
      { x: x - w - 10, y: y + 6, w, h }, // below-left
      { x: x + 12, y: y - h / 2, w, h }, // right
      { x: x - w - 12, y: y - h / 2, w, h }, // left
    ]
    const box = candidates.find((b) => inside(b, area) && !placed.some((o) => overlaps(o, b)) && !pointBoxes.some((o) => overlaps(o, b)))
    if (!box) continue
    placed.push(box)
    out.push({ ...l, box })
  }
  return out
}

/**
 * The point closest to (x, y) within `maxDist` px, or undefined. Used for hover
 * and click instead of per-point hit areas: when points overlap (e.g. one model
 * from two providers), a per-point target drawn on top would steal clicks from
 * the dot actually under the pointer.
 */
export function nearestPoint<P extends { x: number; y: number }>(points: P[], x: number, y: number, maxDist: number): P | undefined {
  let best: P | undefined
  let bestD = maxDist * maxDist
  for (const p of points) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2
    if (d <= bestD) {
      best = p
      bestD = d
    }
  }
  return best
}
