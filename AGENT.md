# AGENT.md: the LLM Service Benchmark (frontend, backend and fakes)

You are working on this project, copying the frontend into another one, or swapping the fakes for real systems. This file tells you what the app is, how it's put together, what to change when you copy it, and the traps we already hit. Read it all before you start; the "Gotchas" section will save you hours.

The source of truth is the code (`frontend/`, `src/`, `fake_data/`). When this file and the code disagree, the code wins. Update this file if you change a rule.

---

## 1. What the app is

A leaderboard of LLM deployments **per service**. Teams own LLM-backed API services (e.g. "Summarize Profile API"); the service is the only unit of organisation (there are no projects). Each service is a black box: BlazeMeter can load-test it, and it logs one event per request to Splunk (TTFT, tokens, end-to-end time, error cause, which model served it).

- **Users start benchmarks from the app.** A run is a BlazeMeter test against the service. They pick models from a two-layer **provider → LLM** catalog (one LLM is often served by several providers: an *offering* is one LLM at one provider), or pick **auto routing**, where the service routes each request to a random model from a pool. Picking several fixed models creates a batch: one run per offering, executed one after another.
- **Results merge two vantage points:** BlazeMeter (client side: hits, failures, response-time percentiles, timeline) and Splunk (server side: TTFT, ITL, tokens, error causes, per-model split for auto runs).
- Runs are persisted through a **DB service** (a document store over HTTP).
- BlazeMeter, Splunk, the DB and the target services **don't exist yet, so all four are faked** as separate HTTP services whose data and canned responses are JSON files under `fake_data/`.

**A leaderboard row is an offering (provider × LLM)** on its latest completed run under the selected **load profile** (Smoke / Baseline / Stress / Custom); results are only comparable within one profile, so profiles are tabs. Auto-routed runs add one "Auto routing" row. There are no quality scores: ranking is by client-side E2E p95.

The service page has three tabs (`?tab=`):

- **Leaderboard**: 01 Leaderboard (profile tabs, test conditions, grouped columns: Latency / Reliability / Throughput / Cost, filters, compare, column chooser, expandable rows with capabilities, error causes, TTFT by prompt length, recent runs, routing mix) and 02 Insights (latency-vs-cost scatter with frontier and kill zone, cost per 1K requests ranked, performance radar).
- **Runs**: the run list (live status, polling while in flight, cancel, report links), the new-run form, and the run detail page (`?run=`): stepper, KPIs, BlazeMeter card with timeline chart, Splunk card, routing mix.
- **Models catalog**: provider → LLM or LLM → provider, with prices, status, regions, capabilities.

The built bundle is written into the Python package (`src/app_benchmark/static/`), which the FastAPI backend serves.

---

## 2. Two ways to replicate

### A. Copy (recommended)

Copy these paths into the target repo. Skip `node_modules/`, `test-results/`, `playwright-report/`, `.vite/` and any `.env*` other than `.env.example`.

```
frontend/                         the whole app
src/, fake_data/, tests/, scripts/, pyproject.toml, Makefile   backend + fakes (skip if the target has its own backend)
.github/workflows/                CI (frontend.yml, backend.yml)
README.md                         (optional) user-facing docs; merge into the target's README
AGENT.md                          this file
```

Then work through the **adaptation checklist in §8**, run `npm install`, and run the **verification in §10**. Don't commit until every check passes.

### B. Rebuild from scratch

Build in this order, verifying each layer before starting the next:

1. Scaffold: Vite + React 18 + TS (project references: `tsconfig.app.json` for `src`, `tsconfig.node.json` for config/mock/e2e), Tailwind v4 through `@tailwindcss/vite`.
2. `src/api/types.ts` (the zod schemas) and `src/api/client.ts`.
3. The mock API (`mock/world.ts`, `mock/plugin.ts`), wired into dev and preview.
4. `src/shared/` (board index + context, URL state, lib, UI kit).
5. `src/features/leaderboard/`, `insights/`, `runs/`, `catalog/`.
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
| Backend | Python ≥ 3.11, FastAPI, httpx, Pydantic 2 / pydantic-settings; pytest + pytest-asyncio; ruff |

Exact versions are in `frontend/package.json` and `package-lock.json`. Install with `npm ci` to reproduce them.

---

## 4. Layout

```
pyproject.toml, Makefile         Python package + dev commands (make dev / test / lint / reset-data / seed-runs / snapshot-fixtures)
scripts/
  dev.py                         runs the API, the four fakes and Vite together
  generate_seed_runs.py          regenerates fake_data/seed/runs.json + run_results.json (deterministic)
  snapshot_fixtures.py           refreshes frontend/mock/fixtures + frontend/src/test/contract from the real API
src/app_benchmark/               the backend (FastAPI)
  main.py                        create_app(): /api routers, error mapping, lifespan (resume runs), static mount
  settings.py                    URLs + credentials of every external system (env prefix BENCH_)
  schemas.py                     Pydantic contract (mirrored by frontend/src/api/types.ts)
  deps.py                        Container: clients + orchestrator per app
  api/                           services, catalog, runs, leaderboard routers
  clients/                       db.py, blazemeter.py, splunk.py: thin httpx clients
  runs/orchestrator.py           per-service queue; queued -> starting -> running -> collecting -> completed|failed|cancelled
  runs/aggregate.py              pure: BlazeMeter summary + Splunk rows -> results (unit-tested)
  runs/leaderboard.py            pure: completed runs -> leaderboard rows (unit-tested)
  static/                        build output
src/benchmark_fakes/             the fake external systems (never imported by app_benchmark)
  db/app.py                      document store over HTTP, one JSON file per collection        :8101
  blazemeter/app.py              BlazeMeter v4 slice + async load engine (time-scaled VUs)     :8102
  splunk/app.py                  HEC ingest + search jobs over JSON-lines event files          :8103
  target_service/app.py          the black-box services under test; logs to Splunk HEC         :8104
  common/                        paths (FAKE_DATA_DIR, TIME_SCALE), jsonstore, templates, http, latency model
fake_data/                       ALL fake data, as JSON
  seed/                          services, providers, llms, offerings, load_profiles, runs, run_results
  profiles/                      offering_profiles.json (latency/error model), service_profiles.json (token sizes)
  blazemeter/, splunk/           response templates ({{placeholder}} leaves)
  db/, blazemeter/state/, splunk/events/   live state (git-ignored; `make reset-data` clears it)
tests/                           pytest: aggregate, leaderboard, each fake, end-to-end through all fakes in-process
frontend/
  mock/world.ts, plugin.ts       Vite mock: serves fake_data/seed + fixtures/leaderboards.json; simulates new runs
  mock/world.test.ts             the mock must satisfy the contract
  e2e/smoke.spec.ts
  src/
    api/types.ts, client.ts      zod contract; queries + mutations (useStartRun, useCancelRun), polling while active
    app/App.tsx                  service switcher, service header, tabs, loading/error, ErrorBoundary
    features/
      leaderboard/               LeaderboardSection, LeaderboardTable, OfferingDetail, TestConditions, table.ts, useLeaderboardView
      insights/                  InsightsSection (lazy), LatencyCostScatter, scatterLayout.ts, CostRanked, PerfRadar
      runs/                      RunsSection, RunsTable, NewRunForm, OfferingPicker, RunDetail, TimelineChart, runs.ts (pure)
      catalog/                   CatalogSection
    shared/
      board/                     boardIndex.ts, BoardContext.tsx, model.ts, orgPalette.ts
      catalog/catalogIndex.ts    catalog lookups, provider<->LLM grouping, usable offerings
      perf/PerfPanels.tsx        error causes, TTFT by input, capabilities, status/source badges, KPI grid
      state/searchParams.ts      typed URL state
      ui/, lib/                  UI kit and helpers (unchanged design system)
    test/                        setup.ts, fixtures.ts, render.tsx (renderWithProviders, fetchStub), contract/*.json
```

---

## 5. Architecture rules (keep these when you copy)

1. **Validate at the boundary.** Every response goes through its zod schema in `request()` (`getJSON` / `sendJSON`). A payload that breaks the contract shows an error naming the field (e.g. `rows.0.perf`) instead of crashing. Optional fields accept `null` or absence and come out as `undefined`; nullable lists come out as `[]`. Error responses surface FastAPI's `detail` (`ApiError.detail`).
2. **Derive once.** `useServiceLeaderboard` uses `select: buildBoardIndex`. That produces `BoardIndex` (rows sorted fastest first, `rowsById`, `profiles`, `profile`, `organizations`, `providers`, `palette`, `conditions`), which is shared through `<BoardProvider>` and read with `useBoard()`. Components never rebuild lookups; add a field to `BoardIndex` instead. The same goes for the catalog: `useCatalog` uses `select: buildCatalogIndex`. Both must stay stable module-level functions, so TanStack Query memoizes the result.
3. **URL state has one definition.** `shared/state/searchParams.ts` owns the keys (`service`, `tab`, `run`, `new`, `profile`, `sort`, `compare`, `lat`) and parses them against a schema; malformed values fall back. Features check ids against the board (see `useLeaderboardView`).
   - *Shareable* (goes in the URL): what the view **is**.
   - *Local* (component state): how you're **exploring** it: search, filter chips, hidden columns, expanded rows, hover, kill zone, radar and cost-list picks, run-list status filter, form inputs.
   - Switching service pushes a history entry with `reset: true`; changing tab, opening a run or the new-run form pushes too (Back closes them); view tweaks use `replaceState`.
4. **Server state polls only while something is in flight.** `useRuns` / `useRun` poll every 2 s while any run is queued/starting/running/collecting (`isActive`), then stop. When a watched run finishes, `RunDetail` invalidates the leaderboard and run list. Results never change once written (`staleTime: Infinity`).
5. **Columns are data** (`features/leaderboard/table.ts`). Each `Column` has:
   - `get` (the sort key) and `format` (the cell text);
   - `group` (one of `COLUMN_GROUPS`): it drives the group header row, the dividers (`groupSpans`, `startsGroup`) and the grouped "Choose columns";
   - `better: 'higher' | 'lower' | null`: drives the first-click sort direction and which end gets shaded. `null` means neither direction is better (Requests, avg tokens), so the column isn't shaded;
   - `shade`, `primary` and `defaultHidden` (collected into `DEFAULT_HIDDEN`);
   - `source` (`BlazeMeter` / `Splunk` / `Catalog`), shown as the header's tooltip. Keep it honest: client-side numbers come from BlazeMeter, server-side from Splunk.

   Paired cells (p50 / p95, avg / peak) sort by their first value. Ties fall back to E2E p95.
6. **Pure logic lives outside components** (`table.ts`, `scatterLayout.ts`, `runs.ts`, `catalogIndex.ts`, `model.ts`, `format.ts`, `boardIndex.ts`; backend: `aggregate.py`, `leaderboard.py`) and is unit-tested.
7. **Color follows the entity.** Organizations (model makers) get palette slots once per leaderboard (fastest first); past 8 slots they fold into "Other". The radar colors models by organization too, and tells picks apart by dash pattern (solid, dashed, dotted), not by a second color.
8. **All formatting goes through `shared/lib/format.ts`** (Intl, locale `en-US`). Missing values render as `—` and sort last.
9. **Rows are offerings.** Identity across providers is `modelKey(r)` (the LLM id). Use `displayName(r)` (name · provider; just the name for the auto row) anywhere rows appear outside the table (selects, tooltips, chart labels), or rows for the same model become indistinguishable. Org color is the model maker's, not the provider's. Elsewhere, name an offering id with `offeringLabel(catalog, id)`.
10. **The backend never talks to the services under test.** It only drives BlazeMeter and reads Splunk, exactly as it will in production; every external system is a URL + credential in `settings.py`. `src/app_benchmark` must not import `src/benchmark_fakes`.
11. **Fake data is JSON.** Seed data, latency profiles and response templates live in `fake_data/` and are edited by hand. Fake code fills placeholders and computes numbers; it doesn't hold data.

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

## 7. API contract (summary; the full definition is `src/app_benchmark/schemas.py` = `frontend/src/api/types.ts`)

```
GET  /api/services                         -> Service[]  { id, name, description?, endpoint_path, allowed_offering_ids? } (first = default)
GET  /api/services/{id}                    -> Service
GET  /api/catalog                          -> { providers[{ id, name, kind }], llms[{ id, name, organization, open_weights, context_window? }],
                                               offerings[{ id, provider_id, llm_id, deployment, regions, status, prices, capabilities }] }
GET  /api/load-profiles                    -> LoadProfile[] { id, name, concurrency, ramp_up_s, duration_s, think_time_s }
POST /api/runs                             <- { service_id, routing: {mode:"fixed", offering_ids[]} | {mode:"auto", pool?[]},
                                                load_profile_id? | load?: {concurrency, ramp_up_s, duration_s, think_time_s}, label? }
                                           -> Run[] (one per fixed offering, sharing batch_id; or one auto run)
GET  /api/runs?service_id&status&limit     -> Run[] newest first
GET  /api/runs/{id}                        -> Run { status, progress, routing, load, blazemeter{test_id, master_id, report_url},
                                                    splunk{sid, search, search_url, events}, headline{requests, error_rate, e2e_p95_ms, ...} }
POST /api/runs/{id}/cancel                 -> Run (queued/starting: never started; running: stopped, partial results kept; collecting: no-op)
GET  /api/runs/{id}/results                -> { blazemeter{summary, interval_s, timeline[]}, splunk{events, overall: Perf, by_offering[]},
                                                perf: Perf (merged), cost }
GET  /api/services/{id}/leaderboard?profile -> { service, profiles[+runs], profile, rows: LeaderboardRow[], conditions }
```

`Perf`: `requests`, `errors`, `success_rate`, `error_breakdown` (counts), `truncation_rate`, `ttft_ms`, `itl_ms`, `e2e_ms` (client), `server_e2e_ms`, `client_overhead_ms` (each `{p50, p95, p99}`), `ttft_by_input[]`, `stall_rate`, `throughput_rps`, `tokens_per_min {avg, peak}`, `decode_tps_p50`, `prefill_tps`, `avg_input_tokens`, `avg_output_tokens`. Rates are 0–1; times ms; prices USD per 1M tokens; `cost.per_1k_requests` is list price at the logged token counts.

`API_BASE` defaults to `api` **resolved relative to the page**; override with `VITE_API_BASE`.

---

## 8. Adaptation checklist (when copying into another project)

- [ ] **Output dir:** `OUT_DIR` in `frontend/vite.config.ts` must point at the target backend's static folder. `cleanOwnedOutput` deletes only `index.html` and `assets/` there. Never set `emptyOutDir: true`.
- [ ] **Serving:** the backend serves `index.html` at a directory URL (e.g. FastAPI `StaticFiles(..., html=True)`, mounted *after* the `/api` routes). Assets are relative (`base: './'`), so any mount path works.
- [ ] **API:** implement the contract in §7, or change the schemas in `types.ts` first; everything downstream is typed from them.
- [ ] **Performance metrics:** if the target measures different metrics, edit `COLUMNS` in `features/leaderboard/table.ts`, `PerfSchema` in `types.ts` and `Perf` in `schemas.py`, plus `aggregate.py` and their tests.
- [ ] **Branding and copy:** `<title>` in `index.html`, "LLM Service Benchmark" in `app/App.tsx`, the section intro text in `LeaderboardSection` and `InsightsSection`, and `name` in `package.json`.
- [ ] **Fake data:** edit `fake_data/` (keep it **fictional**: invented provider, organization and model names; never put real vendors' names next to fabricated numbers), then `make seed-runs` and `make snapshot-fixtures` so the seed history and the frontend fixtures match.
- [ ] **Real systems:** point `BENCH_BLAZEMETER_URL` / `BENCH_SPLUNK_URL` / `BENCH_DB_URL` (+ credentials) at the real ones and `BENCH_TARGET_URL_TEMPLATE` at the real services. The services must copy the `X-Run-Id` header into their Splunk events, and honour `X-Routing` / `X-Offering-Id` / `X-Model-Pool`.
- [ ] **CI:** fix `working-directory`, `paths` and `cache-dependency-path` in the workflow. Keep `permissions: contents: read`, `persist-credentials: false` and the SHA-pinned actions. When bumping an action, resolve the new SHA with `git ls-remote https://github.com/actions/<name>.git refs/tags/<tag>`.
- [ ] **Env:** copy `.env.example`; `.env` and `.env.*` stay git-ignored. **Anything prefixed `VITE_` ends up in the public bundle.**
- [ ] **Backend headers:** the app runs cleanly under this CSP, verified with zero violations. Send it, plus `X-Content-Type-Options: nosniff`, and cache hashed `assets/*` as immutable while serving `index.html` with `no-cache`:
  `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'`

---

## 9. Recipes

- **Add a table column:** add an entry to `COLUMNS` with the `metric(group, key, label, better, source, get, format, extra?)` helper, inside its group's block so the group stays contiguous. Pass `{ defaultHidden: true }` for secondary metrics. If it's new data: compute it in `aggregate.py`, add it to `Perf` (Python) and `PerfSchema` (zod), regenerate seed runs and fixtures, and update the tests.
- **Add a fake field to the logs:** emit it from `common/latency.py` (`simulate_request`), aggregate it in `aggregate.py`.
- **Add a provider, LLM or service:** edit `fake_data/seed/*.json` (+ a latency profile in `offering_profiles.json` for each new offering, token sizes in `service_profiles.json` for a new service), then `make seed-runs snapshot-fixtures reset-data`.
- **Add a column group:** add it to `ColumnGroup` and `COLUMN_GROUPS` (order = display order).
- **Add a URL parameter:** add the key to `SearchSchema` in `searchParams.ts` (use `z.catch(…, fallback)` so bad input degrades gracefully), check it against the board in the feature hook, and add a case to `searchParams.test.ts`.
- **Add derived data:** add a field to `BoardIndex` and compute it in `buildBoardIndex`, with a test in `boardIndex.test.ts`.
- **Add a chart:** put the geometry in a pure module with tests, and render in `ChartFrame` using token classes and `CHART_TEXT` sizes. Give it an `aria-label`, keyboard-reachable marks and a `Tip` for details, and keep the legend outside the frame.
- **Add a UI primitive:** add a file in `shared/ui/`, styled with `cn` + `cva`, built on Radix if it's interactive.

---

## 10. Verification (all must pass)

```sh
make lint test          # ruff + pytest (aggregation, leaderboard, each fake, end-to-end through all fakes)
cd frontend
npm ci
npm run typecheck       # no output = pass
npm run lint            # 0 problems
npm test                # vitest: logic, schema + backend contract samples, URL state, components, mock (96 tests at time of writing)
npm run build           # writes OUT_DIR; no source maps
npm run test:e2e        # builds, serves via `vite preview` + mock, 4 Playwright smoke tests
npm audit               # 0 vulnerabilities expected
```

After changing the contract or the seed data, run `make seed-runs snapshot-fixtures` so `frontend/mock/fixtures` and `frontend/src/test/contract` match the backend.

Then check by hand with `make dev` (the real stack, http://localhost:5176):

- Start a fixed batch (two providers of the same LLM) and an auto run; they queue, show live progress, and complete. The detail page shows the BlazeMeter timeline, Splunk card and (auto) routing mix; the report links open the fake BlazeMeter/Splunk pages.
- The leaderboard picks up the new runs under their profile; the expanded row's recent runs link back to the run.
- `fake_data/db/runs.json` and `fake_data/splunk/events/<run_id>.jsonl` hold the run and its raw logs; restart the stack and the runs are still there.
- Sorting, compare, column chooser, profile tabs, "Show all" (pinned header) and Back/forward all work; reload keeps the URL view.
- Scatter labels don't overlap, the kill zone toggles, tooltips open on hover **and** on Tab.
- Dark mode and `data-theme` overrides render correctly; at 390px the page doesn't scroll sideways.
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
- **Seed numbers depend on the random sequence:** `generate_seed_runs.py` is seeded; changing the latency model or the run plan changes every later number. Regenerate fixtures afterwards.
- **Time is compressed:** the fake load runs at `TIME_SCALE` (default 0.1), so Splunk `_time` stamps are real time. Rates over time (`throughput_rps`, `tokens_per_min`) use BlazeMeter's *nominal* duration, never Splunk timestamps.
- **In-process tests don't run lifespans:** `httpx.ASGITransport` skips startup hooks, so the fakes initialise lazily (the DB seeds on first access) and fakes that call fakes go through `benchmark_fakes.common.http.client()`, which tests point at in-process transports with `override()`.
- **Splunk returns strings:** every result value is a string (blank for null). `aggregate.py` parses with `_num`; a blank TTFT is skipped, not counted as 0.
- **Client overhead is a difference of percentiles** (BlazeMeter p95 − Splunk p95, all requests on both sides), so p95 can come out below p50. Comparing against successful requests only made it collapse to 0 when fast 429s were common.
- **Bundle size:** about 114 KB gzipped for the main chunk; Radix is the largest addition. Insights is lazy-loaded, but it shares Radix with the table, so it only splits off about 6 KB.

---

## 12. Don't

- Don't add a chart library, CSS-in-JS, or a second styling approach.
- Don't upgrade React to 19 without the owner's agreement.
- Don't read `window.location` or define URL keys outside `searchParams.ts`.
- Don't derive lookups inside components (use `BoardIndex` / `CatalogIndex`), and don't write raw `var(--…)` strings (use classes or `cssVar`).
- Don't let `src/app_benchmark` import `src/benchmark_fakes`, or call the target services directly: go through BlazeMeter and Splunk.
- Don't hard-code fake data in Python or TypeScript: it belongs in `fake_data/` as JSON.
- Don't use `dangerouslySetInnerHTML` or render API strings as HTML; all API and URL data is rendered as text.
- Don't make requests to third-party origins (fonts included). That's what keeps the strict CSP above valid.
- Don't put secrets in any `VITE_` variable, and don't commit `.env` files.
- Don't commit without running §10.
