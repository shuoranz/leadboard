# To do

Improvements to the LLM service benchmark, grouped by what they fix. Each item says what's wrong
today and what to build. Suggested order:

1. **Trustworthy ranking:** repeat runs with spread and ties (1.1), plus the warm-up cut-off (1.2).
   Without these, the leaderboard can rank offerings on noise.
2. **Rerun / clone** (2.1) and the **pre-run estimate** (2.2). Both are cheap and get used every day.
3. **Scheduled runs** (2.4), then **trends** (3.1) and **regression alerts** (3.2). Together they
   turn the tool from something you check by hand into a monitor.

Section 4 has to be done before going live, whatever else is picked.

---

## 1. Can the ranking be trusted?

- [ ] **1.1 Repeat runs, and show the noise.**
  - **Today:** each leaderboard row is one offering's single latest run, so one noisy run can swap
    two offerings that perform the same.
  - **Build:** let a run repeat N times. Show the median with a spread or confidence band, and mark
    rows as tied when their difference is within the noise instead of ranking them strictly.
- [ ] **1.2 Leave warm-up out of the stats.**
  - **Today:** [`aggregate.py`](../src/app_benchmark/runs/aggregate.py) counts every request,
    including those sent during ramp-up. Cold-start and ramp requests skew p95, and more so in
    short Smoke runs.
  - **Build:** only count the steady-state part of the test (after `ramp_up_s`). Say so in the
    test conditions.
- [ ] **1.3 Flag low Splunk coverage.**
  - **Today:** if fewer than 98% of BlazeMeter's requests have shown up in Splunk after 3 searches,
    the run still completes. The only trace is an event count on the run detail page.
  - **Build:** store coverage with the run and show it as a data-quality flag on the run and on its
    leaderboard row.
- [ ] **1.4 Make it visible when rows aren't comparable.**
  - **Today:** rows may come from different service versions, times of day or regions, and nothing
    says so.
  - **Build:** record the service version or deploy id with each run. Show each row's age (e.g.
    "38 days old"), and warn when rows compare different versions.

## 2. Running benchmarks

- [ ] **2.1 Rerun / clone a run.** Repeat a run with the same settings in one click. Add
  "re-run stale rows" for a whole load profile.
- [ ] **2.2 Estimate before starting.**
  - **Show:** total duration of the batch, where it lands in the queue, expected request count,
    BlazeMeter usage, and the LLM spend from token prices.
  - Pairs with the per-user quotas in 4.1.
- [ ] **2.3 A visible queue.** Show position and estimated start per service. Allow cancelling or
  reordering a whole batch, not only one run at a time.
- [ ] **2.4 Scheduled runs**, such as a nightly Baseline per offering. Trends (3.1) and regression
  alerts (3.2) depend on this.

## 3. Analysis

- [ ] **3.1 Trends over time.**
  - **Today:** each row already carries `recent_runs`, but they only show in the expanded row.
  - **Build:** a small trend line of p95 and error rate per offering, visible in the table.
- [ ] **3.2 Regression detection and alerts.** Compare each new run with the offering's previous
  run under the same profile. Flag changes larger than the noise (needs 1.1), and notify the service
  owner through Slack or email.
- [ ] **3.3 Run vs. run comparison.**
  - **Today:** the leaderboard can compare rows, but two runs can't be compared.
  - **Build:** a side-by-side view that diffs the metrics and overlays the timelines, for
    before/after checks.
- [ ] **3.4 Cross-service view:** how one offering performs across all services.
- [ ] **3.5 Export** the leaderboard and run results as CSV or JSON, for reports and spreadsheets.

## 4. Before going live

- [ ] **4.1 Sign-in, ownership and quotas.**
  - **Today:** the API has no authentication. Anyone who can reach it can start load tests against
    real services (up to 20 runs × 500 virtual users × 2 h per request) and cancel anyone's runs.
  - **Build:** put the API behind SSO, record who started each run ("started by"), and limit queued
    runs per user.
  - **Cross-site cancel:** once sign-in uses cookies, `POST /api/runs/{id}/cancel` can be triggered
    from another site, since it has no body. Require a custom header or check `Origin`.
- [ ] **4.2 Fail fast on missing configuration.** [`settings.py`](../src/app_benchmark/settings.py)
  defaults to the fake credentials and `http://127.0.0.1` URLs, so a deploy that misses an
  environment variable starts anyway. Outside fake mode, require these settings, and require https.
- [ ] **4.3 More than one API process.**
  - **Today:** runs are driven by in-memory queues in one process, so two API processes would both
    drive the same run.
  - **Build:** a lock per run in the DB, so only one worker takes it.
- [ ] **4.4 Splunk event limit.** Check whether your Splunk caps how many events one search returns,
  and warn when a run hits the cap.
- [ ] **4.5 Error references.**
  - **Today:** users only see short messages like "Splunk returned HTTP 503", and the details are in
    the API logs.
  - **Build:** add a short reference id to the message and write it to the log line too, so an
    operator can find the details.
- [ ] **4.6 Run list at scale.**
  - **Today:** the list loads at most 200 runs, and "Show all" only shows more of those 200.
  - **Build:** server-side paging, and filters by status, offering, label and date.

## 5. Smaller UX items

- [ ] A browser notification when a long batch finishes.
- [ ] Search runs by label.
- [ ] Link each offering on the Catalog page to its leaderboard row.
