import { describe, expect, it } from 'vitest'
import { model } from '../../test/fixtures'
import { OVERALL, costFor, passesFinetune, scoreFor } from './model'

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
