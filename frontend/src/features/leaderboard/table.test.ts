import { describe, expect, it } from 'vitest'
import { buildBoardIndex } from '../../shared/board/boardIndex'
import { OVERALL } from '../../shared/board/model'
import { board as rawBoard, model } from '../../test/fixtures'
import { PERF_COLUMNS, colId, columnsFor, defaultDir, filterModels, formatSort, parseSort, sortModels, topRanks } from './table'

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
  it('overall view has overall, the performance metrics and cost — no category columns', () => {
    const ids = columnsFor(board(models), OVERALL).map((c) => c.id)
    expect(ids).toEqual([
      'overall',
      'perf:requests',
      'perf:success_rate',
      'perf:errors',
      'perf:ttft',
      'perf:e2e',
      'perf:client_overhead',
      'perf:throughput',
      'perf:tokens_per_min',
      'perf:decode',
      'cost',
    ])
  })

  it('titles the metric columns as specified', () => {
    expect(PERF_COLUMNS.map((c) => c.label)).toEqual([
      'Requests',
      'Success rate',
      'Errors',
      'TTFT client p50 / p95 (ms)',
      'E2E client p50 / p95 (ms)',
      'Client overhead p50 / p95 (ms)',
      'Throughput (req/s)',
      'Tokens/min avg / peak',
      'Per-request decode (tok/s, p50)',
    ])
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
