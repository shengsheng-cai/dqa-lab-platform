# DQA Lab Platform — Test Strategy

| Field | Value |
|---|---|
| **Document status** | Active |
| **Baseline** | Demo / simulated-device `main` branch |
| **Last updated** | 2026-07-23 |
| **Approach** | Risk-based, automation-first, evidence-driven |

## 1. Purpose

This strategy defines how DQA Lab is tested as a software QA / QA Automation
portfolio system. The objective is not exhaustive feature coverage. It is to
provide credible evidence that the platform protects its highest-risk
behaviors: authorization, scheduling, device state, fixture lifecycle,
maintenance constraints, reporting, and cross-module consistency.

## 2. Quality objectives

1. **State consistency** — schedule, device, SOP execution, fixture loan, and
   audit records must agree after both successful and failed operations.
2. **Safety constraints** — a busy, unavailable, or maintenance-blocked device
   must not start a test.
3. **Access control** — guests remain read-only; server-side authorization is
   the authority even when the UI hides controls.
4. **Traceability** — important state changes leave enough database, audit, and
   test evidence to explain what happened.
5. **Resilience** — LINE, AI, and report-generation failures must not corrupt
   core business state or hide actionable errors.
6. **Truthful UI** — the screen must reconcile with authoritative backend state
   after a user action.

## 3. Scope

### In scope

- FastAPI routes, service-layer rules, SQLAlchemy persistence, and state
  transitions.
- Scheduling, maintenance windows, device start/stop, SOP execution, fixture
  reserve/loan/return, authorization, audit, reports, AI-to-schedule handoff,
  and WebSocket-backed status presentation.
- Positive, negative, boundary, failure-injection, and regression tests.
- The simulated-device Demo architecture on `main`.

### Out of scope for this baseline

- Real chamber communication, vendor protocols, serial/RS-485 behavior, and
  physical safety validation.
- Production load, soak, penetration, disaster-recovery, and multi-tenant tests.
- A full browser/device compatibility matrix.
- Live Gemini or LINE calls in automated tests.
- Customer-specific deployment and on-premise infrastructure.

## 4. Test approach

| Level | Purpose | Primary location | Notes |
|---|---|---|---|
| Static checks | Catch Python quality violations before execution | `ruff check backend/` | Runs in CI |
| Backend unit/integration | Exercise API, database, service, failure, and state-machine behavior | `backend/tests/` | Uses real in-memory SQLite; cross-module flows patch all participating `SessionLocal` references |
| Frontend unit | Verify deterministic client utilities | `client/src/__tests__/` | Vitest; no jsdom component suite, while selected critical flows are exercised through browser tests |
| Browser E2E | Prove critical workflows from the user's point of view | `tests/e2e/specs/` | Playwright, isolated backend/database, sequential execution, no retries |
| Exploratory/manual | Investigate new risks and collect evidence before automation | Local Demo | A confirmed defect receives a report and, where practical, an automated regression |

Tests use the real database model and service code where practical. Mocks are
reserved for external services, controlled failure injection, time-dependent
boundaries, and hardware that is not present.

## 5. Environments and test data

### CI

GitHub Actions currently gates pushes to `main` and pull requests targeting
`main` with:

- Ruff
- Backend pytest
- Frontend Vitest

### E2E

Playwright uses a dedicated environment:

- Backend port `8100`
- SQLite database `/tmp/dqa-e2e.db`
- Test-only credentials and dummy external-service secrets
- A clean database and restarted backend for each spec file
- One worker and no retry, so shared-state defects are not hidden

E2E also runs in GitHub Actions (the `e2e` job in the Tests workflow) and uploads the Playwright report, traces, and backend log as artifacts on failure. Because the HF Spaces deploy waits for the Tests workflow to succeed, a failing E2E run also blocks deployment.

## 6. Risk and execution priority

The [risk-based test plan](risk-based-test-plan.md) determines execution order:

1. P0 — authorization, maintenance exclusion, and cross-module state integrity.
2. P1 — schedule conflicts/recovery, fixture inventory, and UI/backend
   reconciliation.
3. P2 — AI handoff, report degradation, smoke, and supporting UX.

A low-priority test must not delay investigation of a failing P0 invariant.

## 7. Entry and exit criteria

### Entry

- Expected behavior and failure impact are understood.
- Test data can be created deterministically.
- External dependencies are mocked or explicitly excluded.
- The test cannot write to the development database.

### Exit

- Targeted tests for the changed risk pass.
- The relevant broader suite passes with no unexplained failure.
- No open Critical or High defect affects the intended Demo flow.
- A fixed defect has reproducible evidence and regression protection where
  practical.
- Documentation and [traceability](traceability.md) match the implemented
  behavior.

## 8. Defect lifecycle

The minimum lifecycle is:

`discover → reproduce → document → fix → regression test → verify`

Bug reports live in this directory. Severity describes impact; priority
describes repair order. Reports must distinguish observed facts from inference
and must not claim physical-device validation when only the simulator was used.

## 9. Current limitations

- Test coverage is not yet published automatically.
- Real-device behavior remains unverified until hardware and an authorized
  protocol are available.
