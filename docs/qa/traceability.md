# DQA Lab Platform — Minimal Traceability

This matrix connects critical behavior to risk, automated evidence, and known
defects. It intentionally covers the high-risk Demo baseline rather than every
route or UI element.

| Requirement | Expected behavior | Risk | Automated evidence | Defect evidence | Status |
|---|---|---|---|---|---|
| **REQ-AUTH-01** | Guest cannot mutate protected business state; every admin-only route enforces authorization | R-01 | `backend/tests/test_guest_authorization.py`; `backend/tests/test_blocked_period_audit.py::test_blocked_period_write_rejects_non_admin_without_audit`; `tests/e2e/specs/guest-readonly.spec.js` | — | Covered |
| **REQ-AUD-01** | Device blocked-period changes record the authenticated actor; if the audit write fails, the business change rolls back | R-03 | `backend/tests/test_blocked_period_audit.py` | — | Covered |
| **REQ-MNT-01** | A maintenance-blocked device cannot be selected or started; the schedule remains confirmed and can retry after maintenance | R-02 | `backend/tests/test_schedule_start_consistency.py::test_start_skipped_when_device_in_maintenance`; `::test_maintenance_keeps_confirmed_then_resumes`; `tests/e2e/specs/maintenance-block.spec.js` | [BUG-002](BUG-002-maintenance-device-auto-started.md) | Covered |
| **REQ-STATE-01** | A successful start keeps device, execution, schedule, fixture, audit, and cache state consistent even when the caller is cancelled | R-03 | `backend/tests/test_schedule_start_consistency.py`; `backend/tests/test_device_state.py::test_start_repeated_cancellation_waits_for_commit_and_publishes_cache`; `backend/tests/test_linkage.py`; `tests/e2e/specs/schedule-flow.spec.js` | — | Covered |
| **REQ-STATE-02** | If the execution record cannot be created, the device returns to IDLE, the schedule stays confirmed, and fixtures stay reserved | R-03 | `backend/tests/test_device_state.py::test_start_execution_failure_leaves_db_and_cache_unchanged`; `backend/tests/test_schedule_start_consistency.py::test_start_schedule_keeps_confirmed_when_execution_insert_fails`; `::test_manual_start_sop_reverts_when_execution_insert_fails` | [BUG-003](BUG-003-execution-insert-failure-left-zombie-running-state.md) | Covered |
| **REQ-UI-01** | After confirmation, the schedule row reconciles with backend state without manual refresh | R-04 | `tests/e2e/specs/schedule-flow.spec.js` | [BUG-001](BUG-001-schedule-status-not-refreshed-after-confirm.md) | Covered |
| **REQ-SCH-01** | Active schedules do not overlap on one device; confirmed time edits replace the exact-start job; temporary blocks retry; invalid schedules converge to a terminal error | R-05 | `backend/tests/test_schedule_conflict.py`; `test_schedules_slot.py`; `test_schedule_start_consistency.py::test_confirmed_slot_edit_replaces_scheduled_start_job`; `test_simulator_schedule.py` | [BUG-002](BUG-002-maintenance-device-auto-started.md) | Covered |
| **REQ-FIX-01** | Fixture quantity and reserve → loan → return transitions never inflate stock or affect another schedule; a schedule confirmation cannot reserve more than the remaining stock | R-06 | `backend/tests/test_fixture_lifecycle.py`; `test_fixtures_api.py`; `test_linkage.py`; `tests/e2e/specs/fixture-loan.spec.js` | [BUG-003](BUG-003-execution-insert-failure-left-zombie-running-state.md) | Covered |
| **REQ-FIX-02** | Dates the operator submits are recorded against the operator's local day, not the UTC one: the return date is the local calendar day, a due date expires at the end of its local day, and 今日到期 counts the local day | R-06 | `client/src/__tests__/timezone.test.js` (suite pinned to `Asia/Taipei`); `backend/tests/test_fixtures_api.py::test_summary_due_today_uses_caller_day_window`; `::test_summary_without_window_falls_back_to_utc_day` | [BUG-004](BUG-004-fixture-dates-stored-one-day-early.md); [BUG-005](BUG-005-fixture-day-deadlines-evaluated-in-utc.md) | Covered |
| **REQ-FIX-03** | Returning a fixture goes through the return dialog, so the operator can record a condition, a note, and the actual return date, with a second confirmation for damaged or lost | R-06 | `tests/e2e/specs/fixture-loan.spec.js` | — | Covered |
| **REQ-EXT-01** | LINE, report, and AI provider failures are contained and return actionable results | R-07 | `backend/tests/test_line_resilience.py`; `test_reports_degradation.py`; `test_ai_observability.py` | — | Covered with mocked failures |
| **REQ-AI-01** | AI-recommended conditions can enter scheduling, while guest remains unable to submit a write | R-08 | `backend/tests/test_rag.py`; `tests/e2e/specs/ai-apply-schedule.spec.js`; `guest-readonly.spec.js` | — | Covered with mocked AI boundary |

## Open coverage gaps

| Gap | Impact | Planned treatment |
|---|---|---|
| **GAP-02** — No real chamber integration | Simulator evidence cannot prove vendor protocol or physical control | Validate on a separate real-device branch when authorized hardware is available |
| **GAP-03** — No load/browser/accessibility matrix | Non-functional regressions may be missed | Create separate plans only when these become release requirements |
