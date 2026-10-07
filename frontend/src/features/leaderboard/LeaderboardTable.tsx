import { Fragment, useMemo, useState } from 'react'
import type { LeaderboardRow } from '../../api/types'
import { cn } from '../../shared/lib/cn'
import { formatDate } from '../../shared/lib/format'
import { useElementWidth } from '../../shared/lib/hooks'
import { cssVar, tint } from '../../shared/lib/tokens'
import { Badge } from '../../shared/ui/marks'
import { OfferingDetail } from './OfferingDetail'
import { defaultDir, groupSpans, startsGroup, topRanks, type Column, type SortState } from './table'

// Best-5 shading per column: one hue, stepping lighter with rank.
const HEAT = [26, 19, 13, 8, 4.5]
const heat = (rank: number | undefined) => (rank == null ? undefined : tint(cssVar.accent, HEAT[rank]))

export function LeaderboardTable({
  rows,
  columns,
  sort,
  onSort,
  showOrg,
  limit,
}: {
  rows: LeaderboardRow[]
  columns: Column[]
  sort: SortState
  onSort: (s: SortState) => void
  showOrg: boolean
  /** Render only the first `limit` rows; shading still ranks across all of them. */
  limit?: number
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // The table is far wider than the screen, so expanded details are pinned to the
  // visible width of the scroll area instead of spreading across every column.
  const [scrollRef, visibleWidth] = useElementWidth<HTMLDivElement>()

  // Rank among all matching rows (not just the rendered ones) so shading is stable.
  const ranks = useMemo(
    () => new Map(columns.filter((c) => c.shade).map((c) => [c.id, topRanks(rows, c, HEAT.length)])),
    [rows, columns],
  )

  const clickSort = (col: Column) =>
    onSort(sort.id === col.id ? { id: col.id, dir: sort.dir === 'desc' ? 'asc' : 'desc' } : { id: col.id, dir: defaultDir(col) })

  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // A divider marks each group boundary. The first group sits against the Model
  // column's own border, so it doesn't get one.
  const divider = (i: number) => i > 0 && startsGroup(columns, i) && 'border-l border-line'
  const spans = groupSpans(columns)
  const headCell = 'bg-surface shadow-[inset_0_-1px_0_var(--line)]'
  const stickyLeft = 'sticky z-10 bg-surface group-hover:bg-surface-2'

  return (
    // As tall as its rows: no inner vertical scroll. It only scrolls sideways, when
    // the columns don't fit, with the expand and Model columns pinned on the left.
    <div ref={scrollRef} className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <table aria-label="Leaderboard" className="w-full border-separate border-spacing-0 text-body">
        <thead>
          <tr>
            <th scope="col" rowSpan={2} className={cn(headCell, 'sticky left-0 z-30 w-10')}>
              <span className="sr-only">Expand</span>
            </th>
            <th
              scope="col"
              rowSpan={2}
              className={cn(
                headCell,
                'sticky left-10 z-30 min-w-56 border-r border-line py-4 pr-4 text-left align-bottom font-mono text-xs font-semibold tracking-wider text-ink-2 uppercase',
              )}
            >
              Model
            </th>
            {spans.map((g, i) => (
              <th
                key={`${g.group}-${i}`}
                scope="colgroup"
                colSpan={g.span}
                className={cn(
                  headCell,
                  'h-9 px-4 text-left font-mono text-micro font-semibold tracking-widest text-muted uppercase',
                  i > 0 && 'border-l border-line',
                )}
              >
                {g.label}
              </th>
            ))}
          </tr>
          <tr>
            {columns.map((col, i) => {
              const active = sort.id === col.id
              return (
                <th
                  key={col.id}
                  scope="col"
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={cn(headCell, 'px-4 py-3 text-right align-bottom', divider(i))}
                >
                  <button
                    type="button"
                    title={col.source && `Source: ${col.source}`}
                    onClick={() => clickSort(col)}
                    className={cn(
                      'ml-auto inline-flex max-w-44 items-end justify-end gap-1 text-right font-mono text-xs leading-tight font-semibold tracking-wider uppercase',
                      active ? 'text-accent' : 'text-ink-2 hover:text-ink',
                    )}
                  >
                    <span>{col.label}</span>
                    <span aria-hidden className={cn('text-tiny', !active && 'invisible')}>
                      {sort.dir === 'asc' ? '▲' : '▼'}
                    </span>
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + 2} className="px-6 py-12 text-center text-ink-2">
                No models match these filters.
              </td>
            </tr>
          )}
          {rows.slice(0, limit).map((m) => {
            const open = expanded.has(m.id)
            return (
              <Fragment key={m.id}>
                <tr onClick={() => toggle(m.id)} className="group cursor-pointer hover:bg-surface-2 [&>*]:border-b [&>*]:border-line">
                  <td className={cn(stickyLeft, 'left-0 pl-4')}>
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-label={`${open ? 'Hide' : 'Show'} details for ${m.name}${m.routing === 'fixed' ? ` via ${m.provider}` : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggle(m.id)
                      }}
                      className={cn('text-tiny transition-transform', open ? 'rotate-90 text-accent' : 'text-muted')}
                    >
                      ▶
                    </button>
                  </td>
                  <th scope="row" className={cn(stickyLeft, 'left-10 border-r border-line py-3.5 pr-4 text-left font-semibold text-ink')}>
                    <div className="flex items-center gap-2">
                      <span className="whitespace-nowrap">{m.name}</span>
                      {m.routing === 'auto' && <Badge tone="muted">random per request</Badge>}
                      {m.open_weights && <Badge>open</Badge>}
                      {m.status && m.status !== 'available' && <Badge tone="muted">{m.status}</Badge>}
                    </div>
                    <div className="mt-0.5 text-xs font-normal whitespace-nowrap text-muted">
                      {[
                        m.routing === 'fixed' ? `via ${m.provider}` : `${m.routing_mix?.length ?? 0} models`,
                        showOrg && m.routing === 'fixed' && m.organization,
                        m.run_at && `run ${formatDate(m.run_at)}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </th>
                  {columns.map((col, i) => {
                    const v = col.get(m)
                    return (
                      <td
                        key={col.id}
                        style={{ background: col.shade ? heat(ranks.get(col.id)?.get(m.id)) : undefined }}
                        className={cn(
                          'px-4 py-3.5 text-right font-mono whitespace-nowrap text-ink tabular-nums',
                          divider(i),
                          col.primary && 'text-base font-bold',
                          v == null && 'text-muted',
                        )}
                      >
                        {col.format(m)}
                      </td>
                    )
                  })}
                </tr>
                {open && (
                  <tr className="bg-surface-2">
                    <td colSpan={columns.length + 2} className="border-b border-line p-0">
                      <div className="sticky left-0" style={{ width: visibleWidth || undefined }}>
                        <OfferingDetail row={m} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
