PY ?= .venv/bin/python

.PHONY: setup dev backend test lint reset-data seed-runs snapshot-fixtures

setup:            ## venv + Python deps + frontend deps
	python3 -m venv .venv
	.venv/bin/pip install -e '.[dev]'
	cd frontend && npm ci

dev:              ## API + fakes + Vite dev server (http://localhost:5176)
	$(PY) scripts/dev.py

backend:          ## API + fakes only
	$(PY) scripts/dev.py --no-web

test:             ## backend tests
	$(PY) -m pytest -q

lint:
	$(PY) -m ruff check src tests scripts
	$(PY) -m ruff format --check src tests scripts

reset-data:       ## throw away runs, logs and BlazeMeter state; the DB re-seeds on next start
	rm -rf fake_data/db fake_data/blazemeter/state fake_data/splunk/events

seed-runs:        ## regenerate fake_data/seed/runs.json + run_results.json
	$(PY) scripts/generate_seed_runs.py

snapshot-fixtures: ## refresh frontend/mock/fixtures from the real (fake-backed) API
	$(PY) scripts/snapshot_fixtures.py
