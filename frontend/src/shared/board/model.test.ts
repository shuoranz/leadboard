import { describe, expect, it } from 'vitest'
import { row } from '../../test/fixtures'
import { blendedPrice, costPer1k, displayName, modelKey } from './model'

describe('row helpers', () => {
  it('shares a model key across providers and names the provider', () => {
    const r = row({ id: 'stratus--aurora-4', model_id: 'aurora-4', name: 'Aurora 4', provider: 'Stratus Cloud' })
    expect(modelKey(r)).toBe('aurora-4')
    expect(displayName(r)).toBe('Aurora 4 · Stratus Cloud')
    expect(displayName(row({ id: 'auto', routing: 'auto', name: 'Auto routing', provider: 'Random per request' }))).toBe('Auto routing')
  })

  it('treats missing and non-positive costs as unknown (log scale)', () => {
    expect(costPer1k(row({ id: 'a', cost: { per_1k_requests: 2.5 } }))).toBe(2.5)
    expect(costPer1k(row({ id: 'b', cost: { per_1k_requests: 0 } }))).toBeUndefined()
    expect(costPer1k(row({ id: 'c' }))).toBeUndefined()
  })

  it('blends input and output prices 3:1', () => {
    expect(blendedPrice(row({ id: 'p', cost: { input_per_million: 1, output_per_million: 5 } }))).toBe(2)
    expect(blendedPrice(row({ id: 'q' }))).toBeUndefined()
  })
})
