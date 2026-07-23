# BUG-002 — Automatic scheduler started a device during an active maintenance window

| Field | Value |
|---|---|
| **Bug ID** | BUG-002 |
| **Status** | Fixed (verified by regression tests) |
| **Severity** | High |
| **Priority** | High |
| **Component** | Scheduling — automatic start / maintenance exclusion |
| **Environment** | DQA Lab Platform backend, simulated device, SQLite |
| **Found by** | Schedule-state risk review, 2026-07-18 |
| **Reporter** | Sheng-Sheng Tsai |
| **Fix commit** | `9a7116bd045ec4438c335ddf9f80795e1ae1b675` |

## Summary

A confirmed schedule whose start time had arrived could automatically start an
IDLE device even when that device was inside an active maintenance/unavailable
period. Manual SOP start already checked maintenance, but the automatic
scheduler used a separate path without the same guard.

The result was a contradictory system state: the operator had explicitly marked
the device unavailable, yet the scheduler treated it as available and began the
test.

## Preconditions

- A device exists in state **IDLE**.
- An unavailable period covers the current time for that device.
- A confirmed schedule assigned to the device is due to start.
- The scheduler date job or fallback scan runs.

The defect also applied when the unavailable period had no reason text.

## Steps to reproduce on the pre-fix revision

1. Create an unavailable period for `CH-01` from one hour before now until one
   hour after now.
2. Leave the reason as either `校驗中` or blank.
3. Create and confirm a schedule assigned to `CH-01` with a start time at or
   before now.
4. Trigger the scheduled start or fallback scan.
5. Inspect the schedule and device states.

## Expected result

- The device remains **IDLE**.
- The schedule remains **已確認 (Confirmed)** because maintenance is temporary.
- After the unavailable period ends, the fallback scan may retry and start the
  schedule.

## Actual result

- The automatic path proceeded to SOP start because it only checked that the
  device was IDLE.
- The device and schedule could move to **RUNNING** during maintenance.
- A maintenance record with a blank reason could also be treated as if no block
  existed.

## Evidence

- Historical fix: commit
  `9a7116bd045ec4438c335ddf9f80795e1ae1b675`.
- Current automatic-start guard:
  [`schedule_service.py`](../../backend/app/schedule_service.py#L510).
- Regression tests:
  [`test_schedule_start_consistency.py`](../../backend/tests/test_schedule_start_consistency.py#L110)
  covers maintenance blocking, a blank reason, and retry after maintenance.
- Browser coverage:
  [`maintenance-block.spec.js`](../../tests/e2e/specs/maintenance-block.spec.js)
  verifies that a blocked device is disabled while a healthy device remains
  selectable.

## Root cause

Manual and automatic start paths enforced different rules. The manual SOP route
checked the maintenance table, while `try_start_schedule()` went directly from
basic schedule validation to `auto_start_sop()`.

The block reason was also nullable. Treating the reason value as the existence
signal meant an unavailable period with no text could be misclassified as
unblocked.

## Impact

- Violated an explicit equipment-availability constraint.
- Could run a simulated test against a device the operator had removed from
  service.
- In a future real-device integration, the same business-rule failure could
  conflict with calibration or maintenance work.
- Did not corrupt historical data by itself, but made schedule and maintenance
  controls untrustworthy.

## Resolution

- Added the shared `device_blocked_reason_now()` check to the automatic
  scheduling path.
- An active unavailable period now counts as blocked even when its reason is
  blank.
- A blocked schedule remains confirmed instead of becoming an error.
- The normal fallback retries after the unavailable period ends.

## Verification

The regression suite asserts all three required behaviors:

1. Maintenance blocks automatic start.
2. A blank maintenance reason still blocks start.
3. Removing the maintenance period allows the confirmed schedule to retry and
   enter RUNNING.

Targeted command:

```bash
cd backend && ../venv/bin/python -m pytest tests/test_schedule_start_consistency.py -k maintenance -v
```

