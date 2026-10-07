# How results are computed

How a finished run's raw data becomes its `RunResults` ([contract.md §2](contract.md)). The code is
`src/app_benchmark/runs/aggregate.py`: pure functions, unit-tested in `tests/test_aggregate.py`.
Build it exactly like this, or the numbers won't match the seed data and fixtures.

There are two inputs, seen from two vantage points:
- **BlazeMeter (client side):** the report summary and the timeline, as the load generator saw
  them, network included.
- **Splunk (server side):** one event per request, logged by the service. Every value is a string,
  and `""` means null.

## 1. Basics

- **Parsing numbers:** `_num(v)` is `None` for `None`, `""`, unparsable values and NaN; otherwise it
  is `float(v)`. Missing numbers are skipped, never counted as 0.
- **Percentiles:** linear interpolation between the closest ranks, which is numpy's default. For
  sorted values `s` and fraction `p`:
  - `k = (len(s) − 1) × p`;
  - the result is `s[floor(k)] + (s[ceil(k)] − s[floor(k)]) × (k − floor(k))`, rounded to 1
    decimal;
  - an empty list gives `None`.
- **`pcts(values)`:** `{p50, p95, p99}`, or `None` for an empty list.
- **Rounding:**

  | Value | Rounded to |
  |---|---|
  | rates | 4 decimals |
  | latencies | 1 decimal |
  | `throughput_rps` from Splunk | 3 decimals |
  | token averages, prefill, tokens per minute | integers |
  | cost per request | 6 decimals |
  | cost per 1K requests | 4 decimals |

## 2. BlazeMeter view (`blazemeter_view`)

From the v4 summary record (`result.summary[0]`) and the timeline KPIs:

| Output | Source |
|---|---|
| `hits`, `failed` | `hits`, `failed` (ints, default 0) |
| `error_rate` | `failed / hits` (None when `hits` is 0) |
| `avg_ms`, `min_ms`, `max_ms` | `avg`, `min`, `max` |
| `p50_ms`, `p90_ms`, `p95_ms`, `p99_ms` | `tp50`, `tp90`, `tp95`, `tp99` |
| `throughput_rps` | `hits_avg` |
| `duration_s` | `duration` (nominal seconds) |
| `max_users` | `maxUsers` |
| `errors_by_code` | `errorsByCode` (or `{}`) |
| `interval_s` | the timeline's `interval` |
| `timeline[]` | each point `{ts, na, n, ec, t, t90}` becomes `{t_s, users, hits, errors, avg_ms, p90_ms}` |

## 3. Server view (`server_perf(events, duration_s, stall_threshold_ms)`)

This applies to any set of events: the whole run, or one offering within it.
- `n` = the number of events.
- `ok` = the events with `status == "ok"`.
- Error causes count the `error_type` of every event that isn't ok, with a missing type counted as
  `other`.

| Field | Formula |
|---|---|
| requests | `n` |
| errors | `n − len(ok)` |
| success_rate | `len(ok) / n` |
| error_breakdown | the count per cause for `rate_limited, server_error, timeout, dropped_stream, refused`, plus `other` |
| truncation_rate | the share of `ok` events with `finish_reason == "length"` |
| ttft_ms | `pcts` of every event's `ttft_ms` |
| ttft_by_input | see below |
| itl_ms | `pcts` of `itl_ms` |
| stall_rate | among events that have `max_itl_gap_ms`, the share above `stall_threshold_ms` (default 2000) |
| server_e2e_ms | `pcts` of `e2e_ms` over **all** events, matching BlazeMeter's view |
| decode_tps_p50 | the p50 of `decode_tps` |
| prefill_tps | the median of `input_tokens / (ttft_ms / 1000)` over events with both values and `ttft_ms > 0`, rounded |
| tokens_per_min | `avg` = (sum of `output_tokens` over all events) / (`duration_s` / 60), rounded. `peak` is filled in later (§4). |
| throughput_rps | `n / duration_s` |
| avg_input_tokens | (sum of `input_tokens` over all events) / `n` |
| avg_output_tokens | (sum of `output_tokens` over `ok` events) / `len(ok)` |

**`ttft_by_input`:**
- Events that have both `input_tokens` and `ttft_ms` go into the first bucket whose upper bound is
  above `input_tokens`. The bounds are `1 000, 2 000, 4 000, 8 000, 16 000, ∞`.
- Each bucket with at least 5 events gives one point: `{input_tokens: round(median input),
  p50_ms: median ttft, rounded to 1 decimal}`.
- Points are ordered by bucket.

`duration_s` is always BlazeMeter's **nominal** duration. The fakes compress time, so Splunk
timestamps can't be used for rates.

## 4. Merging (`build_results`)

1. **Server view:** `server = server_perf(all events, bm.duration_s, stall threshold)`.
2. **Per offering:** group the events by `offering_id` (missing: `"unknown"`), largest group first.
   Each group gives:
   - `offering_id`, `provider_id`, `llm_id` (from the catalog);
   - `share = len(group) / len(all events)`, to 4 decimals;
   - `perf = server_perf(group)`;
   - `cost = cost(group, offering prices)` (§5).
3. **Peak tokens per minute:** if `avg_output_tokens`, the timeline and `interval_s` all exist:
   - `busiest = max(hits − errors)` over the timeline points;
   - `tokens_per_min.peak = round(busiest × avg_output_tokens / (interval_s / 60))`.
4. **The merged `perf`**, which leaderboard rows use: start from every server-view field, then
   override these:

   | Field | Value |
   |---|---|
   | requests | BlazeMeter `hits` |
   | errors | BlazeMeter `failed` |
   | success_rate | `1 − bm.error_rate` |
   | e2e_ms | `{p50: p50_ms, p95: p95_ms, p99: p99_ms}` from BlazeMeter, or None when `hits` is 0 |
   | server_e2e_ms | the server view's |
   | client_overhead_ms | `{p50: max(0, bm.p50 − srv.p50), p95: max(0, bm.p95 − srv.p95)}`, to 1 decimal. None if either side is missing. |
   | throughput_rps | BlazeMeter `hits_avg` |

   Client overhead is a difference of percentiles, over all requests on both sides, so its p95 can
   come out below its p50. That's expected.
5. **The run's `cost`:**
   - Fixed run: the first (largest) offering group's cost. With no events, the cost of the fixed
     offering's prices with no traffic.
   - Auto run: total spend over every group whose offering has input and output prices, divided by
     the total successful requests in those groups (§5).

## 5. Cost

**Spend** (USD) over a set of events, at list prices:
- `None` unless the input and output prices both exist.
- **Not billed:** events that failed with `rate_limited`, `server_error` or `refused`. These were
  rejected before the model did any work.
- **Billed:** every other event, including timeouts and dropped streams, which still used tokens.
- Each billed event costs
  `((input − cached) × input_price + cached × (cached_price or input_price) + output × output_price) / 1e6`,
  with missing token counts read as 0.

**Cost of a set** = the prices (`input_per_million`, `cached_input_per_million`,
`output_per_million`) plus, for `ok` = the number of successful events:
- `per_request = spend / ok`, to 6 decimals;
- `per_1k_requests = per_request × 1000`, to 4 decimals;
- both `None` when spend is None or `ok` is 0.

The spend on billed failures is spread over the successes, so an unreliable offering costs more per
useful answer, not less.

**Derived in the UI:**
- **Blended price:** `(3 × input + output) / 4`, a 3:1 input:output mix.
- **Cost per 1K:** a value ≤ 0 is treated as unknown, because it can't sit on the scatter's log
  axis.

## 6. Headline (stored on the run document)

| Field | From |
|---|---|
| requests | `perf.requests` |
| error_rate | `1 − perf.success_rate`, to 4 decimals |
| e2e_p95_ms | `perf.e2e_ms.p95` |
| ttft_p50_ms | `perf.ttft_ms.p50` |
| cost_per_1k | `cost.per_1k_requests` |

## 7. Leaderboard selection

The code is `src/app_benchmark/runs/leaderboard.py`, also pure.

1. **Completed runs:** the service's runs with `status == "completed"`, sorted by `ended_at`
   descending. Failed and cancelled runs never appear.
2. **Tabs:**
   - every preset load profile, with `runs` = its number of completed runs;
   - plus the Custom tab when any completed run has `load.profile_id == "custom"`.
3. **Selected profile:**
   - the `profile` query parameter, if it names a tab;
   - otherwise the latest completed run's profile;
   - otherwise the first tab.
4. **Rows:**
   - Within the selected profile, the row key is the offering id (fixed runs) or `"auto"`.
   - The first, newest run per key is the row's run.
   - `recent_runs` lists that key's first 5 runs.
5. **Loading results:** only the rows' runs need results.
   - The API loads them with one `$in` query.
   - A run whose results are missing is dropped, and the selection repeats. That row then falls
     back to the offering's previous run.
6. **Skipped rows:** rows whose offering is no longer in the catalog are skipped.
7. **Sorting:** by `perf.e2e_ms.p95` ascending; rows without it last.
8. **Conditions:** computed from the rows' runs (see [contract.md §2](contract.md)).
