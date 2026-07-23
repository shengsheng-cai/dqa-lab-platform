# BUG-003 — Execution-record failure left a zombie RUNNING device

| Field | Value |
|---|---|
| **Bug ID** | BUG-003 |
| **Status** | Fixed (verified by failure-injection tests) |
| **Severity** | High |
| **Priority** | High |
| **Component** | SOP start — device / execution / schedule / fixture consistency |
| **Environment** | DQA Lab Platform backend, manual and automatic start paths |
| **Found by** | Cross-module state-consistency review, 2026-07-18 |
| **Reporter** | Sheng-Sheng Tsai |
| **Fix commit** | `fa709947d3fb6a39b36234398401b5cd907830c3` |

## Summary

The start flow changed a device to **RUNNING** before inserting its
`SopExecution` record. If the database insert failed and returned no execution
ID, both manual and automatic paths continued as if start had succeeded.

This left a zombie device: it appeared to be running but had no execution record
to receive an end time or connect to a report. A linked schedule and its fixture
reservation could also advance even though the execution did not exist.

## Preconditions

- The target device is **IDLE**.
- A valid SOP is selected.
- For the scheduled path, a confirmed schedule and reserved fixture may exist.
- Execution-record creation fails after the device cache has been changed to
  RUNNING.

## Steps to reproduce on the pre-fix revision

1. Prepare an IDLE device and a valid SOP.
2. Force `_create_execution_id_db()` to return `None`, simulating a database
   insert failure.
3. Start the SOP manually or through `try_start_schedule()`.
4. Inspect the API result, device cache, schedule status, fixture loan, and
   execution table.

## Expected result

- Start is reported as failed.
- The device returns to **IDLE**.
- No active execution ID is stored.
- A linked schedule remains **已確認 (Confirmed)** for retry.
- Reserved fixtures remain reserved and are not converted to loaned.

## Actual result

- The device remained **RUNNING** with no execution record.
- Manual start still returned success.
- Automatic start still returned `True`, allowing the schedule to advance.
- The workflow could show a running test that could not be completed or
  reported correctly.

## Evidence

- Historical fix: commit
  `fa709947d3fb6a39b36234398401b5cd907830c3`.
- Shared rollback:
  [`sop.py`](../../backend/app/sop.py#L36).
- Manual failure handling:
  [`sop.py`](../../backend/app/sop.py#L246).
- Automatic failure handling:
  [`sop.py`](../../backend/app/sop.py#L339).
- Failure-injection regression tests:
  [`test_schedule_start_consistency.py`](../../backend/tests/test_schedule_start_consistency.py#L390).

## Root cause

The flow persisted the RUNNING device state before creating the dependent
execution record, but it had no compensating rollback. The presence of an
execution ID was treated as optional: the code skipped assigning
`active_execution_id` when insertion failed, then continued through the success
path.

The start operation therefore was not atomic from the business perspective.

## Impact

- UI and WebSocket clients could display a test as running when no execution
  existed.
- Completion could not reliably write `test_ended_at`.
- Report linkage and execution history were missing.
- A schedule could become RUNNING and fixtures could become loaned for a test
  that never successfully started.
- Manual recovery was required to clear the device.

## Resolution

- Added `_revert_device_to_idle()` for both manual and automatic start paths.
- Rollback only clears the state if the device is still RUNNING, so it does not
  overwrite an emergency stop that occurred during the database operation.
- Manual start now returns HTTP 500 when the execution record cannot be created.
- Automatic start returns `False`; the schedule stays confirmed and fixtures
  stay reserved for a later retry.
- Schedule/fixture activation occurs only after execution creation succeeds.

## Verification

Failure-injection tests cover:

1. Automatic SOP start returns `False` and restores IDLE.
2. Scheduled start keeps the schedule confirmed and the fixture reserved.
3. Manual start returns an error and restores IDLE.

Targeted command:

```bash
cd backend && ../venv/bin/python -m pytest tests/test_schedule_start_consistency.py -k execution_insert_fails -v
```

