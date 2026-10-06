// Pure table logic: which columns a view has, which models pass the filters,
// and how rows sort. Kept free of React so it can be unit-tested.
import type { ModelEntry } from '../../api/types'
import type { BoardIndex } from '../../shared/board/boardIndex'
import { OVERALL, blendedPrice, costFor, modelKey, passesFinetune, reasoningShare, type View } from '../../shared/board/model'
import {
  formatCompact,
  formatCost,
  formatDecimal,
  formatInt,
  formatPair,
  formatPercent,
  formatPrice,
  formatScore,
  formatSignedPercent,
} from '../../shared/lib/format'

export type ColumnGroup = 'quality' | 'reliability' | 'latency' | 'throughput' | 'cost'

/** Header row above the columns, in display order. */
export const COLUMN_GROUPS: { id: ColumnGroup; label: string }[] = [
  { id: 'quality', label: 'Quality' },
  { id: 'reliability', label: 'Reliability' },
  { id: 'latency', label: 'Latency' },
  { id: 'throughput', label: 'Throughput' },
  { id: 'cost', label: 'Cost' },
]

export interface Column {
  /** Namespaced so category, subtask, metric and cost ids can never collide. */
  id: string
  label: string
  group: ColumnGroup
  /** Sort key, and the value shading ranks by. */
  get: (m: ModelEntry) => number | undefined
  /** Cell text. */
  format: (m: ModelEntry) => string
  /** Which direction is better: sets the first-click sort and which end gets shaded. null = neither. */
  better: 'higher' | 'lower' | null
  /** Shade the best 5 in this column. */
  shade: boolean
  /** The column the current view is ranked by; rendered bold. */
  primary?: boolean
  /** Starts hidden; available from "Choose columns". */
  defaultHidden?: boolean
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
  group: 'quality',
  get,
  format: (m) => formatScore(get(m)),
  better: 'higher',
  shade: true,
  ...extra,
})

/** A measured metric. `better: null` means neither direction is better, so it isn't shaded. */
const metric = (
  group: ColumnGroup,
  key: string,
  label: string,
  better: Column['better'],
  get: Column['get'],
  format: (m: ModelEntry) => string,
  extra: Partial<Column> = {},
): Column => ({ id: colId.perf(key), label, group, get, format, better, shade: better != null, ...extra })

type Pct = { p50?: number; p95?: number; p99?: number } | undefined
const ms = (p: Pct) => formatPair(p?.p50, p?.p95, formatInt)

/**
 * Client-side API performance and true cost, shown in the overall view, grouped
 * as they appear in the header. Paired cells sort by their first value.
 */
export const PERF_COLUMNS: Column[] = [
  // Reliability
  metric('reliability', 'requests', 'Requests', null, (m) => m.perf?.requests, (m) => formatInt(m.perf?.requests)),
  metric('reliability', 'success_rate', 'Success rate', 'higher', (m) => m.perf?.success_rate, (m) => formatPercent(m.perf?.success_rate)),
  metric('reliability', 'success_after_retry', 'Success after retries', 'higher', (m) => m.perf?.success_after_retry, (m) =>
    formatPercent(m.perf?.success_after_retry),
  ),
  metric('reliability', 'errors', 'Errors', 'lower', (m) => m.perf?.errors, (m) => formatInt(m.perf?.errors)),
  metric('reliability', 'truncation', 'Truncated', 'lower', (m) => m.perf?.truncation_rate, (m) => formatPercent(m.perf?.truncation_rate)),
  // Latency
  metric('latency', 'ttft', 'TTFT client p50 / p95 (ms)', 'lower', (m) => m.perf?.ttft_ms?.p50, (m) => ms(m.perf?.ttft_ms)),
  metric('latency', 'ttft_p99', 'TTFT client p99 (ms)', 'lower', (m) => m.perf?.ttft_ms?.p99, (m) => formatInt(m.perf?.ttft_ms?.p99)),
  metric('latency', 'itl', 'ITL p50 / p95 (ms)', 'lower', (m) => m.perf?.itl_ms?.p50, (m) => ms(m.perf?.itl_ms)),
  metric('latency', 'stall_rate', 'Stall rate', 'lower', (m) => m.perf?.stall_rate, (m) => formatPercent(m.perf?.stall_rate)),
  metric('latency', 'e2e', 'E2E client p50 / p95 (ms)', 'lower', (m) => m.perf?.e2e_ms?.p50, (m) => ms(m.perf?.e2e_ms)),
  metric('latency', 'e2e_p99', 'E2E client p99 (ms)', 'lower', (m) => m.perf?.e2e_ms?.p99, (m) => formatInt(m.perf?.e2e_ms?.p99), {
    defaultHidden: true,
  }),
  metric('latency', 'client_overhead', 'Client overhead p50 / p95 (ms)', 'lower', (m) => m.perf?.client_overhead_ms?.p50, (m) =>
    ms(m.perf?.client_overhead_ms),
  ),
  // Throughput
  metric('throughput', 'throughput', 'Throughput (req/s)', 'higher', (m) => m.perf?.throughput_rps, (m) => formatDecimal(m.perf?.throughput_rps)),
  metric('throughput', 'tokens_per_min', 'Tokens/min avg / peak', 'higher', (m) => m.perf?.tokens_per_min?.avg, (m) =>
    formatPair(m.perf?.tokens_per_min?.avg, m.perf?.tokens_per_min?.peak, formatCompact),
  ),
  metric('throughput', 'decode', 'Per-request decode (tok/s, p50)', 'higher', (m) => m.perf?.decode_tps_p50, (m) =>
    formatDecimal(m.perf?.decode_tps_p50),
  ),
  metric('throughput', 'prefill', 'Prefill (tok/s)', 'higher', (m) => m.perf?.prefill_tps, (m) => formatInt(m.perf?.prefill_tps), {
    defaultHidden: true,
  }),
  // Cost. Reasoning share is informational: more thinking costs more but may buy quality.
  metric('cost', 'reasoning_share', 'Reasoning share of output', null, reasoningShare, (m) => formatPercent(reasoningShare(m))),
  metric(
    'cost',
    'tokens_per_1k_chars',
    'Tokens / 1K chars',
    'lower',
    (m) => m.cost?.tokens_per_1k_chars,
    (m) => formatInt(m.cost?.tokens_per_1k_chars),
    { defaultHidden: true },
  ),
  metric('cost', 'blended_price', 'Blended $/1M (3:1)', 'lower', blendedPrice, (m) => formatPrice(blendedPrice(m))),
  metric(
    'cost',
    'cached_input_price',
    'Cached input $/1M',
    'lower',
    (m) => m.cost?.cached_input_per_million,
    (m) => formatPrice(m.cost?.cached_input_per_million),
    { defaultHidden: true },
  ),
  // Sorted by the size of the error either way; the cell keeps the sign (+ = over-billed).
  metric(
    'cost',
    'billing_drift',
    'Billing drift',
    'lower',
    (m) => (m.cost?.billing_drift == null ? undefined : Math.abs(m.cost.billing_drift)),
    (m) => formatSignedPercent(m.cost?.billing_drift),
    { defaultHidden: true },
  ),
]

/** Column ids that start hidden, for the initial "Choose columns" state. */
export const DEFAULT_HIDDEN: ReadonlySet<string> = new Set(PERF_COLUMNS.filter((c) => c.defaultHidden).map((c) => c.id))

export function columnsFor(board: Pick<BoardIndex, 'categories' | 'categoriesById'>, view: View): Column[] {
  const cost: Column = {
    id: colId.cost,
    label: 'Cost per successful task',
    group: 'cost',
    get: (m) => costFor(m, view),
    format: (m) => formatCost(costFor(m, view)),
    better: 'lower',
    shade: false,
  }
  if (view === OVERALL) {
    return [scoreColumn(colId.overall, 'Overall', (m) => m.overall, { primary: true }), ...PERF_COLUMNS, cost]
  }
  const cat = board.categoriesById.get(view)
  if (!cat) return columnsFor(board, OVERALL)
  return [
    scoreColumn(colId.category(cat.id), `${cat.name} avg`, (m) => m.categories[cat.id], { primary: true }),
    ...cat.subtasks.map((st) => scoreColumn(colId.subtask(st.id), st.name, (m) => m.subtasks[st.id])),
    cost,
  ]
}

export interface GroupSpan {
  group: ColumnGroup
  label: string
  span: number
}

/** Consecutive runs of columns by group, for the group header row (one colSpan per run). */
export function groupSpans(columns: Column[]): GroupSpan[] {
  const spans: GroupSpan[] = []
  for (const c of columns) {
    const last = spans.at(-1)
    if (last?.group === c.group) last.span++
    else spans.push({ group: c.group, label: COLUMN_GROUPS.find((g) => g.id === c.group)!.label, span: 1 })
  }
  return spans
}

/** Whether the i-th visible column starts a group (and so gets a divider). */
export const startsGroup = (columns: Column[], i: number) => i === 0 || columns[i - 1].group !== columns[i].group

export interface ModelFilters {
  query?: string
  openOnly?: boolean
  includeFinetunes?: boolean
  organization?: string
  provider?: string
}

export function filterModels(models: ModelEntry[], f: ModelFilters): ModelEntry[] {
  const q = f.query?.trim().toLowerCase()
  return models.filter(
    (m) =>
      (!q || [m.name, m.organization, m.provider ?? ''].some((s) => s.toLowerCase().includes(q))) &&
      (!f.openOnly || m.open_weights) &&
      passesFinetune(m, !!f.includeFinetunes) &&
      (!f.organization || m.organization === f.organization) &&
      (!f.provider || m.provider === f.provider),
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

/** Keeps the first row per underlying model: its best provider under the current sort. */
export function bestPerModel(sorted: ModelEntry[]): ModelEntry[] {
  const seen = new Set<string>()
  return sorted.filter((m) => {
    const key = modelKey(m)
    if (seen.has(key)) return false
    seen.add(key)
    return true
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
