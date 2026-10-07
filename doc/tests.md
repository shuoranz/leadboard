# Test plan

Every automated test in the repo, by file. Rebuild them along with the code: they are the
definition of "done" for each layer. AGENTS.md §10 has the commands to run, and the expected
counts are in §3 below.

## 1. Backend (`tests/`, pytest + pytest-asyncio)

`conftest.py` provides:
- `fake_data`: a temporary copy of `fake_data/` without live state, with `TIME_SCALE=0.005`,
  `HEC_FLUSH_S=0`, `SPLUNK_JOB_DELAY_S=0.02`, and the fakes' in-memory state reset;
- `fake_clients`: direct httpx clients for each fake;
- `system`: the API plus all four fakes in one event loop over ASGI transports, with fast settings
  (see backend.md §6).


**`test_aggregate.py`**: pure aggregation (metrics.md)

- [ ] percentile interpolates
- [ ] server perf counts errors by cause and ignores blank numbers
- [ ] stall rate uses threshold
- [ ] ttft by input buckets need enough events
- [ ] cost bills cached input at cache rate
- [ ] build results merges client and server views
- [ ] auto run splits per offering and weights cost
- [ ] cost skips rejected requests and charges failures to the successes
- [ ] auto run cost is total spend per successful request

**`test_e2e.py`**: the whole system in-process: runs complete end to end

- [ ] fixed batch and auto run complete with both sources
- [ ] validation errors
- [ ] cancel queued and running
- [ ] catalog and services

**`test_fakes.py`**: each fake's API and behaviour (fakes.md)

- [ ] db crud query and persistence
- [ ] splunk ingest and search return strings
- [ ] search parser
- [ ] blazemeter requires auth and validates
- [ ] target service routes and rejects unknown
- [ ] db sorts numbers as numbers
- [ ] target service rereads config only when a file changes
- [ ] target service keeps only recent run rngs
- [ ] splunk search jobs expire after their last access

**`test_leaderboard.py`**: pure leaderboard selection (metrics.md §7)

- [ ] latest run per offering wins and rows sort by p95
- [ ] profile tabs default to latest run and custom appears only when used
- [ ] auto runs add one row with routing mix and failed runs are ignored
- [ ] only the latest runs results are needed

**`test_leaderboard_api.py`**: the leaderboard endpoint over the seeded history

- [ ] loads results only for the runs it shows
- [ ] a run missing its results falls back to the previous run

**`test_orchestrator.py`**: run lifecycle edge cases (backend.md §3)

- [ ] cancel while starting never creates the test
- [ ] cancel while the test is being created stops it once it exists
- [ ] cancel after the test ended keeps the results
- [ ] failure while running stops the load test
- [ ] brief status errors are retried
- [ ] a test that never ends fails past the deadline
- [ ] a test with no requests fails instead of completing
- [ ] finished masters are forgotten by the engine
- [ ] log search waits for splunk to catch up
- [ ] a cancel that lands after the test ended keeps it completed
- [ ] a failed stop is retried and the cancel is not lost
- [ ] collecting rides out a brief splunk outage
- [ ] collecting fails once the outage outlasts the retries
- [ ] a test with no requests is not retried
- [ ] splunk connection errors are splunk errors
- [ ] an unexpected failure is not described to users

**`test_security.py`**: ids in upstream URLs, request validation, upstream error details

- [ ] ids are escaped in db urls
- [ ] blazemeter ids must be numbers
- [ ] malformed ids in the path are rejected
- [ ] malformed ids and oversized pools in a new run are rejected
- [ ] upstream failures reach clients without their details

That is 49 test functions. Parametrised cases make pytest report more (57 at the time of writing).

## 2. Frontend (`frontend/`, Vitest + Testing Library, jsdom)

`src/test/render.tsx` provides `renderWithProviders` and `fetchStub`, and `src/test/fixtures.ts`
provides row, board, run and catalog builders. `src/test/contract/*.json` holds real backend
responses, which `types.test.ts` parses with the zod schemas.


**`mock/world.test.ts`**

- [ ] serves services, catalog and load profiles that match the contract
- [ ] serves a valid leaderboard for every service and profile
- [ ] serves every seeded run and its results
- [ ] has LLMs served by several providers
- [ ] queue per service and progress queued → running → collecting → completed
- [ ] validates like the backend and cancels

**`src/api/client.test.tsx`**

- [ ] the run list refreshes the leaderboard when one of its runs finishes
- [ ] one run’s page refreshes the leaderboard and that service’s run list

**`src/api/types.test.ts`**

- [ ] `<sample>` parses, once for each of the 8 contract samples: services, catalog, load profiles, runs, run, fixed results, auto results, leaderboard
- [ ] an auto run is split per offering
- [ ] turns nulls into undefined and null lists into []
- [ ] keeps only http(s) links into other systems
- [ ] rejects unknown statuses
- [ ] knows which statuses are in flight

**`src/app/App.test.tsx`**

- [ ] opens the first service and pins it in the URL
- [ ] the leaderboard refreshes when a run finishes, even while the Runs tab is closed
- [ ] switching service pushes history and drops the previous view params
- [ ] section tabs in the header are navigation: runs and catalog
- [ ] the current tab leads back to its top: Runs closes an open run
- [ ] a modified click is left to the browser (new tab), not handled in place
- [ ] reports a contract violation with the offending field instead of crashing
- [ ] runs and the catalog stay usable while the leaderboard fails to load
- [ ] says so when the URL names an unknown service

**`src/features/insights/scatterLayout.test.ts`**

- [ ] maps cost on a log scale inside the plot, cheaper to the left and better upward
- [ ] pads y to nice ticks and puts decade ticks on the x axis
- [ ] handles a single point and empty input
- [ ] places non-overlapping labels inside the area
- [ ] never places a label on top of another point
- [ ] drops a label that cannot fit anywhere
- [ ] keeps each point that beats every cheaper one
- [ ] handles lower-is-better metrics (latency)
- [ ] rounds to 1/2/5 × 10^k
- [ ] picks the closest point even when hit areas overlap
- [ ] returns nothing beyond the radius

**`src/features/leaderboard/LeaderboardSection.test.tsx`**

- [ ] ranks by client E2E p95, fastest first, one row per provider
- [ ] load-profile tabs show run counts and switch the profile in the URL
- [ ] sorting writes the sort to the URL; lower-is-better columns start ascending
- [ ] filters by provider and collapses to the best provider per model
- [ ] restores compare from the URL and ignores unknown ids
- [ ] expands a row into details with its recent runs, which link to the run page
- [ ] shows the auto row’s routing mix
- [ ] shows the test conditions
- [ ] offers to start a run when the profile has no results

**`src/features/leaderboard/table.test.ts`**

- [ ] ranks by client E2E p95 by default and namespaces ids
- [ ] says where each metric comes from
- [ ] groups contiguously, with dividers at each group start
- [ ] hides the more specialized columns by default
- [ ] formats pairs and missing values
- [ ] searches name, provider and maker
- [ ] filters by open weights, maker and provider
- [ ] sorts by a column and sinks missing values either way
- [ ] breaks ties by E2E p95
- [ ] keeps the best provider per model under the current sort
- [ ] first click goes best-first
- [ ] round-trips and falls back on unknown columns
- [ ] ranks the best n in the better direction, ignoring missing values

**`src/features/runs/RunsSection.test.tsx`**

- [ ] lists runs with status, progress and headline numbers
- [ ] opening a run from its id is one history entry, so Back returns to the list
- [ ] does not offer cancel once the load test has ended
- [ ] filters by status
- [ ] picks models by provider, skips unavailable ones, and posts one batch
- [ ] auto routing defaults the pool to every usable model; custom load is validated
- [ ] shows the backend’s reason when it refuses
- [ ] shows BlazeMeter and Splunk results side by side, and the routing mix for auto runs
- [ ] a queued run explains the wait and can be cancelled

**`src/features/runs/runs.test.ts`**

- [ ] fixed routing: one run per picked model, preset load
- [ ] auto routing with a custom load
- [ ] explains what is missing
- [ ] applies the backend limits
- [ ] labels routing
- [ ] measures elapsed time, live while in flight
- [ ] filters by status
- [ ] marks the current stage
- [ ] marks where a failure happened
- [ ] explains cancellation
- [ ] offers cancel until the load test ends, and only once

**`src/shared/board/boardIndex.test.ts`**

- [ ] orders rows fastest first, with unmeasured rows last, and indexes them
- [ ] lists makers and real providers (not the router) alphabetically
- [ ] colors organizations by their fastest row
- [ ] folds organizations past eight slots into Other

**`src/shared/board/model.test.ts`**

- [ ] shares a model key across providers and names the provider
- [ ] treats missing and non-positive costs as unknown (log scale)
- [ ] blends input and output prices 3:1

**`src/shared/catalog/catalogIndex.test.ts`**

- [ ] groups provider → LLM and LLM → provider
- [ ] labels offerings and falls back to the id
- [ ] limits to a service's allow-list; degraded is usable, unavailable is not

**`src/shared/lib/cn.test.ts`**

- [ ] keeps a custom size and a custom color together
- [ ] lets later classes override conflicting earlier ones

**`src/shared/lib/format.test.ts`**

- [ ] formats costs by magnitude
- [ ] formats log ticks without float noise
- [ ] formats scores, prices, integers and dates
- [ ] formats performance values
- [ ] formats signed percents and token counts
- [ ] formats durations, times and per-1K costs

**`src/shared/state/searchParams.test.ts`**

- [ ] parses every key
- [ ] drops malformed values instead of failing
- [ ] patches, serializes arrays and removes cleared keys
- [ ] reset keeps only the patch and push adds a history entry
- [ ] pushing the current URL again adds no history entry
- [ ] is the URL updateSearch would navigate to, without navigating

**`src/shared/ui/ErrorBoundary.test.tsx`**

- [ ] shows the fallback on a render error and recovers on reset

That is 108 test cases, counting each of the 8 contract samples separately.

**End to end** (`e2e/smoke.spec.ts`, Playwright, against the production bundle with the mock): 4
tests, listed in frontend-ui.md §10.

## 3. Expected counts (update these when you add tests)

| Suite | Command | Count |
|---|---|---|
| Backend | `make test` | 57 passed |
| Frontend unit | `npm test` | 108 passed |
| End to end | `npm run test:e2e` | 4 passed |

