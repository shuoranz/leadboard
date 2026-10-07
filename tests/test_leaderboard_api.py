"""The leaderboard endpoint over the seeded history: what it loads, and runs missing their results."""

SERVICE = "summarize-profile"


async def board(api):
    res = await api.get(f"/api/services/{SERVICE}/leaderboard")
    assert res.status_code == 200, res.text
    return res.json()


async def test_loads_results_only_for_the_runs_it_shows(system, monkeypatch):
    db, asked = system.app.state.container.db, []
    original = db.query

    async def spy(collection, filter=None, **kw):
        if collection == "run_results":
            asked.extend(filter["id"]["$in"])
        return await original(collection, filter, **kw)

    monkeypatch.setattr(db, "query", spy)
    b = await board(system.client)
    completed = await original("runs", {"service_id": SERVICE, "status": "completed"})
    assert len(b["rows"]) > 1 and len(completed) > len(b["rows"])
    assert sorted(asked) == sorted(row["run_id"] for row in b["rows"])


async def test_a_run_missing_its_results_falls_back_to_the_previous_run(system, fake_clients):
    db = fake_clients.db
    row = (await board(system.client))["rows"][0]
    latest = (await db.get(f"/collections/runs/docs/{row['run_id']}")).json()
    results = (await db.get(f"/collections/run_results/docs/{latest['id']}")).json()
    # An older run of the same offering, then the latest run loses its results.
    older = {**latest, "id": "r_older", "ended_at": "2020-01-01T00:00:00Z"}
    assert (await db.post("/collections/runs/docs", json=older)).status_code == 201
    assert (await db.post("/collections/run_results/docs", json={**results, "id": "r_older", "run_id": "r_older"})).status_code == 201
    assert (await db.delete(f"/collections/run_results/docs/{latest['id']}")).status_code == 204

    same = next(r for r in (await board(system.client))["rows"] if r["id"] == row["id"])
    assert same["run_id"] == "r_older" and [h["run_id"] for h in same["recent_runs"]] == ["r_older"]
