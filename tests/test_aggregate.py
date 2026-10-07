from app_benchmark.runs.aggregate import build_results, cost, headline, percentile, server_perf, ttft_by_input


def ev(**kw):
    """A Splunk result row: every value a string, like the real thing."""
    base = {
        "status": "ok",
        "input_tokens": "1000",
        "cached_input_tokens": "0",
        "output_tokens": "100",
        "ttft_ms": "200",
        "e2e_ms": "1200",
        "itl_ms": "10",
        "max_itl_gap_ms": "40",
        "decode_tps": "100",
        "finish_reason": "stop",
        "offering_id": "p--a",
        "error_type": "",
    }
    return {**base, **{k: str(v) for k, v in kw.items()}}


def test_percentile_interpolates():
    assert percentile([], 0.5) is None
    assert percentile([10], 0.95) == 10
    assert percentile([1, 2, 3, 4], 0.5) == 2.5
    assert percentile(list(range(101)), 0.95) == 95


def test_server_perf_counts_errors_by_cause_and_ignores_blank_numbers():
    events = [
        ev(),
        ev(),
        ev(status="error", error_type="rate_limited", ttft_ms="", output_tokens="0"),
        ev(status="error", error_type="timeout"),
        ev(finish_reason="length"),
    ]
    p = server_perf(events, duration_s=60, stall_threshold_ms=2000)
    assert p["requests"] == 5 and p["errors"] == 2
    assert p["success_rate"] == 0.6
    assert p["error_breakdown"]["rate_limited"] == 1 and p["error_breakdown"]["timeout"] == 1
    assert p["truncation_rate"] == round(1 / 3, 4)
    assert p["ttft_ms"]["p50"] == 200  # the blank TTFT is skipped, not counted as 0
    assert p["throughput_rps"] == round(5 / 60, 3)


def test_stall_rate_uses_threshold():
    p = server_perf([ev(max_itl_gap_ms=2500), ev(), ev(), ev()], 60, stall_threshold_ms=2000)
    assert p["stall_rate"] == 0.25


def test_ttft_by_input_buckets_need_enough_events():
    events = [ev(input_tokens=500, ttft_ms=100)] * 6 + [ev(input_tokens=5000, ttft_ms=400)] * 2
    assert ttft_by_input(events) == [{"input_tokens": 500, "p50_ms": 100}]


def test_cost_bills_cached_input_at_cache_rate():
    prices = {"input_per_million": 2.0, "cached_input_per_million": 0.5, "output_per_million": 10.0}
    c = cost([ev(input_tokens=1000, cached_input_tokens=400, output_tokens=100)], prices)
    # 600 * 2 + 400 * 0.5 + 100 * 10 = 2400 per 1M
    assert c["per_request"] == 0.0024
    assert c["per_1k_requests"] == 2.4
    no_cache = cost([ev(input_tokens=1000, cached_input_tokens=400)], {**prices, "cached_input_per_million": None})
    assert no_cache["per_request"] == round((1000 * 2 + 100 * 10) / 1e6, 6)


BM_SUMMARY = {
    "hits": 4,
    "failed": 1,
    "avg": 1300,
    "min": 1000,
    "max": 1600,
    "tp50": 1300,
    "tp90": 1500,
    "tp95": 1550,
    "tp99": 1590,
    "hits_avg": 0.4,
    "duration": 10,
    "maxUsers": 2,
    "errorsByCode": {"429": 1},
}
TIMELINE = {
    "interval": 5,
    "points": [{"ts": 0, "na": 1, "n": 1, "ec": 0, "t": 1000, "t90": 1000}, {"ts": 5, "na": 2, "n": 3, "ec": 1, "t": 1400, "t90": 1600}],
}
OFFERINGS = {
    "p--a": {"provider_id": "p", "llm_id": "a", "prices": {"input_per_million": 1.0, "output_per_million": 2.0}},
    "q--a": {"provider_id": "q", "llm_id": "a", "prices": {"input_per_million": 3.0, "output_per_million": 4.0}},
}


def test_build_results_merges_client_and_server_views():
    run = {"id": "r1", "routing": {"mode": "fixed", "offering_id": "p--a"}}
    events = [ev(e2e_ms=1000), ev(e2e_ms=1200), ev(e2e_ms=1100), ev(status="error", error_type="rate_limited")]
    res = build_results(run=run, bm_summary=BM_SUMMARY, bm_timeline=TIMELINE, events=events, offerings=OFFERINGS, stall_threshold_ms=2000)
    perf = res["perf"]
    assert perf["requests"] == 4 and perf["errors"] == 1 and perf["success_rate"] == 0.75
    assert perf["e2e_ms"] == {"p50": 1300, "p95": 1550, "p99": 1590}  # BlazeMeter: client side
    assert perf["server_e2e_ms"]["p50"] == 1150  # Splunk: server side
    assert perf["client_overhead_ms"]["p50"] == 150
    assert perf["tokens_per_min"]["peak"] == round(2 * 100 / (5 / 60))
    assert res["blazemeter"]["timeline"][1] == {"t_s": 5, "users": 2, "hits": 3, "errors": 1, "avg_ms": 1400, "p90_ms": 1600}
    assert res["cost"]["per_request"] is not None
    assert headline(res)["e2e_p95_ms"] == 1550


def test_auto_run_splits_per_offering_and_weights_cost():
    run = {"id": "r2", "routing": {"mode": "auto", "pool": ["p--a", "q--a"]}}
    events = [ev(offering_id="p--a")] * 3 + [ev(offering_id="q--a")]
    res = build_results(run=run, bm_summary=BM_SUMMARY, bm_timeline=TIMELINE, events=events, offerings=OFFERINGS, stall_threshold_ms=2000)
    mix = {b["offering_id"]: b["share"] for b in res["splunk"]["by_offering"]}
    assert mix == {"p--a": 0.75, "q--a": 0.25}
    per = {b["offering_id"]: b["cost"]["per_request"] for b in res["splunk"]["by_offering"]}
    assert res["cost"]["per_request"] == round(0.75 * per["p--a"] + 0.25 * per["q--a"], 6)
