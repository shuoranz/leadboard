import { useMemo, useState } from 'react'
import { useBoard } from '../../shared/board/BoardContext'
import { OVERALL, chipLabel, type View } from '../../shared/board/model'
import { SectionHeader } from '../../shared/ui/Card'
import { Chip } from '../../shared/ui/Chip'
import { ChipRadioGroup } from '../../shared/ui/ChipRadioGroup'
import { CheckRow, MenuFooter, PopoverMenu } from '../../shared/ui/PopoverMenu'
import { SelectPill } from '../../shared/ui/SelectPill'
import { TextInput } from '../../shared/ui/TextInput'
import { LeaderboardTable } from './LeaderboardTable'
import { filterModels, sortModels } from './table'
import { useLeaderboardView } from './useLeaderboardView'

const ROW_LIMIT = 25

const toggleIn = (set: Set<string>, id: string) => {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export function LeaderboardSection() {
  const board = useBoard()
  const { view, columns, sort, compare, setView, setSort, setCompare } = useLeaderboardView(board)

  // Local exploration state (see shared/state/searchParams.ts for what's shareable).
  const [query, setQuery] = useState('')
  const [openOnly, setOpenOnly] = useState(false)
  const [includeFinetunes, setIncludeFinetunes] = useState(false)
  const [showOrg, setShowOrg] = useState(false)
  const [organization, setOrganization] = useState('')
  const [compareQuery, setCompareQuery] = useState('')
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState(false)

  const visibleColumns = columns.filter((c) => !hidden.has(c.id))

  const rows = useMemo(() => {
    // Comparing is an explicit pick, so it bypasses the other filters.
    const base =
      compare.size > 0
        ? board.models.filter((m) => compare.has(m.id))
        : filterModels(board.models, { query, openOnly, includeFinetunes, organization })
    return sortModels(base, columns.find((c) => c.id === sort.id) ?? columns[0], sort.dir)
  }, [board.models, compare, query, openOnly, includeFinetunes, organization, columns, sort.id, sort.dir])

  const q = compareQuery.trim().toLowerCase()
  const compareCandidates = q ? board.models.filter((m) => m.name.toLowerCase().includes(q)) : board.models

  return (
    <section aria-labelledby="leaderboard-title">
      <SectionHeader id="leaderboard-title" index="01" title="Leaderboard">
        Overall score, client-side API performance and cost, all sortable. Pick a category for its subtask scores, or click a row for them.
      </SectionHeader>

      <div className="flex flex-wrap items-center gap-2.5">
        <TextInput
          label="Search models"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search models…"
          className="min-w-60 flex-1 basis-72"
        />
        <Chip active={openOnly} onClick={() => setOpenOnly((v) => !v)}>
          Open weights
        </Chip>
        <Chip active={includeFinetunes} onClick={() => setIncludeFinetunes((v) => !v)}>
          Include finetunes
        </Chip>
        <Chip active={showOrg} onClick={() => setShowOrg((v) => !v)}>
          Show org
        </Chip>
        <SelectPill label="Organization" value={organization} onChange={setOrganization} className="min-w-48">
          <option value="">All organizations</option>
          {board.organizations.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </SelectPill>
        <PopoverMenu label={compare.size ? `Compare · ${compare.size}` : 'Compare'} engaged={compare.size > 0}>
          <TextInput
            label="Filter models"
            size="sm"
            type="search"
            value={compareQuery}
            onChange={(e) => setCompareQuery(e.target.value)}
            placeholder="Filter models…"
            className="mb-1"
          />
          <div className="max-h-72 overflow-y-auto">
            {compareCandidates.map((m) => (
              <CheckRow key={m.id} checked={compare.has(m.id)} onChange={() => setCompare(toggleIn(compare, m.id))}>
                {m.name}
              </CheckRow>
            ))}
          </div>
          <MenuFooter>
            <span>{compare.size ? 'Only compared models are shown' : 'Pick models to show side by side'}</span>
            <button type="button" className="text-accent disabled:opacity-40" disabled={!compare.size} onClick={() => setCompare(new Set())}>
              Clear
            </button>
          </MenuFooter>
        </PopoverMenu>
        <PopoverMenu label="Choose columns" engaged={columns.some((c) => hidden.has(c.id))}>
          {columns.map((c) => (
            <CheckRow key={c.id} checked={!hidden.has(c.id)} onChange={() => setHidden((s) => toggleIn(s, c.id))}>
              {c.label}
            </CheckRow>
          ))}
          <MenuFooter>
            <span />
            <button type="button" className="text-accent" onClick={() => setHidden(new Set())}>
              Show all
            </button>
          </MenuFooter>
        </PopoverMenu>
      </div>

      <div className="mt-4">
        <ChipRadioGroup<View>
          label="Category"
          value={view}
          onChange={setView}
          options={[{ value: OVERALL, label: 'All' }, ...board.categories.map((c) => ({ value: c.id, label: chipLabel(c), title: c.name }))]}
        />
      </div>

      <div className="mt-5">
        <LeaderboardTable
          rows={rows}
          columns={visibleColumns}
          sort={sort}
          onSort={setSort}
          showOrg={showOrg}
          highlightCategory={view ?? undefined}
          limit={showAll ? undefined : ROW_LIMIT}
        />
      </div>
      {rows.length > ROW_LIMIT && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 w-full rounded-xl border border-dashed border-line-strong py-2.5 font-mono text-sm text-ink-2 hover:border-accent hover:text-accent"
        >
          {showAll ? `Show top ${ROW_LIMIT}` : `Show all ${rows.length} models`}
        </button>
      )}
      <p className="mt-3 font-mono text-xs text-muted">
        {Math.min(rows.length, showAll ? Infinity : ROW_LIMIT)} shown · {rows.length} of {board.models.length} models match
        {compare.size > 0 && ' · comparing'}
        {' · '}shading marks the best 5 per column · latencies in ms · costs in USD
      </p>
    </section>
  )
}
