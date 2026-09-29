import { beforeEach, describe, expect, it } from 'vitest'
import { parseSearch, updateSearch } from './searchParams'

describe('parseSearch', () => {
  it('parses every key', () => {
    expect(parseSearch('?app=a&cat=math&sort=cat%3Amath%3Aasc&compare=x,y&cost=code')).toEqual({
      app: 'a',
      cat: 'math',
      sort: 'cat:math:asc',
      compare: ['x', 'y'],
      cost: 'code',
    })
  })

  it('drops malformed values instead of failing', () => {
    expect(parseSearch('?sort=nonsense&cat=&compare=')).toEqual({
      app: undefined,
      cat: undefined,
      sort: undefined,
      compare: [],
      cost: undefined,
    })
  })
})

describe('updateSearch', () => {
  beforeEach(() => window.history.replaceState(null, '', '/?app=a&cat=math'))

  it('patches, serializes arrays and removes cleared keys', () => {
    updateSearch({ compare: ['x', 'y'], cat: null })
    expect(window.location.search).toBe('?app=a&compare=x%2Cy')
  })

  it('reset keeps only the patch and push adds a history entry', () => {
    const before = window.history.length
    updateSearch({ app: 'b' }, { push: true, reset: true })
    expect(window.location.search).toBe('?app=b')
    expect(window.history.length).toBe(before + 1)
  })
})
