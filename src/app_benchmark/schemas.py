"""The HTTP contract with the frontend (mirrored by frontend/src/api/types.ts).

Optional fields serialize as null. Rates are 0–1 fractions, times are milliseconds, prices are
USD per 1M tokens, timestamps are ISO-8601 UTC.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

RunStatus = Literal["queued", "starting", "running", "collecting", "completed", "failed", "cancelled"]
ACTIVE_STATUSES = ("queued", "starting", "running", "collecting")
TERMINAL_STATUSES = ("completed", "failed", "cancelled")

#: Every id a request may name (services, runs, offerings, load profiles).
ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$"
Id = Annotated[str, Field(pattern=ID_PATTERN)]


class Model(BaseModel):
    model_config = ConfigDict(extra="ignore")


# ---- services -------------------------------------------------------------------


class Service(Model):
    """An LLM-backed API service: the unit a benchmark targets."""

    id: str
    name: str
    description: str | None = None
    endpoint_path: str
    #: Offerings this service may call; null = every offering in the catalog.
    allowed_offering_ids: list[str] | None = None


# ---- catalog: provider -> LLM ----------------------------------------------------------------


class Prices(Model):
    input_per_million: float | None = None
    cached_input_per_million: float | None = None
    output_per_million: float | None = None


class Capabilities(Model):
    streaming: bool | None = None
    tool_calling: bool | None = None
    json_mode: bool | None = None
    vision: bool | None = None
    prompt_caching: bool | None = None
    batch_api: bool | None = None


class Llm(Model):
    id: str
    name: str
    organization: str
    family: str | None = None
    open_weights: bool = False
    context_window: int | None = None
    max_output_tokens: int | None = None
    released: str | None = None


class Provider(Model):
    id: str
    name: str
    kind: Literal["first_party", "cloud", "inference_host"]
    description: str | None = None
    console_url: str | None = None


class Offering(Model):
    """One LLM served by one provider: the unit a run targets and a leaderboard row ranks."""

    id: str
    provider_id: str
    llm_id: str
    deployment: str
    regions: list[str] = []
    status: Literal["available", "degraded", "unavailable"]
    prices: Prices
    capabilities: Capabilities


class Catalog(Model):
    providers: list[Provider]
    llms: list[Llm]
    offerings: list[Offering]


class LoadProfile(Model):
    id: str
    name: str
    description: str | None = None
    concurrency: int
    ramp_up_s: int
    duration_s: int
    think_time_s: float = 1.0


# ---- runs -----------------------------------------------------------------------------------


class RoutingIn(Model):
    mode: Literal["fixed", "auto"]
    #: fixed: one run is created per offering (a batch).
    offering_ids: list[Id] = Field(default_factory=list, max_length=20)
    #: auto: the offerings to route between; default every usable offering of the service.
    pool: list[Id] | None = Field(default=None, max_length=100)


class LoadIn(Model):
    concurrency: int = Field(ge=1, le=500)
    ramp_up_s: int = Field(ge=0, le=3600)
    duration_s: int = Field(ge=10, le=7200)
    think_time_s: float = Field(default=1.0, ge=0, le=60)

    @model_validator(mode="after")
    def _ramp_fits(self):
        if self.ramp_up_s >= self.duration_s:
            raise ValueError("ramp_up_s must be shorter than duration_s")
        return self


class RunCreate(Model):
    service_id: Id
    routing: RoutingIn
    #: A preset; or omit it and give `load` for a custom profile.
    load_profile_id: Id | None = None
    load: LoadIn | None = None
    label: str | None = Field(default=None, max_length=80)


class RunRouting(Model):
    mode: Literal["fixed", "auto"]
    offering_id: str | None = None
    pool: list[str] | None = None


class RunLoad(LoadIn):
    profile_id: str
    name: str


class BlazeMeterRef(Model):
    test_id: int | None = None
    master_id: int | None = None
    report_url: str | None = None
    status: str | None = None


class SplunkRef(Model):
    sid: str | None = None
    search: str | None = None
    search_url: str | None = None
    events: int | None = None


class Headline(Model):
    requests: int | None = None
    error_rate: float | None = None
    e2e_p95_ms: float | None = None
    ttft_p50_ms: float | None = None
    cost_per_1k: float | None = None


class Run(Model):
    id: str
    batch_id: str
    service_id: str
    label: str | None = None
    routing: RunRouting
    load: RunLoad
    status: RunStatus
    #: 0–100.
    progress: int = 0
    created_at: str
    started_at: str | None = None
    ended_at: str | None = None
    updated_at: str | None = None
    error: str | None = None
    cancel_requested: bool = False
    blazemeter: BlazeMeterRef = BlazeMeterRef()
    splunk: SplunkRef = SplunkRef()
    headline: Headline | None = None


# ---- results --------------------------------------------------------------------------------


class Pcts(Model):
    p50: float | None = None
    p95: float | None = None
    p99: float | None = None


class ErrorBreakdown(Model):
    rate_limited: int = 0
    server_error: int = 0
    timeout: int = 0
    dropped_stream: int = 0
    refused: int = 0
    other: int = 0


class TokensPerMin(Model):
    avg: float | None = None
    peak: float | None = None


class TtftAtInput(Model):
    input_tokens: float
    p50_ms: float


class Perf(Model):
    requests: int | None = None
    errors: int | None = None
    success_rate: float | None = None
    error_breakdown: ErrorBreakdown | None = None
    truncation_rate: float | None = None
    ttft_ms: Pcts | None = None
    ttft_by_input: list[TtftAtInput] = []
    itl_ms: Pcts | None = None
    stall_rate: float | None = None
    #: Client-side (BlazeMeter) end-to-end; absent per model within an auto run.
    e2e_ms: Pcts | None = None
    #: Server-side (Splunk) end-to-end, all requests.
    server_e2e_ms: Pcts | None = None
    #: Client minus server e2e: network, TLS and gateways.
    client_overhead_ms: Pcts | None = None
    throughput_rps: float | None = None
    tokens_per_min: TokensPerMin | None = None
    decode_tps_p50: float | None = None
    prefill_tps: float | None = None
    avg_input_tokens: float | None = None
    avg_output_tokens: float | None = None


class Cost(Prices):
    per_request: float | None = None
    per_1k_requests: float | None = None


class BlazeMeterSummary(Model):
    hits: int
    failed: int
    error_rate: float | None = None
    avg_ms: float | None = None
    min_ms: float | None = None
    max_ms: float | None = None
    p50_ms: float | None = None
    p90_ms: float | None = None
    p95_ms: float | None = None
    p99_ms: float | None = None
    throughput_rps: float | None = None
    duration_s: float | None = None
    max_users: int | None = None
    errors_by_code: dict[str, int] = {}


class TimelinePoint(Model):
    t_s: float
    users: int
    hits: int
    errors: int
    avg_ms: float | None = None
    p90_ms: float | None = None


class BlazeMeterResults(Model):
    summary: BlazeMeterSummary
    interval_s: float | None = None
    timeline: list[TimelinePoint] = []


class OfferingBreakdown(Model):
    offering_id: str
    provider_id: str | None = None
    llm_id: str | None = None
    #: Share of the run's requests, 0–1.
    share: float
    perf: Perf
    cost: Cost


class SplunkResults(Model):
    events: int
    overall: Perf
    by_offering: list[OfferingBreakdown]


class RunResults(Model):
    run_id: str
    blazemeter: BlazeMeterResults
    splunk: SplunkResults
    perf: Perf
    cost: Cost


# ---- leaderboard ----------------------------------------------------------------------------


class RecentRun(Model):
    run_id: str
    ended_at: str | None = None
    e2e_p95_ms: float | None = None
    ttft_p50_ms: float | None = None
    error_rate: float | None = None


class LeaderboardRow(Model):
    #: The offering id, or "auto" for the auto-routing row.
    id: str
    routing: Literal["fixed", "auto"]
    name: str
    short_name: str | None = None
    provider: str
    provider_id: str
    #: The LLM id, shared by every provider's row of the same model.
    model_id: str
    organization: str
    open_weights: bool = False
    status: str | None = None
    run_id: str
    run_at: str | None = None
    perf: Perf
    cost: Cost
    capabilities: dict | None = None
    #: auto row only: share of requests per offering.
    routing_mix: list[dict] | None = None
    recent_runs: list[RecentRun] = []


class ProfileTab(LoadProfile):
    runs: int = 0


class RunConditions(Model):
    started_at: str | None = None
    ended_at: str | None = None
    client_region: str | None = None
    concurrency: list[int] = []
    ramp_up_s: int | None = None
    duration_s: int | None = None
    think_time_s: float | None = None
    streaming: bool | None = None
    stall_threshold_ms: int | None = None
    timeout_ms: int | None = None
    runs: int = 0
    notes: str | None = None


class Leaderboard(Model):
    service: Service
    profiles: list[ProfileTab]
    profile: str | None = None
    rows: list[LeaderboardRow]
    conditions: RunConditions | None = None
    updated_at: str | None = None
