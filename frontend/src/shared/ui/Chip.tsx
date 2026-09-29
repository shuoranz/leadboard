import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { pill } from './pill'

/** An on/off toggle (a filter). For one-of-many choices use ChipRadioGroup. */
export function Chip({ active, onClick, children, className }: { active: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={cn(pill({ tone: active ? 'on' : 'idle' }), className)}>
      {children}
    </button>
  )
}
