import { describe, expect, it } from 'vitest'
import {
  formatCompact,
  formatCost,
  formatCost1k,
  formatCostTick,
  formatDate,
  formatDateTime,
  formatDecimal,
  formatDuration,
  formatInt,
  formatMs,
  formatPair,
  formatPercent,
  formatPrice,
  formatScore,
  formatSignedPercent,
  formatTokens,
} from './format'

describe('format', () => {
  it('formats costs by magnitude', () => {
    expect(formatCost(0.0291)).toBe('$0.029')
    expect(formatCost(12.345)).toBe('$12.35')
    expect(formatCost(1500)).toBe('$1,500')
    expect(formatCost(undefined)).toBe('—')
  })

  it('formats log ticks without float noise', () => {
    expect([0.005, 0.02, 0.1, 1, 20].map(formatCostTick)).toEqual(['$0.005', '$0.02', '$0.1', '$1', '$20'])
  })

  it('formats scores, prices, integers and dates', () => {
    expect(formatScore(83.44)).toBe('83.4')
    expect(formatPrice(51.3)).toBe('$51.30')
    expect(formatInt(12345.6)).toBe('12,346')
    expect(formatDate('2026-09-24T12:00:00Z')).toBe('Sep 24, 2026')
    expect(formatDate('not a date')).toBeUndefined()
  })

  it('formats performance values', () => {
    expect(formatPercent(0.99214)).toBe('99.2%')
    expect(formatDecimal(12.44)).toBe('12.4')
    expect(formatCompact(48213)).toBe('48.2K')
    expect(formatCompact(1_250_000)).toBe('1.25M')
    expect(formatCompact(3_000_000)).toBe('3.0M')
    expect(formatCompact(480_123)).toBe('480K')
    expect(formatPair(412, 980.4, formatInt)).toBe('412 / 980')
    expect(formatPair(412, undefined, formatInt)).toBe('412 / —')
    expect(formatPair(undefined, undefined, formatInt)).toBe('—')
  })

  it('formats signed percents and token counts', () => {
    expect(formatSignedPercent(0.012)).toBe('+1.2%')
    expect(formatSignedPercent(-0.004)).toBe('-0.4%')
    expect(formatSignedPercent(0)).toBe('0.0%')
    expect(formatTokens(128_000)).toBe('128K')
    expect(formatTokens(1_000_000)).toBe('1M')
  })

  it('formats durations, times and per-1K costs', () => {
    expect([45, 90, 600, 3720, 7200].map(formatDuration)).toEqual(['45s', '1m 30s', '10m', '1h 2m', '2h'])
    expect(formatDuration(undefined)).toBe('—')
    expect(formatMs(1234.4)).toBe('1,234 ms')
    expect(formatCost1k(0.2152)).toBe('$0.215')
    expect(formatCost1k(9.0877)).toBe('$9.09')
    expect(formatDateTime('nope')).toBe('—')
    expect(formatDateTime('2026-10-05T18:04:00Z')).toMatch(/^Oct \d+, \d+:04/)
  })
})
