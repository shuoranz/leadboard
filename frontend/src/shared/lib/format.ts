// All user-facing number/date formatting goes through Intl with one locale, so
// separators and currency symbols are consistent everywhere.
const LOCALE = 'en-US'

const cache = new Map<string, Intl.NumberFormat>()
function nf(key: string, options: Intl.NumberFormatOptions) {
  let f = cache.get(key)
  if (!f) cache.set(key, (f = new Intl.NumberFormat(LOCALE, options)))
  return f
}

const usd = (digits: number) =>
  nf(`usd${digits}`, { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits })

export const EMPTY = '—'

export function formatScore(v: number | undefined) {
  return v == null ? EMPTY : nf('score', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v)
}

/** Cost per task: more precision for small values, where differences matter. */
export function formatCost(v: number | undefined) {
  if (v == null) return EMPTY
  return usd(v >= 100 ? 0 : v >= 10 ? 2 : 3).format(v)
}

/** List price, e.g. "$51.30". */
export function formatPrice(v: number | undefined) {
  return v == null ? EMPTY : usd(2).format(v)
}

/** Log-axis tick: one significant digit below $1 ($0.005, $0.2), whole dollars above. */
export function formatCostTick(v: number) {
  return v >= 1
    ? usd(0).format(v)
    : nf('tick', { style: 'currency', currency: 'USD', maximumSignificantDigits: 1 }).format(v)
}

export function formatInt(v: number | undefined) {
  return v == null ? EMPTY : nf('int', { maximumFractionDigits: 0 }).format(v)
}

const dateFormat = new Intl.DateTimeFormat(LOCALE, { year: 'numeric', month: 'short', day: 'numeric' })
export function formatDate(iso: string | undefined) {
  if (!iso) return undefined
  const d = new Date(iso)
  return isNaN(+d) ? undefined : dateFormat.format(d)
}

/** A 0–1 fraction as a percent, e.g. 0.9921 -> "99.2%". */
export function formatPercent(v: number | undefined) {
  return v == null ? EMPTY : nf('pct', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v)
}

/** One decimal, e.g. throughput "12.4". */
export function formatDecimal(v: number | undefined) {
  return v == null ? EMPTY : nf('dec1', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v)
}

/** Large counts at a consistent 2–3 significant digits, e.g. 48_213 -> "48.2K", 3_000_000 -> "3.0M". */
export function formatCompact(v: number | undefined) {
  return v == null ? EMPTY : nf('compact', { notation: 'compact', minimumSignificantDigits: 2, maximumSignificantDigits: 3 }).format(v)
}

/** Two related values in one cell, e.g. p50 / p95. */
export function formatPair(a: number | undefined, b: number | undefined, format: (v: number | undefined) => string) {
  return a == null && b == null ? EMPTY : `${format(a)} / ${format(b)}`
}
