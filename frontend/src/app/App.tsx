import { useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, type MouseEvent } from 'react'
import { useRuns, useServiceLeaderboard, useServices } from '../api/client'
import { CatalogSection } from '../features/catalog/CatalogSection'
import { LeaderboardSection } from '../features/leaderboard/LeaderboardSection'
import { RunsSection } from '../features/runs/RunsSection'
import { BoardProvider } from '../shared/board/BoardContext'
import type { Service } from '../api/types'
import { cn } from '../shared/lib/cn'
import { formatDate } from '../shared/lib/format'
import { searchHref, updateSearch, useSearch, type Tab } from '../shared/state/searchParams'
import { ErrorBoundary } from '../shared/ui/ErrorBoundary'
import { SelectPill } from '../shared/ui/SelectPill'

// Below the fold, and the heaviest code (charts): load it after the table.
const InsightsSection = lazy(() => import('../features/insights/InsightsSection'))

// Switching service is navigation (new history entry) and drops the previous service's view params.
const selectService = (id: string) => updateSearch({ service: id }, { push: true, reset: true })

export default function App() {
  const queryClient = useQueryClient()
  const services = useServices()
  const search = useSearch()
  const service = search.service ? services.data?.find((s) => s.id === search.service) : services.data?.[0]
  const board = useServiceLeaderboard(service?.id, search.profile)
  const tab = search.tab ?? 'leaderboard'
  // Watched on every tab, not just Runs: it polls while any run is in flight and
  // refreshes the leaderboard when one finishes (see useRuns).
  useRuns(service?.id)

  // Pin the default service in the URL, so a copied link keeps pointing at it.
  useEffect(() => {
    if (!search.service && service) updateSearch({ service: service.id })
  }, [search.service, service])

  return (
    <div className="min-h-screen">
      {/* Sticky from sm up; on a phone the two rows would cover too much of the screen. */}
      <header className="border-b border-line bg-surface sm:sticky sm:top-0 sm:z-30">
        <div className="mx-auto max-w-page px-4 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
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
          {service && <SectionTabs tab={tab} />}
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
        {service && (
          // Keyed by service so local filters and selections start fresh on switch.
          <ErrorBoundary
            key={service.id}
            fallback={(error, reset) => (
              <ErrorPanel
                message="This page couldn't be displayed."
                detail={error.message}
                actionLabel="Reload data"
                // Re-rendering the same data would fail the same way, so fetch fresh data first.
                onRetry={() => queryClient.refetchQueries().then(reset)}
              />
            )}
          >
            <ServicePage service={service} board={board} tab={tab} />
          </ErrorBoundary>
        )}
      </main>
    </div>
  )
}

const TABS: { value: Tab; label: string }[] = [
  { value: 'leaderboard', label: 'Leaderboard' },
  { value: 'runs', label: 'Runs' },
  { value: 'catalog', label: 'Models catalog' },
]

// Changing tab is navigation; it closes any open run or form (so the current tab leads back to its top).
const tabPatch = (t: Tab) => ({ tab: t === 'leaderboard' ? null : t, run: null, new: null })

/**
 * The service's sections, as links: real URLs, so they open in a new tab too,
 * while a plain click navigates in place. Styled as tabs, unlike the pill
 * chips below them, which filter what a section shows.
 */
function SectionTabs({ tab }: { tab: Tab }) {
  const go = (e: MouseEvent, t: Tab) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    updateSearch(tabPatch(t), { push: true })
  }
  return (
    <nav aria-label="Service sections" className="-mx-1.5 -mb-px flex gap-3 overflow-x-auto">
      {TABS.map((t) => (
        <a
          key={t.value}
          href={searchHref(tabPatch(t.value))}
          aria-current={t.value === tab ? 'page' : undefined}
          onClick={(e) => go(e, t.value)}
          className={cn(
            // Inset focus ring: the nav scrolls sideways on narrow screens and would clip an outer one.
            // px + the nav's -mx keep the labels aligned with the page while giving the ring room.
            'rounded-t-md border-b-2 px-1.5 pt-1 pb-2.5 font-mono text-sm whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
            t.value === tab ? 'border-accent font-semibold text-ink' : 'border-transparent text-ink-2 hover:border-line-strong hover:text-ink',
          )}
        >
          {t.label}
        </a>
      ))}
    </nav>
  )
}

type BoardQuery = ReturnType<typeof useServiceLeaderboard>

/**
 * One service's page. Only the leaderboard tab needs the leaderboard: Runs and
 * Catalog work from the service alone, so you can still see and cancel runs
 * while the leaderboard fails to load.
 */
function ServicePage({ service: s, board, tab }: { service: Service; board: BoardQuery; tab: Tab }) {
  const updated = formatDate(board.data?.updatedAt)
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
      </div>
      {tab === 'leaderboard' && <LeaderboardTab board={board} />}
      {tab === 'runs' && <RunsSection service={s} />}
      {tab === 'catalog' && <CatalogSection service={s} />}
    </>
  )
}

function LeaderboardTab({ board }: { board: BoardQuery }) {
  if (board.isError) return <ErrorPanel message="Couldn't load this service's leaderboard." detail={board.error.message} onRetry={() => board.refetch()} />
  if (!board.data) return <LoadingState />
  return (
    <BoardProvider value={board.data}>
      <LeaderboardSection />
      <div className="mt-20">
        <Suspense fallback={<div aria-busy="true" aria-label="Loading insights" className="h-96 animate-pulse rounded-2xl bg-line/70" />}>
          <InsightsSection />
        </Suspense>
      </div>
    </BoardProvider>
  )
}

function LoadingState() {
  return <div aria-busy="true" aria-label="Loading leaderboard" className="h-96 animate-pulse rounded-2xl bg-line/70" />
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
