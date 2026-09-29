import { Popover } from 'radix-ui'
import type { ReactNode } from 'react'
import { pill } from './pill'

/**
 * Pill that opens a panel of controls. Radix handles focus: it moves into the
 * panel on open, Escape/outside-click close it, and focus returns to the trigger.
 */
export function PopoverMenu({
  label,
  engaged,
  children,
  align = 'end',
}: {
  label: ReactNode
  /** Highlight the trigger because a selection inside is active. */
  engaged?: boolean
  children: ReactNode
  align?: 'start' | 'end'
}) {
  return (
    <Popover.Root>
      <Popover.Trigger className={pill({ tone: engaged ? 'engaged' : 'idle' })}>
        {label}
        <span aria-hidden className="text-tiny opacity-70">
          ▾
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={8}
          collisionPadding={12}
          className="z-40 w-72 rounded-xl border border-line bg-surface p-2 text-ink shadow-lg shadow-black/5 focus:outline-none"
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function CheckRow({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-ink hover:bg-surface-2">
      <input type="checkbox" checked={checked} onChange={onChange} className="size-4 accent-accent" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </label>
  )
}

/** Footer row under a menu's options. */
export function MenuFooter({ children }: { children: ReactNode }) {
  return <div className="mt-1 flex items-center justify-between gap-3 border-t border-line px-2 pt-2 text-xs text-muted">{children}</div>
}
