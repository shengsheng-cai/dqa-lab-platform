# DQA Lab Platform — Minimal Traceability

This matrix connects critical behavior to risk, automated evidence, and known
defects. It intentionally covers the high-risk Demo baseline rather than every
route or UI element.

| Requirement | Expected behavior | Risk | Automated evidence | Defect evidence | Status |
|---|---|---|---|---|---|
| **REQ-AUTH-01** | Guest cannot mutate protected business state; every admin-only route enforces authorization | R-01 | `backend/tests/test_guest_authorization.py`; `tests/e2e/specs/guest-readonly.spec.js` | — | Covered |
| **REQ-MNT-01** | A maintenance-blocked device cannot be selected or started; the schedule remains confirmed and can retry after maintenance | R-02 | `backend/tests/test_schedule_start_consistency.py::test_start_skipped_when_device_in_maintenance`; `::test_maintenance_keeps_confirmed_then_resumes`; `tests/e2e/specs/maintenance-block.spec.js` | [BUG-002](BUG-002-maintenance-device-auto-started.md) | Covered |
| **REQ-STATE-01** | A successful start keeps device, execution, schedule, fixture, and audit state consistent | R-03 | `backend/tests/test_schedule_start_consistency.py`; `backend/tests/test_linkage.py`; `tests/e2e/specs/schedule-flow.spec.js` | — | Covered |
| **REQ-STATE-02** | If the execution record cannot be created, the device returns to IDLE, the schedule stays confirmed, and fixtures stay reserved | R-03 | `backend/tests/test_schedule_start_consistency.py::test_auto_start_reverts_device_when_execution_insert_fails`; `::test_try_start_keeps_confirmed_when_execution_insert_fails`; `::test_manual_start_sop_reverts_when_execution_insert_fails` | [BUG-003](BUG-003-execution-insert-failure-left-zombie-running-state.md) | Covered |
| **REQ-UI-01** | After confirmation, the schedule row reconciles with backend state without manual refresh | R-04 | `tests/e2e/specs/schedule-flow.spec.js` | [BUG-001](BUG-001-schedule-status-not-refreshed-after-confirm.md) | Covered |
| **REQ-SCH-01** | Active schedules do not overlap on one device; temporary blocks retry; invalid schedules converge to a terminal error | R-05 | `backend/tests/test_schedule_conflict.py`; `test_schedules_slot.py`; `test_schedule_start_consistency.py`; `test_simulator_schedule.py` | [BUG-002](BUG-002-maintenance-device-auto-started.md) | Covered |
| **REQ-FIX-01** | Fixture quantity and reserve → loan → return transitions never inflate stock or affect another schedule | R-06 | `backend/tests/test_fixture_lifecycle.py`; `test_fixtures_api.py`; `test_linkage.py`; `tests/e2e/specs/fixture-loan.spec.js` | [BUG-003](BUG-003-execution-insert-failure-left-zombie-running-state.md) | Covered |
| **REQ-EXT-01** | LINE, report, and AI provider failures are contained and return actionable results | R-07 | `backend/tests/test_line_resilience.py`; `test_reports_degradation.py`; `test_ai_observability.py` | — | Covered with mocked failures |
| **REQ-AI-01** | AI-recommended conditions can enter scheduling, while guest remains unable to submit a write | R-08 | `backend/tests/test_rag.py`; `tests/e2e/specs/ai-apply-schedule.spec.js`; `guest-readonly.spec.js` | — | Covered with mocked AI boundary |

## Open coverage gaps

| Gap | Impact | Planned treatment |
|---|---|---|
| **GAP-02** — No real chamber integration | Simulator evidence cannot prove vendor protocol or physical control | Validate on a separate real-device branch when authorized hardware is available |
| **GAP-03** — No load/browser/accessibility matrix | Non-functional regressions may be missed | Create separate plans only when these become release requirements |
