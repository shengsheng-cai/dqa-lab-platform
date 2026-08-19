# BUG-010 — A manual loan and a schedule confirmation could both claim the last fixture

English · [繁體中文](BUG-010-concurrent-loan-and-schedule-both-claimed-the-last-fixture.zh-TW.md)

| Field | Value |
|---|---|
| **Bug ID** | BUG-010 |
| **Status** | Fixed |
| **Severity** | High |
| **Priority** | Medium |
| **Component** | Fixture stock allocation — manual loan and schedule reservation (`fixture_lifecycle.py`, `fixtures.py`, `schedules.py`) |
| **Environment** | FastAPI backend on SQLite, any deployment; reproduced on the file-backed database the deployment actually uses |
| **Found by** | Codex whole-project review, 2026-08-19 |
| **Reporter** | Sheng-Sheng Tsai |
| **Fix commit** | `008927780e7f791f2197d7ef3147ac31964692ee`. Unlike BUG-009, this report was written *after* the fix — noted here rather than left implicit |

## Summary

Two different operations allocate fixture stock: a manual loan
(`POST /api/fixtures/loans`) and a schedule confirmation
(`PATCH /api/schedules/{id}` transitioning to 已確認). Both follow the same
shape — read how many units are still available, decide, then write a loan row
— and both did so in their own transaction with nothing serialising them.

Between one request's read and its write, the other request could complete its
own read. Both then saw the same availability, both passed the guard, and both
committed. A fixture with one unit in stock ended up with two active loans
against it.

The guard that was supposed to prevent this — `assert_stock_available` — was
never wrong about the number it computed. It was reading a snapshot that had
already stopped being true by the time the row was written.

## Affected paths

| Path | Wrong behaviour |
|---|---|
| `fixtures.py` — `create_loan` | Opens a session, reads the fixture and the current loan totals, then inserts a `reserved`/`loaned` row and commits. Nothing prevents another session doing the same between the read and the commit |
| `schedules.py` — `_patch_schedule_db`, the 已確認 branch → `_reserve_schedule_fixtures` | Same shape: sums the schedule's fixture rows, calls `assert_stock_available`, then writes one reservation per row |
| `fixture_lifecycle.py` — `assert_stock_available`, `stock_counts` | Computes `available = total_quantity − loaned − reserved − damaged` from whatever the current transaction can see. Correct as an expression, unsafe as a decision, because the value it returns is not held until the write |

## Preconditions

- A fixture whose remaining availability is smaller than the sum of two pending
  requests — most simply, one unit left and two requests each wanting one.
- Two allocating writes overlapping in time: a manual loan and a schedule
  confirmation, or two of either.

## Steps to reproduce on the pre-fix revision

1. Seed one fixture with `total_quantity = 1` and no existing loans.
2. Seed a pending schedule that requests one unit of that fixture.
3. Issue, concurrently, a manual loan for one unit of the fixture and a
   confirmation of that schedule.
4. Sum the quantities of all loans for the fixture whose status is `loaned` or
   `reserved`.

Step 3 has to actually overlap. Coordinating two HTTP requests to collide inside
the same few milliseconds is unreliable, so the reproduction calls the two route
handlers directly from two threads released by a shared barrier. That is what
the server does anyway: `create_loan` is a sync route run in Starlette's
threadpool, and `_patch_schedule_db` is invoked through `asyncio.to_thread`.

## Expected result

One request succeeds and the other is rejected with 400 「治具庫存不足」. The
active loan quantity for the fixture equals 1 — never more than the stock.

## Actual result

Both requests returned success. The active loan quantity was 2 against a stock
of 1. Repeated five times on the file-backed database, it happened every time:

```
結果: [200, 200]
有效借出總量: 2 (庫存 1，超過 1 就是超借)
```

The over-allocation is not visible in the UI. `stock_counts` clamps its result
with `max(0, …)`, so a fixture committed twice over shows 可借 0 rather than a
negative number. Nothing on screen distinguishes "exactly used up" from
"promised to two people at once"; the shortage only surfaces when someone walks
to the shelf.

## Evidence

- The read-then-write shape: [`fixtures.py`](../../backend/app/fixtures.py)
  `create_loan`, and [`schedules.py`](../../backend/app/schedules.py)
  `_reserve_schedule_fixtures`, both of which call `assert_stock_available` and
  then write in the same session without holding a write lock across the pair.
- The clamp that hides it: [`fixture_lifecycle.py`](../../backend/app/fixture_lifecycle.py)
  `stock_counts`, `available=max(0, fixture.total_quantity - loaned - reserved - damaged)`.
- Reproduction: a throwaway script seeded the fixture and schedule above against
  a file-backed SQLite database, ran both handlers from two threads, and printed
  the resulting statuses and active loan total. Five runs before the fix, five
  after. It was run from the scratchpad and deliberately not kept; the standing
  protection is the regression test listed under Verification.

## Root cause

Check-then-act split across two transactions.

SQLite has no row-level `SELECT … FOR UPDATE`, and a transaction opened the
default way is *deferred*: it takes a read lock at the first read and only
upgrades to a write lock at the first write. Two transactions can therefore both
complete their read phase before either writes. Every ingredient of the race was
present by default; nothing had to go wrong for it to happen.

The stock guard was written as a pure function of what the session could see,
which is the right shape for a guard but says nothing about how long the answer
stays valid. Because both allocation paths already shared that one guard, the
correctness of both paths rested on an assumption neither of them stated.

## Impact

- A fixture can be committed to more tests than physically exist. The system
  reports 可借 0, so the double commitment is silent until the fixture is needed
  on the floor and is not there.
- The invariant this module exists to hold —
  `available = total − loaned − reserved − damaged`, and never negative — is
  broken in the data rather than in the arithmetic, so no display bug and no
  validation error points at it.
- Requires two allocating writes to overlap. On this single-administrator Demo
  that is uncommon, which is why the defect survived; in a lab with several
  coordinators confirming schedules while fixtures are lent out by hand, it is
  an ordinary Monday.
- No stored data is corrupted in the sense of being unreadable. Existing loan
  rows are individually valid; it is their sum that exceeds what exists.

## Resolution

Both allocation entry points now take an atomic allocation lock as the first
statement on their session, before any stock is read:
`acquire_fixture_allocation_lock` issues SQLite's `BEGIN IMMEDIATE`, which
acquires the write reservation up front and holds it until the caller commits or
rolls back. The second request therefore cannot read availability until the
first has finished, and it recomputes against the committed result — so it is
rejected by the existing guard rather than by a new code path.

The lock lives in `fixture_lifecycle.py`, the module that already owns the stock
rules, and is taken at exactly the two places that read stock and then allocate
it. Release needs no special handling: commit releases it, and every error exit
leaves the `with SessionLocal()` block, which rolls back.

Two details are deliberate:

- **`BEGIN IMMEDIATE` rather than an application-level lock.** A module-level
  `threading.Lock` would also serialise these two callers on a single-process
  deployment, and the codebase has that pattern already. The database-level
  reservation was kept because it holds regardless of how many sessions or
  threads are involved and does not depend on every allocation path remembering
  to take a Python lock. The alternative is recorded as a standing option rather
  than discarded.
- **A short retry loop around the `BEGIN`.** The test suite runs on shared-cache
  in-memory SQLite, which returns `SQLITE_LOCKED` immediately instead of waiting
  out a busy timeout the way a file-backed database does. Without the retry the
  fix would work in production and fail its own tests.

## Verification

```bash
cd backend && ../venv/bin/python -m pytest tests/test_fixture_lifecycle.py
```

`test_manual_loan_and_schedule_cannot_both_claim_last_fixture` runs the two
handlers concurrently against one unit of stock and asserts both halves of the
invariant: the statuses are exactly one 200 and one 400 — which fails if both
succeed *and* if both fail — and the active loan quantity is 1.

The test was checked against the pre-fix behaviour rather than assumed to work:
with the lock disabled it fails 10 out of 10 runs, and with the lock in place it
passes 15 out of 15.

Because the test database is in-memory while the deployment uses a file, the
file-backed path was verified separately with the throwaway script described
under Evidence: five runs over-allocated before the fix, and five runs after it
produced one success, one 400, and an active total of 1. The full backend suite
passes.

Load behaviour under many simultaneous borrowers is **not** covered and is not
claimed to be; the residual-risk note on R-06 in the
[risk-based test plan](risk-based-test-plan.md) still stands.
