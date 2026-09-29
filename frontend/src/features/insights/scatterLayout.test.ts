import { describe, expect, it } from 'vitest'
import { buildScatter, paretoFrontier, placeLabels } from './scatterLayout'

const plot = { x: 50, y: 10, w: 500, h: 300 }

describe('buildScatter', () => {
  const data = [
    { item: 'a', cost: 0.01, score: 60 },
    { item: 'b', cost: 1, score: 82 },
  ]

  it('maps cost on a log scale inside the plot, cheaper to the left and better upward', () => {
    const g = buildScatter(data, plot)!
    const [a, b] = g.points
    expect(a.x).toBeLessThan(b.x)
    expect(a.y).toBeGreaterThan(b.y)
    for (const p of g.points) {
      expect(p.x).toBeGreaterThanOrEqual(plot.x)
      expect(p.x).toBeLessThanOrEqual(plot.x + plot.w)
    }
    // one decade = equal distance
    expect(g.sx(0.1) - g.sx(0.01)).toBeCloseTo(g.sx(1) - g.sx(0.1))
  })

  it('pads y to multiples of 5 and puts decade ticks on the x axis', () => {
    const g = buildScatter(data, plot)!
    expect(g.yTicks[0] % 5).toBe(0)
    expect(g.yTicks.at(-1)).toBeGreaterThanOrEqual(82)
    expect(g.xTicks.filter((t) => t.major).map((t) => t.v)).toEqual([0.01, 0.1, 1])
  })

  it('handles a single point and empty input', () => {
    expect(buildScatter([data[0]], plot)?.points).toHaveLength(1)
    expect(buildScatter([], plot)).toBeNull()
    expect(buildScatter(data, { ...plot, w: 0 })).toBeNull()
  })
})

describe('placeLabels', () => {
  const area = { x: 0, y: 0, w: 400, h: 300 }

  it('places non-overlapping labels inside the area', () => {
    const labels = [
      { x: 200, y: 150, w: 80, h: 16 },
      { x: 205, y: 152, w: 80, h: 16 },
    ]
    const out = placeLabels(labels, labels, area, 6)
    expect(out).toHaveLength(2)
    const [p, q] = out.map((l) => l.box)
    const overlap = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h
    expect(overlap).toBe(false)
    for (const { box } of out) {
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.w).toBeLessThanOrEqual(400)
    }
  })

  it('drops a label that cannot fit anywhere', () => {
    expect(placeLabels([{ x: 10, y: 10, w: 500, h: 16 }], [], area, 6)).toHaveLength(0)
  })
})

describe('paretoFrontier', () => {
  it('keeps each point that beats every cheaper one', () => {
    const pts = [
      { id: 'cheap', cost: 0.01, score: 60 },
      { id: 'dominated', cost: 0.1, score: 55 },
      { id: 'mid', cost: 0.1, score: 70 },
      { id: 'tie', cost: 1, score: 70 },
      { id: 'best', cost: 2, score: 85 },
    ]
    expect(paretoFrontier(pts).map((p) => p.id)).toEqual(['cheap', 'mid', 'best'])
  })
})
