import { beforeEach, describe, expect, it } from 'vitest'
import { parseSearch, searchHref, updateSearch } from './searchParams'

describe('parseSearch', () => {
  it('parses every key', () => {
    expect(parseSearch('?service=s&tab=runs&run=r1&new=1&profile=smoke&sort=perf%3Ae2e_p95%3Aasc&compare=x,y&lat=ttft_p50')).toEqual({
      service: 's',
      tab: 'runs',
      run: 'r1',
      new: '1',
      profile: 'smoke',
      sort: 'perf:e2e_p95:asc',
      compare: ['x', 'y'],
      lat: 'ttft_p50',
    })
  })

  it('drops malformed values instead of failing', () => {
    expect(parseSearch('?sort=nonsense&tab=bogus&new=yes&lat=fast&profile=&compare=')).toEqual({
      service: undefined,
      tab: undefined,
      run: undefined,
      new: undefined,
      profile: undefined,
      sort: undefined,
      compare: [],
      lat: undefined,
    })
  })
})

describe('updateSearch', () => {
  beforeEach(() => window.history.replaceState(null, '', '/?service=s&tab=runs&profile=smoke'))

  it('patches, serializes arrays and removes cleared keys', () => {
    updateSearch({ compare: ['x', 'y'], profile: null })
    expect(window.location.search).toBe('?service=s&tab=runs&compare=x%2Cy')
  })

  it('reset keeps only the patch and push adds a history entry', () => {
    const before = window.history.length
    updateSearch({ service: 'b' }, { push: true, reset: true })
    expect(window.location.search).toBe('?service=b')
    expect(window.history.length).toBe(before + 1)
  })

  it('pushing the current URL again adds no history entry', () => {
    const before = window.history.length
    updateSearch({ tab: 'runs' }, { push: true })
    expect(window.history.length).toBe(before)
  })
})

describe('searchHref', () => {
  beforeEach(() => window.history.replaceState(null, '', '/app/?service=s&tab=runs&run=r1'))

  it('is the URL updateSearch would navigate to, without navigating', () => {
    expect(searchHref({ tab: 'catalog', run: null })).toBe('/app/?service=s&tab=catalog')
    expect(searchHref({ service: 'b' }, { reset: true })).toBe('/app/?service=b')
    expect(window.location.search).toBe('?service=s&tab=runs&run=r1')
  })
})
