import type { Leaderboard, ModelEntry } from '../api/types'

export function model(partial: Partial<ModelEntry> & { id: string }): ModelEntry {
  return {
    name: partial.id,
    organization: 'Org',
    open_weights: false,
    finetune: false,
    overall: 50,
    categories: {},
    subtasks: {},
    ...partial,
  }
}

export function board(models: ModelEntry[]): Leaderboard {
  return {
    app: { id: 'app', name: 'App' },
    categories: [
      { id: 'math', name: 'Mathematics', subtasks: [{ id: 'math.olympiad', name: 'olympiad' }] },
      { id: 'code', name: 'Coding', subtasks: [] },
    ],
    models,
  }
}
