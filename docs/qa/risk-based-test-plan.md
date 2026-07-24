# DQA Lab Platform — Risk-Based Test Plan

| Field | Value |
|---|---|
| **Plan type** | Release-baseline regression plan |
| **Target** | Simulated-device Demo on `main` |
| **Last updated** | 2026-07-23 |
| **Related strategy** | [Test Strategy](test-strategy.md) |

## 1. Objective

Allocate test effort according to business and engineering risk. The plan gives
priority to failures that can create unauthorized changes, start a test on an
unavailable device, or split one workflow into contradictory schedule, device,
execution, and fixture states.

## 2. Rating method

- **Impact:** High = authorization, safety rule, or persistent data integrity;
  Medium = workflow failure or misleading state with a workaround; Low =
  localized presentation issue.
- **Likelihood:** based on reachable branches, asynchronous behavior, shared
  state, and prior defects.
- **Priority:** P0 must pass first, P1 follows, P2 completes the release
  confidence set.

## 3. Risk register and planned coverage

| ID | Failure mode | Impact | Likelihood | Priority | Automated evidence | Residual risk |
|---|---|---:|---:|---:|---|---|
| **R-01** | Guest performs an admin write | High | Medium | P0 | `test_guest_authorization.py`, `guest-readonly.spec.js` | New routes could omit the shared guard; route enumeration is the regression net |
| **R-02** | Test starts while device is busy or in maintenance | High | Medium | P0 | `test_schedule_start_consistency.py`, `maintenance-block.spec.js` | Real hardware interlock is out of scope |
| **R-03** | Device, schedule, SOP execution, fixture, or audit states diverge | High | High | P0 | `test_schedule_start_consistency.py`, `test_linkage.py`, `test_schedules_complete.py`, `schedule-flow.spec.js` | Process interruption outside tested transaction boundaries |
| **R-04** | UI shows stale status and offers an invalid action | Medium | High | P1 | `schedule-flow.spec.js` | A transient refresh/network failure can still require manual retry |
| **R-05** | Overlap, delayed start, restart, or bad input leaves schedules stuck or starts the wrong job | High | Medium | P1 | `test_schedule_conflict.py`, `test_schedules_slot.py`, `test_simulator_schedule.py`, `test_schedule_start_consistency.py` | Long-running clock drift and production scheduler load are not exercised |
| **R-06** | Fixture stock becomes negative, double-returned, permanently reserved, or linked to the wrong schedule | High | Medium | P1 | `test_fixture_lifecycle.py`, `test_fixtures_api.py`, `test_linkage.py`, `fixture-loan.spec.js` | Concurrent multi-user borrowing is not load-tested |
| **R-07** | External service or report failure breaks a core operation | Medium | Medium | P2 | `test_line_resilience.py`, `test_reports_degradation.py`, `test_ai_observability.py` | Live provider behavior and quota changes are excluded |
| **R-08** | AI recommendation cannot be safely applied, or guest reaches a dead-end write flow | Medium | Medium | P2 | `test_rag.py`, `ai-apply-schedule.spec.js`, `guest-readonly.spec.js` | Semantic answer quality is not exhaustively scored |

## 4. Execution order

### P0 — release blockers

1. Guest authorization route net and API rejection.
2. Maintenance/busy-device start guards.
3. Start success and start-failure rollback across device, execution, schedule,
   fixture, and audit state.

### P1 — core workflow integrity

1. Schedule overlap, automatic assignment, delayed start, retry, and completion.
2. Fixture reserve → loan → return lifecycle, including invalid quantities and
   repeated actions.
3. Browser schedule confirmation and visible status reconciliation.

### P2 — resilience and supporting flows

1. LINE, report, AI timeout, and degraded-provider behavior.
2. AI recommendation → schedule application.
3. Smoke and test-environment self-checks.

## 5. Test design

- Use boundary values for time-window edges, quantity `0`/negative values, and
  state transitions.
- Inject DB/external-service failures at the point where partial writes would
  create inconsistent state.
- Assert both the HTTP result and authoritative database/device state.
- For cross-module workflows, assert every affected entity rather than only the
  initiating API response.
- Keep E2E selectors user-visible and reset the backend for every spec file.
- Do not use retries to hide nondeterministic tests.

## 6. Entry criteria

- The affected risk ID and expected invariant are identified.
- Required seed data and failure controls are deterministic.
- Unit/integration tests cannot reach the development database.
- Live LINE and Gemini calls are disabled or intercepted.

## 7. Exit criteria

- All P0 tests pass.
- P1 tests relevant to the change pass.
- P2 failures are either fixed or explicitly accepted with no impact on P0/P1
  invariants.
- No open Critical/High defect remains in the Demo path.
- Fixed defects are linked from [traceability](traceability.md).

## 8. Known gaps

- No real chamber or protocol testing is claimed.
- Performance, browser matrix, accessibility, and security penetration testing
  require separate plans if they become release goals.

