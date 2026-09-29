// Design tokens for places a class can't reach: SVG attributes computed at runtime,
// inline styles, color-mix(). Typed, so a typo is a compile error rather than black.
export const cssVar = {
  page: 'var(--page)',
  surface: 'var(--surface)',
  ink: 'var(--ink)',
  accent: 'var(--accent)',
  dim: 'var(--dim)',
  grid: 'var(--grid)',
  lineStrong: 'var(--line-strong)',
  seriesOther: 'var(--series-other)',
  series: (slot: number) => `var(--series-${slot + 1})`,
} as const

/** A token tinted toward transparent, e.g. for heat shading. */
export const tint = (color: string, percent: number) => `color-mix(in oklab, ${color} ${percent}%, transparent)`
