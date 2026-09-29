// Pure geometry for the quality-vs-cost scatter: log-x / linear-y scales, ticks,
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
  score: number
}

export type Placed<T> = Datum<T> & { x: number; y: number }

export interface ScatterGeometry<T> {
  points: Placed<T>[]
  frontier: Placed<T>[]
  sx: (cost: number) => number
  sy: (score: number) => number
  yTicks: number[]
  xTicks: { v: number; major: boolean }[]
  /** Whether the 2x/5x ticks have room for labels, or only the decades do. */
  labelMinor: boolean
}

const MIN_TICK_LABEL_GAP = 40

/** Points on the cost/quality Pareto frontier, cheapest first: each beats every cheaper point. */
export function paretoFrontier<T extends { cost: number; score: number }>(points: T[]): T[] {
  const sorted = [...points].sort((a, b) => a.cost - b.cost || b.score - a.score)
  const out: T[] = []
  let best = -Infinity
  for (const p of sorted) {
    if (p.score > best) {
      out.push(p)
      best = p.score
    }
  }
  return out
}

export function buildScatter<T>(data: Datum<T>[], plot: Box): ScatterGeometry<T> | null {
  if (!data.length || plot.w <= 0 || plot.h <= 0) return null
  const logs = data.map((d) => Math.log10(d.cost))
  const scores = data.map((d) => d.score)
  const lo = Math.min(...logs)
  const hi = Math.max(...logs)
  const span = hi - lo || 1
  const x0 = lo - span * 0.06
  const x1 = hi + span * 0.06
  const y0 = Math.floor((Math.min(...scores) - 1) / 5) * 5
  const y1 = Math.ceil((Math.max(...scores) + 1) / 5) * 5
  const sx = (c: number) => plot.x + ((Math.log10(c) - x0) / (x1 - x0)) * plot.w
  const sy = (s: number) => plot.y + ((y1 - s) / (y1 - y0)) * plot.h

  const points = data.map((d) => ({ ...d, x: sx(d.cost), y: sy(d.score) }))

  const yStep = y1 - y0 > 40 ? 10 : 5
  const yTicks: number[] = []
  for (let v = y0; v <= y1; v += yStep) yTicks.push(v)

  const xTicks: { v: number; major: boolean }[] = []
  for (let d = Math.floor(x0); d <= Math.ceil(x1); d++) {
    for (const mult of [1, 2, 5]) {
      const v = mult * 10 ** d
      if (Math.log10(v) >= x0 && Math.log10(v) <= x1) xTicks.push({ v, major: mult === 1 })
    }
  }
  const gaps = xTicks.slice(1).map((t, i) => sx(t.v) - sx(xTicks[i].v))
  const labelMinor = gaps.length === 0 || Math.min(...gaps) >= MIN_TICK_LABEL_GAP

  return { points, frontier: paretoFrontier(points), sx, sy, yTicks, xTicks, labelMinor }
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const inside = (b: Box, area: Box) => b.x >= area.x && b.y >= area.y && b.x + b.w <= area.x + area.w && b.y + b.h <= area.y + area.h

/**
 * Greedy label placement. Each label tries positions around its point, first
 * avoiding every point and earlier label, then only earlier labels; a label
 * with no free position is dropped (the tooltip still carries it).
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
    const free = (b: Box, avoidPoints: boolean) =>
      inside(b, area) && !placed.some((o) => overlaps(o, b)) && (!avoidPoints || !pointBoxes.some((o) => overlaps(o, b)))
    const box = candidates.find((b) => free(b, true)) ?? candidates.find((b) => free(b, false))
    if (!box) continue
    placed.push(box)
    out.push({ ...l, box })
  }
  return out
}
