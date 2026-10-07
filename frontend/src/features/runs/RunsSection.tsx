import { useState } from 'react'
import { useCancelRun, useCatalog, useLoadProfiles, useRuns } from '../../api/client'
import type { Service } from '../../api/types'
import { isActive } from '../../api/types'
import { updateSearch, useSearch } from '../../shared/state/searchParams'
import { SectionHeader } from '../../shared/ui/Card'
import { ChipRadioGroup } from '../../shared/ui/ChipRadioGroup'
import { pill } from '../../shared/ui/pill'
import { NewRunForm } from './NewRunForm'
import { RunDetail } from './RunDetail'
import { RunsTable } from './RunsTable'
import { filterRuns, type StatusFilter } from './runs'

const ROW_LIMIT = 50

export const openRun = (id: string) => updateSearch({ run: id, new: null }, { push: true })
const closeRun = () => updateSearch({ run: null }, { push: true })

/** The runs tab: the list (with the new-run form), or one run's detail page. */
export function RunsSection({ service }: { service: Service }) {
  const search = useSearch()
  if (search.run) return <RunDetail runId={search.run} service={service} onBack={closeRun} />
  return <RunsList service={service} formOpen={search.new === '1'} />
}

function RunsList({ service, formOpen }: { service: Service; formOpen: boolean }) {
  const runs = useRuns(service.id)
  const catalog = useCatalog()
  const profiles = useLoadProfiles()
  const cancel = useCancelRun()
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [showAll, setShowAll] = useState(false)
  const [started, setStarted] = useState<string[]>([])

  const all = runs.data ?? []
  const rows = filterRuns(all, filter)
  const active = all.filter((r) => isActive(r.status)).length

  return (
    <section aria-labelledby="runs-title">
      <SectionHeader id="runs-title" index="01" title="Runs">
        Each run is one BlazeMeter load test against {service.name}. Runs on a service queue up and go one at a time; results combine BlazeMeter's
        client-side view with the service's Splunk request logs.
      </SectionHeader>

      {formOpen && catalog.data && profiles.data ? (
        <NewRunForm
          service={service}
          catalog={catalog.data}
          profiles={profiles.data}
          onClose={() => updateSearch({ new: null }, { push: true })}
          onStarted={(created) => {
            setStarted(created.map((r) => r.id))
            setFilter('all')
            updateSearch({ new: null }, { push: true })
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => updateSearch({ new: '1' }, { push: true })} className={pill({ tone: 'on' })}>
            + New run
          </button>
          {started.length > 0 && (
            <span role="status" className="text-sm text-ink-2">
              Started {started.length === 1 ? `run ${started[0]}` : `${started.length} runs`} — {started.length > 1 ? 'they run' : 'it runs'} in order
              below.
            </span>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <ChipRadioGroup<StatusFilter>
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All · ${all.length}` },
            { value: 'active', label: `In flight · ${active}` },
            { value: 'completed', label: 'Completed' },
            { value: 'failed', label: 'Failed / cancelled' },
          ]}
        />
        {active > 0 && <span className="font-mono text-xs text-muted">Refreshing every 2 s while runs are in flight</span>}
      </div>

      <div className="mt-4">
        {runs.isPending && <div aria-busy="true" aria-label="Loading runs" className="h-72 animate-pulse rounded-2xl bg-line/70" />}
        {runs.isError && (
          <p role="alert" className="rounded-xl border border-bad/40 px-4 py-3 text-sm text-bad">
            Couldn't load runs: {runs.error.message}
          </p>
        )}
        {runs.data && (
          <RunsTable
            runs={showAll ? rows : rows.slice(0, ROW_LIMIT)}
            catalog={catalog.data}
            onOpen={openRun}
            onCancel={(id) => cancel.mutate(id)}
            cancelling={cancel.isPending ? cancel.variables : undefined}
          />
        )}
      </div>
      {rows.length > ROW_LIMIT && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 w-full rounded-xl border border-dashed border-line-strong py-2.5 font-mono text-sm text-ink-2 hover:border-accent hover:text-accent"
        >
          {showAll ? `Show latest ${ROW_LIMIT}` : `Show all ${rows.length} runs`}
        </button>
      )}
    </section>
  )
}
