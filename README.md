# App Benchmark Leaderboard

A benchmark leaderboard frontend with **one leaderboard per API app**. Pick the app in the header (`?app=<id>` in the URL); every table column, category chip and chart comes from that app's own categories.

- **Leaderboard**: overall score, API performance metrics (requests, success rate, errors, latency p50/p95, throughput, tokens/min, decode speed) and cost; search, open-weights / finetune / org filters, compare, column picker, category tabs (subtask columns), sortable columns, top-5 shading, expandable rows with subtask scores.
- **Insights**: quality vs. cost scatter (log cost, value frontier, click-to-show kill zone), cost ranking (hover for $/1M output and verbosity), and a 2–3 model category radar.

Stack: Vite, React 18, TypeScript, TanStack Query, zod (mini), Tailwind CSS v4, Radix UI primitives. Charts are hand-written SVG, with no chart library.

Shareable view state is kept in the URL (`?app=…&cat=…&sort=…&compare=…&cost=…`), so a view can be shared by link. Exploration state (search, filter chips, expanded rows, chart picks) stays local. The rule lives in [`searchParams.ts`](frontend/src/shared/state/searchParams.ts).

## Layout

```
frontend/
  src/api/            API contract (zod schemas -> TS types) and the fetch client
  src/app/            app shell: app switcher, loading/error states, providers
  src/features/
    leaderboard/      table, row detail, column/filter/sort logic, URL-backed view state
    insights/         scatter (+ pure layout), cost ranking, radar
  src/shared/
    board/            BoardIndex: everything derived from one leaderboard, via context
    state/            typed URL state
    ui/               UI kit (Radix-based popover/radio/tooltip, cva variants, ChartFrame)
    lib/              cn(), Intl formatting, design-token map, hooks
  mock/               mock API for `dev` and `preview` (fictional data)
  e2e/                Playwright smoke tests (run against the production bundle)
src/app_benchmark/static/   build output, served by the backend
```

Conventions:
- Components read leaderboard data from `useBoard()`; derived lookups belong in `buildBoardIndex`, not in components.
- Classes are joined with `cn()` (clsx + tailwind-merge), so a `className` override always wins; variants use `cva`.
- Every design token is a Tailwind color (`fill-grid`, `stroke-accent`, …). Where a class can't reach, use the typed `cssVar` map.
- Charts render inside `ChartFrame`, at real pixel size.

## Develop

```sh
cd frontend
npm install
npm run dev                                        # dev server with the mock API
VITE_API_PROXY=http://localhost:8000 npm run dev   # proxy /api to a real backend
npm test                                           # vitest: logic, schema, components (jsdom)
npm run test:e2e                                   # Playwright smoke tests on the built bundle
npm run lint                                       # eslint, incl. react-hooks rules
```

CI (`.github/workflows/frontend.yml`) runs typecheck, lint, unit tests, build and the e2e tests.

## Build

```sh
cd frontend
npm run build    # type-checks, then writes to ../src/app_benchmark/static
npm run preview  # serves that bundle with the mock API
```

The build replaces only what it owns in that folder (`index.html` and `assets/`); anything else the backend keeps there is left alone. The Inter font is bundled, so the page needs no external requests.

Configuration lives in env files; see [`frontend/.env.example`](frontend/.env.example). Put local overrides in `.env.local`. All `.env*` files except the example are git-ignored. **Any variable prefixed `VITE_` is embedded in the public bundle, so never put secrets in one.**

Asset URLs are relative (`base: './'`), and the API is resolved relative to the page the same way: a page served at `/benchmark/` calls `/benchmark/api/…`. Override with `VITE_API_BASE` at build time.

## API contract

See [`frontend/src/api/types.ts`](frontend/src/api/types.ts) for full field docs. Responses are validated against these schemas on arrival; a response that doesn't match shows an error naming the bad field, rather than breaking the page.

| Endpoint | Returns |
|---|---|
| `GET /api/apps` | `AppSummary[]`: `{ id, name, description?, updated_at? }` |
| `GET /api/apps/{app_id}/leaderboard` | `Leaderboard`: `{ app, categories, models }` |

- `categories[]`: `{ id, name, short_name?, abbr?, subtasks: [{ id, name }] }`
- `models[]`: `{ id, name, short_name?, variant?, organization, open_weights, finetune, base_model?, overall, categories: {cat_id: score}, subtasks: {subtask_id: score}, cost?: { per_success: { overall?, categories: {cat_id: usd} }, output_per_million?, avg_output_tokens? }, perf?: ModelPerf }`
- `ModelPerf` (client-side load-test results, every field optional): `{ requests, success_rate (0–1), errors, ttft_ms: {p50, p95}, e2e_ms: {p50, p95}, client_overhead_ms: {p50, p95}, throughput_rps, tokens_per_min: {avg, peak}, decode_tps_p50 }`. The **All** view of the table shows these metrics between Overall and cost; each category view shows that category's subtask scores.

Scores are 0–100. Optional fields may be omitted or `null`, and `null` entries in score maps are dropped. Missing scores or costs render as "—" and are left out of the charts.

If the backend uses FastAPI + Pydantic, consider generating these types from its OpenAPI schema (e.g. `openapi-typescript`) so the contract has one source of truth.

Example of serving the bundle (FastAPI):

```python
from pathlib import Path
from fastapi.staticfiles import StaticFiles

app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="static")
# register the /api routes before this mount
```
