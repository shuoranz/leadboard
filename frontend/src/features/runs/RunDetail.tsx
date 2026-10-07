import { useEffect, useRef } from 'react'
import { useCancelRun, useCatalog, useInvalidateAfterRun, useRun, useRunResults } from '../../api/client'
import type { Run, RunResults, Service } from '../../api/types'
import { isActive } from '../../api/types'
import { offeringLabel, type CatalogIndex } from '../../shared/catalog/catalogIndex'
import { cn } from '../../shared/lib/cn'
import {
  formatCompact,
  formatCost1k,
  formatDateTime,
  formatDecimal,
  formatDuration,
  formatInt,
  formatMs,
  formatPair,
  formatPercent,
} from '../../shared/lib/format'
import { ErrorCauses, FactList, KpiGrid, PanelTitle, SourceBadge, StatusBadge, TtftByInput } from '../../shared/perf/PerfPanels'
import { Card } from '../../shared/ui/Card'
import { SourceLinks } from './RunsTable'
import { TimelineChart } from './TimelineChart'
import { elapsedSeconds, routingLabel, stepsFor } from './runs'

export function RunDetail({ runId, service, onBack }: { runId: string; service: Service; onBack: () => void }) {
  const run = useRun(runId)
  const catalog = useCatalog().data
  const data = run.data
  const ready = !!data && (data.status === 'completed' || (data.status === 'cancelled' && !!data.headline))
  const results = useRunResults(runId, ready)
  const cancel = useCancelRun()
  const invalidate = useInvalidateAfterRun()

  // When a run we're watching finishes, the leaderboard and run list are stale.
  const wasActive = useRef(false)
  useEffect(() => {
    if (!data) return
    if (wasActive.current && !isActive(data.status)) invalidate(data.service_id)
    wasActive.current = isActive(data.status)
  }, [data, invalidate])

  return (
    <section aria-labelledby="run-title">
      <button type="button" onClick={onBack} className="mb-5 font-mono text-sm text-accent hover:underline">
        ← All runs
      </button>
      {run.isPending && <div aria-busy="true" aria-label="Loading run" className="h-64 animate-pulse rounded-2xl bg-line/70" />}
      {run.isError && (
        <p role="alert" className="rounded-xl border border-bad/40 px-4 py-3 text-sm text-bad">
          {run.error.message.startsWith('404') ? `Run ${runId} doesn't exist.` : `Couldn't load run ${runId}: ${run.error.message}`}
        </p>
      )}
      {data && data.service_id !== service.id && (
        <p className="mb-4 text-sm text-ink-2">This run belongs to another service ({data.service_id}).</p>
      )}
      {data && (
        <>
          <RunHeader run={data} catalog={catalog} onCancel={() => cancel.mutate(data.id)} cancelling={cancel.isPending} />
          {data.status === 'failed' && (
            <p role="alert" className="mt-5 rounded-xl border border-bad/40 bg-bad/5 px-4 py-3 text-sm text-bad">
              The run failed: {data.error ?? 'unknown error'}
            </p>
          )}
          {isActive(data.status) && (
            <p className="mt-6 rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-ink-2">
              {data.status === 'queued'
                ? 'Waiting for earlier runs on this service to finish…'
                : data.status === 'collecting'
                  ? 'The load test is done — pulling the summary from BlazeMeter and searching Splunk for this run’s request logs…'
                  : 'BlazeMeter is generating load. Results appear when the test ends.'}
            </p>
          )}
          {results.isError && (
            <p role="alert" className="mt-5 text-sm text-bad">
              Couldn't load results: {results.error.message}
            </p>
          )}
          {results.data && <RunResultsView run={data} results={results.data} catalog={catalog} />}
        </>
      )}
    </section>
  )
}

function RunHeader({ run, catalog, onCancel, cancelling }: { run: Run; catalog: CatalogIndex | undefined; onCancel: () => void; cancelling: boolean }) {
  const steps = stepsFor(run)
  const meta: [string, string][] = [
    ['Routing', routingLabel(run, catalog)],
    ['Load', `${run.load.name} · ${run.load.concurrency} VU · ramp ${formatDuration(run.load.ramp_up_s)} · ${formatDuration(run.load.duration_s)}`],
    ['Created', formatDateTime(run.created_at)],
    ['Took', formatDuration(elapsedSeconds(run))],
    ['Batch', run.batch_id],
  ]
  if (run.blazemeter.master_id) meta.push(['BlazeMeter master', String(run.blazemeter.master_id)])
  if (run.splunk.sid) meta.push(['Splunk search', run.splunk.search ?? run.splunk.sid])
  return (
    <header>
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="run-title" className="text-3xl font-bold tracking-tight text-ink">
          {run.label ?? 'Run'} <span className="font-mono text-xl font-normal text-muted">{run.id}</span>
        </h2>
        <StatusBadge status={run.status} progress={run.progress} />
        {isActive(run.status) && !run.cancel_requested && (
          <button type="button" onClick={onCancel} disabled={cancelling} className="font-mono text-sm text-bad hover:underline disabled:opacity-50">
            Cancel run
          </button>
        )}
        {run.cancel_requested && isActive(run.status) && <span className="text-sm text-muted">Stopping…</span>}
        <span className="ml-auto">
          <SourceLinks run={run} empty={null} />
        </span>
      </div>
      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-1.5 font-mono text-sm">
        {meta.map(([k, v]) => (
          <div key={k} className="flex items-baseline gap-2">
            <dt className="text-xs tracking-wider text-muted uppercase">{k}:</dt>
            <dd className="text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <ol aria-label="Progress" className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-5">
        {steps.map((s, i) => (
          <li
            key={s.id}
            aria-current={s.state === 'current' ? 'step' : undefined}
            className={cn(
              'rounded-lg border px-3 py-2 text-sm',
              s.state === 'done' && 'border-good/40 text-ink',
              s.state === 'current' && 'border-accent bg-accent/5 text-accent',
              s.state === 'failed' && 'border-bad/60 bg-bad/5 text-bad',
              s.state === 'todo' && 'border-line text-muted',
            )}
          >
            <span className="font-mono text-xs opacity-70">{i + 1}</span> {s.label}
            {s.id === 'running' && s.state === 'current' && (
              <span aria-hidden className="mt-1.5 block h-1 rounded-full bg-line">
                <span className="block h-1 rounded-full bg-accent transition-[width]" style={{ width: `${run.progress}%` }} />
              </span>
            )}
          </li>
        ))}
      </ol>
    </header>
  )
}

function RunResultsView({ run, results, catalog }: { run: Run; results: RunResults; catalog: CatalogIndex | undefined }) {
  const bm = results.blazemeter
  const s = bm.summary
  const sp = results.splunk.overall
  const p = results.perf
  return (
    <div className="mt-8 space-y-6">
      <KpiGrid
        items={[
          { label: 'Requests', value: formatInt(p.requests), hint: 'BlazeMeter hits' },
          { label: 'Error rate', value: formatPercent(s.error_rate), hint: `${formatInt(s.failed)} failed` },
          { label: 'E2E p95', value: formatMs(p.e2e_ms?.p95), hint: 'client side' },
          { label: 'TTFT p50', value: formatMs(p.ttft_ms?.p50), hint: 'server side' },
          { label: 'Throughput', value: `${formatDecimal(p.throughput_rps)}/s`, hint: 'requests per second' },
          { label: 'Cost / 1K', value: formatCost1k(results.cost.per_1k_requests), hint: 'at list price' },
        ]}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card
          title="Load test"
          subtitle={
            <span className="inline-flex flex-wrap items-center gap-2">
              <SourceBadge source="blazemeter" /> What the load generator saw, network included.
            </span>
          }
        >
          <TimelineChart points={bm.timeline} interval={bm.interval_s ?? 10} />
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <FactList
              facts={[
                ['Hits / failed', `${formatInt(s.hits)} / ${formatInt(s.failed)}`],
                ['Avg response', formatMs(s.avg_ms)],
                ['Min / max', formatPair(s.min_ms, s.max_ms, formatInt) + ' ms'],
                ['p50 / p90', formatPair(s.p50_ms, s.p90_ms, formatInt) + ' ms'],
                ['p95 / p99', formatPair(s.p95_ms, s.p99_ms, formatInt) + ' ms'],
                ['Throughput', `${formatDecimal(s.throughput_rps)} req/s`],
                ['Max users', formatInt(s.max_users)],
                ['Duration', formatDuration(s.duration_s)],
              ]}
            />
            <section aria-label="Errors by HTTP status">
              <PanelTitle>Errors by HTTP status</PanelTitle>
              {Object.keys(s.errors_by_code).length === 0 ? (
                <p className="text-sm text-ink-2">No failed requests.</p>
              ) : (
                <FactList facts={Object.entries(s.errors_by_code).map(([code, n]) => [code === '200' ? '200 (bad body)' : code, formatInt(n)])} />
              )}
            </section>
          </div>
        </Card>

        <Card
          title="Service logs"
          subtitle={
            <span className="inline-flex flex-wrap items-center gap-2">
              <SourceBadge source="splunk" /> {formatInt(results.splunk.events)} request events the service logged for this run.
            </span>
          }
        >
          <div className="grid gap-6 sm:grid-cols-2">
            <FactList
              facts={[
                ['TTFT p50 / p95', formatPair(sp.ttft_ms?.p50, sp.ttft_ms?.p95, formatInt) + ' ms'],
                ['TTFT p99', formatMs(sp.ttft_ms?.p99)],
                ['E2E p50 / p95', formatPair(sp.server_e2e_ms?.p50, sp.server_e2e_ms?.p95, formatInt) + ' ms'],
                ['ITL p50 / p95', formatPair(sp.itl_ms?.p50, sp.itl_ms?.p95, formatInt) + ' ms'],
                ['Decode p50', `${formatDecimal(sp.decode_tps_p50)} tok/s`],
                ['Prefill', `${formatInt(sp.prefill_tps)} tok/s`],
                ['Avg tokens in / out', formatPair(sp.avg_input_tokens, sp.avg_output_tokens, formatCompact)],
                ['Output tokens/min', formatPair(sp.tokens_per_min?.avg, sp.tokens_per_min?.peak, formatCompact) + ' avg / peak'],
                ['Stall rate', formatPercent(sp.stall_rate)],
                ['Truncated', formatPercent(sp.truncation_rate)],
                ['Network overhead p50', formatMs(p.client_overhead_ms?.p50)],
              ]}
            />
            <div className="space-y-6">
              {sp.error_breakdown && <ErrorCauses breakdown={sp.error_breakdown} />}
              <TtftByInput points={sp.ttft_by_input} />
            </div>
          </div>
        </Card>
      </div>

      {run.routing.mode === 'auto' && <RoutingMix results={results} catalog={catalog} />}
    </div>
  )
}

/** Auto routing: how requests split across models, and how each did. From Splunk, which logs the model per request. */
function RoutingMix({ results, catalog }: { results: RunResults; catalog: CatalogIndex | undefined }) {
  // Bars scale to the largest share, so a 14-way split is still readable.
  const maxShare = Math.max(...results.splunk.by_offering.map((b) => b.share), 0.01)
  const th = 'px-3 py-2.5 font-mono text-xs font-semibold tracking-wider text-ink-2 uppercase'
  return (
    <Card
      title="Routing mix"
      subtitle={
        <span className="inline-flex flex-wrap items-center gap-2">
          <SourceBadge source="splunk" /> Each request went to a model picked at random. Per-model numbers are server side.
        </span>
      }
    >
      <div className="overflow-x-auto">
        <table aria-label="Routing mix" className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={cn(th, 'pl-0 text-left')}>Model · provider</th>
              <th scope="col" className={cn(th, 'w-1/4 text-left')}>Share</th>
              <th scope="col" className={cn(th, 'text-right')}>Requests</th>
              <th scope="col" className={cn(th, 'text-right')}>Success</th>
              <th scope="col" className={cn(th, 'text-right')}>TTFT p50</th>
              <th scope="col" className={cn(th, 'text-right')}>E2E p95 · server</th>
              <th scope="col" className={cn(th, 'pr-0 text-right')}>$ / 1K</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {results.splunk.by_offering.map((b) => (
              <tr key={b.offering_id} className="border-b border-line last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-sans font-normal text-ink">
                  {offeringLabel(catalog, b.offering_id)}
                </th>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="h-2 flex-1 rounded-[2px] bg-surface-2">
                      <span className="block h-2 rounded-r-[2px] bg-accent/70" style={{ width: `${(b.share / maxShare) * 100}%` }} />
                    </span>
                    <span className="w-10 text-right text-ink">{Math.round(b.share * 100)}%</span>
                  </span>
                </td>
                <td className="px-3 py-2 text-right text-ink">{formatInt(b.perf.requests)}</td>
                <td className="px-3 py-2 text-right text-ink">{formatPercent(b.perf.success_rate)}</td>
                <td className="px-3 py-2 text-right text-ink">{formatInt(b.perf.ttft_ms?.p50)}</td>
                <td className="px-3 py-2 text-right text-ink">{formatInt(b.perf.server_e2e_ms?.p95)}</td>
                <td className="py-2 pl-3 text-right text-ink">{formatCost1k(b.cost.per_1k_requests)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
