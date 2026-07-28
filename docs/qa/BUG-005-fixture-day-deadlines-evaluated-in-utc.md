# BUG-005 — Whole-day fixture deadlines were evaluated against the UTC day

| Field | Value |
|---|---|
| **Bug ID** | BUG-005 |
| **Status** | Fixed |
| **Severity** | Low |
| **Priority** | Medium |
| **Component** | Fixture loan due dates and summary counts — timezone semantics |
| **Environment** | React client + FastAPI backend, any timezone ahead of UTC; Demo and development baseline run in `Asia/Taipei` (UTC+8) |
| **Found by** | Four-gate review, 2026-07-27 (diff read and altitude pass) |
| **Reporter** | Sheng-Sheng Tsai |

## Summary

Two independent places treated a deadline expressed in whole days as if it were
an instant on the UTC timeline. Both produced a display that disagreed with the
operator's calendar by up to one day, in opposite directions.

`due_date` is stored as a naive UTC datetime, which is correct. What was wrong
was the conversion at each end: the client submitted a picked date as UTC
midnight, and the summary endpoint bucketed "today" by the UTC calendar day.

## Affected paths

| Path | Wrong behaviour |
|---|---|
| `LoanModal.jsx` — 到期日 submission | A loan due 2026-08-04 was stored as `2026-08-04T00:00`, which is 08:00 on 2026-08-04 in Taipei. From that moment the row turned red and the fixture joined the 逾期未還 count, while it was still 16 hours inside its deadline |
| `fixtures.py` — `GET /api/fixtures/summary`, `due_today` | The count bucketed by `today_utc_window()`. Between 00:00 and 08:00 Taipei the UTC date is still the previous day, so the 今日到期 tile showed yesterday's count |

The `overdue` count in the same endpoint was already correct: it compares
against an instant (`due_date < now`), which carries no calendar ambiguity.

## Preconditions

- Client machine timezone is ahead of UTC (`Asia/Taipei`, UTC+8).
- At least one active loan with a due date.
- For the second path, the observer is looking at the LeftPanel fixture summary
  between 00:00 and 08:00 local time.

## Steps to reproduce on the pre-fix revision

1. Register a loan through 借出登記 with 到期日 set to today.
2. After 08:00 local time, expand the fixture's loan sub-rows in 治具總表.
   Observe the due date shown in red with a 逾期 marker.
3. Set the client clock to 02:00 local, reload, and read the 今日到期 tile in the
   left panel. Compare it against the loans actually due on the local date.

## Expected result

- A loan due today is not overdue until the end of the local day.
- 今日到期 counts the loans due on the operator's current local date.

## Actual result

- The loan was marked overdue from 08:00 local on its due date.
- 今日到期 showed the previous local day's count during the 00:00–08:00 window.

## Evidence

- Submission site: [`LoanModal.jsx`](../../client/src/components/fixture/LoanModal.jsx).
- Local-day helpers: [`timezone.js`](../../client/src/utils/timezone.js)
  (`endOfLocalDay`, `localDayWindow`).
- Summary query: [`fixtures.py`](../../backend/app/fixtures.py) `get_summary`.
- Regression tests:
  [`timezone.test.js`](../../client/src/__tests__/timezone.test.js) and
  [`test_fixtures_api.py`](../../backend/tests/test_fixtures_api.py).

## Root cause

The system had no shared answer to "what does a date-only deadline mean". Each
site invented one:

- `new Date("2026-08-04").toISOString()` parses the string as UTC midnight, so
  the deadline silently became the earliest instant of that UTC day rather than
  the latest instant of the operator's local day.
- `today_utc_window()` builds its window from the server's UTC clock, which is
  the only clock the backend has. That is a sound default for a server, but it
  is not the day the operator is living in.

Both are the same class of defect as [BUG-004](BUG-004-fixture-dates-stored-one-day-early.md):
a calendar concept resolved on the UTC timeline instead of the local one.

## Impact

- A fixture returned on time during its due day was reported as overdue, and the
  逾期未還 tile counted it. Since overdue fixtures are what an operator chases,
  a false positive costs a wasted enquiry.
- The 今日到期 tile was unreliable for anyone working an early shift — exactly
  the shift most likely to plan the day from it.
- No stored data was wrong. Both defects were in how a stored instant was
  interpreted, so no correction of historical records was needed.

## Resolution

- `endOfLocalDay()` converts a picked `YYYY-MM-DD` into the last millisecond of
  that local day; 借出登記 now submits that instead of UTC midnight. The
  backend and the overdue comparison were deliberately left unchanged, because
  schedule-created reservations write a real timestamp (the schedule's end
  time), and a whole-day rule applied there would corrupt it.
- `localDayWindow()` computes the local day's boundaries; `ControlCenter` sends
  them to `GET /api/fixtures/summary` as `due_from` / `due_to`, and the endpoint
  uses them for the 今日到期 count. Without the parameters it falls back to the
  UTC day, so any other caller keeps its previous behaviour.

## Verification

```bash
cd client && npm test
cd backend && ../venv/bin/python -m pytest tests/test_fixtures_api.py -v
```

The backend regression test was checked against the pre-fix behaviour by
temporarily making the endpoint ignore the parameters: it fails with
`0 == 1`, confirming the test discriminates. Its window uses a fixed date
(2026-01-15) rather than the current one, so it cannot pass by coincidence on
the day it happens to run.

The frontend tests are pinned to `Asia/Taipei` and assert both boundaries from a
frozen clock at 00:30 Taipei, the worst point of the 8-hour window.
