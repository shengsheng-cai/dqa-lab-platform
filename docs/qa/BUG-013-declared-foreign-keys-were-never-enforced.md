# BUG-013 — Declared foreign keys were never enforced, so deleted rows left orphan IDs behind

English · [繁體中文](BUG-013-declared-foreign-keys-were-never-enforced.zh-TW.md)

| Field | Value |
|---|---|
| **Bug ID** | BUG-013 |
| **Status** | Fixed |
| **Severity** | Medium |
| **Priority** | Medium |
| **Component** | Database schema and every delete path (`models.py`; `delete_user` in `auth.py`, `_delete_schedule_db` in `schedules.py`) |
| **Environment** | Every deployment. SQLite is the database everywhere: the local development file, the E2E database, and the Space's `/tmp` file |
| **Found by** | Codex whole-project review, 2026-08-19 |
| **Reporter** | Sheng-Sheng Tsai |
| **Fix** | Migration `b7f4c2e91a05`. As with BUG-010 through BUG-012, this report was written *after* the fix — noted here rather than left implicit |

## Summary

The schema declares fifteen foreign keys across ten tables. SQLite honoured none
of them.

`PRAGMA foreign_keys` defaults to **off**, and it is a per-connection setting, so
a declaration like `ForeignKey("users.id")` is a comment until every connection
turns enforcement on. Nothing did. The result is not a crash; it is the quiet kind
of wrong: deleting a person succeeded, and the rows that pointed at them kept
pointing at an ID that no longer existed.

The same silence ran in the other direction. A loan could be written with a
borrower who was never a user, and nothing objected.

## Affected paths

| Path | What was wrong |
|---|---|
| `backend/app/models.py` | Fifteen `ForeignKey(...)` declarations, none enforced and none saying what should happen to the child row when the parent goes |
| `backend/app/auth.py` — `delete_user` | Deletes the user and writes an audit entry; nothing clears the six columns across five tables that point at them |
| `backend/app/schedules.py` — `_delete_schedule_db` | Clears `schedule_fixtures` and `fixture_loans.schedule_id` by hand, but never `sop_executions.schedule_id` — so deleting a schedule left the execution history pointing at nothing |
| `backend/app/fixtures.py` — `create_loan` | Writes `borrower_user_id` straight from the request body without checking the user exists |

## Preconditions

- The database is SQLite, and no connection has run `PRAGMA foreign_keys=ON`.
- A row exists that other rows reference: a user who keeps a fixture, applied for a
  schedule, or borrowed something; or a schedule that an SOP execution records.

## Steps to reproduce on the pre-fix revision

Deleting a user:

1. Create a user, then a fixture whose `keeper_user_id` is that user.
2. Delete the user through `DELETE /api/auth/users/{id}`.
3. Read the fixture back.

Deleting a schedule:

1. Create a schedule, then an SOP execution whose `schedule_id` is that schedule.
2. Delete the schedule through `DELETE /api/schedules/{id}`.
3. Read the execution back.

Writing a reference that was never valid:

1. `POST /api/fixtures/loans` with a `borrower_user_id` that belongs to nobody.

## Expected result

The database refuses to end up in a state its own schema says is impossible. Either
the delete clears the references, or it is refused; and a loan naming a borrower who
does not exist is rejected before it is stored.

## Actual result

All three went through. Measured on the pre-fix revision:

```
修正前 → 使用者已刪除，治具上的保管人 ID 還是： 1 （孤兒）
修正前 → 指向不存在使用者的借用紀錄也寫得進去： 1 筆
排程已刪除，執行紀錄仍指向排程 # 1 → 該排程存在嗎： False
```

The API returned success every time. Nothing appeared in any log.

## Evidence

- `PRAGMA foreign_keys` read back `0` on the application engine before the fix; the
  pragma is per-connection and nothing set it.
- The three lines quoted above were produced against the real models on an
  in-memory database with no enforcement — the pre-fix configuration exactly.
- `_delete_schedule_db` handled two of the three tables that reference a schedule.
  The third, `sop_executions.schedule_id`, was added later (BUG-009) and the delete
  path was never extended to match it — visible by reading the function.
- A scan of the development database at the time of the fix reported **zero**
  orphans (`PRAGMA foreign_key_check`), so no data had to be repaired. The defect
  was a missing guarantee, not existing damage.

## Root cause

Two separate causes with the same shape: a rule that was written down but never
made binding.

First, SQLite's default. Every other database enforces foreign keys as a matter of
course, so a declaration reads as a constraint. In SQLite it is inert unless each
connection opts in, and the opt-in has to be attached to connection creation — a
place nobody thinks about while writing a model.

Second, referential cleanup lived in application code, one delete path at a time.
That works right up until a new reference is added somewhere else: `sop_executions`
gained its `schedule_id` for report identification, and the schedule delete path,
written earlier, had no reason to know. Nothing connects the two, so the omission
is invisible.

## Impact

- Deleting a user left orphan IDs on fixtures, loans, schedules, guest tokens and
  blocked periods. The screens still read fine because names are also stored as
  text, which is exactly why nobody would notice.
- Deleting a schedule left the SOP execution history pointing at a schedule that no
  longer existed, which is the record a test report is built from.
- A loan could name a borrower who was never a user.
- Nothing failed loudly at any point, so the damage would accumulate silently and
  only surface as inexplicable data much later.
- Severity is Medium rather than High because the affected deletes are infrequent
  admin actions and the development database turned out to be clean. The
  probability of *creating* an orphan, however, was 100% for any delete of a
  referenced row.

## Resolution

- **Enforcement**: every SQLite connection now runs `PRAGMA foreign_keys=ON`
  through a connect-event hook. Alembic's own engine is deliberately excluded —
  changing a table in SQLite means building a new one, copying the rows, dropping
  the old one and renaming, which enforcement would block.
- **Declared behaviour**: each of the fifteen foreign keys now says what happens
  when the parent goes. References to a user become empty (`SET NULL`) — removing a
  person is an administrative act and should not be held hostage by history, the
  displayed name survives in its own text column, and accountability stays in the
  audit log. References to a fixture are refused (`RESTRICT`), which writes the
  existing soft-delete rule into the schema. A schedule takes its join-table rows
  with it (`CASCADE`) and empties the schedule reference on loans and executions;
  step records follow their execution.
- **Upgrade guard**: the migration scans with `PRAGMA foreign_key_check` before
  touching anything and refuses to run on a database that already contains orphans,
  naming the table and the count. It reports rather than repairs: whether an orphan
  should be cleared or investigated depends on the data, which is not a decision a
  migration should make on its own.
- **Clear rejection**: a loan naming an unknown borrower now returns 404
  `使用者不存在`, matching the sibling endpoint that sets a fixture's keeper, rather
  than surfacing a foreign-key violation as a 500.

Two things were considered and not done. Handling the deletes purely in application
code would have avoided the migration, but leaves the guarantee in the one place
that had already been shown to drift. Making references to a user `RESTRICT`
instead would preserve who confirmed a schedule, at the price of making anyone who
ever touched a schedule undeletable — the user directory already has a *disable*
action for retiring a person, so hard delete is for correcting mistakes.

## Verification

```bash
cd backend && ../venv/bin/python -m pytest tests/test_foreign_key_enforcement.py tests/test_schema_migrations.py
```

`tests/test_foreign_key_enforcement.py` pins the five behaviours that were absent:
a reference to a user who does not exist is rejected outright; deleting a user
empties every reference to them while the rows and their name snapshots survive;
deleting a schedule empties the reference held by loans and executions and takes
the join-table rows with it; deleting an execution takes its step records; and a
fixture with loans against it cannot be hard-deleted. Because the models declare no
ORM relationships, each of those outcomes is the database enforcing the schema
rather than SQLAlchemy imitating it.

`tests/test_schema_migrations.py` runs the whole migration chain on a scratch
database and compares every foreign key against the model — target table and delete
behaviour both — so changing one without the other turns red.

The migration itself was rehearsed on a copy of the development database before
being applied: fifteen foreign keys correct, forty-one indexes intact, row counts
unchanged, `foreign_key_check` clean, and `downgrade` restoring the previous shape.

One thing is not covered: the upgrade guard's refusal path was verified by hand on a
copy with a seeded orphan, not by an automated test. The migration runs once against
one database, so a test that reconstructs an old revision to prove it would cost
more than it protects.
