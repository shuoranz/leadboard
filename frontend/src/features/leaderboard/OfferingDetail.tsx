import { useCatalog } from '../../api/client'
import type { LeaderboardRow } from '../../api/types'
import { useBoard } from '../../shared/board/BoardContext'
import { offeringLabel } from '../../shared/catalog/catalogIndex'
import { formatCompact, formatCost1k, formatDateTime, formatInt, formatPercent, formatPrice } from '../../shared/lib/format'
import { CapabilityBadges, ErrorCauses, PanelTitle, ShareBars, TtftByInput } from '../../shared/perf/PerfPanels'
import { updateSearch } from '../../shared/state/searchParams'

export const openRun = (id: string) => updateSearch({ tab: 'runs', run: id, new: null }, { push: true })

/**
 * Expanded-row panel: where the row comes from (catalog + run), how the
 * deployment behaved (capabilities, error causes, TTFT by prompt length), and
 * its recent runs. The auto-routing row shows its routing mix instead.
 */
export function OfferingDetail({ row }: { row: LeaderboardRow }) {
  const { palette } = useBoard()
  const catalog = useCatalog().data
  const offering = catalog?.offeringsById.get(row.id)
  const cost = row.cost
  const prices = [cost.input_per_million, cost.cached_input_per_million, cost.output_per_million]
  const meta: [string, string | undefined][] =
    row.routing === 'auto'
      ? [
          ['Routing', 'Each request goes to a model picked at random'],
          ['Models in pool', String(row.routing_mix?.length ?? 0)],
          ['Cost / 1K requests', formatCost1k(cost.per_1k_requests)],
        ]
      : [
          ['From', row.organization],
          ['Served by', row.provider],
          ['Deployment', offering?.deployment],
          ['$/1M in / cached / out', prices.some((p) => p != null) ? prices.map(formatPrice).join(' / ') : undefined],
          [
            'Avg tokens in / out',
            row.perf.avg_input_tokens == null ? undefined : `${formatCompact(row.perf.avg_input_tokens)} / ${formatCompact(row.perf.avg_output_tokens)}`,
          ],
          ['Cost / 1K requests', formatCost1k(cost.per_1k_requests)],
        ]
  const perf = row.perf

  return (
    <div className="px-6 py-7 sm:px-14">
      <dl className="flex flex-wrap gap-x-10 gap-y-2 border-b border-line pb-5 font-mono">
        {meta
          .filter(([, v]) => v != null)
          .map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-2">
              <dt className="text-xs tracking-wider text-muted uppercase">{k}:</dt>
              <dd className="text-body text-ink">{v}</dd>
            </div>
          ))}
      </dl>

      <div className="grid grid-cols-1 gap-x-10 gap-y-7 border-b border-line py-6 lg:grid-cols-3">
        {row.routing === 'auto' && row.routing_mix ? (
          <section aria-label="Routing mix">
            <PanelTitle>Routing mix</PanelTitle>
            <ShareBars
              label="Share of requests per model"
              rows={row.routing_mix.map((m) => {
                const o = catalog?.offeringsById.get(m.offering_id)
                const org = o && catalog?.llmsById.get(o.llm_id)?.organization
                return { key: m.offering_id, label: offeringLabel(catalog, m.offering_id), share: m.share, color: org ? palette.color(org) : undefined }
              })}
            />
          </section>
        ) : (
          row.capabilities && <CapabilityBadges caps={row.capabilities} />
        )}
        {perf.error_breakdown && <ErrorCauses breakdown={perf.error_breakdown} />}
        <TtftByInput points={perf.ttft_by_input} />
      </div>

      <section aria-label="Recent runs" className="pt-6">
        <PanelTitle>Recent runs</PanelTitle>
        <table className="w-full max-w-3xl text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th scope="col" className="py-1.5 pr-4 font-medium">Run</th>
              <th scope="col" className="py-1.5 pr-4 font-medium">Finished</th>
              <th scope="col" className="py-1.5 pr-4 text-right font-medium">E2E p95</th>
              <th scope="col" className="py-1.5 pr-4 text-right font-medium">TTFT p50</th>
              <th scope="col" className="py-1.5 text-right font-medium">Error rate</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {row.recent_runs.map((r) => (
              <tr key={r.run_id} className="border-b border-line last:border-0">
                <td className="py-1.5 pr-4">
                  <button type="button" onClick={() => openRun(r.run_id)} className="text-accent hover:underline">
                    {r.run_id}
                  </button>
                  {r.run_id === row.run_id && <span className="ml-2 font-sans text-xs text-muted">shown</span>}
                </td>
                <td className="py-1.5 pr-4 font-sans text-ink-2">{formatDateTime(r.ended_at)}</td>
                <td className="py-1.5 pr-4 text-right text-ink">{formatInt(r.e2e_p95_ms)}</td>
                <td className="py-1.5 pr-4 text-right text-ink">{formatInt(r.ttft_p50_ms)}</td>
                <td className="py-1.5 text-right text-ink">{formatPercent(r.error_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
