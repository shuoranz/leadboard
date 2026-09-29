import { cva, type VariantProps } from 'class-variance-authority'

/** The rounded mono pill shared by chips, selects and menu triggers. */
export const pill = cva(
  'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 font-mono text-meta transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
  {
    variants: {
      tone: {
        idle: 'border-line-strong bg-surface text-ink-2 hover:border-muted hover:text-ink',
        on: 'border-accent bg-accent font-semibold text-accent-ink',
        /** Idle, but something inside it is active (e.g. a menu with selections). */
        engaged: 'border-accent bg-surface text-accent',
      },
    },
    defaultVariants: { tone: 'idle' },
  },
)

export type PillProps = VariantProps<typeof pill>
