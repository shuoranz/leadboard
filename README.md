# LLM Service Benchmark

Benchmark the LLM-backed API services your teams own, **per service**, and compare the providers and models behind them.

- **Start runs from the UI.** A run is a BlazeMeter load test against a service (e.g. "Summarize Profile API"). Pick models from a two-layer **provider → LLM** catalog (one LLM is often served by several providers, so you can compare the same model across them), or pick **auto routing**, where the service sends each request to a random model from a pool. Picking several models creates a batch that runs one test at a time.
- **See results from both sides.** BlazeMeter reports what the load generator saw (hits, failures, response-time percentiles, a timeline). The service's own Splunk logs give TTFT, inter-token latency, tokens, error causes and, for auto runs, the per-model split.
- **Leaderboard per service.** Every provider × model, ranked on its latest completed run under a load profile (Smoke / Baseline / Stress). Grouped, sortable columns for latency, reliability, throughput and cost, plus insights: latency vs. cost (value frontier, kill zone), cost per 1K successful requests ranked, and a performance radar.

BlazeMeter, Splunk, the database and the services themselves are **faked** for now: four small HTTP services whose data and canned responses are plain JSON files in [`fake_data/`](fake_data/). The backend only talks to them over HTTP, so switching to the real systems is configuration (see [Going live](#going-live)).

## Architecture

```
Browser ──/api──▶ app_benchmark API (FastAPI :8000, also serves the built frontend)
                     ├──▶ DB service        :8101   document store; one JSON file per collection
                     ├──▶ BlazeMeter API    :8102   create/start tests, poll masters, read reports
                     └──▶ Splunk            :8103   search jobs over the services' request logs
BlazeMeter load engine ──HTTP──▶ target services :8104 (black boxes) ──HEC──▶ Splunk
```

A run goes **queued → starting → running → collecting → completed** (or failed / cancelled):

1. The API saves the run through the DB service.
2. It creates and starts a BlazeMeter test. The test carries `X-Run-Id` and the routing headers (`X-Routing`, `X-Offering-Id`, `X-Model-Pool`).
3. It polls BlazeMeter until the test ends. Brief BlazeMeter errors are retried; a test still running long past its planned duration fails the run.
4. It pulls BlazeMeter's summary and timeline, and searches Splunk for `run_id=<id>`. Splunk indexes with a lag, so it waits a moment first and searches again (up to 3 times) while fewer than 98% of BlazeMeter's requests have shown up. The test is over by now and its data stays in BlazeMeter and Splunk, so if either of them (or the DB) is briefly unreachable, collecting is retried with backoff for about 10 minutes rather than failing the run.
5. It aggregates both and saves the results. A test that sent no requests fails instead of completing.

Each service has its own queue. Unfinished runs resume after a restart. A run that fails while its test is still generating load stops that test first, so the next run in the queue never overlaps it.

Cancel works until the load test ends. A run cancelled before its test exists is never started, and a running one is stopped and keeps its partial results. Once the run is collecting, the test is over and its results are kept, so cancel is no longer offered; a cancel that arrives just as the test ends doesn't change that. The cancel is saved before BlazeMeter is asked to stop, and a failed stop is retried, so it's never lost.

## Quick start

```sh
make setup     # .venv + Python deps + frontend deps
make dev       # API + 4 fakes + Vite → http://localhost:5176
```

The fakes compress time (`TIME_SCALE=0.1`), so a 5-minute test finishes in about 30 s. The seed data includes a few weeks of runs, so the leaderboard isn't empty on first launch.

| Command | What it does |
|---|---|
| `make dev` / `make backend` | the whole stack / without Vite |
| `make test`, `make lint` | pytest (including an end-to-end run through all fakes in-process), ruff |
| `make reset-data` | drop live state (runs, logs, BlazeMeter state); the DB re-seeds on next start |
| `make seed-runs` | regenerate the historical runs in `fake_data/seed/` from the latency model |
| `make snapshot-fixtures` | refresh the frontend's mock fixtures and contract samples from the real API |

Frontend only (no Python), against the Vite mock that serves the same seed JSON: `cd frontend && npm install && npm run dev`.

## Fake data

Everything is JSON and meant to be edited:

| Path | Holds |
|---|---|
| `fake_data/seed/` | services (with allowed models), providers, LLMs, offerings (prices, status, capabilities), load profiles, historical runs and results |
| `fake_data/profiles/offering_profiles.json` | per offering: base TTFT, TTFT per 1K input tokens, decode speed, saturation and rate-limit points, error rates |
| `fake_data/profiles/service_profiles.json` | per service: prompt and response sizes |
| `fake_data/blazemeter/*.json`, `fake_data/splunk/*.json` | response templates (`"{{placeholder}}"` leaves are filled in) |
| `fake_data/db/`, `fake_data/splunk/events/<run_id>.jsonl`, `fake_data/blazemeter/state/` | live state (git-ignored) |

Make one offering slower in `offering_profiles.json`, rerun it, and watch its row move.

Names are fictional on purpose: real vendor names never appear next to fabricated numbers.

## Layout

```
src/app_benchmark/     backend: routers, httpx clients, orchestrator, pure aggregation + leaderboard logic
src/benchmark_fakes/   the fake DB, BlazeMeter, Splunk and target services
fake_data/             fake data and response templates (JSON)
tests/                 pytest
scripts/               dev runner, seed-run generator, fixture snapshotter
frontend/              React app (see AGENT.md for conventions)
```

Frontend stack: Vite, React 18, TypeScript, TanStack Query, zod (mini), Tailwind CSS v4, Radix UI primitives, hand-written SVG charts. Backend: FastAPI, httpx, Pydantic. The contract lives in [`schemas.py`](src/app_benchmark/schemas.py) and is mirrored in [`types.ts`](frontend/src/api/types.ts). Real responses from the backend are checked against the zod schemas in the frontend tests.

Shareable view state lives in the URL (`?service&tab&run&profile&sort&compare&lat`).

## Going live

Point the backend at the real systems with `BENCH_*` environment variables (see [`settings.py`](src/app_benchmark/settings.py)):

- `BENCH_BLAZEMETER_URL`, `BENCH_BLAZEMETER_KEY_ID`, `BENCH_BLAZEMETER_KEY_SECRET`, `BENCH_BLAZEMETER_PROJECT_ID`
- `BENCH_SPLUNK_URL`, `BENCH_SPLUNK_WEB_URL`, `BENCH_SPLUNK_TOKEN`, `BENCH_SPLUNK_INDEX`
- `BENCH_DB_URL`, `BENCH_DB_API_KEY`
- `BENCH_TARGET_URL_TEMPLATE`: where BlazeMeter sends traffic, e.g. `https://{service_id}.internal/{endpoint_path}`
- Tuning: `BENCH_POLL_RETRIES`, `BENCH_WAIT_GRACE_S` (how long past its duration a test may run), `BENCH_SPLUNK_SETTLE_S`, `BENCH_SPLUNK_ATTEMPTS`, `BENCH_SPLUNK_MIN_COVERAGE`, `BENCH_COLLECT_RETRIES`, `BENCH_COLLECT_BACKOFF_S`

For the merge to work, the services must:

- copy the `X-Run-Id` request header into every Splunk event;
- log the fields listed in [`aggregate.py`](src/app_benchmark/runs/aggregate.py), such as `ttft_ms`, `e2e_ms`, `input_tokens`, `output_tokens`, `status`, `error_type`, `offering_id`;
- honour the routing headers.

The BlazeMeter and Splunk clients use the documented v4 test/master/report endpoints and the REST search-job API. Expect to adjust field names to your BlazeMeter plan's report format.

## Build

```sh
cd frontend && npm run build   # type-checks, writes ../src/app_benchmark/static (served by the API at /)
```

The build replaces only `index.html` and `assets/` in that folder. **Any `VITE_` variable is embedded in the public bundle, so never put secrets in one.**
