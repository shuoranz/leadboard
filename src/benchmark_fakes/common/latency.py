"""The latency/error model behind the fake target services.

Pure functions over the JSON profiles in fake_data/profiles/, so the same model can generate
live traffic (target_service) and the checked-in historical runs (scripts/generate_seed_runs.py).
"""

import math
import random
from typing import Any

ERROR_HTTP = {"rate_limited": 429, "server_error": 503, "timeout": 504, "dropped_stream": 200, "refused": 400}


def _lognormal(rng: random.Random, mean: float, sigma: float) -> float:
    # Parameterized by the distribution's mean, not the underlying normal's.
    return rng.lognormvariate(math.log(mean) - sigma * sigma / 2, sigma)


def simulate_request(
    offering: dict[str, Any],
    service: dict[str, Any],
    defaults: dict[str, Any],
    concurrency: int,
    rng: random.Random,
) -> dict[str, Any]:
    """One request's server-side view: tokens, timings, outcome. Times in ms."""
    sigma = offering["jitter_sigma"]
    input_tokens = max(16, round(_lognormal(rng, service["input_tokens"]["mean"], service["input_tokens"]["sigma"])))
    wanted_output = max(4, round(_lognormal(rng, service["output_tokens"]["mean"], service["output_tokens"]["sigma"])))
    max_output = service["max_output_tokens"]
    output_tokens = min(wanted_output, max_output)
    finish_reason = "length" if wanted_output > max_output else "stop"
    cached = round(input_tokens * 0.6) if rng.random() < offering["cache_hit_rate"] else 0

    # Past saturation, queueing slows everything down; past the rate limit, 429s climb.
    over = max(0.0, concurrency / offering["saturation_vus"] - 1)
    load = 1 + over * defaults["load_degradation"]
    over_limit = max(0, concurrency - offering["rate_limit_vus"])

    ttft = (offering["ttft_base_ms"] + offering["ttft_per_1k_input_ms"] * (input_tokens - cached * 0.8) / 1000) * load
    ttft *= _lognormal(rng, 1.0, sigma)
    decode_tps = offering["decode_tps"] / math.sqrt(load) * _lognormal(rng, 1.0, sigma / 2)
    gen_ms = output_tokens / decode_tps * 1000
    stalled = rng.random() < offering["stall_probability"] * load
    max_gap = gen_ms / max(1, output_tokens - 1) * rng.uniform(2, 6)
    if stalled:
        max_gap = defaults["stall_threshold_ms"] * rng.uniform(1.05, 2.5)
        gen_ms += max_gap
    e2e = ttft + gen_ms + offering["server_overhead_ms"] * rng.uniform(0.6, 1.6)

    rates = dict(offering["error_rates"])
    rates["rate_limited"] += over_limit * defaults["rate_limit_slope"]
    error_type = None
    roll = rng.random()
    for kind, p in rates.items():
        if roll < p:
            error_type = kind
            break
        roll -= p

    event: dict[str, Any] = {
        "input_tokens": input_tokens,
        "cached_input_tokens": cached,
        "output_tokens": output_tokens,
        "finish_reason": finish_reason,
        "ttft_ms": round(ttft, 1),
        "e2e_ms": round(e2e, 1),
        "itl_ms": round(gen_ms / max(1, output_tokens - 1), 2),
        "max_itl_gap_ms": round(max_gap, 1),
        "decode_tps": round(decode_tps, 1),
        "status": "ok",
        "error_type": None,
        "http_status": 200,
    }
    if error_type:
        event.update(status="error", error_type=error_type, http_status=ERROR_HTTP[error_type], finish_reason="error")
        if error_type in ("rate_limited", "server_error", "refused"):
            # Rejected up front: no tokens streamed.
            event.update(
                ttft_ms=None,
                itl_ms=None,
                max_itl_gap_ms=None,
                decode_tps=None,
                output_tokens=0,
                e2e_ms=round(rng.uniform(20, 180) * load, 1),
            )
        elif error_type == "timeout":
            event.update(e2e_ms=float(defaults["timeout_ms"]), output_tokens=round(output_tokens * rng.uniform(0, 0.5)))
        else:  # dropped_stream: some tokens, then the connection closes.
            event.update(output_tokens=round(output_tokens * rng.uniform(0.1, 0.8)), e2e_ms=round(e2e * rng.uniform(0.3, 0.9), 1))
    return event


def pick_offering(pool: list[str], rng: random.Random) -> str:
    """Auto routing: a uniformly random choice per request."""
    return rng.choice(pool)
