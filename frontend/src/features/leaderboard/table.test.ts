import { describe, expect, it } from 'vitest'
import { buildBoardIndex } from '../../shared/board/boardIndex'
import { OVERALL } from '../../shared/board/model'
import { board as rawBoard, model } from '../../test/fixtures'
import {
  COLUMN_GROUPS,
  DEFAULT_HIDDEN,
  PERF_COLUMNS,
  bestPerModel,
  colId,
  columnsFor,
  defaultDir,
  filterModels,
  formatSort,
  groupSpans,
  parseSort,
  sortModels,
  startsGroup,
  topRanks,
} from './table'

const a = model({
  id: 'a',
  name: 'Alpha',
  overall: 80,
  categories: { math: 90 },
  organization: 'Acme',
  open_weights: true,
  perf: { errors: 12, requests: 1000, ttft_ms: { p50: 300, p95: 900 } },
})
const b = model({ id: 'b', name: 'Beta', overall: 70, categories: { math: 95 }, organization: 'Bolt', perf: { errors: 3, requests: 5000 } })
const c = model({ id: 'c', name: 'Gamma FT', overall: 75, categories: {}, organization: 'Acme', finetune: true })
const models = [a, b, c]
const board = (ms: typeof models) => buildBoardIndex(rawBoard(ms))

describe('columnsFor', () => {
  it('overall view has overall, then reliability, latency, throughput and cost groups — no category columns', () => {
    const cols = columnsFor(board(models), OVERALL)
    expect(cols[0].id).toBe('overall')
    expect(cols.at(-1)!.id).toBe('cost')
    expect(cols.some((c) => c.id.startsWith('cat:'))).toBe(false)
    // groups appear in COLUMN_GROUPS order, each as one contiguous run
    expect(groupSpans(cols).map((g) => g.group)).toEqual(COLUMN_GROUPS.map((g) => g.id))
  })

  it('keeps the originally requested metric titles, alongside the new ones', () => {
    const labels = PERF_COLUMNS.map((c) => c.label)
    for (const title of [
      'Requests',
      'Success rate',
      'Errors',
      'TTFT client p50 / p95 (ms)',
      'E2E client p50 / p95 (ms)',
      'Client overhead p50 / p95 (ms)',
      'Throughput (req/s)',
      'Tokens/min avg / peak',
      'Per-request decode (tok/s, p50)',
    ]) {
      expect(labels).toContain(title)
    }
    for (const title of ['Success after retries', 'Truncated', 'TTFT client p99 (ms)', 'ITL p50 / p95 (ms)', 'Stall rate', 'Blended $/1M (3:1)']) {
      expect(labels).toContain(title)
    }
  })

  it('hides the less essential columns by default', () => {
    expect([...DEFAULT_HIDDEN].sort()).toEqual(
      ['perf:billing_drift', 'perf:cached_input_price', 'perf:e2e_p99', 'perf:prefill', 'perf:tokens_per_1k_chars'].sort(),
    )
  })

  it('marks group boundaries for dividers', () => {
    const cols = columnsFor(board(models), OVERALL)
    const starts = cols.flatMap((c, i) => (startsGroup(cols, i) ? [c.group] : []))
    expect(starts).toEqual(COLUMN_GROUPS.map((g) => g.id))
  })

  it('formats paired cells and missing metrics', () => {
    const ttft = PERF_COLUMNS.find((c) => c.id === colId.perf('ttft'))!
    expect(ttft.format(a)).toBe('300 / 900')
    expect(ttft.get(a)).toBe(300)
    expect(ttft.format(c)).toBe('—')
  })

  it('category view has the category average, its subtasks and cost', () => {
    const cols = columnsFor(board(models), 'math')
    expect(cols.map((c) => c.id)).toEqual(['cat:math', 'sub:math.olympiad', 'cost'])
    expect(cols[0].primary).toBe(true)
  })

  it('namespaces ids so a category called "overall" cannot collide', () => {
    const raw = rawBoard(models)
    raw.categories.push({ id: 'overall', name: 'Tricky', subtasks: [] })
    const bd = buildBoardIndex(raw)
    const ids = columnsFor(bd, OVERALL).map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('falls back to overall for an unknown category', () => {
    expect(columnsFor(board(models), 'nope')[0].id).toBe('overall')
  })
})

describe('filterModels', () => {
  it('hides finetunes by default', () => {
    expect(filterModels(models, {}).map((m) => m.id)).toEqual(['a', 'b'])
    expect(filterModels(models, { includeFinetunes: true })).toHaveLength(3)
  })

  it('matches query against name and organization', () => {
    expect(filterModels(models, { query: 'bolt' }).map((m) => m.id)).toEqual(['b'])
    expect(filterModels(models, { query: ' ALPHA ' }).map((m) => m.id)).toEqual(['a'])
  })

  it('filters by provider and matches the query against provider names', () => {
    const served = [model({ id: 'x1', name: 'Xeno', provider: 'Swiftserve' }), model({ id: 'x2', name: 'Xeno', provider: 'Cloudhaven' })]
    expect(filterModels(served, { provider: 'Cloudhaven' }).map((m) => m.id)).toEqual(['x2'])
    expect(filterModels(served, { query: 'swift' }).map((m) => m.id)).toEqual(['x1'])
  })

  it('applies open-weights and organization filters', () => {
    expect(filterModels(models, { openOnly: true }).map((m) => m.id)).toEqual(['a'])
    expect(filterModels(models, { organization: 'Acme', includeFinetunes: true }).map((m) => m.id)).toEqual(['a', 'c'])
  })
})

describe('sortModels', () => {
  const math = columnsFor(board(models), 'math').find((c) => c.id === colId.category('math'))!

  it('sorts both directions and always sinks missing values', () => {
    expect(sortModels(models, math, 'desc').map((m) => m.id)).toEqual(['b', 'a', 'c'])
    expect(sortModels(models, math, 'asc').map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate its input', () => {
    const input = [...models]
    sortModels(input, math, 'desc')
    expect(input).toEqual(models)
  })
})

describe('bestPerModel', () => {
  it('keeps the first (best-sorted) provider row of each model', () => {
    const rows = [
      model({ id: 'n@fast', model_id: 'n', provider: 'Fast' }),
      model({ id: 'm@a', model_id: 'm', provider: 'A' }),
      model({ id: 'n@slow', model_id: 'n', provider: 'Slow' }),
      model({ id: 'solo' }),
    ]
    expect(bestPerModel(rows).map((m) => m.id)).toEqual(['n@fast', 'm@a', 'solo'])
  })
})

describe('billing drift', () => {
  it('sorts by the size of the drift but shows its sign', () => {
    const drift = PERF_COLUMNS.find((c) => c.id === colId.perf('billing_drift'))!
    const over = model({ id: 'over', cost: { per_success: { categories: {} }, billing_drift: 0.02 } })
    const under = model({ id: 'under', cost: { per_success: { categories: {} }, billing_drift: -0.005 } })
    expect(sortModels([over, under], drift, 'asc').map((m) => m.id)).toEqual(['under', 'over'])
    expect(drift.format(over)).toBe('+2.0%')
    expect(drift.format(under)).toBe('-0.5%')
  })
})

describe('parseSort / formatSort', () => {
  const cols = columnsFor(board(models), OVERALL)

  it('round-trips, including ids that contain colons', () => {
    const s = { id: 'perf:client_overhead', dir: 'asc' as const }
    expect(parseSort(formatSort(s), cols, OVERALL)).toEqual(s)
  })

  it('falls back to the primary column for junk or unknown columns', () => {
    expect(parseSort('garbage', cols, OVERALL)).toEqual({ id: 'overall', dir: 'desc' })
    expect(parseSort('sub:x:asc', cols, OVERALL)).toEqual({ id: 'overall', dir: 'desc' })
    expect(parseSort(null, columnsFor(board(models), 'math'), 'math')).toEqual({ id: 'cat:math', dir: 'desc' })
  })
})

describe('topRanks / defaultDir', () => {
  const col = (id: string) => columnsFor(board(models), OVERALL).find((c) => c.id === id)!

  it('ranks the best n in the column’s better direction and skips missing values', () => {
    const math = columnsFor(board(models), 'math')[0]
    expect([...topRanks(models, math, 5)]).toEqual([
      ['b', 0],
      ['a', 1],
    ])
    // fewer errors is better
    expect([...topRanks(models, col(colId.perf('errors')), 5)]).toEqual([
      ['b', 0],
      ['a', 1],
    ])
  })

  it('does not rank volume columns, which are neither better nor worse', () => {
    expect(topRanks(models, col(colId.perf('requests')), 5).size).toBe(0)
  })

  it('first click sorts best-first', () => {
    expect(defaultDir(col(colId.perf('errors')))).toBe('asc')
    expect(defaultDir(col(colId.perf('ttft')))).toBe('asc')
    expect(defaultDir(col(colId.perf('throughput')))).toBe('desc')
    expect(defaultDir(col(colId.cost))).toBe('asc')
    expect(defaultDir(col(colId.overall))).toBe('desc')
  })
})
