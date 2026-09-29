import { lazy, Suspense, useEffect } from 'react'
import { useApps, useLeaderboard } from '../api/client'
import { LeaderboardSection } from '../features/leaderboard/LeaderboardSection'
import { BoardProvider } from '../shared/board/BoardContext'
import type { BoardIndex } from '../shared/board/boardIndex'
import { formatDate } from '../shared/lib/format'
import { updateSearch, useSearch } from '../shared/state/searchParams'
import { ErrorBoundary } from '../shared/ui/ErrorBoundary'
import { SelectPill } from '../shared/ui/SelectPill'

// Below the fold, and the heaviest code (charts): load it after the table.
const InsightsSection = lazy(() => import('../features/insights/InsightsSection'))

// Switching apps is navigation (new history entry) and drops the previous app's view params.
const selectApp = (id: string) => updateSearch({ app: id }, { push: true, reset: true })

export default function App() {
  const apps = useApps()
  const search = useSearch()
  const appId = search.app ?? apps.data?.[0]?.id
  const board = useLeaderboard(appId)

  // Pin the default app in the URL, so a copied link keeps pointing at it.
  useEffect(() => {
    if (!search.app && appId) updateSearch({ app: appId })
  }, [search.app, appId])

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <span className="font-mono text-sm font-semibold tracking-wide text-ink">
            <span className="text-accent">▍</span>App Benchmark
          </span>
          {apps.data && apps.data.length > 0 && (
            <SelectPill label="API app" value={appId ?? ''} onChange={selectApp} className="min-w-64" mono={false}>
              {apps.data.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </SelectPill>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-page px-4 pt-10 pb-24 sm:px-8">
        {apps.isError && <ErrorPanel message="Couldn't load the list of apps." detail={apps.error.message} onRetry={() => apps.refetch()} />}
        {apps.data?.length === 0 && <p className="text-ink-2">No apps have benchmark results yet.</p>}
        {search.app && apps.data && !apps.data.some((a) => a.id === search.app) && (
          <p className="mb-6 text-ink-2">
            Unknown app <code className="font-mono">{search.app}</code>.
          </p>
        )}
        {board.isPending && appId && <LoadingState />}
        {board.isError && <ErrorPanel message="Couldn't load this leaderboard." detail={board.error.message} onRetry={() => board.refetch()} />}
        {board.data && (
          // Keyed by app so local filters and selections start fresh on switch.
          <ErrorBoundary
            key={board.data.app.id}
            fallback={(error, reset) => (
              <ErrorPanel
                message="This leaderboard couldn't be displayed."
                detail={error.message}
                actionLabel="Reload data"
                // Re-rendering the same data would fail the same way, so fetch fresh data first.
                onRetry={() => board.refetch().then(reset)}
              />
            )}
          >
            <BoardProvider value={board.data}>
              <AppBoard board={board.data} />
            </BoardProvider>
          </ErrorBoundary>
        )}
      </main>
    </div>
  )
}

function AppBoard({ board }: { board: BoardIndex }) {
  const updated = formatDate(board.app.updated_at)
  return (
    <>
      <div className="mb-14">
        <h1 className="text-4xl font-bold tracking-tight text-ink">{board.app.name}</h1>
        {board.app.description && <p className="mt-2 max-w-3xl text-lg text-ink-2">{board.app.description}</p>}
        <p className="mt-3 font-mono text-xs text-muted">
          {board.models.length} models · {board.categories.length} categories
          {updated && ` · updated ${updated}`}
        </p>
      </div>
      <LeaderboardSection />
      <div className="mt-20">
        <Suspense fallback={<div aria-busy="true" aria-label="Loading insights" className="h-96 animate-pulse rounded-2xl bg-line/70" />}>
          <InsightsSection />
        </Suspense>
      </div>
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
