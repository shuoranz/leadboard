import { Fragment, useState } from 'react'
import { useCatalog } from '../../api/client'
import type { Offering, Service } from '../../api/types'
import { KIND_LABEL, groupOfferings, serviceOfferings } from '../../shared/catalog/catalogIndex'
import { cn } from '../../shared/lib/cn'
import { formatPrice, formatTokens } from '../../shared/lib/format'
import { CapabilityBadges } from '../../shared/perf/PerfPanels'
import { SectionHeader } from '../../shared/ui/Card'
import { Chip } from '../../shared/ui/Chip'
import { ChipRadioGroup } from '../../shared/ui/ChipRadioGroup'
import { Badge } from '../../shared/ui/marks'

const STATUS_TONE: Record<Offering['status'], string> = {
  available: 'text-good',
  degraded: 'text-warn',
  unavailable: 'text-bad',
}

/**
 * The two-layer model catalog: providers and the LLMs they serve. One LLM is
 * often served by several providers at different prices and speeds, so the
 * table flips between provider → LLM and LLM → provider.
 */
export function CatalogSection({ service }: { service: Service }) {
  const catalog = useCatalog()
  const [by, setBy] = useState<'provider' | 'llm'>('provider')
  const [onlyService, setOnlyService] = useState(true)

  if (catalog.isPending) return <div aria-busy="true" aria-label="Loading catalog" className="h-96 animate-pulse rounded-2xl bg-line/70" />
  if (catalog.isError)
    return (
      <p role="alert" className="text-bad">
        Couldn't load the catalog: {catalog.error.message}
      </p>
    )
  const cat = catalog.data
  const offerings = onlyService ? serviceOfferings(cat, service) : cat.offerings
  const groups = groupOfferings(cat, offerings, by)
  const th = 'bg-surface px-4 py-3 font-mono text-xs font-semibold tracking-wider text-ink-2 uppercase shadow-[inset_0_-1px_0_var(--line)]'

  return (
    <section aria-labelledby="catalog-title">
      <SectionHeader id="catalog-title" index="01" title="Catalog">
        {cat.providers.length} providers serve {cat.llms.length} LLMs as {cat.offerings.length} offerings. An offering — one LLM at one provider — is
        what a run targets and what a leaderboard row ranks.
      </SectionHeader>

      <div className="flex flex-wrap items-center gap-3">
        <ChipRadioGroup<'provider' | 'llm'>
          label="Group by"
          value={by}
          onChange={setBy}
          options={[
            { value: 'provider', label: 'Provider → LLM' },
            { value: 'llm', label: 'LLM → provider' },
          ]}
        />
        <Chip active={onlyService} onClick={() => setOnlyService((v) => !v)}>
          Only {service.name}'s models
        </Chip>
      </div>

      {/* As tall as its rows; scrolls only sideways. */}
      <div className="mt-5 overflow-x-auto rounded-2xl border border-line bg-surface">
        <table aria-label="Catalog" className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th scope="col" className={cn(th, 'pl-6 text-left')}>{by === 'provider' ? 'LLM' : 'Provider'}</th>
              <th scope="col" className={cn(th, 'text-left')}>Deployment</th>
              <th scope="col" className={cn(th, 'text-left')}>Status</th>
              <th scope="col" className={cn(th, 'text-right')}>$/1M in / cached / out</th>
              <th scope="col" className={cn(th, 'text-right')}>Context</th>
              <th scope="col" className={cn(th, 'text-left')}>Regions</th>
              <th scope="col" className={cn(th, 'pr-6 text-left')}>Capabilities</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.id}>
                <tr>
                  <th scope="rowgroup" colSpan={7} className="border-b border-line bg-surface-2 px-6 pt-4 pb-2 text-left">
                    <span className="text-base font-semibold text-ink">{g.label}</span>
                    {g.detail && <span className="ml-2 font-mono text-xs text-muted">{g.detail}</span>}
                    <span className="ml-2 font-mono text-xs text-muted">· {g.items.length}</span>
                  </th>
                </tr>
                {g.items.map(({ offering: o, label }) => {
                  const llm = cat.llmsById.get(o.llm_id)
                  const p = o.prices
                  return (
                    <tr key={o.id} className="[&>*]:border-b [&>*]:border-line">
                      <th scope="row" className="py-3 pr-4 pl-6 text-left font-medium text-ink">
                        <span className="flex items-center gap-2">
                          {label}
                          {by === 'provider' && llm?.open_weights && <Badge>open</Badge>}
                        </span>
                        <span className="text-xs font-normal text-muted">
                          {by === 'provider' ? llm?.organization : KIND_LABEL[cat.providersById.get(o.provider_id)?.kind ?? 'cloud']}
                        </span>
                      </th>
                      <td className="px-4 py-3 font-mono text-xs text-ink-2">{o.deployment}</td>
                      <td className={cn('px-4 py-3 font-mono text-xs', STATUS_TONE[o.status])}>{o.status}</td>
                      <td className="px-4 py-3 text-right font-mono whitespace-nowrap text-ink tabular-nums">
                        {[p.input_per_million, p.cached_input_per_million, p.output_per_million].map(formatPrice).join(' / ')}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-ink-2 tabular-nums">{formatTokens(llm?.context_window)}</td>
                      <td className="px-4 py-3 text-xs text-ink-2">{o.regions.join(', ')}</td>
                      <td className="py-3 pr-6 pl-4">
                        <CapabilityBadges caps={o.capabilities} title={false} />
                      </td>
                    </tr>
                  )
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
