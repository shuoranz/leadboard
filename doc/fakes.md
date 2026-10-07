# The fake upstream systems

BlazeMeter, Splunk, the DB and the services under test don't exist yet, so `src/benchmark_fakes/`
fakes all four. Each one is a separate FastAPI app with its own port. They keep their data and
canned responses as JSON under `fake_data/`.

## Shared code (`common/`)

- **`paths.py`:**
  - `data_dir()` = `$FAKE_DATA_DIR`, or `<repo>/fake_data`.
  - `time_scale()` = `$TIME_SCALE`, default `0.1`: real seconds per nominal second, so a 5-minute
    test takes 30 s.
- **`jsonstore.py`:**
  - `read_json(path, default)`;
  - `write_json(path, data)`: writes a temporary file and renames it over the target, under one
    `threading.Lock` per resolved path;
  - `append_jsonl(path, rows)` and `read_jsonl(path)`.
- **`templates.py`:** `render(service, name, **values)` reads `fake_data/<service>/<name>.json` on
  every call, so edits apply at once. It then fills the placeholders:
  - a string that is exactly `"{{name}}"` becomes the typed value (number, object, list, null);
  - `{{name}}` inside a longer string is interpolated, with a missing value read as `""`.
- **`http.py`:** `client(base_url)` keeps one `httpx.AsyncClient` per (base URL, event loop), with a
  30 s timeout and a 5 s connect timeout. `override(base_url, transport)` lets tests route a base
  URL to an in-process ASGI app.
- **`latency.py`:** the latency and error model (§5). It is shared with the seed generator.

## 1. DB service (:8101), `db/app.py`

A document store. Each collection is the JSON list `fake_data/db/<collection>.json`, cached in
memory, with one global lock.

**Seeding:** on the first request (or `POST /admin/reset`, which forces it), every
`fake_data/seed/*.json` that has no `db/` copy yet is copied there.

**Collection names:** must match `^[a-z][a-z0-9_]{0,63}$`, or the request gets 400.

| Method and path | Behaviour |
|---|---|
| `GET /health` | `{status, data_dir}` |
| `POST /admin/reset` | re-seeds every collection: `{seeded: [...]}` |
| `GET /collections` | the collection names |
| `GET /collections/{c}/docs?limit&offset` | `{items, total}` |
| `POST /collections/{c}/docs` | 201: the doc. The id is generated (12 hex characters) when absent. 409 if the id exists. |
| `GET /collections/{c}/docs/{id}` | the doc, or 404 |
| `PUT /collections/{c}/docs/{id}` | replace or insert. The `id` is forced to the one in the path. |
| `PATCH /collections/{c}/docs/{id}` | shallow merge (`{**old, **patch, id}`), or 404 |
| `DELETE /collections/{c}/docs/{id}` | 204, or 404 |
| `POST /collections/{c}/query` | body `{filter, sort: [[field, ±1]], limit?, offset}` → `{items, total}` |

**Query filter:** `{field: value}` matches by equality. `{field: {"$in": [...]}}` and
`{field: {"$ne": v}}` are also supported.

**Sort:**
- Sort fields apply in order, as several stable sorts run last key first.
- `None` sorts first in ascending order.
- Numbers (not booleans) compare as numbers, and everything else as strings.

The real DB service needs an `X-Api-Key` header. The fake doesn't check it.

## 2. BlazeMeter (:8102), `blazemeter/app.py`

A slice of the v4 REST API, plus a load engine.
- Every `/api/*` request needs an `Authorization` or `X-Api-Key` header; without one, 401.
- Responses use the templates in `fake_data/blazemeter/`, with the envelope
  `{api_version: 4, error, request_id, result}`.
- Errors render `error.json`: `{error: {code, message}, result: null}`.

| Method and path | Behaviour |
|---|---|
| `POST /api/v4/tests` | Needs `configuration.targetUrl` and `overrideExecutions[0]`, with concurrency ≥ 1 and `rampUp + holdFor > 0`; otherwise 400. Durations parse `90`, `"90s"`, `"5m"`, `"1m30s"` and `"1h"`. Test ids are `max(existing, 10 000 000) + random 1–97`. 201. |
| `POST /api/v4/tests/{id}/start` | Creates a master (same id scheme) and starts the engine task. 201 with `{id, testId, name, created, status: "CREATED", publicTokenUrl}`. `publicTokenUrl` = `$BLAZEMETER_PUBLIC_URL` (default `http://127.0.0.1:8102`) + `/app/masters/{id}`. |
| `GET /api/v4/masters/{id}/status` | `{id, testId, status, progress, created, started, ended, hits, currentConcurrency, reportUrl}`. The status moves `CREATED → INIT_SCRIPT → RUNNING → ENDED`. `progress` is `min(99, nominal elapsed / total × 100)`, and 100 once ended. |
| `POST /api/v4/masters/{id}/stop` | Asks the engine to stop (marks the master aborted). `result: [{id, status}]`. |
| `GET /api/v4/masters/{id}/reports/default/summary` | 409 until ended. Otherwise `result.summary[0]` = `{id: "ALL", lbl: "ALL", hits, failed, avg, min, max, tp50, tp90, tp95, tp99, hits_avg, failed_avg, maxUsers, duration, first, last, errorsByCode}`. |
| `GET /api/v4/masters/{id}/reports/timeline/kpis` | 409 until ended. Otherwise `{interval, kpis: ["ts","na","n","ec","t","t90"], labels, points}`. |
| `GET /app/masters/{id}` | A bare HTML report page, with HTML-escaped values. It's what the "BlazeMeter ↗" links open. |

**The engine** works in nominal time: real time = nominal × `TIME_SCALE`.
1. The master spends `2 × TIME_SCALE` real seconds in `INIT_SCRIPT`, then becomes `RUNNING`.
2. Every nominal second, it adds virtual users up to `ceil(concurrency × t / ramp_up)` (or all of
   them when there is no ramp-up).
3. Each virtual user loops until `t ≥ ramp_up + hold_for`, or until stopped:
   - POST to the target, with JSON `{"input": {"member_id": random}}` and the test's headers plus
     `X-Sim-Concurrency: <active VUs>`;
   - read the server time from `timing.e2e_ms` in the reply;
   - client response time = `server_ms + uniform(25, 70) + expovariate(mean 15)` ms;
   - `ok` = a 2xx reply with no `error` key;
   - if the request raised: `ok = false` with code 599;
   - record the sample `(t_sent, rt_ms, ok, http_code)`;
   - sleep `(rt / 1000 + think × uniform(0.7, 1.3)) × TIME_SCALE`.
4. When the test ends (or is stopped), the report is computed once:
   - percentiles use the same interpolation as [metrics.md §1](metrics.md);
   - `duration` = the last sample's send time;
   - `hits_avg = hits / duration`;
   - `errorsByCode` counts the failed samples by status code.
5. **The timeline:**
   - `interval = max(5, round(total / 60 / 5) × 5)` seconds;
   - each point is `{ts: bucket start, na: active VUs at the bucket middle (ramp-aware), n: hits,
     ec: errors, t: avg rt, t90: p90 rt}`.
6. The master becomes `ENDED`, and its tests and masters persist in `fake_data/blazemeter/state/`.
   - Finished engine tasks are forgotten.
   - After a restart, a master that was mid-run comes back as `ENDED` and aborted.

## 3. Splunk (:8103), `splunk/app.py`

The HTTP Event Collector (HEC) for ingest, plus the REST search-job API. Templates are in
`fake_data/splunk/`.

| Method and path | Behaviour |
|---|---|
| `POST /services/collector/event` | Needs `Authorization: Splunk <token>`, or 401 `{text: "Token is required", code: 2}`. The body is concatenated JSON objects or a JSON array. Every record needs an `event` object; `time` defaults to now. Records are appended to `fake_data/splunk/events/<run_id>.jsonl`, where the file name is the `run_id` with anything outside `[A-Za-z0-9_.-]` replaced by `_` (default `_unscoped`). Reply: `{text: "Success", code: 0, ackId}`. |
| `POST /services/search/jobs` | Form or JSON `{search}`. 201 `{sid}`. 400 on a missing or unparsable search. |
| `GET /services/search/jobs/{sid}` | `{entry: [{content: {sid, dispatchState, isDone, doneProgress, resultCount, eventSearch}}]}`. 404 for an unknown or expired sid. |
| `GET /services/search/jobs/{sid}/results?count&offset` | 204 until done. Then `{preview: false, init_offset, messages: [], fields: [{name}], results: rows}`. `count=0` means all rows. |
| `GET /en-US/app/search/search?q=` | A bare HTML results page, the first 500 rows, HTML-escaped. It's what the "Splunk ↗" links open. |

**The search language** is a small subset:
- An optional leading `search `, then space-separated `key=value` terms (`shlex` quoting).
- Anything after the first `|` is ignored.
- A term without `=` gives 400.
- Every term must match exactly.
- With a `run_id` term, only that run's file is read; otherwise every file is.

**Result rows:**
- Event fields become strings, with `None` as `""`.
- The HEC fields `index`, `sourcetype`, `source` and `host` are added.
- `_time` is ISO-8601 with milliseconds and `+00:00`.
- Rows are sorted by `_time`.

**Jobs:**
- A job is `QUEUED` for the first third of `$SPLUNK_JOB_DELAY_S` (default 0.6), then `RUNNING`, then
  `DONE` once the delay has passed. Its rows are computed at that point.
- Jobs expire `$SPLUNK_JOB_TTL_S` (default 600) seconds after they were last accessed.

## 4. Target services (:8104), `target_service/app.py`

The black-box services under test. Every service is served at `POST /svc/{service_id}/invoke`.

**Headers:**

| Header | Meaning |
|---|---|
| `X-Run-Id` | default `adhoc` |
| `X-Routing` | `fixed` (default) or `auto` |
| `X-Offering-Id` | fixed routing |
| `X-Model-Pool` | auto routing: comma-separated ids |
| `X-Sim-Concurrency` | default 1 |

**Per request:**
1. **Config:** load it from `seed/offerings.json`, `seed/services.json`,
   `profiles/offering_profiles.json` and `profiles/service_profiles.json`. It is re-read only when
   one of those files' modification time changes.
2. **Unknown service:** 404 `{error}`.
3. **RNG:** one `random.Random(run_id)` per run, so runs are reproducible. Only the 64 most recently
   used run RNGs are kept.
4. **Pick the offering:**
   - Auto routing: the pool is `X-Model-Pool`, or the service's usable offerings, filtered to ones
     the catalog knows. An empty pool gives 400. The offering is picked uniformly at random per
     request.
   - Fixed routing: `X-Offering-Id`. An unknown id gives 400.
5. **Simulate:** `simulate_request(...)` (§5). An `unavailable` offering always fails:
   `server_error`, 503, `e2e_ms` 40, no tokens.
6. **Log the event** ([contract.md §5](contract.md)) as a HEC record:
   `{time, host: "<service>-pod-<1..4>", source: "<service>:<endpoint_path>",
   sourcetype: "llm_api:request", index: "llm_api", event}`.
   - Records are buffered and flushed to `$SPLUNK_HEC_URL` (default `http://127.0.0.1:8103`) every
     `$HEC_FLUSH_S` (default 0.25 s), or when 200 are buffered.
   - Flush failures are ignored: logging never breaks the service.
7. **Reply** at once with the simulated timings. The status is the event's `http_status`.
   - Body: `{request_id, model: {provider, llm, offering_id}, usage: {input_tokens, output_tokens},
     timing: {ttft_ms, e2e_ms}}`.
   - Success adds `output` (a fixed sentence) and `finish_reason`. Failure adds
     `error: {type}`.
   - The load engine waits out `e2e_ms` itself, in scaled time.

`POST /admin/flush` flushes the buffer, and `GET /health` reports how many records are buffered.

## 5. Latency and error model (`common/latency.py`)

`simulate_request(offering_profile, service_traffic, defaults, concurrency, rng)` simulates one
request. All times are in ms.
- `lognormal(mean, σ)` is parameterised by the distribution's own mean:
  `rng.lognormvariate(ln(mean) − σ²/2, σ)`.
- Parameters, per offering: `ttft_base_ms`, `ttft_per_1k_input_ms`, `decode_tps`, `jitter_sigma`,
  `saturation_vus`, `rate_limit_vus`, `server_overhead_ms`, `stall_probability`, `cache_hit_rate`,
  `error_rates{rate_limited, server_error, timeout, dropped_stream, refused}`.
- Parameters, per service: `input_tokens{mean, sigma}`, `output_tokens{mean, sigma}`,
  `max_output_tokens`.
- Defaults: `timeout_ms` 30000, `stall_threshold_ms` 2000, `rate_limit_slope` 0.004,
  `load_degradation` 0.6.

The RNG calls below are listed in the order the code makes them. A different order produces
different numbers.

**1. Tokens**
- `input = max(16, round(lognormal(in.mean, in.sigma)))`
- `wanted = max(4, round(lognormal(out.mean, out.sigma)))`
- `output = min(wanted, max_output_tokens)`
- `finish_reason = "length"` if `wanted > max_output`, else `"stop"`
- `cached = round(input × 0.6)` if `rng.random() < cache_hit_rate`, else 0

**2. Load**
- `over = max(0, concurrency / saturation_vus − 1)`
- `load = 1 + over × load_degradation`
- `over_limit = max(0, concurrency − rate_limit_vus)`

**3. Timings**
- `ttft = (ttft_base + ttft_per_1k × (input − cached × 0.8) / 1000) × load × lognormal(1, σ)`
- `decode = decode_tps / sqrt(load) × lognormal(1, σ/2)`
- `gen = output / decode × 1000`
- `stalled = rng.random() < stall_probability × load`
- `max_gap = gen / max(1, output − 1) × uniform(2, 6)`. When stalled:
  `max_gap = stall_threshold × uniform(1.05, 2.5)`, and `gen += max_gap`.
- `e2e = ttft + gen + server_overhead × uniform(0.6, 1.6)`

**4. Errors**
- `rates = error_rates`, with `rates.rate_limited += over_limit × rate_limit_slope`.
- Draw one `roll = rng.random()` and walk the causes in order. The first cause with `roll < p` is
  the error; otherwise subtract `p` and go on. No match means success.

**5. The event**
- Success: `{input_tokens, cached_input_tokens, output_tokens, finish_reason, ttft_ms (1 dp),
  e2e_ms (1 dp), itl_ms = gen / max(1, output − 1) (2 dp), max_itl_gap_ms (1 dp), decode_tps (1 dp),
  status: "ok", error_type: null, http_status: 200}`.
- On error, set `status: "error"`, the `error_type`, `finish_reason: "error"` and the HTTP status:

  | Cause | HTTP | Changes |
  |---|---|---|
  | rate_limited | 429 | rejected up front: no TTFT, ITL, gap or decode; `output_tokens: 0`; `e2e = uniform(20, 180) × load` |
  | server_error | 503 | same as rate_limited |
  | refused | 400 | same as rate_limited |
  | timeout | 504 | `e2e = timeout_ms`; `output = round(output × uniform(0, 0.5))` |
  | dropped_stream | 200 | `output = round(output × uniform(0.1, 0.8))`; `e2e = round(e2e × uniform(0.3, 0.9), 1)` |

`pick_offering(pool, rng)` = `rng.choice(pool)`.
