import type { ModelEntry } from '../../api/types'
import { useBoard } from '../../shared/board/BoardContext'
import { cn } from '../../shared/lib/cn'
import { formatInt, formatPrice, formatScore } from '../../shared/lib/format'

/** Expanded-row panel: provenance line, then every category's subtask scores. */
export function ModelDetail({ model, highlightCategory }: { model: ModelEntry; highlightCategory?: string }) {
  const { categories } = useBoard()
  const meta: [string, string | undefined][] = [
    ['From', model.organization],
    ['Fine-tuned from', model.base_model],
    ['$/1M output', model.cost?.output_per_million != null ? formatPrice(model.cost.output_per_million) : undefined],
    ['Avg output tokens', model.cost?.avg_output_tokens != null ? formatInt(model.cost.avg_output_tokens) : undefined],
  ]
  return (
    <div className="px-6 py-7 sm:px-14">
      <dl className="flex flex-wrap gap-x-10 gap-y-2 border-b border-line pb-5 font-mono">
        {meta
          .filter(([, v]) => v != null)
          .map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-2">
              <dt className="text-xs tracking-wider text-muted uppercase">{k}:</dt>
              <dd className="text-body text-ink">{v}</dd>
            </div>
          ))}
      </dl>
      <div className="mt-7 grid grid-cols-1 gap-x-7 gap-y-9 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {categories.map((c) => (
          <section key={c.id} aria-label={`${c.name} subtasks`}>
            <h4
              className={cn(
                'mb-2 font-mono text-sm tracking-wider text-accent uppercase',
                c.id === highlightCategory && 'font-bold underline decoration-2 underline-offset-4',
              )}
            >
              {c.name}
            </h4>
            <ul>
              {c.subtasks.map((s) => (
                <li key={s.id} className="flex items-baseline justify-between gap-3 border-b border-dotted border-line-strong py-2 font-mono text-body">
                  <span className="min-w-0 truncate text-ink-2" title={s.name}>
                    {s.name}
                  </span>
                  <span className="font-bold text-ink tabular-nums">{formatScore(model.subtasks[s.id])}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
