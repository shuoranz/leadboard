import { cva } from 'class-variance-authority'
import type { InputHTMLAttributes } from 'react'
import { cn } from '../lib/cn'

const input = cva('w-full border text-ink placeholder:text-muted focus:border-accent focus:outline-none', {
  variants: {
    size: {
      md: 'h-11 rounded-lg border-line-strong bg-surface px-4 text-body',
      /** Compact, for use inside menus. */
      sm: 'h-9 rounded-md border-line bg-surface-2 px-3 text-sm',
    },
  },
  defaultVariants: { size: 'md' },
})

export function TextInput({
  label,
  size,
  className,
  ...props
}: { label: string; size?: 'sm' | 'md' } & Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>) {
  return (
    <label className={cn('block', className)}>
      <span className="sr-only">{label}</span>
      <input {...props} className={input({ size })} />
    </label>
  )
}
