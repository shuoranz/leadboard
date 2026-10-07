"""Configuration. Every external system is a URL + credential, so the fakes can be swapped for
the real BlazeMeter / Splunk / DB service without code changes. Env prefix: ``BENCH_``."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="BENCH_", env_file=".env", extra="ignore")

    db_url: str = "http://127.0.0.1:8101"
    db_api_key: str = "fake-db-key"

    blazemeter_url: str = "http://127.0.0.1:8102"
    blazemeter_key_id: str = "fake-key-id"
    blazemeter_key_secret: str = "fake-key-secret"
    blazemeter_project_id: str = "benchmark-leaderboard"

    splunk_url: str = "http://127.0.0.1:8103"
    splunk_web_url: str = "http://127.0.0.1:8103"
    splunk_token: str = "fake-splunk-token"
    splunk_index: str = "llm_api"

    # Where BlazeMeter sends traffic. {service_id} and {endpoint_path} are substituted.
    target_url_template: str = "http://127.0.0.1:8104/svc/{service_id}/invoke"

    poll_interval_s: float = 2.0
    splunk_poll_interval_s: float = 0.5
    splunk_timeout_s: float = 120.0

    # Reported with every run as its test conditions.
    client_region: str = "us-east (BlazeMeter cloud)"
    stall_threshold_ms: int = 2000
    timeout_ms: int = 30000

    # Serve the built frontend from src/app_benchmark/static.
    serve_static: bool = True
