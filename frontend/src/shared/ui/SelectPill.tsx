import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { pill } from './pill'

const Chevron = () => (
  <svg aria-hidden viewBox="0 0 12 12" className="pointer-events-none size-3 shrink-0">
    <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

/** Native select styled as a pill (native keeps mobile pickers and full keyboard support). */
export function SelectPill({
  value,
  onChange,
  children,
  label,
  className,
  mono = true,
}: {
  value: string
  onChange: (v: string) => void
  children: ReactNode
  label: string
  className?: string
  mono?: boolean
}) {
  return (
    <label className={cn('relative inline-flex items-center', className)}>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(pill(), 'w-full appearance-none pr-9', !mono && 'font-sans text-sm', value && 'text-ink')}
      >
        {children}
      </select>
      <span className="absolute right-3.5 text-muted">
        <Chevron />
      </span>
    </label>
  )
}
