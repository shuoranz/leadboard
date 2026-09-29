import { Tooltip } from 'radix-ui'
import type { ReactElement, ReactNode } from 'react'

/** Wrap the app once. Charts want tooltips immediately, so no open delay. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={0} skipDelayDuration={0}>
      {children}
    </Tooltip.Provider>
  )
}

/**
 * Hover/focus tooltip on `children` (which must be focusable to reach keyboard
 * users). Positioned by Radix/Floating UI, so it flips and shifts at edges.
 */
export function Tip({ content, children, side = 'top' }: { content: ReactNode; children: ReactElement; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={10}
          collisionPadding={12}
          className="z-50 max-w-72 rounded-lg border border-line bg-surface px-3 py-2.5 text-meta text-ink shadow-lg shadow-black/10"
        >
          {content}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

/** Label/value rows inside a tooltip. */
export function TooltipRows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 font-mono text-xs tabular-nums">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-2">{k}</dt>
          <dd className="text-right text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
