// The provider → LLM catalog with its lookups, built once per fetch. Used by the
// run form's model picker, the catalog tab, and anywhere an offering id needs a name.
import type { Catalog, Llm, Offering, Provider, Service } from '../../api/types'

export interface CatalogIndex {
  providers: Provider[]
  llms: Llm[]
  offerings: Offering[]
  providersById: ReadonlyMap<string, Provider>
  llmsById: ReadonlyMap<string, Llm>
  offeringsById: ReadonlyMap<string, Offering>
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name)

export function buildCatalogIndex(c: Catalog): CatalogIndex {
  return {
    providers: [...c.providers].sort(byName),
    llms: [...c.llms].sort(byName),
    offerings: c.offerings,
    providersById: new Map(c.providers.map((p) => [p.id, p])),
    llmsById: new Map(c.llms.map((l) => [l.id, l])),
    offeringsById: new Map(c.offerings.map((o) => [o.id, o])),
  }
}

/** "Aurora 4 · Stratus Cloud", falling back to the raw id for an offering the catalog no longer has. */
export function offeringLabel(cat: CatalogIndex | undefined, offeringId: string): string {
  const o = cat?.offeringsById.get(offeringId)
  if (!o) return offeringId
  return `${cat!.llmsById.get(o.llm_id)?.name ?? o.llm_id} · ${cat!.providersById.get(o.provider_id)?.name ?? o.provider_id}`
}

/** Offerings this service may call (its allow-list, or the whole catalog). */
export function serviceOfferings(cat: CatalogIndex, service: Pick<Service, 'allowed_offering_ids'>): Offering[] {
  const allowed = service.allowed_offering_ids ? new Set(service.allowed_offering_ids) : undefined
  return cat.offerings.filter((o) => !allowed || allowed.has(o.id))
}

/** Can a run target it? Degraded offerings still can; unavailable ones can't. */
export const isUsable = (o: Offering) => o.status !== 'unavailable'

export interface OfferingGroup {
  id: string
  label: string
  /** Secondary line, e.g. the maker for an LLM or the kind of provider. */
  detail?: string
  items: { offering: Offering; label: string }[]
}

/**
 * The two-layer view of a set of offerings: provider → its LLMs, or LLM → the
 * providers that serve it. Groups and items are alphabetical.
 */
export function groupOfferings(cat: CatalogIndex, offerings: Offering[], by: 'provider' | 'llm'): OfferingGroup[] {
  const groups = new Map<string, OfferingGroup>()
  for (const o of offerings) {
    const provider = cat.providersById.get(o.provider_id)
    const llm = cat.llmsById.get(o.llm_id)
    const key = by === 'provider' ? o.provider_id : o.llm_id
    let g = groups.get(key)
    if (!g) {
      g =
        by === 'provider'
          ? { id: key, label: provider?.name ?? key, detail: provider ? KIND_LABEL[provider.kind] : undefined, items: [] }
          : { id: key, label: llm?.name ?? key, detail: llm?.organization, items: [] }
      groups.set(key, g)
    }
    g.items.push({ offering: o, label: by === 'provider' ? (llm?.name ?? o.llm_id) : (provider?.name ?? o.provider_id) })
  }
  return [...groups.values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((g) => ({ ...g, items: g.items.sort((a, b) => a.label.localeCompare(b.label)) }))
}

export const KIND_LABEL: Record<Provider['kind'], string> = {
  first_party: 'First-party API',
  cloud: 'Cloud platform',
  inference_host: 'Inference host',
}
