# BUG-004 — Fixture dates submitted before 08:00 local time are stored one day early

| Field | Value |
|---|---|
| **Bug ID** | BUG-004 |
| **Status** | Fixed |
| **Severity** | Medium |
| **Priority** | Medium |
| **Component** | Fixture loan / return — client-side date submission |
| **Environment** | React client, any timezone ahead of UTC; Demo and development baseline run in `Asia/Taipei` (UTC+8) |
| **Found by** | Four-gate review backlog (`CLAUDE.local.md`), 2026-07-27 |
| **Reporter** | Sheng-Sheng Tsai |

## Summary

Three fixture screens built a `YYYY-MM-DD` string with
`new Date().toISOString().slice(0, 10)`. That expression returns the **UTC**
calendar date, not the operator's local one. Between 00:00 and 08:00 Taipei time
the UTC date is still the previous day, so the client submitted — and the
backend stored — a date one day earlier than the day the operator was working.

Unlike the report-filename variant fixed in `b1dca47`, these three values are
submitted data: two reach the database directly, and one seeds a due date the
operator is unlikely to re-check.

## Affected paths

| Path | Value | Consequence |
|---|---|---|
| `FixturePage.jsx` — inline 正常/損壞/遺失 return buttons | `returned_at` sent to `POST /api/fixtures/loans/{id}/return` | The stored return date is one day early; the operator is never shown the value and cannot correct it |
| `ReturnModal.jsx` | default 實際歸還日期 | Same stored value, but pre-filled in a visible field the operator can correct. Was unreachable in the UI when this report was written (see Notes) |
| `LoanModal.jsx` | default 到期日 (today + 7 days) | The loan is due six days out instead of seven, so the fixture is flagged overdue a day early |

## Preconditions

- Client machine timezone is ahead of UTC (`Asia/Taipei`, UTC+8).
- Local wall-clock time is between 00:00 and 08:00.
- An admin session on the 治具管理 page.

## Steps to reproduce on the pre-fix revision

1. Set the client machine clock to a local time between 00:00 and 08:00 in
   `Asia/Taipei` — for example 2026-07-28 01:00, which is 2026-07-27 17:00 UTC.
2. Open 治具總表, expand a fixture with an active loan, and press 正常 to return it.
3. Read `fixture_loans.return_date` for that loan, or reopen the record in the
   損壞／遺失 list if the return was marked damaged or lost.
4. Separately, open 借出登記 and read the pre-filled 到期日.

## Expected result

- The stored return date is 2026-07-28, the day the operator performed the return.
- The default due date is 2026-08-04, seven days after the local date.

## Actual result

- The stored return date is 2026-07-27, one day early.
- The default due date is 2026-08-03, six days out.

## Evidence

- Client submission sites:
  [`FixturePage.jsx`](../../client/src/FixturePage.jsx),
  [`ReturnModal.jsx`](../../client/src/components/fixture/ReturnModal.jsx),
  [`LoanModal.jsx`](../../client/src/components/fixture/LoanModal.jsx).
- Backend persistence: `return_loan()` in
  [`fixtures.py`](../../backend/app/fixtures.py) parses `returned_at` with
  `datetime.date.fromisoformat()` and stores midnight of that date, so a wrong
  client date is written verbatim.
- The underlying date expression is covered by
  [`timezone.test.js`](../../client/src/__tests__/timezone.test.js), which pins
  the suite to `Asia/Taipei` and asserts that `localDateStamp()` returns the
  local date at 00:30 Taipei while `toISOString()` returns the previous day.

## Root cause

`Date.prototype.toISOString()` always serializes in UTC. Slicing its first ten
characters therefore yields the UTC calendar date. For every timezone ahead of
UTC there is a window after local midnight in which that date has not yet
advanced, and the width of the window equals the UTC offset — eight hours in
Taipei.

The correct local-date helper, `localDateStamp()`, already existed in
`utils/timezone.js` (added in `b1dca47` while fixing the same defect class in
report filenames), but these three call sites were not migrated at that time.

## Impact

- Fixture return history is wrong by one day for any return performed on an
  early shift or an overnight session. Auditors reading 歸還日 or the
  損壞／遺失 list see a date that does not match the operator's day.
- The wrong return date is written without ever being displayed for the inline
  buttons, so there is no opportunity to correct it before it is stored.
- Loans created in that window become overdue one day early, which colours the
  row red and inflates the 逾期未還 count on the fixture summary panel.

## Resolution

- All three call sites now use `localDateStamp("-")` from `utils/timezone.js`.
- `LoanModal` computes the +7-day default from a local `Date`, then formats it
  with the same helper via an explicit date argument rather than `toISOString()`.

## Verification

- Frontend unit tests, which are pinned to `Asia/Taipei`:

  ```bash
  cd client && npm test
  ```

- Fixture lifecycle regression, covering loan → return through the API:

  ```bash
  make test-e2e ARGS="specs/fixture-loan.spec.js"
  ```

The one-day offset itself is timezone- and clock-dependent, so it is not
reproduced in an automated browser test. Regression protection sits at the
helper level: `timezone.test.js` fails if `localDateStamp()` ever regresses to
UTC semantics, and no fixture screen constructs a date string by other means.

## Notes

When this report was written, `ReturnModal` was unreachable from the UI:
`setReturnTarget` was only ever called with `null`, and the 治具總表 expanded row
used an inline `ReturnButtonGroup` instead. Its date default was fixed here to
keep the file consistent, and the modal was re-wired to the 歸還 button in a
follow-up change, which also added the browser test that would have caught the
dead entry point.
