import { useState } from 'react'
import type { Offering } from '../../api/types'
import { groupOfferings, isUsable, type CatalogIndex } from '../../shared/catalog/catalogIndex'
import { cn } from '../../shared/lib/cn'
import { CheckRow, MenuFooter, PopoverMenu } from '../../shared/ui/PopoverMenu'

/**
 * The two-layer model picker: provider → LLM, or LLM → provider (one LLM is
 * often served by several providers). A group's checkbox toggles every usable
 * offering in it; unavailable offerings are listed but can't be picked.
 */
export function OfferingPicker({
  catalog,
  offerings,
  selected,
  onChange,
  label,
}: {
  catalog: CatalogIndex
  offerings: Offering[]
  selected: ReadonlySet<string>
  onChange: (next: Set<string>) => void
  label: string
}) {
  const [by, setBy] = useState<'provider' | 'llm'>('provider')
  const groups = groupOfferings(catalog, offerings, by)
  const usable = offerings.filter(isUsable).map((o) => o.id)

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }
  const toggleGroup = (ids: string[]) => {
    const next = new Set(selected)
    const all = ids.every((id) => next.has(id))
    for (const id of ids) {
      if (all) next.delete(id)
      else next.add(id)
    }
    onChange(next)
  }

  return (
    <PopoverMenu label={selected.size ? `${label} · ${selected.size}` : label} engaged={selected.size > 0} align="start">
      <div role="radiogroup" aria-label="Group models by" className="mb-2 flex gap-1 rounded-lg bg-surface-2 p-1 font-mono text-xs">
        {(['provider', 'llm'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={by === k}
            onClick={() => setBy(k)}
            className={cn('flex-1 rounded-md px-2 py-1', by === k ? 'bg-surface font-semibold text-ink shadow-sm' : 'text-muted hover:text-ink')}
          >
            {k === 'provider' ? 'By provider' : 'By LLM'}
          </button>
        ))}
      </div>
      <div className="max-h-80 overflow-y-auto">
        {groups.map((g) => {
          const ids = g.items.filter((i) => isUsable(i.offering)).map((i) => i.offering.id)
          const on = ids.filter((id) => selected.has(id)).length
          return (
            <div key={g.id} role="group" aria-label={g.label} className="mb-1">
              <CheckRow
                checked={ids.length > 0 && on === ids.length}
                indeterminate={on > 0 && on < ids.length}
                disabled={ids.length === 0}
                onChange={() => toggleGroup(ids)}
                className="font-semibold"
              >
                {g.label}
                {g.detail && <span className="ml-1.5 text-xs font-normal text-muted">{g.detail}</span>}
              </CheckRow>
              {g.items.map(({ offering: o, label: itemLabel }) => (
                <CheckRow
                  key={o.id}
                  checked={selected.has(o.id)}
                  disabled={!isUsable(o)}
                  onChange={() => toggle(o.id)}
                  className="pl-7"
                >
                  {itemLabel}
                  {o.status !== 'available' && <span className="ml-1.5 text-xs text-muted">({o.status})</span>}
                </CheckRow>
              ))}
            </div>
          )
        })}
      </div>
      <MenuFooter>
        <button type="button" className="text-accent" onClick={() => onChange(new Set(usable))}>
          All usable ({usable.length})
        </button>
        <button type="button" className="text-accent disabled:opacity-40" disabled={!selected.size} onClick={() => onChange(new Set())}>
          Clear
        </button>
      </MenuFooter>
    </PopoverMenu>
  )
}
