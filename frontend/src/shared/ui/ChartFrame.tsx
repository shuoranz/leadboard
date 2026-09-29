import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { useElementWidth } from '../lib/hooks'

/** Chart type sizes in px. Charts draw at real pixel size, so text never scales. */
export const CHART_TEXT = { tick: 12, label: 12.5, small: 11 } as const

/**
 * The one sizing strategy for charts: measure the container and hand the chart
 * its real pixel width, so it lays out (and places labels) at the size it renders.
 * `height` may depend on width, e.g. for a square-ish radar.
 */
export function ChartFrame({
  height,
  className,
  children,
}: {
  height: number | ((width: number) => number)
  className?: string
  children: (width: number, height: number) => ReactNode
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const h = typeof height === 'function' ? height(width) : height
  return (
    <div ref={ref} className={cn('relative w-full', className)} style={{ height: h }}>
      {width > 0 && children(width, h)}
    </div>
  )
}
