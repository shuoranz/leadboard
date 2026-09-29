import { describe, expect, it } from 'vitest'
import { LeaderboardSchema } from './types'

const payload = {
  app: { id: 'chat', name: 'Chat', description: null },
  categories: [{ id: 'math', name: 'Mathematics', short_name: null, subtasks: [{ id: 'math.a', name: 'a' }] }],
  models: [
    {
      id: 'm1',
      name: 'Model 1',
      short_name: null,
      organization: 'Org',
      open_weights: false,
      finetune: false,
      overall: 71.2,
      categories: { math: 80 },
      subtasks: { 'math.a': 80, 'math.b': null },
      cost: { per_success: { overall: 0.4, categories: { math: 0.2 } }, output_per_million: null },
    },
  ],
}

describe('LeaderboardSchema', () => {
  it('normalizes nulls from the backend to undefined and drops null scores', () => {
    const board = LeaderboardSchema.parse(payload)
    const m = board.models[0]
    expect(board.app.description).toBeUndefined()
    expect(m.short_name).toBeUndefined()
    expect(m.cost?.output_per_million).toBeUndefined()
    expect(m.subtasks).toEqual({ 'math.a': 80 })
  })

  it('defaults missing per-category costs and allows no cost at all', () => {
    const noCats = structuredClone(payload)
    noCats.models[0].cost = { per_success: { overall: 0.4 } } as never
    expect(LeaderboardSchema.parse(noCats).models[0].cost?.per_success.categories).toEqual({})

    const noCost = structuredClone(payload) as { models: Record<string, unknown>[] }
    delete noCost.models[0].cost
    expect(LeaderboardSchema.parse(noCost).models[0].cost).toBeUndefined()
  })

  it('rejects contract violations with a path', () => {
    const bad = structuredClone(payload) as { models: Record<string, unknown>[] }
    bad.models[0].overall = 'high'
    const res = LeaderboardSchema.safeParse(bad)
    expect(res.success).toBe(false)
    expect(res.error?.issues[0].path).toEqual(['models', 0, 'overall'])
  })

  it('rejects empty ids', () => {
    const bad = structuredClone(payload)
    bad.categories[0].id = ''
    expect(LeaderboardSchema.safeParse(bad).success).toBe(false)
  })
})
