# API contract

The full HTTP contract between the backend and the frontend. The code mirrors it twice: in
Pydantic (`src/app_benchmark/schemas.py`) and in zod (`frontend/src/api/types.ts`). When this file and
the code disagree, the code wins.

**Conventions**
- All paths are under `/api`. Request and response bodies are JSON.
- Optional fields are sent as `null`, never left out. The frontend turns `null` into `undefined`,
  and a `null` list into `[]`.
- Rates are 0–1 fractions, times are milliseconds, and prices are USD per 1M tokens.
- Timestamps are ISO-8601 UTC strings with second precision and a `Z` suffix, e.g.
  `2026-10-05T18:00:00Z`.
- Unknown fields in a request are ignored (Pydantic `extra="ignore"`).

---

## 1. Endpoints

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/health` | – | `{"status": "ok"}` |
| GET | `/api/services` | – | `Service[]`, in seed order. The first one is the app's landing page. |
| GET | `/api/services/{service_id}` | – | `Service`, or 404 `Unknown service` |
| GET | `/api/catalog` | – | `Catalog` |
| GET | `/api/load-profiles` | – | `LoadProfile[]` (the presets; "Custom" isn't one) |
| POST | `/api/runs` | `RunCreate` | 201 `Run[]`: one per fixed offering, or one auto run |
| GET | `/api/runs` | query: `service_id?`, `batch_id?`, `status?` (repeatable), `limit` (1–500, default 100) | `Run[]`, newest first: by `created_at` descending, then `id` descending |
| GET | `/api/runs/{run_id}` | – | `Run`, or 404 `Unknown run` |
| POST | `/api/runs/{run_id}/cancel` | no body | `Run`, as it is after the cancel (see §4) |
| GET | `/api/runs/{run_id}/results` | – | `RunResults`. While the run isn't `completed` or `cancelled`: 409 `No results yet (run is <status>)`. Finished but no results stored: 404. |
| GET | `/api/services/{service_id}/leaderboard` | query: `profile?` | `Leaderboard`, or 404 `Unknown service` |

### Ids
- Every id a request names must match `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$` (`ID_PATTERN`). This
  covers path parameters and the body fields `service_id`, `load_profile_id`, `offering_ids[]` and
  `pool[]`. Anything else is a 422 from validation, before any upstream call.
- The server generates new ids:

  | Id | Format |
  |---|---|
  | run | `r_` + 10 hex characters (`secrets.token_hex(5)`) |
  | batch | `b_` + 8 hex characters |
  | seeded run | `r_seed0000` … |
  | seeded batch | `b_seed0000` … |

### Errors
- **Validation errors** use FastAPI's default 422 shape:
  `{"detail": [{"loc": ["body", "routing", "pool"], "msg": "...", "type": "..."}]}`.
- **Handled errors** are `{"detail": "<message>"}` with 404, 409 or 422.
- **An upstream system (DB, BlazeMeter, Splunk) failed:** 502 with a short public message. It names
  only the system and the HTTP status: `"DB service is unreachable"`, `"Splunk returned HTTP 503"`,
  `"BlazeMeter sent an invalid response"` and similar. The full message, with paths and upstream
  response text, goes only to the API log.

### `POST /api/runs` validation, in order

| # | Check | Failure |
|---|---|---|
| 1 | Body schema, ids, `label` ≤ 80 chars, `offering_ids` ≤ 20 items, `pool` ≤ 100 items, `LoadIn` limits | 422 (validation) |
| 2 | The service exists | 404 `Unknown service` |
| 3 | `load_profile_id` names a preset | 422 `Unknown load profile '<id>'` |
| 4 | Either `load_profile_id` or `load` is given | 422 `Give load_profile_id or load` |
| 5 | Fixed routing: `offering_ids` (duplicates removed) isn't empty | 422 `Pick at least one model` |
| 6 | Fixed routing: every id is usable for the service | 422 `Not available for this service: <ids>` |
| 7 | Auto routing: every id in `pool` (default: every usable offering; duplicates removed) is usable | 422 `Not available for this service: <ids>` |
| 8 | Auto routing: the pool has at least 2 offerings | 422 `Auto routing needs at least two models in the pool` |

- **Usable offering:** listed in the service's `allowed_offering_ids` (or any catalog offering when
  that is `null`), present in the catalog, and `status != "unavailable"`. Degraded offerings are
  usable.
- **`load` from a preset:** `concurrency`, `ramp_up_s`, `duration_s` and `think_time_s` are copied
  from the preset, plus `profile_id` = the preset id and `name` = the preset name.
- **Custom `load`:** the body's values plus `profile_id: "custom"` and `name: "Custom"`.
- **Batch:** every run created by one request shares a `batch_id`. Each run is written to the DB
  with `status: "queued"` and then queued on its service's worker, in request order.

---

## 2. Types

Type notation: `?` means nullable (sent as `null` when unknown). `[]` is a list. `{k: v}` is an
object.

### Service
| Field | Type | Notes |
|---|---|---|
| id | str | |
| name | str | e.g. "Summarize Profile API" |
| description | str? | |
| endpoint_path | str | the service's own path, e.g. `/v1/profile/summarize` |
| allowed_offering_ids | str[]? | null = any catalog offering |

### Catalog = `{providers: Provider[], llms: Llm[], offerings: Offering[]}`

**Provider**

| Field | Type | Notes |
|---|---|---|
| id | str | |
| name | str | |
| kind | `"first_party" \| "cloud" \| "inference_host"` | |
| description | str? | |
| console_url | str? | |

**Llm**

| Field | Type | Notes |
|---|---|---|
| id | str | |
| name | str | |
| organization | str | the model's maker |
| family | str? | |
| open_weights | bool | default false |
| context_window | int? | |
| max_output_tokens | int? | |
| released | str? | a date |

**Offering**: one LLM at one provider. A run targets an offering, and a leaderboard row ranks one.

| Field | Type | Notes |
|---|---|---|
| id | str | `<provider_id>--<llm_id>` by convention |
| provider_id | str | |
| llm_id | str | |
| deployment | str | the provider's deployment or model name |
| regions | str[] | |
| status | `"available" \| "degraded" \| "unavailable"` | |
| prices | Prices | |
| capabilities | Capabilities | |

- **Prices:** `input_per_million?`, `cached_input_per_million?`, `output_per_million?` (all
  floats).
- **Capabilities:** `streaming?`, `tool_calling?`, `json_mode?`, `vision?`, `prompt_caching?`,
  `batch_api?` (all booleans).

### LoadProfile
| Field | Type | Notes |
|---|---|---|
| id | str | presets: `smoke`, `baseline`, `stress` |
| name | str | |
| description | str? | |
| concurrency | int | virtual users |
| ramp_up_s | int | |
| duration_s | int | total, including ramp-up |
| think_time_s | float | default 1.0 |

### RunCreate (request)
| Field | Type | Notes |
|---|---|---|
| service_id | Id | |
| routing | RoutingIn | |
| load_profile_id | Id? | a preset. Give this or `load`. |
| load | LoadIn? | custom load |
| label | str? | ≤ 80 chars |

- **RoutingIn:**
  - `mode`: `"fixed" | "auto"`.
  - `offering_ids`: `Id[]`, at most 20, default `[]`. Used by fixed routing.
  - `pool`: `Id[]?`, at most 100. Used by auto routing; `null` or empty means every usable offering.
- **LoadIn:**
  - `concurrency` 1–500;
  - `ramp_up_s` 0–3600;
  - `duration_s` 10–7200;
  - `think_time_s` 0–60, default 1.0;
  - and `ramp_up_s < duration_s`, or 422 "ramp_up_s must be shorter than duration_s".

### Run
| Field | Type | Notes |
|---|---|---|
| id | str | |
| batch_id | str | |
| service_id | str | |
| label | str? | |
| routing | `{mode, offering_id?, pool?}` | fixed: `offering_id` set, `pool: null`. Auto: `offering_id: null`, `pool` set. |
| load | `LoadIn + {profile_id, name}` | |
| status | RunStatus | |
| progress | int | 0–100 (see §4) |
| created_at | str | |
| started_at | str? | set when the run becomes `starting` |
| ended_at | str? | set when terminal |
| updated_at | str? | every write |
| error | str? | failed runs: a message written for users (§4) |
| cancel_requested | bool | |
| blazemeter | `{test_id?, master_id?, report_url?, status?}` | `{}` until the test exists. `report_url` is BlazeMeter's `publicTokenUrl`. `status` is the last master status seen. |
| splunk | `{sid?, search?, search_url?, events?}` | `{}` until collected. `search` = `search index=<index> run_id=<id>`. `search_url` = `<splunk_web_url>/en-US/app/search/search?q=<url-encoded search>`. |
| headline | Headline? | set on completion |

- **RunStatus:** `queued | starting | running | collecting | completed | failed | cancelled`.
  - Active (in flight): `queued`, `starting`, `running`, `collecting`.
  - Terminal: `completed`, `failed`, `cancelled`.
- **Headline:** `requests?`, `error_rate?`, `e2e_p95_ms?`, `ttft_p50_ms?`, `cost_per_1k?`. These
  are copied from the results (see [metrics.md §6](metrics.md)).

### RunResults
| Field | Type |
|---|---|
| run_id | str |
| blazemeter | `{summary: BlazeMeterSummary, interval_s: float?, timeline: TimelinePoint[]}` |
| splunk | `{events: int, overall: Perf, by_offering: OfferingBreakdown[]}` |
| perf | Perf (the merged view, which leaderboard rows use) |
| cost | Cost |

- **BlazeMeterSummary:**
  - `hits` int, `failed` int;
  - `error_rate?`, `avg_ms?`, `min_ms?`, `max_ms?`;
  - `p50_ms?`, `p90_ms?`, `p95_ms?`, `p99_ms?`;
  - `throughput_rps?`, `duration_s?`, `max_users?`;
  - `errors_by_code: {"<http status>": count}`.
- **TimelinePoint:** `t_s` (interval start, nominal seconds), `users`, `hits`, `errors`, `avg_ms?`,
  `p90_ms?`.
- **OfferingBreakdown:** `offering_id`, `provider_id?`, `llm_id?`, `share` (0–1 of the run's Splunk
  events), `perf: Perf` (server side only), `cost: Cost`. Sorted by share, largest first.

### Perf
Every field is nullable. `ttft_by_input` defaults to `[]`.

| Field | Type | Meaning |
|---|---|---|
| requests | int | |
| errors | int | |
| success_rate | float | |
| error_breakdown | `{rate_limited, server_error, timeout, dropped_stream, refused, other}` | counts |
| truncation_rate | float | successful requests that hit the max-output limit |
| ttft_ms | Pcts | time to first token |
| ttft_by_input | `{input_tokens, p50_ms}[]` | |
| itl_ms | Pcts | inter-token latency |
| stall_rate | float | |
| e2e_ms | Pcts | client side (BlazeMeter). Absent per model within an auto run. |
| server_e2e_ms | Pcts | server side (Splunk), all requests |
| client_overhead_ms | Pcts | client minus server: network, TLS, gateways |
| throughput_rps | float | |
| tokens_per_min | `{avg?, peak?}` | output tokens |
| decode_tps_p50 | float | |
| prefill_tps | float | |
| avg_input_tokens | float | |
| avg_output_tokens | float | |

- **Pcts:** `{p50?, p95?, p99?}`.
- **Cost:** `Prices + {per_request?, per_1k_requests?}`. Both are per *successful* request (see
  [metrics.md §5](metrics.md)).

### Leaderboard
| Field | Type | Notes |
|---|---|---|
| service | Service | |
| profiles | ProfileTab[] | the load-profile tabs |
| profile | str? | the selected profile id |
| rows | LeaderboardRow[] | sorted by `perf.e2e_ms.p95` ascending; rows without it last |
| conditions | RunConditions? | null when there are no rows |
| updated_at | str? | `ended_at` of the service's latest completed run |

- **ProfileTab:** a `LoadProfile` plus `runs` (the number of completed runs under it).
- **The Custom tab:** added when any completed run used a custom load:
  `{id: "custom", name: "Custom", description: "Runs with a custom load; may not be comparable.",
  concurrency: 0, ramp_up_s: 0, duration_s: 0, think_time_s: 0, runs: n}`.

**LeaderboardRow**

| Field | Type | Fixed row | Auto row |
|---|---|---|---|
| id | str | the offering id | `"auto"` |
| routing | `"fixed" \| "auto"` | | |
| name | str | the LLM's name | `"Auto routing"` |
| short_name | str? | null | `"Auto"` |
| provider | str | the provider's name | `"Random per request"` |
| provider_id | str | | `"auto"` |
| model_id | str | the LLM id, shared by every provider's row of that model | `"auto"` |
| organization | str | the LLM's maker | `"Auto routing"` |
| open_weights | bool | | false |
| status | str? | the offering's status | null |
| run_id | str | the run the row shows | |
| run_at | str? | that run's `ended_at` | |
| perf | Perf | the run's merged `perf` | |
| cost | Cost | the offering's prices, overlaid with the run's cost | the run's cost |
| capabilities | object? | Capabilities + `context_window`, `max_output_tokens`, `regions` | null |
| routing_mix | `{offering_id, share}[]`? | null | from `splunk.by_offering` |
| recent_runs | RecentRun[] | the latest 5 completed runs of this row under this profile, newest first | |

- **RecentRun:** `run_id`, `ended_at?`, `e2e_p95_ms?`, `ttft_p50_ms?`, `error_rate?`. These come
  from each run's `headline`.

**RunConditions:** how the shown runs were measured.
- From the runs the rows show:
  - `started_at?`: the earliest of them;
  - `ended_at?`: the latest of them;
  - `concurrency: int[]`: the distinct values, sorted;
  - `ramp_up_s?`, `duration_s?`, `think_time_s?`: from the first row's run;
  - `runs`: the number of rows' runs.
- From the settings: `client_region?`, `stall_threshold_ms?`, `timeout_ms?`.
- Fixed values: `streaming: true` and `notes`, which is: "Client-side latency and volume from
  BlazeMeter; TTFT, tokens and error causes from the service's own Splunk logs. Each row is that
  offering's latest completed run."

---

## 3. Stored documents (DB collections)

| Collection | Documents |
|---|---|
| `services`, `providers`, `llms`, `offerings`, `load_profiles` | the catalog, as in §2 |
| `runs` | `Run` exactly as in §2 |
| `run_results` | `RunResults` plus `id` (= the run id) |

The app reads and writes them only through the DB service's HTTP API (see [fakes.md §1](fakes.md)).

## 4. Run lifecycle fields

**Status and progress**

| Status | progress | Set when |
|---|---|---|
| queued | 0 | created |
| starting | 1 | the worker picks the run up (`started_at` set) |
| running | 2–90 | the BlazeMeter test is started. `progress = clamp(round(bm_progress × 0.9), 2, 90)`, written only when it changes. |
| collecting | 92 | the master reports `ENDED` |
| completed / cancelled | 100 | results saved (`ended_at`, `splunk`, `headline` set) |
| failed | unchanged | `error` and `ended_at` set |

**`error`:** the API only ever stores one of these:
- a reason written for users:
  - `Service <id> no longer exists`;
  - `BlazeMeter test <id> is still <status> <grace>s past its planned duration`;
  - `BlazeMeter recorded no requests: the test ended before generating any load`;
  - `Couldn't collect results after <n> attempts: <public upstream message>`;
- an upstream error's public message, e.g. `BlazeMeter is unreachable`;
- `Internal error (details are in the API logs)` for anything else.

**Cancel** (`POST /runs/{id}/cancel`):

| Run state | What happens |
|---|---|
| terminal or `collecting` | Nothing: the run comes back unchanged. Its results are kept. |
| `queued` | Becomes `cancelled` at once, with `cancel_requested: true`, `ended_at` set and `progress: 0`. |
| `starting` or `running` | `cancel_requested: true` is saved first. Then BlazeMeter `stop` is tried if a master exists. A failed stop is logged; the worker re-sends it. |

What the run ends as:
- **Cancelled before the test exists:** `cancelled`, and it is never started.
- **Stopped while running:** collected as usual, then saved as `cancelled` with its partial results
  and headline. A run that sent no requests at all is `cancelled` with no results.
- **The cancel arrives after the test ended:** the run completes normally. Whether the run was
  stopped early is decided once, at the moment the master reports `ENDED`, and stored as
  `stopped_early`.

## 5. Splunk event (one per request the service handles)

The target services log these fields. The real services must log the same ones.

| Field | Meaning |
|---|---|
| `run_id` | copied from the `X-Run-Id` request header |
| `request_id`, `service_id` | |
| `routing` | `fixed` or `auto` |
| `offering_id`, `provider`, `llm` | the model that served the request |
| `concurrency` | active virtual users |
| `input_tokens`, `cached_input_tokens`, `output_tokens` | |
| `finish_reason` | `stop`, `length` or `error` |
| `ttft_ms`, `e2e_ms`, `itl_ms`, `max_itl_gap_ms`, `decode_tps` | |
| `status` | `ok` or `error` |
| `error_type` | `rate_limited`, `server_error`, `timeout`, `dropped_stream`, `refused`, or null |
| `http_status` | |

Splunk returns every value as a string, and `null` as `""`.

## 6. Request headers BlazeMeter sends to the service

| Header | Value |
|---|---|
| `X-Run-Id` | the run id |
| `X-Routing` | `fixed` or `auto` |
| `X-Offering-Id` | fixed routing only |
| `X-Model-Pool` | auto routing with an explicit pool: comma-separated offering ids |

The fake BlazeMeter also adds `X-Sim-Concurrency` (the active virtual users), which drives the fake
service's load model.
