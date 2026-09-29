import { useMemo, useState } from 'react'
import { useBoard } from '../../shared/board/BoardContext'
import { OVERALL, chipLabel, passesFinetune, type View } from '../../shared/board/model'
import { updateSearch, useSearch } from '../../shared/state/searchParams'
import { Card, SectionHeader } from '../../shared/ui/Card'
import { Chip } from '../../shared/ui/Chip'
import { ChipRadioGroup } from '../../shared/ui/ChipRadioGroup'
import { Eyebrow } from '../../shared/ui/marks'
import { CategoryRadar } from './CategoryRadar'
import { CostRanked } from './CostRanked'
import { QualityCostScatter } from './QualityCostScatter'

/** Default export so the app can lazy-load this below-the-fold section. */
export default function InsightsSection() {
  const board = useBoard()
  const search = useSearch()
  const [includeFinetunes, setIncludeFinetunes] = useState(false)

  // Shareable: the cost view lives in the URL, validated against this leaderboard.
  const view: View = search.cost && board.categoriesById.has(search.cost) ? search.cost : OVERALL
  const setView = (v: View) => updateSearch({ cost: v })

  const models = useMemo(() => board.models.filter((m) => passesFinetune(m, includeFinetunes)), [board.models, includeFinetunes])

  return (
    <section aria-labelledby="insights-title">
      <SectionHeader id="insights-title" index="02" title="Insights">
        A few analytical views — the headline is cost vs. quality, because a score alone doesn't tell you whether a model is worth it.
      </SectionHeader>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Eyebrow>Models</Eyebrow>
          <Chip active={includeFinetunes} onClick={() => setIncludeFinetunes((v) => !v)}>
            Include finetunes
          </Chip>
        </div>
        <ChipRadioGroup<View>
          label="Cost view"
          value={view}
          onChange={setView}
          options={[{ value: OVERALL, label: 'Overall' }, ...board.categories.map((c) => ({ value: c.id, label: chipLabel(c), title: c.name }))]}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card
          title="Quality vs. cost"
          subtitle={
            <>
              {board.app.name} score vs. cost per successful task (log). The <strong className="font-semibold text-accent">value frontier</strong> is
              the best score at each cost. Click a model to grey out its <strong className="font-semibold text-ink">kill zone</strong> — everything
              that scores lower and costs more; click it again to clear.
            </>
          }
        >
          <QualityCostScatter models={models} view={view} />
        </Card>
        <Card title="Cost, ranked" subtitle="Cost per successful task, cheapest first. Hover or focus a row for $/1M output and verbosity.">
          <CostRanked models={models} view={view} />
        </Card>
      </div>

      <Card className="mt-6" title="Category profile" subtitle={`Add any 2–3 models to compare across the ${board.categories.length} categories.`}>
        <CategoryRadar models={models} />
      </Card>
    </section>
  )
}
