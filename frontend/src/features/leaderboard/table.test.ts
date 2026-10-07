import { describe, expect, it } from 'vitest'
import { row } from '../../test/fixtures'
import {
  COLUMNS,
  DEFAULT_HIDDEN,
  DEFAULT_SORT,
  PRIMARY_COLUMN,
  bestPerModel,
  colId,
  defaultDir,
  filterRows,
  formatSort,
  groupSpans,
  parseSort,
  sortRows,
  startsGroup,
  topRanks,
} from './table'

const col = (key: string) => COLUMNS.find((c) => c.id === colId(key))!
const perf = (e2e: number | undefined, extra = {}) => ({ ttft_by_input: [], e2e_ms: e2e == null ? undefined : { p50: e2e / 2, p95: e2e }, ...extra })

const rows = [
  row({ id: 'a', name: 'Aurora 4', model_id: 'aurora-4', provider: 'Stratus', organization: 'Aurora Labs', perf: perf(3000, { errors: 4 }) }),
  row({ id: 'b', name: 'Aurora 4', model_id: 'aurora-4', provider: 'Aurora API', organization: 'Aurora Labs', perf: perf(2000, { errors: 9 }) }),
  row({ id: 'c', name: 'Forge 70B', model_id: 'forge', provider: 'Swiftserve', organization: 'OpenForge', open_weights: true, perf: perf(1000) }),
  row({ id: 'd', name: 'Quanta 8B', model_id: 'quanta', provider: 'Swiftserve', organization: 'Quanta', perf: perf(undefined, { errors: 1 }) }),
]
const ids = (rs: { id: string }[]) => rs.map((r) => r.id)

describe('columns', () => {
  it('ranks by client E2E p95 by default and namespaces ids', () => {
    expect(COLUMNS.filter((c) => c.primary).map((c) => c.id)).toEqual([PRIMARY_COLUMN])
    expect(COLUMNS.every((c) => c.id.startsWith('perf:'))).toBe(true)
    expect(new Set(COLUMNS.map((c) => c.id)).size).toBe(COLUMNS.length)
  })

  it('says where each metric comes from', () => {
    expect(col('e2e_p95').source).toBe('BlazeMeter')
    expect(col('ttft').source).toBe('Splunk')
    expect(COLUMNS.every((c) => c.source)).toBe(true)
  })

  it('groups contiguously, with dividers at each group start', () => {
    const spans = groupSpans(COLUMNS)
    expect(spans.map((s) => s.group)).toEqual(['latency', 'reliability', 'throughput', 'cost'])
    expect(spans.reduce((n, s) => n + s.span, 0)).toBe(COLUMNS.length)
    expect(startsGroup(COLUMNS, 0)).toBe(true)
    expect(startsGroup(COLUMNS, 1)).toBe(false)
  })

  it('hides the more specialized columns by default', () => {
    expect(DEFAULT_HIDDEN.has(colId('ttft_p99'))).toBe(true)
    expect(DEFAULT_HIDDEN.has(PRIMARY_COLUMN)).toBe(false)
  })

  it('formats pairs and missing values', () => {
    expect(col('e2e').format(rows[0])).toBe('1,500 / —')
    expect(col('e2e_p95').format(rows[3])).toBe('—')
  })
})

describe('filterRows', () => {
  it('searches name, provider and maker', () => {
    expect(ids(filterRows(rows, { query: 'swift' }))).toEqual(['c', 'd'])
    expect(ids(filterRows(rows, { query: 'aurora labs' }))).toEqual(['a', 'b'])
  })

  it('filters by open weights, maker and provider', () => {
    expect(ids(filterRows(rows, { openOnly: true }))).toEqual(['c'])
    expect(ids(filterRows(rows, { organization: 'Quanta' }))).toEqual(['d'])
    expect(ids(filterRows(rows, { provider: 'Stratus' }))).toEqual(['a'])
  })
})

describe('sortRows', () => {
  it('sorts by a column and sinks missing values either way', () => {
    expect(ids(sortRows(rows, col('e2e_p95'), 'asc'))).toEqual(['c', 'b', 'a', 'd'])
    expect(ids(sortRows(rows, col('e2e_p95'), 'desc'))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('breaks ties by E2E p95', () => {
    const tied = rows.map((r) => ({ ...r, perf: { ...r.perf, errors: 1 } }))
    expect(ids(sortRows(tied, col('errors'), 'asc'))).toEqual(['c', 'b', 'a', 'd'])
  })

  it('keeps the best provider per model under the current sort', () => {
    expect(ids(bestPerModel(sortRows(rows, col('e2e_p95'), 'asc')))).toEqual(['c', 'b', 'd'])
    expect(ids(bestPerModel(sortRows(rows, col('errors'), 'asc')))).toEqual(['d', 'a', 'c'])
  })
})

describe('sort state', () => {
  it('first click goes best-first', () => {
    expect(defaultDir(col('errors'))).toBe('asc')
    expect(defaultDir(col('success_rate'))).toBe('desc')
  })

  it('round-trips and falls back on unknown columns', () => {
    const s = { id: colId('ttft'), dir: 'desc' as const }
    expect(parseSort(formatSort(s))).toEqual(s)
    expect(parseSort('perf:nope:asc')).toEqual(DEFAULT_SORT)
    expect(parseSort(null)).toEqual(DEFAULT_SORT)
  })
})

describe('topRanks', () => {
  it('ranks the best n in the better direction, ignoring missing values', () => {
    expect([...topRanks(rows, col('e2e_p95'), 2)]).toEqual([
      ['c', 0],
      ['b', 1],
    ])
    expect(topRanks(rows, col('requests'), 3).size).toBe(0) // neither direction is better
  })
})
