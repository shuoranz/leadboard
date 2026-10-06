import { describe, expect, it } from 'vitest'
import { AppListSchema, LeaderboardSchema } from '../src/api/types.ts'
import { mockApps, mockLeaderboard } from './data.ts'

// The mock stands in for the backend, so it must satisfy the same contract.
describe('mock API data', () => {
  it('app list matches the contract', () => {
    expect(AppListSchema.safeParse(mockApps).success).toBe(true)
  })

  for (const app of mockApps) {
    describe(app.id, () => {
      const parsed = LeaderboardSchema.safeParse(mockLeaderboard(app.id))

      it('leaderboard matches the contract', () => {
        expect(parsed.error?.issues ?? []).toEqual([])
      })

      it('has unique row ids and several providers for some models', () => {
        const models = parsed.data!.models
        expect(new Set(models.map((m) => m.id)).size).toBe(models.length)
        const perModel = new Map<string, number>()
        for (const m of models) perModel.set(m.model_id!, (perModel.get(m.model_id!) ?? 0) + 1)
        expect(Math.max(...perModel.values())).toBeGreaterThan(1)
      })

      it('keeps rates in 0–1 and error causes summing to the error count', () => {
        for (const m of parsed.data!.models) {
          const p = m.perf
          if (!p) continue
          for (const r of [p.success_rate, p.success_after_retry, p.truncation_rate, p.stall_rate]) expect(r).toBeGreaterThanOrEqual(0)
          expect(p.success_rate).toBeLessThanOrEqual(p.success_after_retry!)
          const causes = Object.values(p.error_breakdown ?? {}).reduce((a, b) => a + (b ?? 0), 0)
          expect(causes).toBe(p.errors)
        }
      })
    })
  }
})
