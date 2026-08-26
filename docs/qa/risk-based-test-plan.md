# DQA Lab Platform — Risk-Based Test Plan

English · [繁體中文](risk-based-test-plan.zh-TW.md)

| Field | Value |
|---|---|
| **Plan type** | Release-baseline regression plan |
| **Target** | Simulated-device Demo on `main` |
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
| **R-01** | Guest reaches an admin-only interface or performs an admin write | High | Medium | P0 | `test_guest_authorization.py`, `test_blocked_period_audit.py`, `guest-readonly.spec.js` | New pages or routes could omit a frontend or backend guard; route enumeration and role-switch E2E are the regression net |
| **R-02** | Test starts while device is busy or in maintenance | High | Medium | P0 | `test_schedule_start_consistency.py`, `maintenance-block.spec.js` | Real hardware interlock is out of scope |
| **R-03** | Device, schedule, SOP execution, fixture, audit, or cache states diverge | High | High | P0 | `test_device_state.py`, `test_schedule_start_consistency.py`, `test_blocked_period_audit.py`, `test_linkage.py`, `test_schedules_complete.py`, `schedule-flow.spec.js` | Process interruption outside tested transaction boundaries |
| **R-04** | UI shows stale or misleading state, or a successful write does not persist the value the operator submitted | Medium | High | P1 | `schedule-flow.spec.js`, `fixture-loan.spec.js`, `stocktake-scope.spec.js`, `schedule-start-readiness.spec.js`, `fixture-keeper.spec.js`, `test_maintenance.py` | A transient refresh/network failure can still require manual retry; optional-field semantics need an explicit regression whenever a new nullable field is added |
| **R-05** | Overlap, delayed start, confirmed-time edit, restart, or bad input leaves schedules stuck or starts the wrong job | High | Medium | P1 | `test_schedule_conflict.py`, `test_schedules_slot.py`, `test_simulator_schedule.py`, `test_schedule_start_consistency.py` (including exact date-job replacement), `test_schedules_complete.py` (device availability while returning to ambient) | Long-running clock drift and production scheduler load are not exercised |
| **R-06** | Fixture stock becomes negative, over-committed by schedule reservations, double-returned, double-added by purchase arrival, permanently reserved, or linked to the wrong schedule | High | Medium | P1 | `test_fixture_lifecycle.py`, `test_fixtures_api.py`, `test_fixture_excel.py`, `test_purchase_orders.py`, `test_linkage.py`, `fixture-loan.spec.js` | Concurrent multi-user borrowing is not load-tested |
| **R-07** | An external service or report fails a core operation, or a report is produced but silently incomplete, internally inconsistent, or identifying the wrong subject | Medium | Medium | P2 | `test_line_resilience.py`, `test_reports_degradation.py` (degradation, the timestamp contract the measurement summary depends on, the summary/uncertainty-analysis consistency contract, and the test-item identification contract), `test_uncertainty.py`, `test_ai_observability.py`, `client/src/__tests__/executionPayload.test.js` | Live provider behavior and quota changes are excluded; a frontend save path that omits a field now fails a test, but when the fallback path fires is still caught by review (GAP-04) |
| **R-08** | AI recommendation cannot be safely applied, or guest reaches a dead-end write flow | Medium | Medium | P2 | `test_rag.py`, `ai-apply-schedule.spec.js`, `guest-readonly.spec.js` | Semantic answer quality is not exhaustively scored |
| **R-09** | A session credential ends up somewhere it can be replayed from — a URL, an access log, or any record kept after the request | High | Medium | P1 | `test_ws_auth.py`, `ws-auth.spec.js` | Covers the credentials this application controls; what a deployment platform's proxy or log pipeline records on its own is outside what the suite can observe |
| **R-10** | Core background work stops while the service still claims to be healthy | Medium | Low | P2 | `test_health.py` | Covers whether the probe tells the truth; the simulator's main loop still has no outer guard, and whether the deployment wires up monitoring is out of scope |
| **R-11** | Deleting a row leaves other rows pointing at data that no longer exists, because the declared relationships are not enforced | Medium | Medium | P2 | `test_foreign_key_enforcement.py`, `test_schema_migrations.py` | Covers what the schema declares and what the database does with it; a database that already contains orphans is refused by the migration rather than repaired, which stays a human decision |
| **R-12** | An irreversible operator action fires on a single click, destroying work that is already in flight | Medium | Medium | P1 | `tests/e2e/specs/delete-confirm-identity.spec.js`, `tests/e2e/specs/device-stop-confirm.spec.js`, `tests/e2e/specs/fixture-loan.spec.js`, `tests/e2e/specs/maintenance-block.spec.js`, `tests/e2e/specs/purchase-arrival-confirm.spec.js`, `tests/e2e/specs/users-page-feedback.spec.js` | Every irreversible delete asks first, and the dialog names the record it is about to act on. The inline quick-stocktake field still acts on one click and remains in the backlog |

## 4. Execution order

### P0 — release blockers

1. Guest authorization route net and API rejection.
2. Maintenance/busy-device start guards.
3. Start success and start-failure rollback across device, execution, schedule,
   fixture, and audit state.

### P1 — core workflow integrity

1. Schedule overlap, automatic assignment, delayed start, retry, rescheduled
   date-job replacement, and completion.
2. Fixture reserve → loan → return lifecycle, including invalid quantities and
   repeated actions.
3. Browser schedule confirmation, visible status and device-readiness reconciliation,
   fixture-keeper consistency, and maintenance partial-update semantics.

### P2 — resilience and supporting flows

1. LINE, report, AI timeout, and degraded-provider behavior.
2. AI recommendation → schedule application.
3. Smoke and test-environment self-checks.

## 5. Test design

- Use boundary values for time-window edges, quantity `0`/negative values, and
  state transitions.
- Inject DB/external-service failures at the point where partial writes would
  create inconsistent state.
- Cancel async callers while worker-thread transactions are in flight, then
  assert DB/cache convergence.
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
- Selected defect case studies are linked from [traceability](traceability.md);
  other fixes remain traceable through commits and regression tests.

## 8. Known gaps

- No real chamber or protocol testing is claimed.
- Performance, browser matrix, accessibility, and security penetration testing
  require separate plans if they become release goals.
