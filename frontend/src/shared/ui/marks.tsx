import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

/** Small uppercase mono label that introduces a control row. */
export function Eyebrow({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <span id={id} className="mr-1 font-mono text-xs tracking-widest text-muted uppercase">
      {children}
    </span>
  )
}

export function OrgDot({ color, size = 10 }: { color: string; size?: number }) {
  return <span aria-hidden className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: color }} />
}

/** Short line swatch: color plus dash pattern, for series told apart by both. */
export function LineKey({ color, dash, width = 18 }: { color: string; dash?: string; width?: number }) {
  return (
    <svg aria-hidden width={width} height={8} className="shrink-0">
      <line x1={1} x2={width - 1} y1={4} y2={4} stroke={color} strokeWidth={2.5} strokeDasharray={dash} strokeLinecap="round" />
    </svg>
  )
}

export function Badge({ children, tone = 'good' }: { children: ReactNode; tone?: 'good' | 'muted' }) {
  return (
    <span
      className={cn(
        'rounded-md border px-1.5 py-px font-mono text-micro leading-4',
        tone === 'good' ? 'border-good/60 text-good' : 'border-line-strong text-muted',
      )}
    >
      {children}
    </span>
  )
}
