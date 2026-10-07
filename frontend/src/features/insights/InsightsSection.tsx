import { useBoard } from '../../shared/board/BoardContext'
import { LATENCY_METRICS, updateSearch, useSearch, type LatencyMetric } from '../../shared/state/searchParams'
import { Card, SectionHeader } from '../../shared/ui/Card'
import { ChipRadioGroup } from '../../shared/ui/ChipRadioGroup'
import { CostRanked } from './CostRanked'
import { LATENCY, LatencyCostScatter } from './LatencyCostScatter'
import { PerfRadar } from './PerfRadar'

/** Default export so the app can lazy-load this below-the-fold section. */
export default function InsightsSection() {
  const board = useBoard()
  const search = useSearch()
  // Shareable: the latency metric lives in the URL.
  const metric: LatencyMetric = search.lat ?? 'e2e_p95'
  const setMetric = (m: LatencyMetric) => updateSearch({ lat: m === 'e2e_p95' ? null : m })

  if (board.rows.length === 0) return null
  return (
    <section aria-labelledby="insights-title">
      <SectionHeader id="insights-title" index="02" title="Insights">
        A few analytical views — the headline is latency vs. cost, because the fastest deployment isn't always worth what it costs.
      </SectionHeader>

      <ChipRadioGroup<LatencyMetric>
        label="Latency"
        value={metric}
        onChange={setMetric}
        options={LATENCY_METRICS.map((m) => ({ value: m, label: LATENCY[m].short, title: LATENCY[m].label }))}
      />

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card
          title="Latency vs. cost"
          subtitle={
            <>
              {LATENCY[metric].label} vs. cost per 1K requests (log). The <strong className="font-semibold text-accent">value frontier</strong> is the
              lowest latency at each cost. Click a point to grey out its <strong className="font-semibold text-ink">kill zone</strong> — everything
              slower and more expensive; click it again to clear.
            </>
          }
        >
          <LatencyCostScatter rows={board.rows} metric={metric} />
        </Card>
        <Card title="Cost, ranked" subtitle="List-price cost per 1K requests at this service's real token counts, cheapest first. Hover or focus a row for details.">
          <CostRanked rows={board.rows} />
        </Card>
      </div>

      <Card className="mt-6" title="Performance profile" subtitle="Add any 2–3 rows to compare TTFT, latency, decode speed, reliability and cost at a glance.">
        <PerfRadar rows={board.rows} />
      </Card>
    </section>
  )
}
