# AGENT.md: replicating the App Benchmark Leaderboard frontend

You are copying this frontend into another project, or rebuilding it for another backend. This file tells you what the app is, how it's put together, what to change when you copy it, and the traps we already hit. Read it all before you start; the "Gotchas" section will save you hours.

The source of truth is the code in `frontend/`. When this file and the code disagree, the code wins. Update this file if you change a rule.

---

## 1. What the app is

A single-page leaderboard that benchmarks LLM-backed API services **per API app**. One backend can host several "apps" (e.g. Chat Completions API, Code Assist API). Each app has its own categories, models, scores, costs and client-side performance metrics.

**A row is a deployment: one model served by one provider.** A model offered by several providers appears once per provider. Rows share a `model_id`, and each has a `provider`.

The page has two sections:

- **01 Leaderboard**: a sortable table.
  - Above it, a collapsible **Test conditions** panel: window, client region, RTT baseline, concurrency, streaming, stall threshold, timeout, retry policy, requests per model, traffic mix.
  - The **All** view's columns sit under a group header row:
    - **Quality:** Overall.
    - **Reliability:** requests, success rate, success after retries, errors, truncated.
    - **Latency:** TTFT p50/p95, TTFT p99, ITL p50/p95, stall rate, E2E p50/p95, E2E p99*, client overhead p50/p95.
    - **Throughput:** throughput, tokens/min avg/peak, per-request decode, prefill*.
    - **Cost:** reasoning share of output, tokens per 1K chars*, blended $/1M (3:1), cached input $/1M*, billing drift*, cost per successful task.
    - Columns marked * start hidden.
  - Each **category** tab shows that category's average plus its subtask scores.
  - Rows expand to show:
    - provenance and prices (input / cached / output);
    - capability badges;
    - errors by cause;
    - TTFT by prompt length;
    - every subtask score.
  - Filters: search (models, organizations and providers), open weights, include finetunes, show org, **one row per model** (keeps the best provider under the current sort), organization, **provider**, compare, and choose columns (grouped, with whole-group toggles).
  - The best 5 values in each column are shaded.
- **02 Insights** (lazy-loaded):
  - Quality-vs-cost scatter: log cost axis, a Pareto "value frontier", and click-to-show "kill zone".
  - Cost ranking: bars, with a tooltip for $/1M output and verbosity.
  - Category radar: 2–3 models, plus a comparison table.

Categories are **data-driven**: nothing hard-codes category ids. Only the metric columns (`PERF_COLUMNS`) are fixed in code.

The built bundle is written into a Python package (`src/app_benchmark/static/`), and the backend serves it. There is no backend in this repo; a dev-only mock API stands in for it.

---

## 2. Two ways to replicate

### A. Copy (recommended)

Copy these paths into the target repo. Skip `node_modules/`, `test-results/`, `playwright-report/`, `.vite/` and any `.env*` other than `.env.example`.

```
frontend/                         the whole app
.github/workflows/frontend.yml    CI
README.md                         (optional) user-facing docs; merge into the target's README
AGENT.md                          this file
```

Then work through the **adaptation checklist in §8**, run `npm install`, and run the **verification in §10**. Don't commit until every check passes.

### B. Rebuild from scratch

Build in this order, verifying each layer before starting the next:

1. Scaffold: Vite + React 18 + TS (project references: `tsconfig.app.json` for `src`, `tsconfig.node.json` for config/mock/e2e), Tailwind v4 through `@tailwindcss/vite`.
2. `src/api/types.ts` (the zod schemas) and `src/api/client.ts`.
3. The mock API (`mock/data.ts`, `mock/plugin.ts`), wired into dev and preview.
4. `src/shared/` (board index + context, URL state, lib, UI kit).
5. `src/features/leaderboard/`, then `src/features/insights/`.
6. `src/app/App.tsx` and `src/main.tsx`.
7. Tests, e2e, lint, CI.

Use the existing files as the reference implementation for every step.

---

## 3. Stack and versions

| Area | Choice |
|---|---|
| Runtime | Node ≥ 24 (CI uses 24; developed on 26), npm 11 |
| Build | Vite 8, `@vitejs/plugin-react` 6, TypeScript 5.9 (`tsc -b` project references) |
| UI | **React 18** (a hard requirement from the project owner; do not upgrade to 19) |
| Data | TanStack Query 5; **zod 4 via `zod/mini`** (smaller bundle) |
| Styling | Tailwind CSS 4 (CSS-first `@theme`), `clsx` + `tailwind-merge` 3 through `cn()`, `class-variance-authority` for variants |
| Primitives | `radix-ui` (Popover, RadioGroup, Tooltip) |
| Font | `@fontsource-variable/inter`, bundled (no external requests) |
| Charts | Hand-written SVG. **No chart library.** |
| Tests | Vitest 5 + jsdom + Testing Library; Playwright 1.63 for e2e |
| Lint | ESLint 10 flat config + `typescript-eslint` + `eslint-plugin-react-hooks` |

Exact versions are in `frontend/package.json` and `package-lock.json`. Install with `npm ci` to reproduce them.

---

## 4. Layout

```
frontend/
  index.html                 shell; inline SVG favicon (data: URI)
  vite.config.ts             OUT_DIR, cleanOwnedOutput plugin, mock wiring, proxy, vitest config
  eslint.config.js
  playwright.config.ts       e2e against `vite preview` of the production build
  .env.example               documents VITE_API_BASE / VITE_API_PROXY
  mock/
    data.ts                  deterministic FICTIONAL data (seeded PRNG); 3 apps, ~85 rows each
                             (models x providers), run conditions
    data.test.ts             the mock must satisfy the real schema
    plugin.ts                middleware for both dev and preview servers
  e2e/smoke.spec.ts
  src/
    main.tsx                 QueryClient + TooltipProvider + App
    index.css                design tokens (light-dark()), Tailwind @theme, type scale
    api/
      types.ts               zod schemas -> TS types (THE contract)
      client.ts              fetch + parse; useApps(); useLeaderboard() (select: buildBoardIndex)
    app/App.tsx              header/app switcher, loading/error, ErrorBoundary, lazy Insights
    features/
      leaderboard/           LeaderboardSection, LeaderboardTable, ModelDetail,
                             TestConditions, table.ts (columns, groups, filter, sort, rank,
                             best-per-model; pure), useLeaderboardView.ts
      insights/              InsightsSection (default export, lazy), QualityCostScatter,
                             scatterLayout.ts (pure: scales, frontier, labels, nearestPoint),
                             CostRanked, CategoryRadar
    shared/
      board/                 boardIndex.ts (derived data), BoardContext.tsx (useBoard),
                             model.ts (accessors), orgPalette.ts
      state/searchParams.ts  typed URL state (the only place URL params are defined)
      ui/                    pill.ts (cva), Chip, ChipRadioGroup, SelectPill, TextInput,
                             PopoverMenu, Tooltip, Card, marks, ChartFrame, ErrorBoundary
      lib/                   cn.ts, format.ts (Intl), tokens.ts (cssVar map), hooks.ts
    test/                    setup.ts (jsdom stubs), fixtures.ts, render.tsx
../src/app_benchmark/static/ build output (owned by the backend package)
../.github/workflows/frontend.yml
```

---

## 5. Architecture rules (keep these when you copy)

1. **Validate at the boundary.** Every response goes through its zod schema in `getJSON`. A payload that breaks the contract shows an error naming the field (e.g. `models.0.overall`) instead of crashing. Optional fields accept `null` or absence and come out as `undefined`; `null` entries in score maps are dropped.
2. **Derive once.** `useLeaderboard` uses `select: buildBoardIndex`. That produces `BoardIndex` (models sorted, `modelsById`, `categoriesById`, `organizations`, `providers`, `palette`, `run`), which is shared through `<BoardProvider>` and read with `useBoard()`. Components never rebuild lookups; add a field to `BoardIndex` instead. `buildBoardIndex` must stay a stable module-level function, so TanStack Query memoizes the result.
3. **URL state has one definition.** `shared/state/searchParams.ts` owns the keys (`app`, `cat`, `sort`, `compare`, `cost`) and parses them against a schema; malformed values fall back. Features check ids against the board (see `useLeaderboardView`).
   - *Shareable* (goes in the URL): what the view **is**.
   - *Local* (component state): how you're **exploring** it: search, filter chips, hidden columns, expanded rows, hover, kill zone, radar and cost-list picks.
   - Switching apps pushes a history entry with `reset: true`; view tweaks use `replaceState`.
4. **"Overall" is `null`, not a string.** `View = string | null`; `OVERALL = null`. The contract keeps overall separate from categories (`overall` + `categories: {}`, and `cost.per_success: { overall, categories }`). Table column ids are namespaced (`overall`, `cat:<id>`, `sub:<id>`, `perf:<key>`, `cost`), so a category literally named `overall` can't collide.
5. **Columns are data** (`features/leaderboard/table.ts`). Each `Column` has:
   - `get` (the sort key) and `format` (the cell text);
   - `group` (one of `COLUMN_GROUPS`): it drives the group header row, the dividers (`groupSpans`, `startsGroup`) and the grouped "Choose columns";
   - `better: 'higher' | 'lower' | null`: drives the first-click sort direction and which end gets shaded. `null` means neither direction is better (Requests, reasoning share), so the column isn't shaded;
   - `shade`, `primary` and `defaultHidden` (collected into `DEFAULT_HIDDEN`).

   Paired cells (p50 / p95, avg / peak) sort by their first value. Billing drift sorts by its size and displays its sign.
6. **Pure logic lives outside components** (`table.ts`, `scatterLayout.ts`, `model.ts`, `format.ts`, `boardIndex.ts`) and is unit-tested.
7. **Color follows the entity.** Organizations get palette slots once per leaderboard (strongest first); past 8 slots they fold into "Other". The radar colors models by organization too, and tells picks apart by dash pattern (solid, dashed, dotted), not by a second color.
8. **All formatting goes through `shared/lib/format.ts`** (Intl, locale `en-US`). Missing values render as `—` and sort last.
9. **Rows are deployments.** Identity across providers is `modelKey(m)` (`model_id ?? id`). Use `displayName(m)` (name · provider) anywhere rows appear outside the table (selects, tooltips, chart labels), or rows for the same model become indistinguishable. Org color is the model maker's, not the provider's.

---

## 6. Styling system

- **Tokens:** defined once in `index.css` with `light-dark()` under `:root { color-scheme: light dark }`. Setting `data-theme="light"` or `"dark"` on `<html>` forces a theme.
  - `@theme inline` turns every token into a Tailwind color (`bg-surface`, `text-ink`, `stroke-grid`, `fill-dim`, `bg-series-3`…).
  - A separate **non-inline** `@theme` holds fonts, the type scale (`text-tiny` 10, `text-micro` 11, `text-meta` 13, `text-body` 15) and `max-w-page`. It must be non-inline so the CSS variables are actually emitted: the charts read `--font-sans` at runtime.
- **Classes:** always join with `cn()` (`shared/lib/cn.ts`), so a `className` override wins. If you add a custom token, **also add it to the `extendTailwindMerge` config in `cn.ts`**, or `tailwind-merge` will drop classes (see Gotchas).
- **Variants:** `cva` (`shared/ui/pill.ts`, `TextInput`).
- **Where a class can't reach** (runtime SVG attributes, `color-mix()`), use the typed `cssVar` map in `shared/lib/tokens.ts`. Never write raw `var(--…)` strings in components.
- **Charts:**
  - Render inside `ChartFrame`, which measures the container and passes the real pixel width, so text never scales. Keep legends *outside* the frame, which has a fixed height.
  - Chart type sizes come from `CHART_TEXT`.
  - The scatter measures label widths with the same font values it draws with, and waits for `document.fonts.ready` first.
- **Accessibility:** one-of-many choices use `ChipRadioGroup` (a Radix radio group: arrow keys, a single tab stop); on/off filters use `Chip` (`aria-pressed`). Menus use `PopoverMenu`, which moves focus in and returns it on close. Tooltips use `Tip`, which opens on hover and on Tab focus and repositions at screen edges; its trigger must be focusable.
- **The categorical palette** (8 slots, light and dark steps) is validated for colorblind separation. Don't reorder the slots or invent new ones.

---

## 7. API contract (summary; the full definition is `src/api/types.ts`)

```
GET {API_BASE}/apps                      -> AppSummary[]   { id, name, description?, updated_at? }
GET {API_BASE}/apps/{app_id}/leaderboard -> { app, categories, models, run? }
  categories[]: { id, name, short_name?, abbr?, subtasks: [{ id, name }] }
  models[]:     { id, model_id?, provider?, name, short_name?, variant?, organization, open_weights, finetune,
                  base_model?, overall, categories: {cat_id: score}, subtasks: {subtask_id: score},
                  cost?: { per_success: { overall?, categories: {cat_id: usd} },
                           input_per_million?, cached_input_per_million?, output_per_million?,
                           avg_output_tokens? (incl. reasoning), avg_reasoning_tokens?,
                           tokens_per_1k_chars?, billing_drift? ((billed-counted)/counted) },
                  perf?: { requests?, success_rate?, success_after_retry?, errors?,
                           error_breakdown?: { rate_limited?, server_error?, timeout?, dropped_stream?, refused?, other? },
                           truncation_rate?, ttft_ms?: {p50?, p95?, p99?}, ttft_by_input?: [{ input_tokens, p50_ms }],
                           itl_ms?: {p50?, p95?, p99?}, stall_rate?, e2e_ms?: {p50?, p95?, p99?},
                           client_overhead_ms?: {p50?, p95?}, throughput_rps?, tokens_per_min?: {avg?, peak?},
                           decode_tps_p50?, prefill_tps? },
                  capabilities?: { context_window?, max_output_tokens?, streaming?, tool_calling?, json_mode?,
                                   vision?, prompt_caching?, batch_api?, regions?: string[] } }
  run?:         { started_at?, ended_at?, client_region?, network_rtt_ms?, concurrency?: number[], streaming?,
                  stall_threshold_ms?, timeout_ms?, retry_policy?, requests_per_model?,
                  profiles?: [{ name, input_tokens?, output_tokens?, share? }], notes? }
```

Rates and shares (`success_rate`, `success_after_retry`, `truncation_rate`, `stall_rate`, `profiles[].share`) are 0–1 fractions. The blended price is computed in the frontend at 3:1 input:output (`blendedPrice` in `shared/board/model.ts`).

Scores are 0–100. Ids must be non-empty. `API_BASE` defaults to `api` **resolved relative to the page** (a page at `/benchmark/` calls `/benchmark/api`); override it at build time with `VITE_API_BASE`.

---

## 8. Adaptation checklist (when copying into another project)

- [ ] **Output dir:** `OUT_DIR` in `frontend/vite.config.ts` must point at the target backend's static folder. `cleanOwnedOutput` deletes only `index.html` and `assets/` there. Never set `emptyOutDir: true`.
- [ ] **Serving:** the backend serves `index.html` at a directory URL (e.g. FastAPI `StaticFiles(..., html=True)`, mounted *after* the `/api` routes). Assets are relative (`base: './'`), so any mount path works.
- [ ] **API:** implement the contract in §7, or change the schemas in `types.ts` first; everything downstream is typed from them.
- [ ] **Performance metrics:** if the target measures different metrics, edit `PERF_COLUMNS` in `features/leaderboard/table.ts` and `ModelPerfSchema` in `types.ts`, plus their tests (`table.test.ts` asserts the column titles).
- [ ] **Branding and copy:** `<title>` in `index.html`, "App Benchmark" in `app/App.tsx`, the section intro text in `LeaderboardSection` and `InsightsSection`, and `name` in `package.json`.
- [ ] **Mock:** rewrite `mock/data.ts` for the new domain. Keep it **fictional**: invented organization and model names, seeded random numbers. Never put real vendors' names next to fabricated numbers.
- [ ] **CI:** fix `working-directory`, `paths` and `cache-dependency-path` in the workflow. Keep `permissions: contents: read`, `persist-credentials: false` and the SHA-pinned actions. When bumping an action, resolve the new SHA with `git ls-remote https://github.com/actions/<name>.git refs/tags/<tag>`.
- [ ] **Env:** copy `.env.example`; `.env` and `.env.*` stay git-ignored. **Anything prefixed `VITE_` ends up in the public bundle.**
- [ ] **Backend headers:** the app runs cleanly under this CSP, verified with zero violations. Send it, plus `X-Content-Type-Options: nosniff`, and cache hashed `assets/*` as immutable while serving `index.html` with `no-cache`:
  `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'`

---

## 9. Recipes

- **Add a table column:** add an entry to `PERF_COLUMNS` with the `metric(group, key, label, better, get, format, extra?)` helper, inside its group's block so the group stays contiguous. Pass `{ defaultHidden: true }` for secondary metrics. Add its schema field if it's new data, extend `mock/data.ts`, and update `table.test.ts`.
- **Add a column group:** add it to `ColumnGroup` and `COLUMN_GROUPS` (order = display order).
- **Add a URL parameter:** add the key to `SearchSchema` in `searchParams.ts` (use `z.catch(…, fallback)` so bad input degrades gracefully), check it against the board in the feature hook, and add a case to `searchParams.test.ts`.
- **Add derived data:** add a field to `BoardIndex` and compute it in `buildBoardIndex`, with a test in `boardIndex.test.ts`.
- **Add a chart:** put the geometry in a pure module with tests, and render in `ChartFrame` using token classes and `CHART_TEXT` sizes. Give it an `aria-label`, keyboard-reachable marks and a `Tip` for details, and keep the legend outside the frame.
- **Add a UI primitive:** add a file in `shared/ui/`, styled with `cn` + `cva`, built on Radix if it's interactive.

---

## 10. Verification (all must pass)

```sh
cd frontend
npm ci
npm run typecheck      # no output = pass
npm run lint           # 0 problems
npm test               # vitest: pure logic, schema, URL state, components, mock-vs-contract (83 tests at time of writing)
npm run build          # writes OUT_DIR; no source maps
npm run test:e2e       # builds, serves via `vite preview` + mock, 4 Playwright smoke tests
npm audit              # 0 vulnerabilities expected
```

Locally, Playwright uses the installed Google Chrome (`channel: 'chrome'`); in CI it installs Chromium. Then check by hand in a browser (`npm run dev`, which picks the next free port if 5173 is taken):

- The All view shows the group header row (Quality / Reliability / Latency / Throughput / Cost), "via <provider>" under each name, and a category tab shows its subtasks.
- "One row per model" keeps one row per model, and changes which provider wins when you change the sort. The provider filter works.
- Choose columns: groups toggle as a whole, and partly shown groups appear partly checked (indeterminate). "Defaults" restores the default-hidden set.
- The expanded row stays inside the visible area even after scrolling the table fully right.
- The test-conditions panel opens and shows the traffic mix.
- Sorting, row expansion, compare and "Show all" (the header stays pinned) all work.
- Reloading keeps `cat`, `sort`, `compare` and `cost`; switching apps clears them; Back restores them.
- Scatter labels don't overlap each other, the kill zone toggles, and tooltips open on hover **and** on Tab.
- Dark mode (`prefers-color-scheme: dark`) and `data-theme` overrides both render correctly.
- At 390px wide the page doesn't scroll sideways (the table scrolls inside its own container), and the radar labels stay 11px.
- The console has no errors.

---

## 11. Gotchas we already hit

- **zod optional + transform:** in zod 4, `.nullish().transform(…)` makes the key *required* (typed `T | undefined`), which breaks object literals. The helper wraps it: `z.optional(z.pipe(z.nullish(s), z.transform(v => v ?? undefined)))`.
- **tailwind-merge and custom tokens:** unless it's told about the custom font sizes and colors, it treats `text-body` (a size) and `text-ink` (a color) as the same group and silently drops one. Keep `cn.ts`'s theme config in sync with `index.css`.
- **Tailwind `@theme inline` doesn't emit CSS variables.** Anything read at runtime (`--font-sans`) must live in a non-inline `@theme`.
- **Sticky table header:** needs `border-separate border-spacing-0` (not `border-collapse`) and a bounded scroll container (`max-h-[80vh] overflow-auto`, applied only in "Show all"). A sticky element can't escape a horizontal-scroll ancestor.
- **Overlapping scatter points:** the same model from two providers often lands within a few pixels of itself. Per-point hit areas let the dot drawn on top steal clicks from the one under the pointer. The scatter uses **one transparent overlay with `nearestPoint`** for hover and click; dots are `pointer-events-none` keyboard buttons. Pointer hover and keyboard focus are tracked separately (`focusId ?? pointerId`), and the tooltip is a controlled `Tip open=…`. In e2e, click a dot via `page.mouse.click` at its center or with keyboard Enter; Playwright's `locator.click()` refuses, because the overlay receives the pointer.
- **Expanded rows in a wide table:** the detail cell spans every column (thousands of px). Its content is wrapped in a `sticky left-0` box sized to the scroll container's visible width (`useElementWidth`), or most of it renders off-screen.
- **Scatter labels are strict:** a label that would cover another dot is dropped (the tooltip still names that dot), rather than placed on top of it.
- **More than one table on the page:** the conditions panel has its own table. Address the leaderboard as `getByRole('table', { name: 'Leaderboard' })` in tests, never `locator('table').first()`.
- **Fixed-height chart frames:** anything rendered after the SVG inside `ChartFrame` overflows onto the next section. Legends go outside.
- **Radix Tooltip** opens on real keyboard focus (Tab), **not** on a programmatic `element.focus()`. In e2e tests, reach the trigger with Tab.
- **Radix RadioGroup** selects on arrow keys only while the key is held (it moves focus in a `setTimeout`). Playwright's `keyboard.press` is too fast; use `down` → wait ~60ms → `up`. Real users are fine.
- **Playwright locators:**
  - `name: 'All'` also matches "Overall"; use `exact: true`.
  - `/per successful task$/` also matches the "Cost per successful task" column header.
  - Selecting a scatter point re-orders the points (dominated ones are drawn first), so `.first()` changes. Pin the point by its exact `aria-label`.
- **The mock must serve both servers:** it needs `configureServer` *and* `configurePreviewServer`, or `vite preview` (and e2e) has no API.
- **jsdom lacks ResizeObserver, canvas and pointer capture.** `src/test/setup.ts` stubs them. Don't delete it.
- **npm 11** warns about `fsevents` install scripts not being allowlisted. The package is optional and not needed.
- **Mock numbers depend on the random sequence:** adding a `rand()` call anywhere in `mock/data.ts` shifts every later value, so model names and scores change. That's expected.
- **Bundle size:** about 114 KB gzipped for the main chunk; Radix is the largest addition. Insights is lazy-loaded, but it shares Radix with the table, so it only splits off about 6 KB.

---

## 12. Don't

- Don't add a chart library, CSS-in-JS, or a second styling approach.
- Don't upgrade React to 19 without the owner's agreement.
- Don't read `window.location` or define URL keys outside `searchParams.ts`.
- Don't derive lookups inside components (use `BoardIndex`), and don't write raw `var(--…)` strings (use classes or `cssVar`).
- Don't use `dangerouslySetInnerHTML` or render API strings as HTML; all API and URL data is rendered as text.
- Don't make requests to third-party origins (fonts included). That's what keeps the strict CSP above valid.
- Don't put secrets in any `VITE_` variable, and don't commit `.env` files.
- Don't commit without running §10.
