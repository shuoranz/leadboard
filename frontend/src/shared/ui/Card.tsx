import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export function Card({ title, subtitle, children, className }: { title: string; subtitle?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-sm shadow-black/[0.02] sm:p-7', className)}>
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      {subtitle && <p className="mt-1.5 text-body leading-relaxed text-ink-2">{subtitle}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

export function SectionHeader({ id, index, title, children }: { id: string; index: string; title: string; children?: ReactNode }) {
  return (
    <header className="mb-6">
      <h2 id={id} className="flex items-baseline gap-3">
        <span className="font-mono text-base text-muted">{index}</span>
        <span className="text-3xl font-bold tracking-tight text-ink">{title}</span>
      </h2>
      {children && <p className="mt-3 max-w-3xl text-lg leading-relaxed text-ink-2">{children}</p>}
    </header>
  )
}
