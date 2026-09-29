import { RadioGroup } from 'radix-ui'
import { useId } from 'react'
import { pill } from './pill'
import { Eyebrow } from './marks'

export interface ChipOption<T> {
  value: T
  label: string
  title?: string
}

/**
 * One-of-many choice rendered as chips: a real radiogroup (arrow keys move and
 * select, one tab stop). Values can be any type; they're matched by identity.
 */
export function ChipRadioGroup<T>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: ChipOption<T>[]
  onChange: (v: T) => void
}) {
  const labelId = useId()
  const selected = options.findIndex((o) => o.value === value)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Eyebrow id={labelId}>{label}</Eyebrow>
      <RadioGroup.Root
        aria-labelledby={labelId}
        orientation="horizontal"
        value={String(selected)}
        onValueChange={(i) => onChange(options[Number(i)].value)}
        className="flex flex-wrap items-center gap-2"
      >
        {options.map((o, i) => (
          <RadioGroup.Item key={i} value={String(i)} title={o.title} className={pill({ tone: i === selected ? 'on' : 'idle' })}>
            {o.label}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  )
}
