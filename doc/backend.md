# Backend

How the API process works: the clients, the orchestrator and the settings. The package is
`src/app_benchmark/`.
- The data contract is in [contract.md](contract.md).
- The numbers are in [metrics.md](metrics.md).
- The fake upstream systems are in [fakes.md](fakes.md).

## 1. Shape

```
main.py        create_app(settings?, transports?) -> FastAPI
               - routers under /api: services, catalog, runs, leaderboard
               - GET /api/health
               - an exception handler for UpstreamError: 502 {"detail": e.public}, full error logged
               - lifespan: orchestrator.resume() on startup (a DbError is logged, not fatal);
                 shutdown cancels the workers and closes the clients
               - StaticFiles(static/, html=True) mounted at "/" AFTER the routers, when
                 settings.serve_static and static/index.html exists
deps.py        Container(settings, db, blazemeter, splunk, orchestrator), built once per app;
               routes get it through `Deps`. PathId = a path parameter checked against ID_PATTERN.
schemas.py     Pydantic models (the contract). Model base: extra="ignore".
api/*.py       thin routers; all logic is in runs/ and clients/
clients/       one httpx.AsyncClient each; the tests pass in-process transports
runs/          orchestrator.py, aggregate.py (pure), leaderboard.py (pure)
```

- `src/app_benchmark` never imports `src/benchmark_fakes`. The app only reaches the outside world
  through the three clients.
- It never calls the services under test directly. BlazeMeter does that.

## 2. Clients

Every client error subclasses `UpstreamError(RuntimeError)`.
- `str(e)` holds the details, for logs only.
- `e.public` is the message shown to users. When none is given, it is
  `"<system> returned HTTP <status>"` if there is a status, else `"<system> is unreachable"`.
- `e.status` is the upstream HTTP status, if any.
- The system names are `DB service`, `BlazeMeter` and `Splunk`.

`segment(value)` escapes one URL path segment with `quote(str(value), safe="")`. It raises
`ValueError` for `""`, `.` and `..`. Clients put ids into URLs only through it.

| Client | Auth | Timeout | Calls |
|---|---|---|---|
| `DbClient(base_url, api_key)` | header `X-Api-Key` | 10 s | `query(collection, filter, sort, limit, offset)` → `POST /collections/{c}/query`, returns `items`<br>`all(c)` → `GET /collections/{c}/docs`<br>`get(c, id)` → `GET …/docs/{id}`, `None` on 404<br>`create(c, doc)` → `POST …/docs`<br>`put(c, id, doc)`, `patch(c, id, patch)`<br>A 204 returns `None`. |
| `BlazeMeterClient(base_url, key_id, key_secret)` | HTTP Basic | 30 s | All paths are under `/api/v4`, with the envelope `{api_version, error, result}`. An error is raised when the status is an error or `error` is set; otherwise it returns `result`.<br>`create_test(name, project_id, target_url, headers, concurrency, ramp_up_s, hold_for_s, think_time_s)` → `POST /tests` with `{name, projectId, configuration: {type: "http", targetUrl, method: "POST", headers}, overrideExecutions: [{concurrency, rampUp: "<n>s", holdFor: "<n>s", thinkTime}]}`<br>`start(test_id)` → `POST /tests/{id}/start` (returns a master)<br>`status(master_id)` → `GET /masters/{id}/status`<br>`stop(master_id)` → `POST /masters/{id}/stop`<br>`summary(master_id)` → `GET /masters/{id}/reports/default/summary`, returns `result.summary[0]`<br>`timeline(master_id)` → `GET /masters/{id}/reports/timeline/kpis`<br>Ids go in as `int(id)`. |
| `SplunkClient(base_url, token)` | `Authorization: Bearer <token>` | 30 s | `create_job(search)` → `POST /services/search/jobs`, form `{search, output_mode: json}`, returns `sid`<br>`wait(sid, poll_s, timeout_s)` → polls `GET /services/search/jobs/{sid}` until `entry[0].content.isDone`. It raises on `dispatchState == "FAILED"` or after the timeout.<br>`results(sid)` → pages through `GET …/{sid}/results?output_mode=json&count=5000&offset=n` until a page comes back short<br>`search(search, poll_s, timeout_s)` = create, wait, results; returns `(sid, rows)` |

Each client turns transport errors (`httpx.HTTPError`), error statuses and non-JSON replies into its
own error class.

## 3. Orchestrator (`runs/orchestrator.py`)

The DB is the only source of truth: every state change is written to it at once.

### Queueing
- There is one `asyncio.Queue` and one worker task per service. A service runs one run at a time,
  so two tests never load it together.
- `enqueue(service_id, run_id)` starts the worker if it isn't running. The worker drains its queue,
  calls `_execute` for each run, and logs any crash without dying.
- `resume()` runs on startup. It re-queues every active run (`queued`, `starting`, `running`,
  `collecting`), oldest first. A run that already has a `master_id` skips `_start` and goes on
  polling BlazeMeter.
- In memory: `_cancel` (run ids with a cancel requested) and `_live` (run id → BlazeMeter master
  still generating load).

### `_execute(run_id)`
1. Load the run. Stop if it's missing or terminal.
2. If a cancel is wanted and no master exists: set `cancelled` (with `ended_at`) and stop.
3. If there's no master yet, `_start`. Then, if the status is `starting` or `running`, `_wait`.
   Then `_collect_with_retries`.
4. **On any exception** (except task cancellation):
   - log it;
   - stop the live load test, if any (`_stop_load`);
   - set `failed` with `error = public_error(e)` and `ended_at`.
5. Always clear the run from `_cancel` and `_live`.

`public_error(e)`:
- `UpstreamError` → `e.public`;
- `RunFailed` (the orchestrator's own reasons) → `str(e)[:500]`;
- anything else → `"Internal error (details are in the API logs)"`.

### `_start`
1. Patch the run to `starting`, with `started_at` and `progress 1`. If a cancel is wanted now, set
   `cancelled` and stop.
2. Load the service. If it's missing: `RunFailed("Service <id> no longer exists")`.
3. Build the headers:
   - always `X-Run-Id` and `X-Routing`;
   - fixed routing: `X-Offering-Id`;
   - auto routing with a pool: `X-Model-Pool`, comma-joined.
4. Build the target: `settings.target_url_template.format(service_id=…, endpoint_path=…)`.
5. Create the test:
   - name `"<service name> · <offering_id or 'auto'> · <load name> · <run id>"`;
   - `project_id` from the settings;
   - `hold_for = duration − ramp_up`;
   - concurrency, ramp-up and think time from the run's load.
6. Start it, and record the master in `_live`.
7. Patch the run to `running` with `blazemeter: {test_id, master_id, report_url: master.publicTokenUrl,
   status}`.

### `_wait`: poll until the test ends
- **Deadline:** `now + duration_s + wait_grace_s`.
- **Each loop:**
  1. **Cancel:** if a cancel is wanted and no stop has gone through yet, send `stop`.
     - Failures are counted, and more than `poll_retries` of them raise.
     - The cancel is seen two ways: from memory (`_cancel`), and from the `cancel_requested` flag
       on the copy of the run that each progress patch returns. So a cancel saved before a restart
       is honoured too.
  2. **Status:** fetch the status. A `BlazeMeterError` increments a failure counter (more than
     `poll_retries` in a row raises) and waits `poll_interval_s`. A success resets the counter.
  3. **`ENDED`:**
     - drop the run from `_live`;
     - decide `stopped_early = stop_sent or cancel wanted`, once, now;
     - patch the run to `collecting` with `progress 92` and `stopped_early`;
     - return.
  4. **Past the deadline:** raise
     `RunFailed("BlazeMeter test <id> is still <status> <grace>s past its planned duration")`.
  5. **Otherwise:**
     - `progress = clamp(round(bm.progress × 0.9), 2, 90)`;
     - patch only when it changes, along with `blazemeter.status`;
     - sleep `poll_interval_s`.

### `_collect_with_retries`
- Runs `_collect`. On an `UpstreamError` it retries up to `collect_retries` times, sleeping
  `min(collect_backoff_s × 2^(attempt−1), 300)` between attempts.
- After the last attempt:
  `RunFailed("Couldn't collect results after <n> attempts: <e.public>")`.
- It is safe to repeat, because results are stored under the run id.
- `RunFailed` and other exceptions are not retried.

### `_collect`
1. Fetch the BlazeMeter summary and timeline.
2. **`cancelled`:** `run.stopped_early` if present. Older runs don't have it, so for them, whether a
   cancel is wanted, read from a fresh copy of the run.
3. **No hits:** if `hits == 0`:
   - cancelled: set `cancelled` with `progress 100` and `ended_at`, and no results;
   - otherwise: `RunFailed("BlazeMeter recorded no requests: the test ended before generating any load")`.
4. **Splunk:** search `search index=<splunk_index> run_id=<run id>` (see "Splunk lag" below).
5. **Aggregate:** load the offerings and call `build_results(...)` ([metrics.md](metrics.md)).
6. **Results:** `PUT run_results/<run id>` with `{id: run id, **results}`.
7. **Run:** patch it to `cancelled` (if cancelled) or `completed`, with:
   - `progress 100` and `ended_at`;
   - `splunk: {sid, search, search_url, events}`;
   - `headline` ([metrics.md §6](metrics.md)).

**Splunk lag (`_search_logs`):** Splunk indexes with a delay. Up to `splunk_attempts` times:
1. sleep `splunk_settle_s`;
2. search;
3. stop once `len(events) ≥ hits × splunk_min_coverage`.

The last result is used either way.

### `cancel(run)`, from the API
- Terminal or `collecting`: return the run unchanged.
- Otherwise:
  - add the run to `_cancel`;
  - `queued`: patch it to `cancelled` (`cancel_requested`, `ended_at`, `progress 0`);
  - otherwise: patch `cancel_requested: true` first, then try `stop` if a master exists. A failure
    is only logged; `_wait` re-sends the stop.

## 4. Settings (`settings.py`, environment prefix `BENCH_`, reads `.env`)

| Setting | Default | Meaning |
|---|---|---|
| db_url / db_api_key | `http://127.0.0.1:8101` / `fake-db-key` | DB service |
| blazemeter_url / _key_id / _key_secret / _project_id | `:8102` / `fake-key-id` / `fake-key-secret` / `benchmark-leaderboard` | |
| splunk_url / splunk_web_url / splunk_token / splunk_index | `:8103` / `:8103` / `fake-splunk-token` / `llm_api` | `splunk_web_url` builds `search_url` |
| target_url_template | `http://127.0.0.1:8104/svc/{service_id}/invoke` | where BlazeMeter sends traffic |
| poll_interval_s | 2.0 | BlazeMeter status poll |
| poll_retries | 5 | consecutive failed polls or stops tolerated |
| wait_grace_s | 900 | how long past its duration a test may run |
| splunk_poll_interval_s / splunk_timeout_s | 0.5 / 120 | |
| splunk_settle_s / splunk_attempts / splunk_min_coverage | 2.0 / 3 / 0.98 | Splunk lag handling |
| collect_retries / collect_backoff_s | 6 / 10.0 | about 10 minutes of retries in all |
| client_region | `us-east (BlazeMeter cloud)` | shown in the test conditions |
| stall_threshold_ms / timeout_ms | 2000 / 30000 | |
| serve_static | true | serve the built frontend |

Ports without a host are on `http://127.0.0.1`.

## 5. Dev runner and scripts

- **`scripts/dev.py`** runs uvicorn for:

  | Service | Module | Port |
  |---|---|---|
  | DB | `benchmark_fakes.db.app:app` | 8101 |
  | BlazeMeter | `benchmark_fakes.blazemeter.app:app` | 8102 |
  | Splunk | `benchmark_fakes.splunk.app:app` | 8103 |
  | target services | `benchmark_fakes.target_service.app:app` | 8104 |
  | API | `app_benchmark.main:app` | 8000 |

  It starts the DB first and waits 0.8 s, so the API's `resume()` finds it. Then it runs
  `npm run dev` in `frontend/` with `VITE_API_PROXY=http://127.0.0.1:8000` (Vite on port 5176).
  `--no-web` skips Vite, and `--reload` reloads the Python services on code changes. If any child
  process exits, it stops the whole stack.
- **`scripts/generate_seed_runs.py`** regenerates the seed history (see
  [seed-data.md §5](seed-data.md)).
- **`scripts/snapshot_fixtures.py`** runs the API and all fakes in-process against a temporary copy
  of `fake_data/`, with `TIME_SCALE=0.003`. It writes:
  - `frontend/mock/fixtures/leaderboards.json`: every service × profile, plus each service's
    default, keyed `"<service>"` and `"<service>:<profile>"`;
  - `frontend/src/test/contract/*.json`: one real response per endpoint, including a live fixed
    batch and an auto run.
- **Makefile:**

  | Target | Does |
  |---|---|
  | `setup` | venv, `pip install -e '.[dev]'`, `npm ci` |
  | `dev` | the whole stack |
  | `backend` | the stack without Vite |
  | `test` | pytest |
  | `lint` | `ruff check` and `ruff format --check` |
  | `reset-data` | deletes `fake_data/db`, `fake_data/blazemeter/state` and `fake_data/splunk/events` |
  | `seed-runs` | regenerates the seed history |
  | `snapshot-fixtures` | refreshes the frontend fixtures |

- **`pyproject.toml`:**
  - Python ≥ 3.11;
  - dependencies `fastapi`, `uvicorn`, `httpx`, `pydantic`, `pydantic-settings`, `python-multipart`;
  - the `dev` extra: `pytest`, `pytest-asyncio`, `ruff`;
  - ruff: line length 140, target `py311`, rules `E F I UP B SIM`, with `B008` ignored (FastAPI
    declares parameters with `Query()` and `Body()` defaults);
  - pytest: `testpaths = ["tests"]`, `asyncio_mode = "auto"`.

## 6. Tests (`tests/`)

`conftest.py` sets up the `system` fixture:
- the whole system in one event loop: the API plus all four fakes over `httpx.ASGITransport`;
- a temporary copy of `fake_data/` (without live state), with `TIME_SCALE=0.005`, `HEC_FLUSH_S=0`
  and `SPLUNK_JOB_DELAY_S=0.02`;
- fast settings: `poll_interval_s=0.01`, `splunk_settle_s=0`, `collect_backoff_s=0`.

The fakes that call other fakes go through `benchmark_fakes.common.http.client()`, which the tests
point at in-process transports with `override()`.

The list of test cases is in [tests.md](tests.md).
