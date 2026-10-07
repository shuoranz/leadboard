// Pure table logic: which columns the leaderboard has, which rows pass the
// filters, and how rows sort. Kept free of React so it can be unit-tested.
import type { LeaderboardRow } from '../../api/types'
import { blendedPrice, costPer1k, e2eP95, modelKey } from '../../shared/board/model'
import { formatCompact, formatCost1k, formatDecimal, formatInt, formatPair, formatPercent, formatPrice } from '../../shared/lib/format'

export type ColumnGroup = 'reliability' | 'latency' | 'throughput' | 'cost'

/** Header row above the columns, in display order. */
export const COLUMN_GROUPS: { id: ColumnGroup; label: string }[] = [
  { id: 'latency', label: 'Latency' },
  { id: 'reliability', label: 'Reliability' },
  { id: 'throughput', label: 'Throughput' },
  { id: 'cost', label: 'Cost' },
]

export interface Column {
  /** Namespaced (`perf:<key>`), so ids stay stable in shared URLs. */
  id: string
  label: string
  group: ColumnGroup
  /** Sort key, and the value shading ranks by. */
  get: (r: LeaderboardRow) => number | undefined
  /** Cell text. */
  format: (r: LeaderboardRow) => string
  /** Which direction is better: sets the first-click sort and which end gets shaded. null = neither. */
  better: 'higher' | 'lower' | null
  /** Shade the best 5 in this column. */
  shade: boolean
  /** The column the board is ranked by by default; rendered bold. */
  primary?: boolean
  /** Starts hidden; available from "Choose columns". */
  defaultHidden?: boolean
  /** Hover text for the header: where the number comes from. */
  source?: 'BlazeMeter' | 'Splunk' | 'Catalog'
}

export type SortDir = 'asc' | 'desc'
export interface SortState {
  id: string
  dir: SortDir
}

export const colId = (key: string) => `perf:${key}`
export const PRIMARY_COLUMN = colId('e2e_p95')

/** A measured metric. `better: null` means neither direction is better, so it isn't shaded. */
const metric = (
  group: ColumnGroup,
  key: string,
  label: string,
  better: Column['better'],
  source: Column['source'],
  get: Column['get'],
  format: (r: LeaderboardRow) => string,
  extra: Partial<Column> = {},
): Column => ({ id: colId(key), label, group, get, format, better, shade: better != null, source, ...extra })

type Pct = { p50?: number; p95?: number; p99?: number } | undefined
const ms = (p: Pct, a: 'p50' | 'p95' = 'p50', b: 'p95' | 'p99' = 'p95') => formatPair(p?.[a], p?.[b], formatInt)

/** Grouped as they appear in the header. Paired cells sort by their first value. */
export const COLUMNS: Column[] = [
  // Latency — client side (BlazeMeter) unless marked server.
  metric('latency', 'e2e_p95', 'E2E p95 · client (ms)', 'lower', 'BlazeMeter', e2eP95, (r) => formatInt(e2eP95(r)), { primary: true }),
  metric('latency', 'e2e', 'E2E p50 / p99 · client (ms)', 'lower', 'BlazeMeter', (r) => r.perf.e2e_ms?.p50, (r) => ms(r.perf.e2e_ms, 'p50', 'p99')),
  metric('latency', 'ttft', 'TTFT p50 / p95 (ms)', 'lower', 'Splunk', (r) => r.perf.ttft_ms?.p50, (r) => ms(r.perf.ttft_ms)),
  metric('latency', 'ttft_p99', 'TTFT p99 (ms)', 'lower', 'Splunk', (r) => r.perf.ttft_ms?.p99, (r) => formatInt(r.perf.ttft_ms?.p99), {
    defaultHidden: true,
  }),
  metric('latency', 'itl', 'ITL p50 / p95 (ms)', 'lower', 'Splunk', (r) => r.perf.itl_ms?.p50, (r) => ms(r.perf.itl_ms)),
  metric('latency', 'server_e2e', 'E2E p50 / p95 · server (ms)', 'lower', 'Splunk', (r) => r.perf.server_e2e_ms?.p50, (r) => ms(r.perf.server_e2e_ms), {
    defaultHidden: true,
  }),
  metric('latency', 'overhead', 'Network overhead p50 / p95 (ms)', 'lower', 'BlazeMeter', (r) => r.perf.client_overhead_ms?.p50, (r) =>
    ms(r.perf.client_overhead_ms),
  ),
  metric('latency', 'stall_rate', 'Stall rate', 'lower', 'Splunk', (r) => r.perf.stall_rate, (r) => formatPercent(r.perf.stall_rate), {
    defaultHidden: true,
  }),
  // Reliability
  metric('reliability', 'success_rate', 'Success rate', 'higher', 'BlazeMeter', (r) => r.perf.success_rate, (r) => formatPercent(r.perf.success_rate)),
  metric('reliability', 'requests', 'Requests', null, 'BlazeMeter', (r) => r.perf.requests, (r) => formatInt(r.perf.requests)),
  metric('reliability', 'errors', 'Errors', 'lower', 'BlazeMeter', (r) => r.perf.errors, (r) => formatInt(r.perf.errors)),
  metric('reliability', 'truncation', 'Truncated', 'lower', 'Splunk', (r) => r.perf.truncation_rate, (r) => formatPercent(r.perf.truncation_rate), {
    defaultHidden: true,
  }),
  // Throughput
  metric('throughput', 'throughput', 'Throughput (req/s)', 'higher', 'BlazeMeter', (r) => r.perf.throughput_rps, (r) =>
    formatDecimal(r.perf.throughput_rps),
  ),
  metric('throughput', 'tokens_per_min', 'Output tokens/min avg / peak', 'higher', 'Splunk', (r) => r.perf.tokens_per_min?.avg, (r) =>
    formatPair(r.perf.tokens_per_min?.avg, r.perf.tokens_per_min?.peak, formatCompact),
  ),
  metric('throughput', 'decode', 'Decode (tok/s, p50)', 'higher', 'Splunk', (r) => r.perf.decode_tps_p50, (r) => formatDecimal(r.perf.decode_tps_p50)),
  metric('throughput', 'prefill', 'Prefill (tok/s)', 'higher', 'Splunk', (r) => r.perf.prefill_tps, (r) => formatInt(r.perf.prefill_tps), {
    defaultHidden: true,
  }),
  // Cost
  metric('cost', 'cost_1k', 'Cost / 1K successful requests', 'lower', 'Splunk', costPer1k, (r) => formatCost1k(costPer1k(r))),
  metric('cost', 'tokens', 'Avg tokens in / out', null, 'Splunk', (r) => r.perf.avg_input_tokens, (r) =>
    formatPair(r.perf.avg_input_tokens, r.perf.avg_output_tokens, formatCompact),
  ),
  metric('cost', 'blended_price', 'Blended $/1M (3:1)', 'lower', 'Catalog', blendedPrice, (r) => formatPrice(blendedPrice(r))),
  metric('cost', 'cached_input_price', 'Cached input $/1M', 'lower', 'Catalog', (r) => r.cost.cached_input_per_million, (r) =>
    formatPrice(r.cost.cached_input_per_million),
    { defaultHidden: true },
  ),
]

/** Column ids that start hidden, for the initial "Choose columns" state. */
export const DEFAULT_HIDDEN: ReadonlySet<string> = new Set(COLUMNS.filter((c) => c.defaultHidden).map((c) => c.id))

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

export interface RowFilters {
  query?: string
  openOnly?: boolean
  organization?: string
  provider?: string
}

/** The auto-routing row has no single provider or maker, so provider/org/open filters leave it out. */
export function filterRows(rows: LeaderboardRow[], f: RowFilters): LeaderboardRow[] {
  const q = f.query?.trim().toLowerCase()
  return rows.filter(
    (r) =>
      (!q || [r.name, r.organization, r.provider].some((s) => s.toLowerCase().includes(q))) &&
      (!f.openOnly || r.open_weights) &&
      (!f.organization || r.organization === f.organization) &&
      (!f.provider || r.provider === f.provider),
  )
}

/** Sorts by `column`; rows missing the value always sink, ties fall back to E2E p95. */
export function sortRows(rows: LeaderboardRow[], column: Column, dir: SortDir): LeaderboardRow[] {
  const sign = dir === 'asc' ? 1 : -1
  const tie = (a: LeaderboardRow, b: LeaderboardRow) => (e2eP95(a) ?? Infinity) - (e2eP95(b) ?? Infinity) || a.id.localeCompare(b.id)
  return [...rows].sort((a, b) => {
    const va = column.get(a)
    const vb = column.get(b)
    if (va == null && vb == null) return tie(a, b)
    if (va == null) return 1
    if (vb == null) return -1
    return (va - vb) * sign || tie(a, b)
  })
}

/** Keeps the first row per underlying LLM: its best provider under the current sort. */
export function bestPerModel(sorted: LeaderboardRow[]): LeaderboardRow[] {
  const seen = new Set<string>()
  return sorted.filter((r) => {
    const key = modelKey(r)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** First click sorts best-first: ascending when lower is better (cost, latency, errors). */
export const defaultDir = (column: Column): SortDir => (column.better === 'lower' ? 'asc' : 'desc')

export const DEFAULT_SORT: SortState = { id: PRIMARY_COLUMN, dir: 'asc' }

export function parseSort(raw: string | null): SortState {
  const match = raw?.match(/^(.+):(asc|desc)$/)
  if (match && COLUMNS.some((c) => c.id === match[1])) return { id: match[1], dir: match[2] as SortDir }
  return DEFAULT_SORT
}

export const formatSort = (s: SortState) => `${s.id}:${s.dir}`

/** Rank (0-based) of each row within the best `n` of a column, by its `better` direction. */
export function topRanks(rows: LeaderboardRow[], column: Column, n: number): Map<string, number> {
  if (!column.better) return new Map()
  const sign = column.better === 'lower' ? 1 : -1
  const top = rows
    .map((r) => ({ id: r.id, v: column.get(r) }))
    .filter((x): x is { id: string; v: number } => x.v != null)
    .sort((a, b) => (a.v - b.v) * sign)
    .slice(0, n)
  return new Map(top.map((x, i) => [x.id, i]))
}
