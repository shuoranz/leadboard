import { describe, expect, it } from 'vitest'
import { board, row } from '../../test/fixtures'
import { buildBoardIndex } from './boardIndex'

const p95 = (v: number) => ({ ttft_by_input: [], e2e_ms: { p95: v } })

describe('buildBoardIndex', () => {
  const index = buildBoardIndex(
    board([
      row({ id: 'slow', organization: 'Zeta', provider: 'P2', perf: p95(4000) }),
      row({ id: 'fast', organization: 'Acme', provider: 'P1', perf: p95(900) }),
      row({ id: 'none', organization: 'Acme', provider: 'P1' }),
      row({ id: 'auto', routing: 'auto', organization: 'Auto routing', provider: 'Random per request', perf: p95(2000) }),
    ]),
  )

  it('orders rows fastest first, with unmeasured rows last, and indexes them', () => {
    expect(index.rows.map((r) => r.id)).toEqual(['fast', 'auto', 'slow', 'none'])
    expect(index.rowsById.get('slow')?.organization).toBe('Zeta')
    expect(index.profile?.name).toBe('Baseline')
  })

  it('lists makers and real providers (not the router) alphabetically', () => {
    expect(index.organizations).toEqual(['Acme', 'Auto routing', 'Zeta'])
    expect(index.providers).toEqual(['P1', 'P2'])
  })

  it('colors organizations by their fastest row', () => {
    expect(index.palette.color('Acme')).toBe('var(--series-1)')
    expect(index.palette.color('Auto routing')).toBe('var(--series-2)')
    expect(index.palette.color('Zeta')).toBe('var(--series-3)')
    expect(index.palette.color('Unknown')).toBe('var(--series-other)')
  })

  it('folds organizations past eight slots into Other', () => {
    const many = buildBoardIndex(board(Array.from({ length: 10 }, (_, i) => row({ id: `m${i}`, organization: `Org${i}`, perf: p95(100 + i) }))))
    expect(many.palette.legend.at(-1)).toEqual({ org: 'Other', color: 'var(--series-other)' })
    expect(many.palette.color('Org9')).toBe('var(--series-other)')
  })
})
