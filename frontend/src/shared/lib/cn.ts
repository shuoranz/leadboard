import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// tailwind-merge must know the custom theme tokens, otherwise `text-body` (a size)
// and `text-ink` (a color) look like the same group and one silently drops the other.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['tiny', 'micro', 'meta', 'body'],
      color: [
        'page', 'surface', 'surface-2', 'ink', 'ink-2', 'muted', 'line', 'line-strong',
        'accent', 'accent-ink', 'good', 'bad', 'grid', 'dim',
        'series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-6', 'series-7', 'series-8', 'series-other',
      ],
      container: ['page'],
    },
  },
})

/** Joins class names; later Tailwind classes override conflicting earlier ones. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
