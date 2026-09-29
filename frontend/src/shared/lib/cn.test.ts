import { describe, expect, it } from 'vitest'
import { cn } from './cn'

describe('cn', () => {
  it('keeps a custom size and a custom color together', () => {
    expect(cn('text-body text-ink')).toBe('text-body text-ink')
  })

  it('lets later classes override conflicting earlier ones', () => {
    expect(cn('h-11 px-4 text-body', 'h-9 text-sm')).toBe('px-4 h-9 text-sm')
    const disabled = false as boolean
    expect(cn('text-ink', disabled && 'x', 'text-muted')).toBe('text-muted')
  })
})
