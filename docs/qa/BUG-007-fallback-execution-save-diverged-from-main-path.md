# BUG-007 — The fallback execution save dropped fields the main save sends, producing reports with no measurement data

English · [繁體中文](BUG-007-fallback-execution-save-diverged-from-main-path.zh-TW.md)

| Field | Value |
|---|---|
| **Bug ID** | BUG-007 |
| **Status** | Fixed |
| **Severity** | Medium |
| **Priority** | Medium |
| **Component** | SOP execution record creation — frontend fallback save path |
| **Environment** | React frontend + FastAPI backend, simulator Demo baseline; any deployment where the browser misses the `ramp_to_ambient` phase transition |
| **Found by** | Code read during the unreferenced-endpoint cleanup, 2026-08-01, while investigating why `GET /api/sop-executions/{id}` returned an empty `steps` array. Extended by the four-gate review of the fix |
| **Reporter** | Sheng-Sheng Tsai |
| **Fix commit** | `6e90524d476e92361ac439b59386844c79984ef1` |

## Summary

The frontend creates an SOP execution record in two independent places, and the
two payloads had drifted apart.

`ExecutionPanel.saveExecution` is the main path. `SOPPage` carries a second,
fallback copy for the case where the browser never saw the `ramp_to_ambient`
transition, so the main path was never armed. The fallback was missing three
fields the main path sends: both test timestamps and `manual_mode`.

Each omission has its own user-visible consequence, and neither produces an
error message.

## Affected paths

| Path | Wrong behaviour |
|---|---|
| `client/src/SOPPage.jsx` — the `data.status === IDLE_STATUS` effect | Sent `test_started_at: null` and omitted `test_ended_at` entirely. `reports.py` only queries sensor data when both are present, so the report came out with no measurements |
| `client/src/SOPPage.jsx` — same request | Omitted `manual_mode`. `ExecutionCreate` defaults it to `False`, so `sop.py` treated a manual debug run as a normal one and pushed to LINE |

## Preconditions

- A test runs to natural completion on the SOP page.
- The browser does not observe the `sim_phase` transition into
  `ramp_to_ambient`. `SOPPage` only arms the main path on that specific
  transition (`prevPhase !== "ramp_to_ambient" && simPhase === "ramp_to_ambient"`),
  so a gap in the device feed at that moment leaves `autoSave` false.
- The device then reaches `IDLE`, and the fallback saves the record instead.

For the second symptom, additionally: the run was started ad hoc in 手動模式
with no confirmed schedule attached to the device.

## Steps to reproduce on the pre-fix revision

1. Start a low-temperature SOP (for example `iec60068_ab_-40_16h`) on CH-01 from
   the SOP page and let it run to natural completion.
2. Interrupt the device feed across the moment the simulator enters
   `ramp_to_ambient`, so the page never sees that phase.
3. Wait for the device to return to `IDLE`. The fallback save fires.
4. Open 執行紀錄, download the CSV or PDF report for the newly created record.

## Expected result

The report contains the measurement summary for the test window — 最高溫度,
最低溫度, 平均溫度, 平均濕度, 數據筆數 — exactly as a report saved by the main
path does.

## Actual result

Sections 1 through 4 were populated, including the step table, but
數據筆數 was 0 and every value in 測試數據統計 was `N/A`. The report looked as
though the chamber had recorded nothing. No warning appeared in the UI or the
logs.

Separately, a manual-mode run with no schedule sent a `✅ 測試完成` LINE push
that the same run would have suppressed had it been saved by the main path.

## Evidence

- Fallback save: [`SOPPage.jsx`](../../client/src/SOPPage.jsx) (the
  `data.status === IDLE_STATUS` effect).
- Main save for comparison:
  [`ExecutionPanel.jsx`](../../client/src/components/sop/ExecutionPanel.jsx)
  (`saveExecution`).
- Measurement window query: [`reports.py`](../../backend/app/reports.py)
  (`_fetch_execution_data` — the `if execution.test_started_at and
  execution.test_ended_at` guard).
- Push suppression: [`sop.py`](../../backend/app/sop.py) (`create_execution` —
  `if not has_schedule and not data.manual_mode`).
- Regression test:
  [`test_reports_degradation.py`](../../backend/tests/test_reports_degradation.py)
  (`test_frontend_iso_timestamps_still_match_sensor_data`).

## Observed versus inferred

Observed directly:

- `reports.py` returns no sensor rows unless both timestamps are set. Confirmed
  by removing `test_ended_at` from the regression test's payload: the report
  query returned 0 rows instead of 10.
- A record that does carry both timestamps produces a full measurement section.
  Confirmed against execution 5 on the development database — 2401 data points,
  max 25.0 °C, min −40.0 °C, avg −31.99 °C.
- `manual_mode` gates the push, and the fallback did not send it.

Inferred, not reproduced: that the feed gap which arms the fallback occurs in
normal operation. The fallback and the comment above it predate this
investigation, so the condition was understood to be reachable, but no captured
instance exists. Everything here was exercised against the simulator; no
physical chamber was involved.

## Root cause

One request, built twice, kept in step by hand. Nothing tied the two payloads
together, so a field added to the main path did not reach the fallback and no
test or type failed.

The timestamp omission was not a simple oversight. The fallback runs after the
device has returned to `IDLE`, and the backend clears `started_at` at that
point, so the value the main path reads from live device state is already gone
by the time the fallback needs it. Sending `null` was the path of least
resistance.

## Impact

- Reports saved through the fallback carried no measurement data. For an
  ISO/IEC 17025 report that is the substance of the document, and the failure is
  silent — a reader cannot distinguish it from a chamber that genuinely recorded
  nothing.
- Manual debug runs consumed the LINE push quota (200/month on the free tier)
  that 手動模式 exists to protect.
- No stored data was corrupted. The affected records are missing timestamps, not
  holding wrong ones, so any historical record can still be identified.

## Resolution

- The fallback now sends both timestamps and `manual_mode`, matching
  `ExecutionPanel.saveExecution`.
- `lastStartedAtRef` retains the start time while the test is running, so it
  survives the device returning to `IDLE`. It deliberately does not reuse the
  existing `chartStartedAt`: that value belongs to the chart's lifecycle and is
  cleared on the emergency-stop path, where `started_at` disappears while the
  status is not yet `FINISHING`.
- Both call sites now carry a comment pointing at the other, so the next field
  added to either is visible from both.

The two payloads were not merged into a shared builder. They legitimately differ
beyond these fields — the fallback marks every step complete, the main path
sends the operator's actual per-step state — and consolidating them is a
refactor outside this repair.

## Verification

```bash
cd backend && ../venv/bin/python -m pytest tests/test_reports_degradation.py -v
```

`test_frontend_iso_timestamps_still_match_sensor_data` posts through the real
route so the ISO strings the browser sends pass through `ExecutionCreate`, then
asserts the report query finds the seeded sensor rows. Removing `test_ended_at`
from its payload turns it red with `0 == 10`, so it discriminates against the
pre-fix behaviour rather than passing by accident.

It seeds timezone-aware UTC timestamps on purpose, because that is what the
browser actually sends: the start time carries `+00:00` and the end time is
`new Date().toISOString()` with `Z`. Sensor timestamps are naive UTC. The test
pins the requirement that the two still match.

The frontend change itself has no automated coverage. React components are out
of scope for unit testing in this baseline (no jsdom configuration), and the
fallback only fires on a feed gap that a browser test cannot reliably provoke.
