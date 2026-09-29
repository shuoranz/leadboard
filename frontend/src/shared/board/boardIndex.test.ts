import { describe, expect, it } from 'vitest'
import { board, model } from '../../test/fixtures'
import { buildBoardIndex, viewLabel } from './boardIndex'

describe('buildBoardIndex', () => {
  const index = buildBoardIndex(
    board([
      model({ id: 'low', overall: 40, organization: 'Zeta' }),
      model({ id: 'high', overall: 90, organization: 'Acme' }),
      model({ id: 'mid', overall: 60, organization: 'Acme' }),
    ]),
  )

  it('orders models best-first and indexes them', () => {
    expect(index.models.map((m) => m.id)).toEqual(['high', 'mid', 'low'])
    expect(index.modelsById.get('mid')?.overall).toBe(60)
    expect(index.categoriesById.get('math')?.name).toBe('Mathematics')
  })

  it('lists organizations alphabetically and colors them by strength', () => {
    expect(index.organizations).toEqual(['Acme', 'Zeta'])
    expect(index.palette.color('Acme')).toBe('var(--series-1)')
    expect(index.palette.color('Zeta')).toBe('var(--series-2)')
    expect(index.palette.color('Unknown')).toBe('var(--series-other)')
  })

  it('labels views', () => {
    expect(viewLabel(index, null)).toBe('Overall')
    expect(viewLabel(index, 'math')).toBe('Mathematics')
  })

  it('folds organizations past eight slots into Other', () => {
    const many = buildBoardIndex(board(Array.from({ length: 10 }, (_, i) => model({ id: `m${i}`, overall: 90 - i, organization: `Org${i}` }))))
    expect(many.palette.legend.at(-1)).toEqual({ org: 'Other', color: 'var(--series-other)' })
    expect(many.palette.color('Org9')).toBe('var(--series-other)')
  })
})
