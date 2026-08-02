# BUG-006 — A chamber still returning to ambient was treated as available for scheduling

English · [繁體中文](BUG-006-cooling-device-treated-as-available.zh-TW.md)

| Field | Value |
|---|---|
| **Bug ID** | BUG-006 |
| **Status** | Fixed |
| **Severity** | Medium |
| **Priority** | Medium |
| **Component** | Auto-scheduling device availability estimate — `FINISHING` device state |
| **Environment** | FastAPI backend, simulator Demo baseline; any deployment where a test is stopped part-way or an emergency stop is cleared |
| **Found by** | State-machine spine review, 2026-07-31 (code read of `device_state.py`, `schedule_service.py`, `simulator.py`) |
| **Reporter** | Sheng-Sheng Tsai |
| **Fix commit** | `86e7faac29ec7e0fc2ac95c21437b639b797caa2` |

## Summary

Two places answered the question "when does this chamber free up", and they
disagreed whenever the device was in `FINISHING`.

The device card computed the remaining ramp from the current temperature, which
is right. The scheduler reused `occupied_end`, which computes
`started_at + full temperature curve + 30 min stabilisation` — the time the test
would have finished had it run to completion. For a device that is merely
cooling down, that is the wrong quantity, and it failed in both directions.

## Affected paths

| Path | Wrong behaviour |
|---|---|
| `schedule_service.py` — `_est_end_from_device`, consumed by `_build_running_until` and `_get_stuck_devices` | `FINISHING` was routed to `occupied_end`. After a mid-test cancellation the estimate assumed the entire curve still had to run, overstating occupancy by hours. After an emergency stop it returned nothing at all, and the device was treated as free |
| `devices.py` — `_calc_estimated_end_at` | Correct in itself, but its `FINISHING` branch was a private copy. Nothing kept the two callers in step |

## Preconditions

- A device is in `FINISHING`, reached either by stopping a running test or by
  clearing an emergency stop with a normal stop.
- A new schedule is submitted with automatic device assignment while that device
  is still ramping down.

## Steps to reproduce on the pre-fix revision

1. Start a high-temperature test on CH-01 and let it reach its setpoint.
2. Trigger 緊急停止, then 正常停止 so the device enters `FINISHING`.
3. While CH-01 is still ramping down, submit a new schedule and let the system
   assign the device.
4. Read the assigned device and start time on the Gantt chart.

## Expected result

The new schedule is not placed before CH-01 has reached ambient, whichever
device is chosen.

## Actual result

CH-01 was selected with a start time of the current moment. The schedule stayed
在「已確認」, the five-minute fallback rejected it with `DEVICE_BUSY` on every
pass, and the Gantt bar showed a start time that had already gone by. Nothing in
the UI explained the delay.

## Evidence

- Scheduler estimate: [`schedule_service.py`](../../backend/app/schedule_service.py)
  (`_build_running_until`, `_get_stuck_devices`, `_auto_assign`).
- Device card estimate: [`devices.py`](../../backend/app/devices.py)
  (`_calc_estimated_end_at`).
- Field clearing on emergency: [`device_state.py`](../../backend/app/device_state.py)
  (`emergency`).
- Shared estimators: [`utils.py`](../../backend/app/utils.py)
  (`device_free_at`, `finishing_end`, `ramp_rate_from_sop`).
- Regression tests: [`test_utils.py`](../../backend/tests/test_utils.py) and
  [`test_schedules_complete.py`](../../backend/tests/test_schedules_complete.py).

## Root cause

`emergency()` clears `started_at` and `active_sop_json` the moment the device
enters `EMERGENCY`. Those are exactly the two fields `occupied_end` needs, so
after the subsequent normal stop it had nothing to compute from and returned
`None`. `_est_end_from_device` reads `None` as "this device is not occupied".

Neither guard nearby could compensate. `_get_stuck_devices` also needs an
estimate before it can judge anything, so a missing estimate silently skips it.
`_get_emergency_devices` no longer matches, because by then the status has moved
on from `EMERGENCY` to `FINISHING`.

Underneath the specific failure, the real defect is that "which status uses
which estimate" existed as two independent copies. `occupied_end`'s own
docstring recorded that the `FINISHING` special case belonged to the callers,
and only one of the two callers ever implemented it. The same class of defect as
the duplicated temperature-curve calculations that `curve_total_minutes` was
introduced to consolidate.

## Impact

- Auto-assign could place a schedule on a chamber that was physically unable to
  start for up to a couple of hours. The schedule was not lost — the fallback
  starts it once the device reaches IDLE — but its planned time was wrong, the
  Gantt chart was wrong, and every later slot computed for that device inherited
  the error.
- In the opposite direction, a test cancelled shortly after starting kept its
  device marked occupied for the full original duration, so auto-assign skipped
  a chamber that was in fact about to be free.
- No stored data was affected. Both failures were in an estimate, so no
  historical record needed correcting.

## Resolution

- `device_free_at()` now owns the mapping from device status to estimator. The
  device card and the scheduler both call it, so the two cannot drift apart
  again.
- `finishing_end()` estimates `FINISHING` from the current temperature and the
  ramp rate. When the SOP data has been cleared it falls back to 1 °C/min, so
  the answer always lands in the future rather than collapsing to "free now".
- `ramp_rate_from_sop()` is the single source for the ramp rate, shared with the
  simulator that performs the actual cooldown, so the simulated ramp and the
  estimate of that ramp read the same number.
- `FINISHING` is now structurally outside stuck-device detection, because its
  estimate is always in the future. That guard was only ever meant for a device
  that should have finished and has not returned to IDLE; the exclusion is
  recorded in `_get_stuck_devices` and in `.claude/rules/api-conventions.md`.

## Verification

```bash
cd backend && ../venv/bin/python -m pytest tests/test_utils.py tests/test_schedules_complete.py -v
```

`test_est_end_finishing_after_emergency_is_not_treated_as_free` discriminates
against the pre-fix behaviour: on the old code the estimate is `None`, so the
assertion that it equals `now + 60 min` fails rather than passing by accident.
`test_build_running_until_includes_finishing_device` covers the consequence one
level up — the cooling device must appear in the occupancy table that
`_find_earliest_slot` reads.

The RUNNING and PAUSED estimates were left untouched: `occupied_end`'s body is
unchanged, and the pre-existing pause tests still assert the same values.
