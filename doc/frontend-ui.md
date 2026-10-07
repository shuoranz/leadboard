# Frontend

The React app in `frontend/`. AGENTS.md §5–6 hold its architecture rules and styling rules; this
file is the full specification: the build setup, the design tokens, the data layer, and every
screen with its copy and behaviour. Quoted text is the UI copy, word for word.

## 1. Project setup

- **Vite 8 + React 18 + TypeScript 5.9.** The `npm` scripts:

  | Script | Runs |
  |---|---|
  | `dev` | `vite` |
  | `build` | `tsc -b && vite build` |
  | `typecheck` | `tsc -b` |
  | `lint` | `eslint .` |
  | `test` | `vitest run` |
  | `test:e2e` | `playwright test` |
  | `preview` | `vite preview` |

- **`vite.config.ts`:**
  - `base: './'`: relative asset URLs, so the bundle works at any mount path.
  - `build.outDir` = `../src/app_benchmark/static`, `assetsDir: 'assets'`, `emptyOutDir: false`. A
    `clean-owned-output` plugin deletes only `static/assets/` and `static/index.html` at build
    start.
  - Dev server: port **5176**, `strictPort: true`.
  - With `VITE_API_PROXY` set, `/api` (or `VITE_API_BASE`) is proxied there with
    `changeOrigin: true`, in both dev and preview. Without it, the mock API plugin (§9) serves the
    API in dev and preview.
  - Plugins: `@vitejs/plugin-react`, `@tailwindcss/vite`.
  - Vitest: jsdom, `include: ['src/**/*.test.{ts,tsx}', 'mock/**/*.test.ts']`, setup file
    `src/test/setup.ts`.
- **TypeScript:** project references.
  - `tsconfig.app.json` covers `src`: ES2022, DOM, `strict`, `noUnusedLocals` and
    `noUnusedParameters`, `verbatimModuleSyntax`, `moduleResolution: bundler`, `jsx: react-jsx`,
    `resolveJsonModule`.
  - `tsconfig.node.json` covers `vite.config.ts`, `eslint.config.js`, `playwright.config.ts`,
    `mock` and `e2e`: ES2023, node types, `allowImportingTsExtensions`.
- **ESLint 10 flat config:** `@eslint/js` recommended, `typescript-eslint` recommended and the
  react-hooks recommended rules. Unused variables are allowed when prefixed with `_`.
- **Playwright:** Chromium against `npm run build && vite preview --port 5181` with the mock API.
  Locally it uses the installed Chrome (`channel: 'chrome'`). On CI it retries once.
- **`index.html`:**
  - `<title>LLM Service Benchmark</title>`;
  - an inline SVG favicon of three rounded bars in `#3b4fd8`;
  - `<div id="root">`.
- **`main.tsx`:** `StrictMode`, then `QueryClientProvider`, then `TooltipProvider`, then `App`.
  Query defaults: `staleTime` 5 minutes, `refetchOnWindowFocus: false`, `retry: 1`.
- **Test setup (`src/test/setup.ts`):**
  - jest-dom matchers;
  - a `ResizeObserver` stub that reports a width of 800;
  - `hasPointerCapture` and `scrollIntoView` stubs;
  - `getContext` returning null;
  - after each test: cleanup, and reset the URL to `/`.
- **Test helpers (`src/test/render.tsx`):**
  - `renderWithProviders(ui, {url, board})` sets the URL and wraps the UI in a fresh `QueryClient`
    (retry off), `TooltipProvider` and an optional `BoardProvider`.
  - `fetchStub(routes)` routes `fetch` by the path after `/api` (key `"<path>"` or
    `"<METHOD> <path>"`). A value is a body, or `(init) => [status, body]`. It records every call.

## 2. Design tokens and type (`src/index.css`)

Every color is defined once with `light-dark(light, dark)` under `:root { color-scheme: light dark }`.
`:root[data-theme='light' | 'dark']` forces one side.

| Token | Light | Dark |
|---|---|---|
| page | #f6f7fb | #0f1115 |
| surface | #ffffff | #171a21 |
| surface-2 | #f8f9fc | #1c2029 |
| ink | #111827 | #f3f4f6 |
| ink-2 | #4b5563 | #c3c7d1 |
| muted | #8a8f9c | #8b909c |
| line | #e6e8ef | #272b35 |
| line-strong | #d3d7e2 | #353a46 |
| accent | #3b4fd8 | #7385ff |
| accent-ink | #ffffff | #0f1115 |
| good | #16803c | #3fbf6a |
| bad | #c2352f | #f07470 |
| warn | #a15c00 | #e0a33a |
| grid | #eceef3 | #232731 |
| dim | #cfd3dc | #3a3f4b |
| series-1 | #2a78d6 | #3987e5 |
| series-2 | #eb6834 | #d95926 |
| series-3 | #1baf7a | #199e70 |
| series-4 | #eda100 | #c98500 |
| series-5 | #e87ba4 | #d55181 |
| series-6 | #008300 | #008300 |
| series-7 | #4a3aa7 | #9085e9 |
| series-8 | #e34948 | #e66767 |
| series-other | #9a9ca3 | #6b6e76 |

The series colors have a fixed order, checked for colorblind separation in both modes.

- **`@theme inline`** maps every token to a Tailwind color: `--color-<token>: var(--<token>)`. So
  `bg-surface`, `text-ink`, `stroke-grid`, `fill-dim` and so on work in HTML and SVG alike.
- **A separate, non-inline `@theme`** (so the CSS variables really exist at runtime):
  - `--font-sans: 'Inter Variable', system-ui, -apple-system, 'Segoe UI', sans-serif`;
  - `--font-mono: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace`;
  - a type scale of `--text-tiny` 10px, `--text-micro` 11px, `--text-meta` 13px and
    `--text-body` 15px, alongside Tailwind's xs, sm, base and lg;
  - `--container-page: 1500px` (`max-w-page`).
- **Base styles:** `html` and `body` use `background: var(--page)` and `color: var(--ink)`. The body
  uses the sans font, antialiased.
- **Inter** is self-hosted with `@import '@fontsource-variable/inter/wght.css'`. Nothing loads from
  third-party origins.
- **`cn()`** (`shared/lib/cn.ts`) = `twMerge(clsx(...))`. The `twMerge` is extended so it knows the
  custom `text` sizes (`tiny`, `micro`, `meta`, `body`), every color token and the `page`
  container.
- **`cssVar`** (`shared/lib/tokens.ts`) has `page`, `surface`, `ink`, `accent`, `dim`, `grid`,
  `lineStrong`, `seriesOther` and `series(i)` → `var(--series-{i+1})`. The helper
  `tint(color, pct)` = `color-mix(in oklab, <color> <pct>%, transparent)`.

## 3. UI kit (`src/shared/ui/`)

- **`pill`** (cva): the rounded mono pill.
  - Base: `inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5
    font-mono text-meta`, with an accent focus outline.
  - Tones:
    - `idle`: line-strong border, surface background, ink-2 text; the hover darkens it;
    - `on`: accent border and background, accent-ink text, semibold;
    - `engaged`: accent border, surface background, accent text.
- **`Chip`:** a `<button aria-pressed>` pill, `on` when active, otherwise `idle`. It is for on/off
  filters.
- **`ChipRadioGroup<T>`:** a label (the `Eyebrow`: mono, xs, widest tracking, uppercase, muted),
  then a Radix `RadioGroup` of pills, `on` for the selected one. Options are `{value, label,
  title?}`, matched by identity. It is for one-of-many choices.
- **`SelectPill`:**
  - a native `<select>` styled as a pill, with a chevron and an `sr-only` label;
  - prop `mono` (default true); `mono={false}` uses the sans font at `text-sm`.
- **`TextInput`** (cva):
  - size `md`: `h-11 rounded-lg`, line-strong border, surface background, `text-body`;
  - size `sm`: `h-9 rounded-md`, line border, surface-2 background, `text-sm`;
  - the label is `sr-only` unless `showLabel` is set, which puts it above in mono, xs, uppercase.
- **`PopoverMenu`:**
  - a Radix Popover whose trigger is a pill (`engaged` when something is selected) with a `▾`;
  - the panel is 72 wide (18rem), rounded-xl, with a line border, surface background and a
    shadow, aligned `end` by default, max height `min(70vh, available)`;
  - `CheckRow` is a checkbox label row; it supports `indeterminate`, set as a DOM property, and
    `disabled`;
  - `MenuFooter` is a top-bordered row of small text links.
- **`Tip`:** a Radix Tooltip.
  - The provider has no delay.
  - The content is rounded-lg with a line border, a surface background, `text-meta`, at most 72
    wide (18rem), offset 10.
  - Its `open` prop lets a chart control it.
  - `TooltipRows` is a two-column mono `dl`.
- **`Card`:**
  - a `section` that is rounded-2xl, with a line border, a surface background, `p-5` (`sm:p-7`) and
    a faint shadow;
  - `h3` title at `text-lg` semibold;
  - an optional subtitle at `text-body`, ink-2.
- **`SectionHeader`:** an `h2` holding a mono muted index (e.g. "01") next to a `text-3xl` bold
  title, then an optional intro paragraph at `text-lg`, ink-2, max-w-3xl.
- **`ChartFrame`:**
  - measures its container's width with a `ResizeObserver` and renders `children(width, height)`
    only once the width is > 0;
  - `height` is a number, or a function of the width;
  - `CHART_TEXT = {tick: 12, label: 12.5, small: 11}`;
  - charts draw at real pixel size, so text never scales.
- **`marks`:**
  - `Eyebrow`;
  - `OrgDot` (a colored circle, default 10px);
  - `LineKey` (a short SVG line swatch with an optional dash);
  - `Badge` (tones `good` and `muted`, mono `text-micro`).
- **`ErrorBoundary`:** a class component with a `fallback(error, reset)` prop. It logs the error
  with `console.error`.
- **Hooks** (`shared/lib/hooks.ts`):
  - `useElementWidth()`: a ref plus its content width, tracked with a ResizeObserver;
  - `useFontsReady()`: true once `document.fonts.ready` resolves;
  - `measureText(text, cssFont)`: measures on a canvas, or falls back to `length × 7`.

## 4. Formatting (`shared/lib/format.ts`)

Locale `en-US` through `Intl`, with cached formatters. Missing values render as `—` (`EMPTY`).

| Function | Output |
|---|---|
| formatInt | grouped, no decimals: `1,234` |
| formatDecimal | 1 decimal: `12.4` |
| formatPercent | a 0–1 value as a percent, 1 decimal: `99.2%` |
| formatSignedPercent | the same with a sign, except for zero |
| formatCompact | compact notation, 2–3 significant digits: `48.2K`, `3.0M` |
| formatTokens | compact, at most 1 decimal: `128K` |
| formatPrice | USD, 2 decimals |
| formatCost1k | USD: ≥ 100 → 0 decimals, ≥ 1 → 2, else 3 |
| formatCost | USD: ≥ 100 → 0, ≥ 10 → 2, else 3 |
| formatCostTick | ≥ $1: whole dollars; below: 1 significant digit (`$0.005`) |
| formatPair(a, b, f) | `"f(a) / f(b)"`, or `—` when both are missing |
| formatDate | `Oct 5, 2026` (undefined when invalid) |
| formatDateTime | `Oct 5, 6:04 PM` (local time) |
| formatDuration(s) | `45s`, `1m 30s`, `10m`, `1h 2m`, `1h` |
| formatMs | `1,234 ms` |

## 5. Data layer (`src/api/`)

**`types.ts`:** zod 4 through `zod/mini`, mirroring [contract.md](contract.md).
- **Helpers:**
  - `optional(s)` = `z.optional(z.pipe(z.nullish(s), z.transform(v => v ?? undefined)))`;
  - `list(s)` turns a null or missing list into `[]`;
  - `id` = a non-empty string;
  - `externalUrl` keeps a string only if `new URL(v).protocol` is `http:` or `https:`, and
    otherwise turns it into `undefined`. It is used for `console_url`, `report_url` and
    `search_url`.
- **Exports:**
  - every schema: `ServiceListSchema`, `CatalogSchema`, `LoadProfileListSchema`, `RunSchema`,
    `RunListSchema`, `RunResultsSchema`, `ServiceLeaderboardSchema`;
  - their output types;
  - `*Payload` input types, which the mock uses;
  - `isActive(status)`: true for `queued`, `starting`, `running` and `collecting`.

**`client.ts`:**
- **`apiBase()`:** `VITE_API_BASE`, or `new URL('api', document.baseURI).pathname`, without a
  trailing `/`.
- **`request(path, schema, init)`:**
  - Sends `Accept: application/json`.
  - On a non-OK response, it throws `ApiError("<status> <statusText> — <path>[: <detail>]", status,
    detail)`. `detail` is FastAPI's `detail`: a string, or a list rendered as `loc.slice(1).join('.')
    + ": " + msg`, joined with `; `.
  - It then validates the body with `safeParse`. On failure it throws
    `ApiError("Unexpected response from <path> — <path.of.field>: <message>; …")` with the first 3
    issues.
- **`getJSON` and `sendJSON`:** the POST sends a JSON body with `Content-Type`.

**Query keys:**

| Key | Value |
|---|---|
| services | `['services']` |
| catalog | `['catalog']` |
| load profiles | `['load-profiles']` |
| one leaderboard | `['leaderboard', serviceId, profile ?? null]` |
| all leaderboards | `['leaderboard']` |
| one service's runs | `['runs', serviceId]` |
| one run | `['run', id]` |
| results | `['run-results', id]` |

**Hooks:**

| Hook | Behaviour |
|---|---|
| `useServices()` | `GET /services` |
| `useCatalog()` | `GET /catalog` with `select: buildCatalogIndex` |
| `useLoadProfiles()` | `GET /load-profiles` |
| `useServiceLeaderboard(serviceId, profile)` | `GET /services/{id}/leaderboard[?profile=]` with `select: buildBoardIndex`. Enabled when there is a service. `placeholderData` keeps the previous data while another profile of the **same** service loads. |
| `useRuns(serviceId)` | `GET /runs?service_id=<id>&limit=200`, `staleTime: 0`. Polls every 2 s (`POLL_MS`) while any run is active, then stops. |
| `useRun(id)` | `GET /runs/{id}`, polled the same way |
| `useRunResults(id, ready)` | `GET /runs/{id}/results`. Enabled only when `ready`. `staleTime: Infinity`: results never change. |
| `useStartRun()` | mutation `POST /runs`. On success it invalidates that service's runs. |
| `useCancelRun()` | mutation `POST /runs/{id}/cancel`. On success it writes the returned run into the `run` query and invalidates the service's runs. |

**`useRefreshWhenFinished`:** inside `useRuns` and `useRun`, it remembers which run ids were active
on the previous data. When one of them is no longer active:
- it invalidates every leaderboard;
- from `useRun` only, it also invalidates the run list of each finished run's service.

Every id that goes into a path is passed through `encodeURIComponent`.

## 6. URL state (`shared/state/searchParams.ts`)

`SearchSchema` (zod) parses `location.search`. A malformed value falls back to `undefined`, or to
`[]` for `compare`.

| Key | Values | Meaning |
|---|---|---|
| `service` | non-empty string | the service. Absent means the first one, which the app then writes into the URL. |
| `tab` | `leaderboard`, `runs`, `catalog` | absent means leaderboard |
| `run` | string | the run open on the Runs tab |
| `new` | `1` | the new-run form is open |
| `profile` | string | the leaderboard's load profile. Absent means the backend's default. |
| `sort` | `<column id>:<asc\|desc>` | |
| `compare` | comma-separated row ids | |
| `lat` | `e2e_p95`, `e2e_p50`, `ttft_p50` | the insights latency metric. Absent means `e2e_p95`. |

- **`searchHref(patch, {reset})`:** the URL with the patch applied. `null` or `''` removes a key,
  arrays are comma-joined, and `reset` starts from an empty query.
- **`updateSearch(patch, {push, reset})`:** replaces the history entry by default. `push` adds a
  new entry, but not when the URL wouldn't change. It then notifies listeners.
- **`useSearch()`:** `useSyncExternalStore` over `location.search`. It also listens to `popstate`.

**Push (navigation):**
- switching service, with `reset`;
- changing tab, which also clears `run` and `new`;
- opening or closing a run;
- opening or closing the new-run form.

**Replace (view tweaks):** sort, compare, profile and `lat`. Changing the profile also clears
`compare`.

## 7. Derived data

- **`buildBoardIndex(board)`:**
  - `rows`: sorted by `perf.e2e_ms.p95` ascending, missing last;
  - `rowsById`;
  - `profiles`, and `profile` (the tab whose id is `board.profile`);
  - `organizations`: sorted;
  - `providers`: sorted, fixed rows only;
  - `palette`, `conditions`, `updatedAt`.
- **`buildOrgPalette(rows)`:**
  - Each organization's best (lowest) E2E p95 orders the organizations, with ties broken by name.
  - The first 8 get `series-1` … `series-8`; the rest share `series-other`.
  - `legend` lists the slotted organizations, plus `Other` when any were folded.
  - Color means the model's maker everywhere: the table, the scatter, the cost bars and the radar.
- **`model.ts`:**
  - `modelKey(r)` = `r.model_id`;
  - `displayName(r)` = `"<name> · <provider>"`, or just the name for the auto row;
  - `shortName(r)` = `short_name ?? name`;
  - `e2eP95(r)`;
  - `costPer1k(r)`: `per_1k_requests` if > 0, else undefined;
  - `blendedPrice(r)` = `(3 × input + output) / 4`;
  - `STATUS_LABEL`: queued "Queued", starting "Starting", running "Running", collecting
    "Collecting logs", completed "Completed", failed "Failed", cancelled "Cancelled".
- **`buildCatalogIndex(c)`:**
  - providers and LLMs sorted by name, with `providersById`, `llmsById` and `offeringsById`;
  - `offeringLabel(cat, id)` = `"<LLM name> · <provider name>"`, falling back to the raw id;
  - `serviceOfferings(cat, service)` filters to the allow-list, when there is one;
  - `isUsable(o)` = status isn't `unavailable`;
  - `groupOfferings(cat, offerings, 'provider' | 'llm')` returns groups sorted by label, with their
    items sorted by label. A provider group's detail is its kind label; an LLM group's detail is its
    organization;
  - `KIND_LABEL`: first_party "First-party API", cloud "Cloud platform", inference_host
    "Inference host".

## 8. Screens

### 8.1 Shell (`app/App.tsx`)
**The header:**
- A bottom border and a surface background. It is sticky (`top-0`, `z-30`) from the `sm`
  breakpoint up.
- Row 1:
  - the wordmark `▍LLM Service Benchmark`, in mono, semibold, `text-sm`, with the bar in accent;
  - a **Service** `SelectPill` (sans, min-width 16rem). Choosing a service calls
    `updateSearch({service}, {push, reset})`.
- Row 2: the section tabs, a `<nav aria-label="Service sections">` of real `<a href>` links:
  "Leaderboard", "Runs", "Models catalog".
  - The current tab has `aria-current="page"` and a 2px accent bottom border.
  - A plain left click is handled in place: it prevents the default and pushes `tabPatch`.
  - A click with Cmd, Ctrl, Shift or Alt is left to the browser, so the link opens in a new tab.

**The main area:** `max-w-page`, `px-4 sm:px-8`, `pt-10 pb-24`.

| Situation | Shows |
|---|---|
| The services list failed | the ErrorPanel "Couldn't load the list of services." with Retry |
| No services | "No services are set up yet." |
| Unknown `?service=` | "Unknown service `<id>`." |
| Normal | the service page, inside an ErrorBoundary keyed by service id |

- **The ErrorBoundary's fallback:** the ErrorPanel "This page couldn't be displayed." with the
  button "Reload data", which refetches every query and then resets the boundary.
- **The ErrorPanel:** `role="alert"`, a rounded-xl box with a `bad/40` border, the message in
  semibold, the detail in mono xs muted, and an accent button (default "Retry").

**The service page:**
- `h1` with the service name (`text-4xl` bold), then the description (`text-lg`, ink-2), then a mono
  xs muted line: `POST <endpoint_path> · <n> allowed models` (or `· any catalog model`), then
  `· last run <date>` when the leaderboard has `updatedAt`.
- Below that, the current tab. Only the Leaderboard tab waits for the leaderboard. Runs and Catalog
  work from the `Service` alone, so they stay usable when the leaderboard fails.
- **The Leaderboard tab:**
  - on error: the ErrorPanel "Couldn't load this service's leaderboard.";
  - while loading: a pulsing `h-96` placeholder (`aria-label="Loading leaderboard"`);
  - otherwise: `BoardProvider`, then the Leaderboard section, then (`mt-20`) the Insights section,
    lazy-loaded with a pulsing placeholder.
- `useRuns(service)` runs on every tab, so finished runs refresh the leaderboard anywhere.

### 8.2 Leaderboard section
- **`SectionHeader` "01 Leaderboard"**, with the intro: "Every provider × model this service has
  been benchmarked on, ranked on its latest completed run. Latency and volume come from BlazeMeter
  (client side); TTFT, tokens and error causes from the service's own Splunk logs. Click a row for
  details."
- **Load profile:** a `ChipRadioGroup`, one chip per tab, labelled `"<name> · <runs>"`.
  - The chip's title for presets: `"<n> virtual users, <duration> · <runs> completed runs"`.
  - For Custom: its description plus the run count.
  - Choosing one sets `profile` and clears `compare`.
- **Test conditions:** a `<details>` panel.
  - The summary line: "TEST CONDITIONS", then the profile name, `<vus> virtual users`, the
    duration, the date window and `from <client_region>`, joined with ` · `.
  - When open: a two-column `dl`:

    | Label | Value |
    |---|---|
    | Load profile | `<name> — <description>` |
    | Virtual users | |
    | Ramp-up | |
    | Duration | |
    | Think time | `<n>s between requests` |
    | Window | |
    | Load generator | |
    | Streaming | On / Off |
    | Stall threshold | `gap > <n> ms` |
    | Timeout | |
    | Runs on this board | |

  - The `notes` paragraph sits beside it.
- **Controls row** (wrapping):
  - a search input (placeholder "Search models, providers or makers…") that matches name,
    organization or provider;
  - the Chips "Open weights" and "Show maker", and "One row per model" (only with more than one
    provider);
  - a SelectPill "All makers";
  - a SelectPill "All providers" (only with more than one provider);
  - a **Compare** PopoverMenu (label `Compare · <n>` while engaged). Inside:
    - a filter input;
    - `CheckRow`s of `displayName`;
    - a footer: "Only compared models are shown" or "Pick models to show side by side", and
      "Clear".
  - a **Choose columns** PopoverMenu. Inside:
    - for each group, a group `CheckRow` (indeterminate when only part of the group is shown) and
      its columns;
    - a footer: "Defaults" and "Show all".
- **Rows:**
  1. While comparing: only the compared rows, ignoring the other filters. Otherwise: the filtered
     rows.
  2. Sorted (§8.3).
  3. With "One row per model" (and not comparing): the first row per `modelKey` under the current
     sort.
  4. The first 25 are shown. Below them, a dashed button "Show all <n> rows" / "Show top 25".
- **Footer line:** mono xs muted: `<shown> shown · <n> of <total> rows match`, then
  ` · best provider per model under the current sort` (one row per model) or ` · comparing`, then
  ` · shading marks the best 5 per column · latencies in ms · costs in USD at list price`.
- **No rows for this profile:** a dashed box. "No completed runs under the `<profile>` profile
  yet.", then "Start a BlazeMeter test against this service and the results land here.", and a
  pill button "Start a run" that pushes `{tab: 'runs', new: '1'}`.

### 8.3 Leaderboard table
**Columns** (`features/leaderboard/table.ts`). Each id is `perf:<key>`. "Better" sets the
first-click sort direction and which end gets shaded. Columns with better = null aren't shaded.

| Group | key | Label | Better | Source | Sort value | Cell | Hidden by default |
|---|---|---|---|---|---|---|---|
| Latency | e2e_p95 | E2E p95 · client (ms) | lower | BlazeMeter | e2e_ms.p95 | int (**primary**: bold, base size) | |
| Latency | e2e | E2E p50 / p99 · client (ms) | lower | BlazeMeter | e2e_ms.p50 | pair p50 / p99 | |
| Latency | ttft | TTFT p50 / p95 (ms) | lower | Splunk | ttft_ms.p50 | pair | |
| Latency | ttft_p99 | TTFT p99 (ms) | lower | Splunk | ttft_ms.p99 | int | yes |
| Latency | itl | ITL p50 / p95 (ms) | lower | Splunk | itl_ms.p50 | pair | |
| Latency | server_e2e | E2E p50 / p95 · server (ms) | lower | Splunk | server_e2e_ms.p50 | pair | yes |
| Latency | overhead | Network overhead p50 / p95 (ms) | lower | BlazeMeter | client_overhead_ms.p50 | pair | |
| Latency | stall_rate | Stall rate | lower | Splunk | stall_rate | percent | yes |
| Reliability | success_rate | Success rate | higher | BlazeMeter | success_rate | percent | |
| Reliability | requests | Requests | null | BlazeMeter | requests | int | |
| Reliability | errors | Errors | lower | BlazeMeter | errors | int | |
| Reliability | truncation | Truncated | lower | Splunk | truncation_rate | percent | yes |
| Throughput | throughput | Throughput (req/s) | higher | BlazeMeter | throughput_rps | decimal | |
| Throughput | tokens_per_min | Output tokens/min avg / peak | higher | Splunk | tokens_per_min.avg | compact pair | |
| Throughput | decode | Decode (tok/s, p50) | higher | Splunk | decode_tps_p50 | decimal | |
| Throughput | prefill | Prefill (tok/s) | higher | Splunk | prefill_tps | int | yes |
| Cost | cost_1k | Cost / 1K successful requests | lower | Splunk | costPer1k | formatCost1k | |
| Cost | tokens | Avg tokens in / out | null | Splunk | avg_input_tokens | compact pair | |
| Cost | blended_price | Blended $/1M (3:1) | lower | Catalog | blendedPrice | price | |
| Cost | cached_input_price | Cached input $/1M | lower | Catalog | cost.cached_input_per_million | price | yes |

The group order is Latency, Reliability, Throughput, Cost. Pair cells are formatted with `formatInt`
unless the table says otherwise.

**Sorting:**
- **Default:** `perf:e2e_p95:asc`. An unknown sort in the URL falls back to it.
- **Clicking a header:**
  - the same column flips direction;
  - a new column starts best-first: `asc` when lower is better, otherwise `desc`.
- **Order:**
  - rows missing the value sink, in both directions;
  - ties fall back to E2E p95 ascending, then to the id.

**Shading:**
- For each shaded column, the best 5 rows among **all** matching rows, by the better direction
  (missing values ignored), get an accent tint.
- The tint steps by rank: 26%, 19%, 13%, 8%, 4.5%, applied as `color-mix(in oklab, accent N%,
  transparent)`.

**Layout:**
- **Wrapper:** rounded-2xl, line border, `overflow-x-auto` only, never an inner vertical scroll.
  The table is `aria-label="Leaderboard"`, `border-separate border-spacing-0`.
- **Header row 1:**
  - an expand column (w-10, sticky left 0, z-30);
  - a "MODEL" column (sticky left-10, min-w-56, a right border, `rowSpan 2`);
  - one `colgroup` cell per run of same-group columns: mono micro, widest tracking, muted,
    uppercase, with a left border on every group after the first.
- **Header row 2:** a sort button per column:
  - mono xs, semibold, uppercase, right-aligned, max-w-44;
  - title `Source: <source>`;
  - `▲` or `▼` on the active column (invisible elsewhere);
  - the active column in accent;
  - `aria-sort` on the `th`.
- **Body rows:** clicking anywhere on a row toggles it open. The expand cell is a `▶` button
  (rotated and accent when open) with `aria-expanded`, labelled
  `"Show|Hide details for <name>[ via <provider>]"`.
- **The model cell:** a `th scope=row`, sticky, semibold.
  - The name, then badges: "random per request" (auto row, muted), "open" (open weights), and the
    status when not `available` (muted).
  - A second line in xs muted: `via <provider>` (or `<n> models`), then the maker when "Show maker"
    is on, then `run <date>`.
- **Cells:** right-aligned mono tabular. Missing values show as muted `—`. Each group start has a
  left border.
- **Empty:** "No models match these filters."
- **An expanded row:** a full-width cell holding a `sticky left-0` box sized to the scroll area's
  visible width (`useElementWidth`), which contains `OfferingDetail`.

**OfferingDetail** (the expanded row):
- **A meta line**, mono, `LABEL: value`:
  - fixed rows: From, Served by, Deployment (from the catalog), "$/1M in / cached / out", "Avg
    tokens in / out" (compact), "Cost / 1K successful requests";
  - the auto row: Routing "Each request goes to a model picked at random", "Models in pool", and
    Cost / 1K.
- **Three panels** (`lg:grid-cols-3`):
  1. **Capabilities**, or the **Routing mix** for the auto row. The routing mix uses `ShareBars`,
     colored by each offering's organization.
  2. **Errors by cause.**
  3. **TTFT by prompt length (p50).**
- **"Recent runs":** a table with the columns Run (an accent button that opens the run, plus
  "shown" next to the row's own run), Finished, E2E p95, TTFT p50 and Error rate.

**Shared panels** (`shared/perf/PerfPanels.tsx`):
- **`PanelTitle`:** mono sm, uppercase, accent.
- **`CapabilityBadges`:**
  - limits first: `<n> context`, `<n> max output`;
  - then the features "Streaming", "Tool calling", "JSON mode", "Vision", "Prompt caching" and
    "Batch API": green bordered when supported, muted and struck through when not, left out when
    unknown;
  - then `Regions: …`.
- **`ErrorCauses`:** labels "Rate limited (429)", "Server error (5xx)", "Timeout", "Dropped
  stream", "Refused (content filter)" and "Other", each with a `bad/70` bar scaled to the total
  error count. With no errors: "No errors recorded."
- **`TtftByInput`:** rows of `<tokens> in`, an `accent/70` bar scaled to the maximum, and
  `<ms> ms`. Too few events: "Not enough requests per prompt size."
- **`ShareBars`:** label, bar (share × 100%), and `<n>%`.
- **`StatusBadge`:**
  - a rounded-full bordered mono xs badge, with the label from `STATUS_LABEL`;
  - colors: queued is neutral; starting and collecting have an accent border; running has an
    accent border and tint; completed is green; failed is red; cancelled is muted;
  - starting, running and collecting show a pulsing dot;
  - running adds `<progress>%`.
- **`SourceBadge`:** "BlazeMeter · client side" or "Splunk · server side", mono micro, uppercase.
- **`KpiGrid`:** a grid of 2, 3 or 6 columns (by screen width) of label, big mono value and hint.
- **`FactList`:** a two-column `dl` that leaves out missing values.

### 8.4 Insights section (lazy-loaded, default export)
- **`SectionHeader` "02 Insights":** "A few analytical views — the headline is latency vs. cost,
  because the fastest deployment isn't always worth what it costs." The section isn't rendered
  when there are no rows.
- **A "Latency" ChipRadioGroup:** E2E p95 / E2E p50 / TTFT p50, stored in `lat`.

  | Metric | Full label | Value |
  |---|---|---|
  | `e2e_p95` | "E2E p95 · client" | `e2e_ms.p95` |
  | `e2e_p50` | "E2E p50 · client" | `e2e_ms.p50` |
  | `ttft_p50` | "TTFT p50 · server" | `ttft_ms.p50` |

- **Layout:** a grid (`xl`: 1.1fr / 0.9fr) of two Cards, then a full-width Card.

**Card "Latency vs. cost"**
- **Subtitle:** "`<label>` vs. cost per 1K successful requests (log). The **value frontier** is the
  lowest latency at each cost. Click a point to grey out its **kill zone** — everything slower and
  more expensive; click it again to clear."
- **Data:** rows that have both `costPer1k` and the metric. With none: "No rows report both cost
  and latency."
- **Geometry** (`scatterLayout.ts`, pure):
  - **Plot box:** height 440, margins `{top: 16, right: 24, bottom: 52, left: 64}`.
  - **x axis (log10 of cost):** padded by 6% of the span on each side (span 1 when every point has
    the same cost).
  - **y axis (linear):**
    - `step = niceStep((max − min) × 1.1 || |max| || 1)`;
    - `niceStep(span, 5)` = a 1, 2 or 5 × 10^k step giving about 5 intervals;
    - `y0 = max(0 if min ≥ 0, floor((min − step/4) / step) × step)`;
    - `y1 = ceil((max + step/4) / step) × step`.
  - **y ticks:** every step from `y0` to `y1`.
  - **x ticks:** 1, 2 and 5 × 10^d within range. Decades are major. Minor ticks get labels only if
    every tick gap is ≥ 40px.
  - **The frontier:** sort by cost ascending (ties: better value first), and keep each point that
    beats every cheaper one. Lower latency is better.
- **Drawing:**
  - grid lines with `stroke-grid`;
  - y labels `formatInt`, x labels `formatCostTick`, in mono 12px muted;
  - an x caption "Cost per 1K successful requests (log) →";
  - a rotated y caption "`<label>` (ms) — lower is better";
  - the frontier as a dashed (5 4), 2px accent polyline;
  - dots: radius 6, colored by organization, with a 2px surface stroke;
  - a selected or active dot gets a ring of radius 10 in ink.
- **The kill zone:**
  - Selecting a point draws a rect from the point to the top-right of the plot, filled ink at 4.5%
    with a line-strong stroke.
  - Every point that is slower **and** more expensive turns `dim`, and is drawn first so the live
    points stay on top.
  - The legend adds "Beaten by `<name>` (`<n>`)".
- **Labels:**
  - Labelled: the frontier points (lowest latency first) and the selected point.
  - Each label is the short name (12.5px, weight 600), plus `(<provider>)` (11px, weight 400) for
    fixed rows.
  - The labels are measured with canvas `measureText` in the same font, once
    `document.fonts.ready` resolves.
  - **Greedy placement:** try, in order, above-left, below-right, above-right, below-left, right
    and left of the point. Take the first spot that stays inside the plot and clear of every point
    (radius + 2 padding) and every earlier label. When none fits, the label is dropped.
- **Interaction:**
  - **Pointer:** one transparent overlay rect (the plot plus 14px) handles all of it:
    - pointer move: hover the nearest point within 14px;
    - click: toggle that point's selection, or clear the selection on empty space.
  - **Keyboard:** each dot is a `role="button" tabIndex=0` group with `aria-pressed` and the label
    `"<displayName>: <n> ms at <cost>"`. Enter or Space toggles it. The dots themselves have
    `pointer-events: none`.
  - **The tooltip** is a controlled `Tip`, open for the focused point, else the hovered one. It
    shows:
    - the org dot and display name;
    - the organization;
    - rows for the metric and "Cost / 1K successful requests";
    - "Click to show kill zone" / "Click to clear kill zone".
- **The legend** (below the chart): the organizations present, then "Value frontier" (a dashed
  accent key), then the kill-zone note.

**Card "Cost, ranked"**
- **Subtitle:** "List-price cost per 1K successful requests at this service's real token counts
  (failed requests that still used tokens included), cheapest first. Hover or focus a row for
  details."
- **Rows:**
  - By default, the 12 fastest rows (by E2E p95) that have a cost.
  - "Add a model…" (a SelectPill) adds any other row. A "Reset" link returns to the default set.
  - Sorted cheapest first.
- **Each row:**
  - org dot, then name, then ` · <provider>` (muted);
  - a bar in the organization's color, `max(1.2%, cost / max)` wide, on a surface-2 track;
  - the cost;
  - a "×" remove button, shown on hover or focus.
- **Tooltip:** "$ / 1M output", "Avg tokens in / out" and "E2E p95". With no rows: "No models to
  rank."

**Card "Performance profile"**
- **Subtitle:** "Add any 2–3 rows to compare TTFT, latency, decode speed, reliability and cost at a
  glance."
- **Axes**, in order: TTFT p50 (ms, lower), E2E p95 (ms, lower), Decode (tok/s, higher), Success
  rate (higher), Cost / 1K successful requests (lower). The short labels are TTFT, E2E, Decode,
  Success and Cost.
- **Normalisation:**
  - Each value's position on its axis runs from the board's worst row (`lo`) to its best (`hi`).
  - `t = (v − lo) / (hi − lo)` when higher is better, `(hi − v) / (hi − lo)` when lower is better.
  - The position is `12 + 88 × clamp(t)`. A missing value is 0; when `hi == lo` it is 100.
  - So bigger is better everywhere, and the worst row still shows a sliver.
- **Plot:**
  - rings at 20, 40, 60, 80 and 100;
  - the frame height is `min(width, 420) × 0.86`;
  - the first axis points up;
  - axis labels sit 18px outside the plot, with a `title` of `"<name> — <better> is better"`.
- **Picks:**
  - The first two rows to start with; at most 3.
  - Each pick keeps a line-style slot for its lifetime: solid, `6 4`, then `1.5 3.5`.
  - Each pick's polygon is filled in its organization's color at 10%, with a 2px stroke in the
    slot's dash pattern and a dot of radius 4 at each vertex.
  - Pick chips show the line key, `displayName` and "×".
  - "+ Add model…" is a SelectPill.
- **Caption:** "Compare any 2–3 rows · each axis scaled from the board's worst (center) to its best
  (edge)".
- **Table:** one row per axis and one column per pick. When there are two or more picks, the best
  value in each row is bold.

### 8.5 Runs tab (`features/runs/`)
The tab shows `RunDetail` when `?run=` is set, and otherwise the list.

**The list:**
- **`SectionHeader` "01 Runs":** "Each run is one BlazeMeter load test against `<service>`. Runs on
  a service queue up and go one at a time; results combine BlazeMeter's client-side view with the
  service's Splunk request logs."
- **The form:** shown (`NewRunForm`) when `?new=1` and the catalog and profiles have loaded.
  Otherwise a pill button "+ New run" pushes `new=1`. After starting:
  - `role=status` text: "Started run `<id>` — it runs in order below." (or "Started `<n>` runs —
    they run in order below.");
  - the filter resets to All;
  - the form closes.
- **"Show" filter** (ChipRadioGroup):
  - `All · <n>`;
  - `In flight · <n>` (the active runs);
  - Completed;
  - "Failed / cancelled".

  While any run is in flight, mono xs muted text says "Refreshing every 2 s while runs are in
  flight".
- **The table** (`aria-label="Runs"`):
  - **Columns:**
    - Status: a StatusBadge, plus a progress bar while running;
    - Run: the id as a mono button, with the label under it (xs, muted, truncated);
    - Model / routing: `routingLabel`, i.e. `"<LLM> · <provider>"` or `"Auto · <n> models"`;
    - Load: `<name> · <vus> VU · <duration>`;
    - Created;
    - Took: elapsed from start to end, or to now;
    - Requests, Errors (`headline.error_rate` as a percent), E2E p95, TTFT p50 and $ / 1K: the
      headline numbers;
    - Reports: links "BlazeMeter ↗" and "Splunk ↗" (`target=_blank`, `rel="noopener noreferrer"`),
      or `—`;
    - a Cancel link (red mono xs), shown while `canCancel`.
  - **Clicking a row** opens the run. This is one push; the id button doesn't add a second.
  - **Empty:** "No runs match."
  - The first 50 runs are shown, then "Show all `<n>` runs" / "Show latest 50".
  - `canCancel(run)` = the status is queued, starting or running, and `cancel_requested` is false.

**`NewRunForm`** (`aria-label="New run"`, a rounded-2xl panel with an `accent/40` border):
- **Header:**
  - the title "New run · `<service>`" and a "Close" link;
  - the copy "Starts a BlazeMeter load test against `POST <endpoint_path>`. The service logs every
    request to Splunk; results merge both once the test ends."
- **Routing** (ChipRadioGroup):
  - "Fixed models", title "One test per picked model";
  - "Auto routing", title "One test; each request goes to a random model from the pool".
- **The model picker** (`OfferingPicker`):
  - A PopoverMenu labelled "Models" (fixed) or "Routing pool" (auto), with `· <n>` when anything
    is selected. It opens aligned to the start.
  - Inside:
    - a "By provider" / "By LLM" toggle;
    - groups, each with a group CheckRow (indeterminate when part of it is selected, disabled when
      none of it is usable);
    - the items, showing `(degraded)` or `(unavailable)`, with unavailable items disabled;
    - a footer: "All usable (`<n>`)" and "Clear".
  - **Hint text** beside it:
    - fixed: "Pick by provider, or by LLM to compare one model across its providers.";
    - auto: "Each request is routed to a model picked uniformly at random from this pool."
  - The selected offerings are listed as removable chips.
  - The fixed pick starts empty. The auto pool starts as every usable offering of the service.
- **Load** (ChipRadioGroup):
  - each preset as `"<name> · <vus> VU · <duration>"` (title: its description), plus "Custom";
  - the default is `smoke`;
  - **Custom** shows four inputs: "Virtual users" (default 10), "Ramp-up (s)" (20), "Duration (s)"
    (120) and "Think time (s)" (1).
- **"Label (optional)":** at most 80 characters, placeholder "e.g. Before the prompt change".
- **Submit:** "Start run", "Start `<n>` runs", or "Starting…" while pending. Beside it:
  - "Runs one after another, so they never load the service at the same time." when n > 1;
  - then `"[<n> × ]<duration> of load at <vus> virtual users."`.
- **Client-side validation** (`buildRunPayload`, `parseCustomLoad`):
  - "Pick at least one model";
  - "Auto routing needs at least two models in the pool";
  - per custom field: `"<Field> must be a whole number"` (think time may be a decimal) or
    `"<Field> must be between <lo> and <hi>"`, with the same limits as the backend;
  - "Ramp-up must be shorter than the duration".

  The errors show after the first submit attempt. A backend refusal shows as "Couldn't start the
  run: `<detail>`".
- **The payload:**
  - `{service_id, routing: {mode: 'fixed', offering_ids} | {mode: 'auto', pool}}`;
  - plus `load_profile_id` or `load`;
  - plus the trimmed `label` (sliced to 80) when it isn't empty.

**`RunDetail`:**
- **Top:** "← All runs" (pushes `run: null`), then states:

  | State | Shows |
  |---|---|
  | loading | a pulsing placeholder |
  | 404 | "Run `<id>` doesn't exist." |
  | other error | "Couldn't load run `<id>`: …" |
  | the run belongs to another service | a note: "This run belongs to another service (`<id>`)." |

- **The header:**
  - `h2`: the label (or "Run"), then the id in mono muted;
  - the StatusBadge;
  - "Cancel run" while `canCancel`, or "Stopping…" while a cancel is pending and the run is still
    active;
  - the source links, pushed to the right;
  - a meta line: Routing, Load (`<name> · <vus> VU · ramp <d> · <d>`), Created, Took, Batch, and,
    when present, "BlazeMeter master" and "Splunk search".
- **The stepper:** five steps: "Queued", "BlazeMeter starting", "Load test running", "Collecting
  Splunk logs", "Results ready". Each is done (green border), current (accent, plus a progress bar
  on the running step), todo (muted) or failed (red).
  - **Failed:** the failed step is "BlazeMeter starting" if there is no master, "Load test running"
    if the master hadn't ended, else "Collecting Splunk logs".
  - **Cancelled with a master:** step 5 reads "Stopped early · partial results" and is done.
  - **Cancelled without one:** step 1 reads "Cancelled before start".
- **Failed:** an alert, "The run failed: `<error>`".
- **Active:** a dashed note:
  - queued: "Waiting for earlier runs on this service to finish…";
  - collecting: "The load test is done — pulling the summary from BlazeMeter and searching Splunk
    for this run's request logs…";
  - otherwise: "BlazeMeter is generating load. Results appear when the test ends."
- **Results:** fetched once the run is completed, or cancelled with a headline.
  - **A KpiGrid:**

    | KPI | Value | Hint |
    |---|---|---|
    | Requests | | "BlazeMeter hits" |
    | Error rate | | "`<n>` failed" |
    | E2E p95 | | "client side" |
    | TTFT p50 | | "server side" |
    | Throughput | `<n>/s` | "requests per second" |
    | Cost / 1K | | "at list price" |

  - **Card "Load test"** (SourceBadge BlazeMeter, "What the load generator saw, network
    included."):
    - the TimelineChart;
    - FactList: Hits / failed, Avg response, Min / max, p50 / p90, p95 / p99, Throughput, Max
      users, Duration;
    - "Errors by HTTP status", where `200` is shown as "200 (bad body)", or "No failed requests."
  - **Card "Service logs"** (SourceBadge Splunk, "`<n>` request events the service logged for
    this run."):
    - FactList: TTFT p50 / p95, TTFT p99, E2E p50 / p95, ITL p50 / p95, Decode p50, Prefill, Avg
      tokens in / out, "Output tokens/min … avg / peak", Stall rate, Truncated, Network overhead
      p50;
    - ErrorCauses and TtftByInput.
  - **Auto runs: Card "Routing mix"** ("Each request went to a model picked at random. Per-model
    numbers are server side."):
    - a table: Model · provider, Share (an `accent/70` bar scaled to the largest share, plus
      `n%`), Requests, Success, TTFT p50, E2E p95 · server, $ / 1K.

**`TimelineChart`** (height 260, margins `{14, 48, 36, 56}`):
- **Scales:**
  - x = time, 0 … last point + interval;
  - left y = ms, 0 … a nice ceiling of the largest p90 (or avg);
  - the users axis uses 92% of the height.
- **Layers:**
  - active virtual users as a step area (ink at 7%) behind everything;
  - ms grid lines and labels;
  - x labels `formatDuration`;
  - `ms` and `<max> VU` captions;
  - error ticks as red bars at the bottom, up to 18px tall, scaled to the most errors in any
    interval;
  - p90 (dashed 4 3, 1.5px) and avg (2px) accent lines through the interval midpoints.
- **Interaction:** each interval is a focusable transparent band with an `aria-label`. It shows a
  hover line and a Tip with Time (`from – to`), Virtual users, Hits, Errors, Avg response and p90
  response.
- **Legend:** "Avg response", "p90 response", "Active virtual users", "Errors". With no points:
  "No samples were recorded."

### 8.6 Catalog tab
- **`SectionHeader` "01 Catalog":** "`<p>` providers serve `<l>` LLMs as `<o>` offerings. An
  offering — one LLM at one provider — is what a run targets and what a leaderboard row ranks."
- **Controls:**
  - "Group by": "Provider → LLM" / "LLM → provider";
  - a Chip "Only `<service>`'s models", on by default.
- **The table** (`aria-label="Catalog"`):
  - one `rowgroup` header row per group: the label, the detail, and `· <n>`;
  - then one row per offering:

    | Column | Shows |
    |---|---|
    | LLM, or Provider | the name, plus an "open" badge (by provider). The second line is the organization (by provider) or the provider kind (by LLM). |
    | Deployment | mono |
    | Status | available green, degraded warn, unavailable red |
    | $/1M in / cached / out | |
    | Context | formatTokens |
    | Regions | |
    | Capabilities | the badges, without a title |

## 9. Mock API (`frontend/mock/`)

`plugin.ts` adds Vite middleware with both `configureServer` and `configurePreviewServer`. It serves
the `/api` routes from `world.ts`:
- **Delay:** every response is delayed 200 ms, so loading states are visible.
- **Errors:** they are `{detail}`, with the backend's status codes and messages. Unknown routes get
  404 "Not found". An unparsable body gets 400.

`createWorld(now = Date.now)`:
- **Data:** reads `fake_data/seed/*.json` directly, plus `mock/fixtures/leaderboards.json`
  (snapshots keyed `"<service>"` and `"<service>:<profile>"`).
- **Leaderboard:** the snapshot for the profile, else the service's default. When a profile was
  asked for but not snapshotted (e.g. `custom`), it returns the default board with that `profile`,
  no rows and no conditions.
- **Run lists:**
  - the seed runs plus the simulated runs, newest first;
  - filtered by `service_id` and `status`;
  - `limit` defaults to 100.
- **`createRuns`** applies the same validation as the backend.
  - **Ids:** `r_mock0000…`, with batch `b_mock<n>`.
  - **Queueing:** the runs of one service queue: each starts 200 ms after the previous one finishes
    collecting, and the first starts 600 ms from now at the earliest.
  - **Duration:** `clamp(duration_s × 25 ms, 4 s, 15 s)` of real time.
  - **The run's state is computed from the clock:**
    1. queued until its start;
    2. `starting` for 800 ms (progress 1);
    3. `running` with `progress = max(2, round(elapsed / duration × 90))` and fake BlazeMeter ids;
    4. `collecting` for 1200 ms (progress 92);
    5. then `completed` with a headline.
  - **Results:** copied from a seeded run of the same service and routing mode (the same offering
    when possible), with the new `run_id`.
- **`cancel`:**
  - before the load ends: mark the run cancelled, and cut its duration to now if it is already
    running, so it keeps partial results;
  - a seeded run: returned as it is.
- **`results`:**
  - 409 "No results yet (run is `<status>`)" unless the run is completed, or cancelled with a
    headline;
  - 404 for unknown runs.

`mock/world.test.ts` checks that the mock satisfies the zod contract and behaves like the backend.

## 10. End-to-end tests (`frontend/e2e/smoke.spec.ts`)

These run against the production bundle with the mock (§1):
1. The leaderboard loads, sorts, switches profile and keeps its view in the URL.
2. Insights render, and the kill zone toggles by keyboard and by mouse.
3. Starting a fixed batch: the runs queue, progress, finish, and show both sources.
4. An auto-routing run shows its routing mix. Switching service navigates, and Back restores the
   previous view.

AGENTS.md §11 lists the locator traps these tests have to avoid.
