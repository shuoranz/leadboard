import { lazy, Suspense, useEffect } from 'react'
import { useServiceLeaderboard, useServices } from '../api/client'
import { CatalogSection } from '../features/catalog/CatalogSection'
import { LeaderboardSection } from '../features/leaderboard/LeaderboardSection'
import { RunsSection } from '../features/runs/RunsSection'
import { BoardProvider } from '../shared/board/BoardContext'
import type { BoardIndex } from '../shared/board/boardIndex'
import { formatDate } from '../shared/lib/format'
import { updateSearch, useSearch, type Tab } from '../shared/state/searchParams'
import { ChipRadioGroup } from '../shared/ui/ChipRadioGroup'
import { ErrorBoundary } from '../shared/ui/ErrorBoundary'
import { SelectPill } from '../shared/ui/SelectPill'

// Below the fold, and the heaviest code (charts): load it after the table.
const InsightsSection = lazy(() => import('../features/insights/InsightsSection'))

// Switching service is navigation (new history entry) and drops the previous service's view params.
const selectService = (id: string) => updateSearch({ service: id }, { push: true, reset: true })

export default function App() {
  const services = useServices()
  const search = useSearch()
  const service = search.service ? services.data?.find((s) => s.id === search.service) : services.data?.[0]
  const board = useServiceLeaderboard(service?.id, search.profile)

  // Pin the default service in the URL, so a copied link keeps pointing at it.
  useEffect(() => {
    if (!search.service && service) updateSearch({ service: service.id })
  }, [search.service, service])

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <span className="font-mono text-sm font-semibold tracking-wide text-ink">
            <span className="text-accent">▍</span>LLM Service Benchmark
          </span>
          {services.data && services.data.length > 0 && (
            <SelectPill label="Service" value={service?.id ?? ''} onChange={selectService} className="min-w-64" mono={false}>
              {!service && <option value="">Choose a service…</option>}
              {services.data.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SelectPill>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-page px-4 pt-10 pb-24 sm:px-8">
        {services.isError && <ErrorPanel message="Couldn't load the list of services." detail={services.error.message} onRetry={() => services.refetch()} />}
        {services.data?.length === 0 && <p className="text-ink-2">No services are set up yet.</p>}
        {search.service && services.data && !service && (
          <p className="mb-6 text-ink-2">
            Unknown service <code className="font-mono">{search.service}</code>.
          </p>
        )}
        {board.isPending && service && <LoadingState />}
        {board.isError && <ErrorPanel message="Couldn't load this service's leaderboard." detail={board.error.message} onRetry={() => board.refetch()} />}
        {board.data && (
          // Keyed by service so local filters and selections start fresh on switch.
          <ErrorBoundary
            key={board.data.service.id}
            fallback={(error, reset) => (
              <ErrorPanel
                message="This page couldn't be displayed."
                detail={error.message}
                actionLabel="Reload data"
                // Re-rendering the same data would fail the same way, so fetch fresh data first.
                onRetry={() => board.refetch().then(reset)}
              />
            )}
          >
            <BoardProvider value={board.data}>
              <ServicePage board={board.data} tab={search.tab ?? 'leaderboard'} />
            </BoardProvider>
          </ErrorBoundary>
        )}
      </main>
    </div>
  )
}

const TAB_OPTIONS: { value: Tab; label: string }[] = [
  { value: 'leaderboard', label: 'Leaderboard' },
  { value: 'runs', label: 'Runs' },
  { value: 'catalog', label: 'Models catalog' },
]

// Changing tab is navigation; it closes any open run or form.
const selectTab = (t: Tab) => updateSearch({ tab: t === 'leaderboard' ? null : t, run: null, new: null }, { push: true })

function ServicePage({ board, tab }: { board: BoardIndex; tab: Tab }) {
  const updated = formatDate(board.updatedAt)
  const s = board.service
  return (
    <>
      <div className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight text-ink">{s.name}</h1>
        {s.description && <p className="mt-2 max-w-3xl text-lg text-ink-2">{s.description}</p>}
        <p className="mt-3 font-mono text-xs text-muted">
          POST {s.endpoint_path}
          {s.allowed_offering_ids ? ` · ${s.allowed_offering_ids.length} allowed models` : ' · any catalog model'}
          {updated && ` · last run ${updated}`}
        </p>
        <nav aria-label="Service sections" className="mt-6">
          <ChipRadioGroup<Tab> label="View" value={tab} onChange={selectTab} options={TAB_OPTIONS} />
        </nav>
      </div>
      {tab === 'leaderboard' && (
        <>
          <LeaderboardSection />
          <div className="mt-20">
            <Suspense fallback={<div aria-busy="true" aria-label="Loading insights" className="h-96 animate-pulse rounded-2xl bg-line/70" />}>
              <InsightsSection />
            </Suspense>
          </div>
        </>
      )}
      {tab === 'runs' && <RunsSection service={s} />}
      {tab === 'catalog' && <CatalogSection service={s} />}
    </>
  )
}

function LoadingState() {
  return (
    <div aria-busy="true" aria-label="Loading leaderboard" className="animate-pulse space-y-4">
      <div className="h-10 w-80 rounded-lg bg-line" />
      <div className="h-5 w-[32rem] max-w-full rounded bg-line" />
      <div className="mt-10 h-96 rounded-2xl bg-line/70" />
    </div>
  )
}

function ErrorPanel({ message, detail, onRetry, actionLabel = 'Retry' }: { message: string; detail: string; onRetry: () => void; actionLabel?: string }) {
  return (
    <div role="alert" className="mb-6 rounded-xl border border-bad/40 bg-surface p-5">
      <p className="font-semibold text-ink">{message}</p>
      <p className="mt-1 font-mono text-xs break-words text-muted">{detail}</p>
      <button type="button" onClick={onRetry} className="mt-3 font-mono text-sm text-accent">
        {actionLabel}
      </button>
    </div>
  )
}
