# BUG-012 — A dead simulator task still let the service report itself healthy

English · [繁體中文](BUG-012-dead-simulator-task-still-reported-a-healthy-service.zh-TW.md)

| Field | Value |
|---|---|
| **Bug ID** | BUG-012 |
| **Status** | Fixed |
| **Severity** | Medium |
| **Priority** | Medium |
| **Component** | Background task lifecycle and health probe (`lifespan` and `/health` in `main.py`, `data_simulator` in `simulator.py`) |
| **Environment** | Any deployment started through the app lifespan, which includes the container start command in `Dockerfile` |
| **Found by** | Codex whole-project review, 2026-08-19 |
| **Reporter** | Sheng-Sheng Tsai |
| **Fix commit** | `159f54d24558d9c415212a77a87637bd86c4ff13`. As with BUG-010 and BUG-011, this report was written *after* the fix — noted here rather than left implicit |

## Summary

Almost everything that moves in this system hangs off one background task: the
simulator writes a sensor sample every second, advances the device state machine,
and carries a test into its next phase. Its main loop is the `while True` in
`simulator.py`, and the loop body has no outer exception guard — so any exception
that escapes the inner `except` blocks ends the task, and nothing restarts it.

The rest of the system never finds out. The API still answers, pages still load,
and `/health` still returns `{"status": "ok"}` — because that is all it ever did,
unconditionally. Temperatures freeze at their last value and schedules stop
advancing, while the probe reports a healthy service.

Worse, the exception never reaches the log **while the service is running** (see
Evidence), so reading the logs does not help either. The defect is not that the
code did something wrong; it is that nothing speaks up once it breaks.

## Affected paths

| Path | What was wrong |
|---|---|
| `backend/app/main.py` — `health` | The whole body was `return {"status": "ok"}`; it consulted no background task and no scheduler |
| `backend/app/main.py` — `lifespan` | Three background tasks were each `create_task`-ed into a module-level `background_tasks` set whose done callback only performed `discard`; nothing ever read a task's exception |
| `backend/app/simulator.py` — `data_simulator` | The `while True` body has no outer `try`, so any unexpected exception raised while walking the devices ends the whole task |

## Preconditions

- The service is started through its normal lifespan and the simulator task is running.
- An exception escapes the inner `except` blocks of `data_simulator`'s main loop.
  Database writes and LINE pushes are guarded locally, so this takes a new,
  unanticipated error — unlikely, but permanent the first time it happens.
- Someone, or something, uses `/health` to decide whether this service is well.

## Steps to reproduce on the pre-fix revision

1. Check out the revision before the fix commit (`159f54d^`).
2. Make `data_simulator` raise shortly after start-up. The measurement here
   replaced it with a coroutine that raises immediately, which is equivalent to an
   exception escaping the main loop.
3. Start the app through its normal lifespan (a `TestClient` entered as a context
   manager, or plain uvicorn).
4. Request `GET /health`, and watch the log while the service is running.

## Expected result

The probe reflects whether the core background work is alive, and does not report
success once the simulator is gone:

```
HTTP/1.1 503 Service Unavailable
{"status": "unhealthy", "checks": {"simulator": "stopped", "scheduler": "running"}}
```

And the task's exception reaches the log at the moment it happens.

## Actual result

```
HTTP/1.1 200 OK
{"status": "ok"}
```

Sensor data, the device state machine, and schedule progress had all stopped, and
`/health` still reported success.

The log offered no fallback either. The exception never appeared while the service
was running, because the tasks were held in local variables of `lifespan` — an
async generator (`sim_task`). The generator is suspended at its `yield`, so its
frame is never released, so the task object is never collected, so
`Future.__del__` — the place asyncio would otherwise print
`Task exception was never retrieved` — is never called. It surfaces only once the
lifespan ends, that is at shutdown, by which point the service has already run its
whole life behind a lying probe.

## Evidence

- The pre-fix probe: `git show 159f54d^:backend/app/main.py`, lines 282–284,
  `async def health(): return {"status": "ok"}` — that one line was the body.
- The pre-fix task bookkeeping: the same file, `background_tasks = set()` on line 39
  and three `add(...)` / `add_done_callback(background_tasks.discard)` pairs on
  lines 137, 141 and 146. Nowhere in the file was `task.exception()` called.
- The unguarded loop: `data_simulator` in
  [`simulator.py`](../../backend/app/simulator.py) — the `while True:` is followed
  directly by the per-device work, and the inner `except Exception` blocks cover
  only database writes and pushes.
- "Nothing is logged while running" was measured: the pre-fix shape was reproduced
  with `asynccontextmanager` + `create_task` + a `discard` callback, and a
  `weakref` confirmed the task object was still alive inside the context. No
  asyncio error was emitted during that window; `Task exception was never
  retrieved` appeared only after the context exited. Reading this correctly needs
  unbuffered output: the log goes to stderr and the markers to stdout, and
  buffering makes the two look reversed.
- The post-fix behaviour was measured the same way: running the real app's full
  lifespan against a scratch database, `/health` returned 200 `{"status": "ok"}`
  while healthy, and 503 with `{"simulator": "stopped", "scheduler": "running"}`
  once `data_simulator` was replaced by a raising version — with
  `Background task simulator failed: ...` and a full traceback in the application log.

## Root cause

Two individually reasonable decisions stacked up.

First, background tasks were *kept* but not *supervised*. The module-level set
existed to stop the tasks being garbage collected — which is what asyncio's own
documentation recommends, and it did that job. But nobody was responsible for
asking why a task had finished. `discard` merely removes it from the set; it asks
no questions.

Second, `/health` was written when there was no background work to speak of. It
answers "can the HTTP server take a request", while most of what this service
actually does happens outside HTTP: the simulator advancing the state machine every
second, APScheduler starting schedules on time. The probe's scope and the service's
scope were never the same — which is invisible until something dies.

A third thing amplified both: because the `lifespan` locals held the task objects
in addition to the set, asyncio's last-resort "shout when it is collected" never
fired either. Together, the three produced a completely silent, permanent failure.

## Impact

- When the simulator dies, the core of the system stops: no sensor data is written,
  the device state machine stops advancing, and schedules neither start nor
  complete. Device cards freeze on their last value.
- `/health` still returns 200, so any probe trusting it concludes the service is
  well. That disconnect between failure and detection *is* the defect.
- Nothing appears in the log while the service runs, so in practice the only way to
  notice is for a person to spot that the temperature stopped moving.
- The probability is low — the normal path has plenty of local guards — but the
  impact is permanent: nothing restarts the task, so only restarting the whole
  service recovers it.
- Severity is rated Medium because this baseline is a portfolio demo on simulated
  data, so what stops is a simulation rather than a real chamber. The same shape in
  a real lab stops equipment monitoring, and would have to be re-rated for that.

## Resolution

Three separate pieces.

- **Supervision**: background tasks are now registered through
  `_start_background_task` into `app.state.background_tasks`, and the done callback
  always calls `task.exception()` and logs it — with the traceback — through the
  application's own logger. Because the exception is retrieved, nothing depends on
  asyncio's collection-time last resort any more. A task leaves the registry when
  it finishes, so the registry only ever lists what is still alive.
- **Probe**: `/health` now reports whether `simulator` and `scheduler` are alive and
  returns 503 naming whichever is not. While healthy it still returns the original
  200 `{"status": "ok"}`, so the existing waiters — `dev_start.sh` and the E2E
  backend poll — are unaffected.
- **Shutdown**: the start-up section of `lifespan` is wrapped in `try/finally`,
  which explicitly cancels and awaits every background task on the way out before
  closing the HTTP client. A failure during start-up takes the same cleanup path.

Three things were considered and not done:

- **Restarting a dead task automatically.** A restart does not know where the last
  run died, and when it dies mid-state-machine it would simply replay broken state.
  Letting the probe fail honestly, and leaving the response to whoever is outside,
  is easier to reason about.
- **Adding `broadcast_loop` to the probe.** Its `try/except` sits inside the loop,
  so a single error does not kill the task — a different risk from the simulator's
  unguarded loop. Including it would only blur what the probe means.
- **Adding a `HEALTHCHECK` to `Dockerfile`, or wiring external monitoring.** This
  baseline is a portfolio demo on a free Hugging Face Space, and a monitoring layer
  nobody maintains would not make it more credible. `/health` now tells the truth;
  what consumes it is a deployment decision.

## Verification

```bash
cd backend && ../venv/bin/python -m pytest tests/test_health.py
```

`tests/test_health.py` pins six things: `/health` returns 200 while the core
background work is present; it returns 503 naming `simulator` once the simulator is
gone; it returns 503 just the same when the scheduler is not RUNNING (both PAUSED
and STOPPED); a background task that raises has its exception retrieved and logged,
leaves the registry, and flips the probe accordingly; shutdown cancels the tasks and
genuinely awaits them; and after a full real lifespan, the keys `_health_checks`
sees really are `simulator` and `scheduler` — that last one runs against a real
`AsyncIOScheduler` and in-memory SQLite rather than fakes, so renaming anything in
the start-up path turns it red.

Two things are not covered. The simulator's main loop still has no outer exception
guard: this fix is about *noticing* that it died, not about it not dying. And
`/health` currently has no consumer in the deployment — `Dockerfile` is a plain
uvicorn command with no `HEALTHCHECK` — so whether anyone is told when it returns
503 depends on the deployment wiring up monitoring.
