// Pure table logic: which columns a view has, which models pass the filters,
// and how rows sort. Kept free of React so it can be unit-tested.
import type { ModelEntry } from '../../api/types'
import type { BoardIndex } from '../../shared/board/boardIndex'
import { OVERALL, costFor, passesFinetune, type View } from '../../shared/board/model'
import { formatCompact, formatCost, formatDecimal, formatInt, formatPair, formatPercent, formatScore } from '../../shared/lib/format'

export interface Column {
  /** Namespaced so category, subtask, metric and cost ids can never collide. */
  id: string
  label: string
  /** Sort key, and the value shading ranks by. */
  get: (m: ModelEntry) => number | undefined
  /** Cell text. */
  format: (m: ModelEntry) => string
  /** Which direction is better: sets the first-click sort and which end gets shaded. null = neither (a volume). */
  better: 'higher' | 'lower' | null
  /** Shade the best 5 in this column. */
  shade: boolean
  /** The column the current view is ranked by; rendered bold. */
  primary?: boolean
  /** Starts a new group of columns; rendered with a divider. */
  groupStart?: boolean
}

export type SortDir = 'asc' | 'desc'
export interface SortState {
  id: string
  dir: SortDir
}

export const colId = {
  overall: 'overall',
  category: (id: string) => `cat:${id}`,
  subtask: (id: string) => `sub:${id}`,
  perf: (key: string) => `perf:${key}`,
  cost: 'cost',
}

export const primaryColumnId = (view: View) => (view === OVERALL ? colId.overall : colId.category(view))

const scoreColumn = (id: string, label: string, get: Column['get'], extra: Partial<Column> = {}): Column => ({
  id,
  label,
  get,
  format: (m) => formatScore(get(m)),
  better: 'higher',
  shade: true,
  ...extra,
})

/** A metric column; `format` defaults to formatting the sort value. */
const metric = (
  key: string,
  label: string,
  better: Column['better'],
  get: Column['get'],
  format: (m: ModelEntry) => string,
): Column => ({ id: colId.perf(key), label, get, format, better, shade: better != null })

const ms = (p: { p50?: number; p95?: number } | undefined) => formatPair(p?.p50, p?.p95, formatInt)

/** Client-side API performance, shown in the overall view. Paired cells sort by their first value. */
export const PERF_COLUMNS: Column[] = [
  { ...metric('requests', 'Requests', null, (m) => m.perf?.requests, (m) => formatInt(m.perf?.requests)), groupStart: true },
  metric('success_rate', 'Success rate', 'higher', (m) => m.perf?.success_rate, (m) => formatPercent(m.perf?.success_rate)),
  metric('errors', 'Errors', 'lower', (m) => m.perf?.errors, (m) => formatInt(m.perf?.errors)),
  metric('ttft', 'TTFT client p50 / p95 (ms)', 'lower', (m) => m.perf?.ttft_ms?.p50, (m) => ms(m.perf?.ttft_ms)),
  metric('e2e', 'E2E client p50 / p95 (ms)', 'lower', (m) => m.perf?.e2e_ms?.p50, (m) => ms(m.perf?.e2e_ms)),
  metric('client_overhead', 'Client overhead p50 / p95 (ms)', 'lower', (m) => m.perf?.client_overhead_ms?.p50, (m) => ms(m.perf?.client_overhead_ms)),
  metric('throughput', 'Throughput (req/s)', 'higher', (m) => m.perf?.throughput_rps, (m) => formatDecimal(m.perf?.throughput_rps)),
  metric('tokens_per_min', 'Tokens/min avg / peak', 'higher', (m) => m.perf?.tokens_per_min?.avg, (m) =>
    formatPair(m.perf?.tokens_per_min?.avg, m.perf?.tokens_per_min?.peak, formatCompact),
  ),
  metric('decode', 'Per-request decode (tok/s, p50)', 'higher', (m) => m.perf?.decode_tps_p50, (m) => formatDecimal(m.perf?.decode_tps_p50)),
]

export function columnsFor(board: Pick<BoardIndex, 'categories' | 'categoriesById'>, view: View): Column[] {
  const cost: Column = {
    id: colId.cost,
    label: 'Cost per successful task',
    get: (m) => costFor(m, view),
    format: (m) => formatCost(costFor(m, view)),
    better: 'lower',
    shade: false,
    groupStart: true,
  }
  if (view === OVERALL) {
    return [scoreColumn(colId.overall, 'Overall', (m) => m.overall, { primary: true, groupStart: true }), ...PERF_COLUMNS, cost]
  }
  const cat = board.categoriesById.get(view)
  if (!cat) return columnsFor(board, OVERALL)
  return [
    scoreColumn(colId.category(cat.id), `${cat.name} avg`, (m) => m.categories[cat.id], { primary: true, groupStart: true }),
    ...cat.subtasks.map((st) => scoreColumn(colId.subtask(st.id), st.name, (m) => m.subtasks[st.id])),
    cost,
  ]
}

export interface ModelFilters {
  query?: string
  openOnly?: boolean
  includeFinetunes?: boolean
  organization?: string
}

export function filterModels(models: ModelEntry[], f: ModelFilters): ModelEntry[] {
  const q = f.query?.trim().toLowerCase()
  return models.filter(
    (m) =>
      (!q || m.name.toLowerCase().includes(q) || m.organization.toLowerCase().includes(q)) &&
      (!f.openOnly || m.open_weights) &&
      passesFinetune(m, !!f.includeFinetunes) &&
      (!f.organization || m.organization === f.organization),
  )
}

/** Sorts by `column`; models missing the value always sink, ties fall back to overall. */
export function sortModels(models: ModelEntry[], column: Column, dir: SortDir): ModelEntry[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...models].sort((a, b) => {
    const va = column.get(a)
    const vb = column.get(b)
    if (va == null && vb == null) return b.overall - a.overall
    if (va == null) return 1
    if (vb == null) return -1
    return (va - vb) * sign || b.overall - a.overall
  })
}

/** First click sorts best-first: ascending when lower is better (cost, latency, errors). */
export const defaultDir = (column: Column): SortDir => (column.better === 'lower' ? 'asc' : 'desc')

export function parseSort(raw: string | null, columns: Column[], view: View): SortState {
  const match = raw?.match(/^(.+):(asc|desc)$/)
  if (match && columns.some((c) => c.id === match[1])) return { id: match[1], dir: match[2] as SortDir }
  return { id: primaryColumnId(view), dir: 'desc' }
}

export const formatSort = (s: SortState) => `${s.id}:${s.dir}`

/** Rank (0-based) of each model within the best `n` of a column, by its `better` direction. */
export function topRanks(models: ModelEntry[], column: Column, n: number): Map<string, number> {
  if (!column.better) return new Map()
  const sign = column.better === 'lower' ? 1 : -1
  const top = models
    .map((m) => ({ id: m.id, v: column.get(m) }))
    .filter((x): x is { id: string; v: number } => x.v != null)
    .sort((a, b) => (a.v - b.v) * sign)
    .slice(0, n)
  return new Map(top.map((x, i) => [x.id, i]))
}
