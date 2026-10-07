import { useMemo, useState } from 'react'
import { useBoard } from '../../shared/board/BoardContext'
import { displayName } from '../../shared/board/model'
import { formatDuration } from '../../shared/lib/format'
import { updateSearch } from '../../shared/state/searchParams'
import { SectionHeader } from '../../shared/ui/Card'
import { Chip } from '../../shared/ui/Chip'
import { ChipRadioGroup } from '../../shared/ui/ChipRadioGroup'
import { pill } from '../../shared/ui/pill'
import { CheckRow, MenuFooter, PopoverMenu } from '../../shared/ui/PopoverMenu'
import { SelectPill } from '../../shared/ui/SelectPill'
import { TextInput } from '../../shared/ui/TextInput'
import { LeaderboardTable } from './LeaderboardTable'
import { TestConditions } from './TestConditions'
import { COLUMNS, COLUMN_GROUPS, DEFAULT_HIDDEN, bestPerModel, filterRows, sortRows, type Column } from './table'
import { useLeaderboardView } from './useLeaderboardView'

const ROW_LIMIT = 25

const toggleIn = (set: ReadonlySet<string>, id: string) => {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** Opening the run form is navigation (back closes it). */
export const startRun = () => updateSearch({ tab: 'runs', new: '1', run: null }, { push: true })

export function LeaderboardSection() {
  const board = useBoard()
  const { sort, compare, setProfile, setSort, setCompare } = useLeaderboardView(board)
  const multiProvider = board.providers.length > 1

  // Local exploration state (see shared/state/searchParams.ts for what's shareable).
  const [query, setQuery] = useState('')
  const [openOnly, setOpenOnly] = useState(false)
  const [showOrg, setShowOrg] = useState(false)
  const [organization, setOrganization] = useState('')
  const [provider, setProvider] = useState('')
  const [onePerModel, setOnePerModel] = useState(false)
  const [compareQuery, setCompareQuery] = useState('')
  const [hidden, setHidden] = useState<ReadonlySet<string>>(DEFAULT_HIDDEN)
  const [showAll, setShowAll] = useState(false)

  const visibleColumns = COLUMNS.filter((c) => !hidden.has(c.id))

  const rows = useMemo(() => {
    // Comparing is an explicit pick, so it bypasses the other filters.
    const base = compare.size > 0 ? board.rows.filter((r) => compare.has(r.id)) : filterRows(board.rows, { query, openOnly, organization, provider })
    const sorted = sortRows(base, COLUMNS.find((c) => c.id === sort.id) ?? COLUMNS[0], sort.dir)
    return onePerModel && compare.size === 0 ? bestPerModel(sorted) : sorted
  }, [board.rows, compare, query, openOnly, organization, provider, onePerModel, sort.id, sort.dir])

  const q = compareQuery.trim().toLowerCase()
  const compareCandidates = q ? board.rows.filter((r) => displayName(r).toLowerCase().includes(q)) : board.rows

  const columnGroups = COLUMN_GROUPS.map((g) => ({ ...g, columns: COLUMNS.filter((c) => c.group === g.id) }))
  const toggleGroup = (cols: Column[]) =>
    setHidden((s) => {
      const next = new Set(s)
      const allShown = cols.every((c) => !s.has(c.id))
      for (const c of cols) {
        if (allShown) next.add(c.id)
        else next.delete(c.id)
      }
      return next
    })
  const isDefaultColumns = COLUMNS.every((c) => hidden.has(c.id) === DEFAULT_HIDDEN.has(c.id))
  const profile = board.profile

  return (
    <section aria-labelledby="leaderboard-title">
      <SectionHeader id="leaderboard-title" index="01" title="Leaderboard">
        Every provider × model this service has been benchmarked on, ranked on its latest completed run. Latency and volume come from BlazeMeter
        (client side); TTFT, tokens and error causes from the service's own Splunk logs. Click a row for details.
      </SectionHeader>

      <ChipRadioGroup<string>
        label="Load profile"
        value={profile?.id ?? ''}
        onChange={setProfile}
        options={board.profiles.map((p) => ({
          value: p.id,
          label: `${p.name} · ${p.runs}`,
          title:
            p.id === 'custom'
              ? `${p.description ?? ''} ${p.runs} runs`
              : `${p.concurrency} virtual users, ${formatDuration(p.duration_s)} · ${p.runs} completed runs`,
        }))}
      />

      <div className="mt-4">
        <TestConditions />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2.5">
        <TextInput
          label="Search models"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search models, providers or makers…"
          className="min-w-60 flex-1 basis-72"
        />
        <Chip active={openOnly} onClick={() => setOpenOnly((v) => !v)}>
          Open weights
        </Chip>
        <Chip active={showOrg} onClick={() => setShowOrg((v) => !v)}>
          Show maker
        </Chip>
        {multiProvider && (
          <Chip active={onePerModel} onClick={() => setOnePerModel((v) => !v)}>
            One row per model
          </Chip>
        )}
        <SelectPill label="Organization" value={organization} onChange={setOrganization} className="min-w-48">
          <option value="">All makers</option>
          {board.organizations.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </SelectPill>
        {multiProvider && (
          <SelectPill label="Provider" value={provider} onChange={setProvider} className="min-w-44">
            <option value="">All providers</option>
            {board.providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </SelectPill>
        )}
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
            {compareCandidates.map((r) => (
              <CheckRow key={r.id} checked={compare.has(r.id)} onChange={() => setCompare(toggleIn(compare, r.id))}>
                {displayName(r)}
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
        <PopoverMenu label="Choose columns" engaged={!isDefaultColumns}>
          {columnGroups.map((g) => {
            const shown = g.columns.filter((c) => !hidden.has(c.id)).length
            return (
              <div key={g.id} role="group" aria-label={`${g.label} columns`} className="mb-1">
                <CheckRow
                  checked={shown === g.columns.length}
                  indeterminate={shown > 0 && shown < g.columns.length}
                  onChange={() => toggleGroup(g.columns)}
                  className="font-semibold"
                >
                  {g.label}
                </CheckRow>
                {g.columns.map((c) => (
                  <CheckRow key={c.id} checked={!hidden.has(c.id)} onChange={() => setHidden((s) => toggleIn(s, c.id))} className="pl-7">
                    {c.label}
                  </CheckRow>
                ))}
              </div>
            )
          })}
          <MenuFooter>
            <button type="button" className="text-accent disabled:opacity-40" disabled={isDefaultColumns} onClick={() => setHidden(DEFAULT_HIDDEN)}>
              Defaults
            </button>
            <button type="button" className="text-accent" onClick={() => setHidden(new Set())}>
              Show all
            </button>
          </MenuFooter>
        </PopoverMenu>
      </div>

      <div className="mt-5">
        {board.rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line-strong px-6 py-14 text-center">
            <p className="text-lg text-ink">No completed runs{profile ? ` under the ${profile.name} profile` : ''} yet.</p>
            <p className="mt-1 text-ink-2">Start a BlazeMeter test against this service and the results land here.</p>
            <button type="button" onClick={startRun} className={pill({ tone: 'on', className: 'mt-5' })}>
              Start a run
            </button>
          </div>
        ) : (
          <LeaderboardTable rows={rows} columns={visibleColumns} sort={sort} onSort={setSort} showOrg={showOrg} limit={showAll ? undefined : ROW_LIMIT} />
        )}
      </div>
      {rows.length > ROW_LIMIT && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 w-full rounded-xl border border-dashed border-line-strong py-2.5 font-mono text-sm text-ink-2 hover:border-accent hover:text-accent"
        >
          {showAll ? `Show top ${ROW_LIMIT}` : `Show all ${rows.length} rows`}
        </button>
      )}
      {board.rows.length > 0 && (
        <p className="mt-3 font-mono text-xs text-muted">
          {Math.min(rows.length, showAll ? Infinity : ROW_LIMIT)} shown · {rows.length} of {board.rows.length} rows match
          {onePerModel && compare.size === 0 && ' · best provider per model under the current sort'}
          {compare.size > 0 && ' · comparing'}
          {' · '}shading marks the best 5 per column · latencies in ms · costs in USD at list price
        </p>
      )}
    </section>
  )
}
