import { describe, expect, it } from 'vitest'
import { catalog } from '../../test/fixtures'
import { buildCatalogIndex, groupOfferings, isUsable, offeringLabel, serviceOfferings } from './catalogIndex'

const cat = buildCatalogIndex(catalog)

describe('catalog index', () => {
  it('groups provider → LLM and LLM → provider', () => {
    expect(groupOfferings(cat, cat.offerings, 'provider').map((g) => [g.label, g.items.map((i) => i.label)])).toEqual([
      ['Aurora Labs API', ['Aurora 4']],
      ['Stratus Cloud', ['Aurora 4', 'Forge 70B']],
    ])
    const byLlm = groupOfferings(cat, cat.offerings, 'llm')
    expect(byLlm[0]).toMatchObject({ label: 'Aurora 4', detail: 'Aurora Labs' })
    expect(byLlm[0].items.map((i) => i.label)).toEqual(['Aurora Labs API', 'Stratus Cloud'])
  })

  it('labels offerings and falls back to the id', () => {
    expect(offeringLabel(cat, 'stratus--aurora-4')).toBe('Aurora 4 · Stratus Cloud')
    expect(offeringLabel(cat, 'gone')).toBe('gone')
  })

  it("limits to a service's allow-list; degraded is usable, unavailable is not", () => {
    expect(serviceOfferings(cat, { allowed_offering_ids: ['stratus--aurora-4'] }).map((o) => o.id)).toEqual(['stratus--aurora-4'])
    expect(serviceOfferings(cat, {})).toHaveLength(3)
    expect(cat.offerings.filter(isUsable).map((o) => o.id)).toEqual(['stratus--aurora-4', 'aurora-api--aurora-4'])
  })
})
