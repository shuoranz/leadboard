import { describe, expect, it } from 'vitest'
import { model } from '../../test/fixtures'
import { OVERALL, blendedPrice, costFor, displayName, modelKey, passesFinetune, reasoningShare, scoreFor } from './model'

describe('scoreFor / costFor', () => {
  const m = model({
    id: 'm',
    overall: 70,
    categories: { math: 80, overall: 1 },
    cost: { per_success: { overall: 0.5, categories: { math: 0.25, overall: 9 } } },
  })

  it('reads overall and categories from separate fields', () => {
    expect(scoreFor(m, OVERALL)).toBe(70)
    expect(scoreFor(m, 'math')).toBe(80)
    expect(costFor(m, OVERALL)).toBe(0.5)
    expect(costFor(m, 'math')).toBe(0.25)
  })

  it('a category literally named "overall" does not shadow the real overall', () => {
    expect(scoreFor(m, 'overall')).toBe(1)
    expect(costFor(m, 'overall')).toBe(9)
    expect(costFor(m, OVERALL)).toBe(0.5)
  })

  it('treats missing and non-positive costs as unknown (log scale)', () => {
    expect(costFor(model({ id: 'x' }), OVERALL)).toBeUndefined()
    expect(costFor(model({ id: 'x', cost: { per_success: { overall: 0, categories: {} } } }), OVERALL)).toBeUndefined()
  })
})

describe('passesFinetune', () => {
  it('hides finetunes unless included', () => {
    const ft = model({ id: 'f', finetune: true })
    expect(passesFinetune(ft, false)).toBe(false)
    expect(passesFinetune(ft, true)).toBe(true)
    expect(passesFinetune(model({ id: 'b' }), false)).toBe(true)
  })
})

describe('provider and cost helpers', () => {
  it('shares a model key across providers and names the provider', () => {
    const m = model({ id: 'nimbus@swift', model_id: 'nimbus', name: 'Nimbus 4', provider: 'Swiftserve' })
    expect(modelKey(m)).toBe('nimbus')
    expect(modelKey(model({ id: 'solo' }))).toBe('solo')
    expect(displayName(m)).toBe('Nimbus 4 · Swiftserve')
    expect(displayName(model({ id: 'x', name: 'X' }))).toBe('X')
  })

  it('blends input and output prices 3:1', () => {
    const m = model({ id: 'p', cost: { per_success: { categories: {} }, input_per_million: 1, output_per_million: 5 } })
    expect(blendedPrice(m)).toBe(2)
    expect(blendedPrice(model({ id: 'q' }))).toBeUndefined()
  })

  it('reports reasoning tokens as a share of billed output', () => {
    const m = model({ id: 'r', cost: { per_success: { categories: {} }, avg_output_tokens: 2000, avg_reasoning_tokens: 900 } })
    expect(reasoningShare(m)).toBe(0.45)
    expect(reasoningShare(model({ id: 's' }))).toBeUndefined()
  })
})
