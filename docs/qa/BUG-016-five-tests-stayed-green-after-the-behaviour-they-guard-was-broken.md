# BUG-016 — Five tests stayed green after the behaviour they guard was broken

English · [繁體中文](BUG-016-five-tests-stayed-green-after-the-behaviour-they-guard-was-broken.zh-TW.md)

| Field | Value |
|---|---|
| **Bug ID** | BUG-016 |
| **Status** | Fixed |
| **Severity** | Medium |
| **Priority** | High |
| **Component** | The test suite itself — five tests across `backend/tests/` and `tests/e2e/specs/`, plus three production paths with no test at all |
| **Environment** | Local suite at `e63e1e6`: 466 pytest, 152 Vitest, 91 Playwright |
| **Found by** | Suite-wide audit by mutation testing, 2026-09-21 |
| **Reporter** | Sheng-Sheng Tsai |
| **Fix commit** | `cf7e744` (backend: calibration classification, datetime update paths, LINE push payload and webhook signature, auto-assign exclusions) and `2f1d9db` (E2E: keyboard reachability, top-bar counts, three row-action groups) |
| **Recording order** | Pre-fix record. Every mutation below was applied to a clean tree, the suite was run, the output was captured, and the mutation was reverted — all before any repair was attempted. The captured output is the evidence. The repairs followed, and each was verified by replaying the mutation recorded here |

## Summary

The product behaves correctly today. What this report documents is that five of
its guards do not.

A green suite is a claim: *if this behaviour breaks, something here will fail.*
The audit tested that claim the only way it can be tested — by breaking the
behaviour and re-running the suite. Five tests kept passing. Three further paths
turned out to have no test to break in the first place.

The failures are not distributed randomly. Each one is a test that asserts the
*shape* of an outcome rather than its *content*: that a key exists rather than
what it holds, that a call happened rather than what it carried, that a sum is
within bounds rather than what it sums to, that an element can take focus rather
than that a keyboard can reach it. Each reads as coverage in a test report and
buys nothing.

## Affected paths

Tests that did not fail when their subject was broken:

- `backend/tests/test_maintenance.py:240` — `test_calibration_status_api`
- `backend/tests/test_datetime_normalization.py` — the module claims to cover
  every endpoint accepting external datetimes; two update paths are absent
- `backend/tests/test_line_resilience.py:29` — the fake client records
  `called = True` and discards the arguments
- `tests/e2e/specs/top-bar-counts.spec.js:23`
- `tests/e2e/specs/keyboard-navigation.spec.js:145`

Production paths with no test:

- `backend/app/line.py:65` — `_verify_signature`, on the project's only
  unauthenticated externally-callable endpoint
- `backend/app/schedule_service.py:446` — the stuck/emergency exclusion in
  `_auto_assign`
- `client/src/UsersPage.jsx:439`, `client/src/FixturePage.jsx:1430`,
  `client/src/components/schedule/ManageBlockedPeriodsModal.jsx:154` — three
  row-action groups containing a delete button, outside the geometry spec

## Method

For each suspected test: start from a clean tree, apply a single mutation to the
production code the test names as its subject, run the full suite, record the
result, revert. A mutation that leaves the suite green is a test that cannot
detect that regression.

Mutations were chosen to be regressions a person could plausibly introduce — an
inverted comparison, a dropped normalisation call, a renamed field, a stray
`tabIndex` — not absurdities that no reviewer would miss.

## Evidence — tests that stayed green

### E1. The calibration status classification is unguarded

`backend/tests/test_maintenance.py:240` is the only test of
`GET /api/maintenance/calibration-status`. It runs against an empty database,
where every device is correctly `unknown`, and asserts:

```python
for device_id in ["CH-01", ..., "CH-05"]:
    assert device_id in data
    assert "status" in data[device_id]
```

`assert "status" in data[device_id]` cannot fail once the key exists. The
three-way classification — overdue, due soon, ok — is never exercised, because
no calibration record is ever created.

Mutation applied to `backend/app/devices_maintenance.py`:

```python
if days_remaining < 0:      status = CalibrationStatus.OK   # was OVERDUE
elif days_remaining <= 30:  status = CalibrationStatus.OK   # was DUE_SOON
else:                       status = CalibrationStatus.OK
```

Result: `466 passed`.

Every expired calibration now reports as normal. The device cards show no badge,
the maintenance summary counts zero overdue, and the suite is silent. Note the
asymmetry this creates with `backend/tests/test_calibration_status_labels.py`,
which rigorously guards that all four status values have Chinese labels — while
nothing guards that the backend still emits three of them.

### E2. Datetime normalisation is unguarded on the update paths

`backend/tests/test_datetime_normalization.py` opens by stating its scope:
every endpoint that accepts external time must store converted UTC. It covers
eight endpoints. The calibration and maintenance **update** paths are not among
them, although their **create** counterparts are.

Both update paths normalise through a string-keyed field list:

```python
for field, value in body.model_dump(exclude_none=True).items():
    if field in ("calibration_date", "next_calibration_date"):
        value = _to_naive_utc(value)
```

Mutation: replace `value = _to_naive_utc(value)` with `pass` at
`backend/app/devices_maintenance.py:139` and `:226`.

Result: `466 passed`.

Editing a calibration record now stores Taipei wall-clock time as UTC — an
eight-hour drift on a calibration due date, with no error. The create path
remains correct, so one table ends up holding both correctly converted and
silently wrong rows. The shape of the code makes this more likely than it
sounds: renaming a field in the Pydantic model without updating the string tuple
produces exactly this, and the suite would not notice.

### E3. LINE push content is unguarded

`backend/tests/test_line_resilience.py` is the only test of `push_message`. Its
fake client records that a call happened and discards what it carried:

```python
async def post(self, *_a, **_kw):
    self.called = True
```

The tests then assert `fake.called is True` or `is False`. The file's stated
scope is resilience — that a failing LINE API does not raise — and it tests that
well. But nothing else tests this function, so the payload has no guard.

Mutation: `backend/app/line.py:56`, `"text": text` → `"text": "MUTANT"`.

Result: `466 passed`.

Every alert — including emergency stop — now delivers a fixed string. Because
pushes are fire-and-forget through `asyncio.create_task`, and LINE returns 200
for a well-formed message regardless of content, there is no other signal. The
same mutation applied to `"to": target` sends every alert to the wrong
recipient, equally undetected.

### E4. The top-bar device counts are unguarded from below

`tests/e2e/specs/top-bar-counts.spec.js:23` asserts:

```js
expect(await total()).toBeLessThanOrEqual(DEVICE_COUNT);
```

An upper bound is satisfied by any undercount. The preceding
`expect.poll(() => statValue("不可用")).toBe(SEEDED_MAINT_COUNT)` pins one of
the four numbers, which rules out all-zeros; the other three are unconstrained
below.

Mutation: `client/src/components/control/TopBar.jsx:14`, filter on `"RUNNINGX"`
so the running count is always 0.

Result: `1 passed`.

Two running chambers vanish from the header. The number a user reads to see
what the lab is doing shows zero, and the assertion that exists to protect
these counts holds, because 3 ≤ 5.

### E5. The fixture import keyboard test proves nothing about the keyboard

`tests/e2e/specs/keyboard-navigation.spec.js:145` is titled
「治具匯入用鍵盤進得去」 (the fixture importer is reachable by keyboard). Its body:

```js
const choose = page.getByRole("button", { name: "選擇檔案" });
await choose.focus();
await expect(choose).toBeFocused();
```

`locator.focus()` sets focus programmatically, bypassing tab order entirely, and
`getByRole("button")` has already established the element is a button before
`focus()` is called. The assertion restates the locator.

Mutation: add `tabIndex={-1}` to the button in
`client/src/components/fixture/ImportModal.jsx`.

Result: `1 passed`.

The button is now unreachable by Tab. A keyboard user cannot import fixtures —
the precise regression the test's own comment says it exists to prevent, citing
the earlier bug where the only entry point was a `div` wrapping a
`display:none` file input.

`.claude/rules/testing.md` already states this: *"`focus()` 只證明「這是按鈕、
Enter 有反應」，不證明「Tab 走得到」"*. The same file's final test
(`keyboard-navigation.spec.js:195`) does it correctly, pressing Tab repeatedly
and asserting where focus lands. The import test was written to the wrong
pattern.

## Evidence — paths with no test

These are absences rather than failures, so the evidence is a search that
returns nothing rather than a mutation that survives. Listed separately because
the evidence is weaker in kind.

### G1. The LINE webhook signature check

`backend/app/line.py:65`, enforced at `:299`. This is the only endpoint in the
project that is externally callable without authentication
(`.claude/rules/api-conventions.md` says so explicitly).

Searching `backend/tests/` and `tests/` for `webhook`, `_verify_signature`, or
`X-Line-Signature` returns two hits, both in
`backend/tests/test_guest_authorization.py`: a comment, and an allowlist entry
that exempts the route from the admin-write check. Neither asserts anything
about signatures.

Neither branch is tested: a valid signature being accepted, or a bad one
returning 400. Worse, the function short-circuits when the secret is unset:

```python
if not secret:
    return True
```

and `tests/e2e/run-e2e.sh:38` sets `LINE_CHANNEL_SECRET=""`. The E2E harness
therefore exercises the pass-through branch. This is the failure mode the rules
file warns about by name: *"本機測起來過」不代表驗證有效"*.

### G2. The auto-assign exclusion for stuck and emergency chambers

`backend/app/schedule_service.py:446` excludes chambers that are stuck past
their estimated end or sitting in EMERGENCY. `backend/tests/test_linkage.py:48`
tests `_get_stuck_devices` and `_get_emergency_devices` thoroughly in isolation,
but nothing wires them to `_auto_assign`: the two tests that call it
(`backend/tests/test_schedules_slot.py:122` and `:131`) pass no cache, so the
exclusion branch is never entered. `:122` asserts only
`device_id in DEVICE_IDS`, which the function satisfies by construction.

A schedule assigned to a dead chamber will be refused at start time by
`test_schedule_start_consistency.py`'s subject, which is correct and well
tested — so the visible symptom is a schedule that parks in CONFIRMED and
retries every five minutes forever.

### G3. Three row-action groups containing a delete button

`.claude/rules/frontend.md` requires that delete buttons in a row-action group
sit last with extra separation, and states that
`tests/e2e/specs/row-action-hit-area.spec.js` guards this by measuring real
geometry — adding: *"新增用到列動作的頁面時，一併把它加進那支測試，不然那一頁
沒有任何東西擋著"*.

Eight `rowActions` containers exist. The spec covers three. Three of the
uncovered five contain a delete button:

- `client/src/UsersPage.jsx:439` — guest tokens (disable, delete)
- `client/src/FixturePage.jsx:1430` — purchase orders (confirm arrival, delete)
- `client/src/components/schedule/ManageBlockedPeriodsModal.jsx:154` —
  maintenance windows (edit, delete)

All three currently set the required separation, so there is no defect today.
The gap is that nothing would notice its removal, which is what the rule says
lint cannot see. The third is the most consequential: deleting a maintenance
window removes the lock that keeps both scheduling and on-floor start off a
chamber.

## Root cause

The five green tests share one shape: each asserts a property that the code
satisfies by construction.

| Test | What it asserts | Why that holds regardless |
|---|---|---|
| E1 | the `status` key is present | the handler always builds the key |
| E2 | — | the path is simply not covered |
| E3 | a call occurred | the client is always called |
| E4 | a sum is ≤ a bound | any undercount satisfies it |
| E5 | an element can take focus | `getByRole("button")` already proved that |

This is not carelessness about assertions in general — the same suite contains
`test_deploy_config.py`, which parses an IP range and tests membership rather
than matching a string, and `users-page-feedback.spec.js`, which pastes the
clipboard back into a field rather than trusting a success toast. The weak tests
are the ones written to confirm a fix rather than to describe an invariant: the
author knew the behaviour was correct at that moment, and wrote an assertion
that observed it rather than one that constrained it.

The three untested paths share a different cause — each sits behind a boundary
the suite does not cross. The webhook needs a signed request, the auto-assign
exclusion needs a device cache, the row geometry needs a browser with layout.
All three are reachable; none is convenient.

## Impact

No user is affected today. Every mutation was reverted; the product is correct.

The impact is on what the suite can promise. Five behaviours currently carry a
green check that means nothing, and the two most consequential — calibration
expiry classification and datetime normalisation — are in compliance-relevant
paths. An expired calibration reported as normal is an ISO 17025 problem, not a
cosmetic one. An eight-hour drift on a due date silently reschedules the next
calibration.

The unauthenticated webhook is the widest exposure: it is the one entry point an
outsider can reach, its signature check has never been tested in either
direction, and the harness that would notice runs in the branch where the check
is disabled.

## Resolution

All eight are fixed. The production code was not changed — it was correct
throughout. What changed is what the suite asserts.

| | Repair | Location |
|---|---|---|
| E1 | Calibration records created at known offsets; all three classifications asserted, plus latest-record-wins | `backend/tests/test_maintenance.py` |
| E2 | Datetime round-trip extended to both update paths, seeded with a different value first so a no-op fails | `backend/tests/test_datetime_normalization.py` |
| E3 | The fake client records its arguments; recipient, text and auth header are asserted | `backend/tests/test_line_resilience.py` |
| E4 | The seeded running count is pinned, so an undercount fails while the upper bound still tolerates cooldown and paused chambers | `tests/e2e/specs/top-bar-counts.spec.js` |
| E5 | `focus()` replaced with repeated Tab presses, then Enter, asserting the file chooser opens | `tests/e2e/specs/keyboard-navigation.spec.js` |
| G1 | New file: valid, wrong, missing and tampered signatures, each with the secret set; plus the unset-secret pass-through pinned deliberately | `backend/tests/test_line_webhook_signature.py` |
| G2 | A cache is passed to `_auto_assign`; emergency and stuck chambers must be skipped, and the all-excluded fallback must still return a device | `backend/tests/test_schedules_slot.py` |
| G3 | The three uncovered row-action groups added to the geometry spec | `tests/e2e/specs/row-action-hit-area.spec.js` |

Two notes on what the repairs revealed.

E1's first draft asserted `days_remaining` equals the offset it seeded. It
failed: `days_remaining` is computed against the current instant, not against
midnight, so a due date one day out reads as −2 rather than −1. That is the
endpoint's real behaviour and not a defect, but it means inputs sitting exactly
on the 0-day and 30-day thresholds land on either side depending on the time of
day. The test now stays clear of both thresholds and says why.

E4 was not changed to an equality. The upper bound exists because chambers in
cooldown or paused legitimately fall outside these four numbers, and an equality
would go red whenever a chamber transitions mid-run. Pinning the seeded running
count separately closes the undercount hole without reintroducing that
flakiness.

Suite size: backend 466 → 487, E2E 91 → 94, frontend 152 unchanged.

## Verification

Each repair was verified by replaying the exact mutation recorded above and
confirming the suite now fails — the same procedure, run in the opposite
direction.

| Mutation replayed | Result |
|---|---|
| E1 — all three classifications return `ok` | 4 failed |
| E2 — `_to_naive_utc` dropped on both update paths | 2 failed |
| E3 — message text replaced; recipient replaced | 1 failed each |
| E4 — running count filter never matches | 1 failed |
| E5 — `tabIndex={-1}` on the file-chooser button | 1 failed |
| G1 — signature check removed | 3 failed |
| G2 — stuck/emergency exclusion bypassed | 1 failed |
| G3 — delete button's separation removed | 1 failed |

Every mutation that this report captured as surviving now turns the suite red.
A repair that did not achieve that would not have fixed anything.
