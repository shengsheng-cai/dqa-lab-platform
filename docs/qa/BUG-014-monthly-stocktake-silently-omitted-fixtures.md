# BUG-014 — Monthly stocktake silently omitted off-site fixtures and still reported the partial count as complete

English · [繁體中文](BUG-014-monthly-stocktake-silently-omitted-fixtures.zh-TW.md)

| Field | Value |
|---|---|
| **Bug ID** | BUG-014 |
| **Status** | Fixed |
| **Severity** | Medium |
| **Priority** | Medium |
| **Component** | Fixture monthly-stocktake scope and completion result (`StocktakeModal.jsx`) |
| **Environment** | Admin fixture page; any deployment with loaned or reserved fixtures |
| **Found by** | Codex whole-project UX review, 2026-08-19 |
| **Reporter** | Sheng-Sheng Tsai |
| **Fix commit** | `f496d13969ba73bca6f631eb93578dc7653a0fa0` |
| **Report timing** | Written after the fix; the pre-fix screen was recreated on 2026-08-24 in an isolated checkout of `4b566f46f616b9ce67dae885fcdb802e176e72c9` |

## Summary

The monthly stocktake listed only fixture types whose full quantity could be counted on site. If any unit of a
fixture type was loaned or reserved, the entire type was filtered out of `active`. The screen did not name the
omitted fixtures or say how much of the catalogue the list covered.

Submission used that same `active` list to calculate the “normal/difference” success result. An operator could
therefore count only a small subset and still receive “stocktake complete”. If every type was excluded, the empty
dialog still allowed submission and reported zero normal and zero differences. The omitted stock was not
overwritten, but “not counted” was presented as “no difference”.

## Preconditions

- At least one fixture type has a loaned or schedule-reserved unit.
- An administrator can open the fixture table and monthly stocktake.

## Steps to reproduce on the pre-fix revision

1. Start pre-fix commit `4b566f46f616b9ce67dae885fcdb802e176e72c9` with the demo seed.
2. Sign in as an administrator and open Fixture Management.
3. Confirm that the table contains six fixture types, several loaned or reserved.
4. Select “Start monthly stocktake”.
5. Compare the catalogue count with the fixture types listed in the dialog.

To exercise the empty-list branch, give every fixture type at least one loaned or reserved unit, reopen the dialog,
and select “Complete stocktake”.

## Expected result

- Types that cannot be counted fully on site remain visible in the scope summary and state why they are excluded.
- Counted types plus excluded types always equals the complete fixture catalogue.
- When no type can be counted, completion is disabled and cannot produce a success result.

## Actual result

- Of six fixture types, the dialog listed only `USB-C / Gen2`; the other five disappeared silently. (This originally called it the only countable type; that was wrong — see the follow-up correction at the end.)
- The introductory copy implied that the visible row was the complete stocktake scope.
- The completion button was disabled only while a request was in flight, not when the list was empty.
- The success message counted only the surviving rows and disclosed no excluded total.

## Evidence

![Pre-fix monthly stocktake listing only one of six fixture types](assets/BUG-014-monthly-stocktake-before.jpg)

The screenshot was not captured contemporaneously with the fix. It was recreated afterwards by running the
pre-fix commit above against an isolated demo database. The fixture page behind the dialog says there are six
fixture types; the stocktake dialog contains only `USB-C / Gen2`.

Before the fix, `StocktakeModal.jsx` built `active` from fixture status, rendered only `active`, and used only
`active` for requests and the completion message. There was no complementary `excluded` set, total reconciliation,
or empty-list guard.

## Root cause

One array represented two different concepts:

1. whether the full quantity of a fixture type can be counted on site now; and
2. whether that fixture type belongs to the scope of this stocktake.

A loaned or reserved type should not accept a full on-site count, but it does not cease to belong to the stocktake.
Because `active` controlled rendering, API writes, and the success summary, filtered data also lost its “not
counted” identity. No invariant required `counted + excluded = total`, so an incomplete list produced no observable
failure.

## Impact

- An administrator could mistake a partial count for a completed monthly stocktake and gain false confidence in
  inventory completeness.
- The fixtures most likely to disappear were the ones moving outside the lab — the types whose whereabouts most
  need to be explicit.
- No omitted quantity was written incorrectly, so severity is Medium rather than High; the defect falsified scope
  and result semantics rather than stored stock.
- The defect occurred whenever any fixture was loaned or reserved; no race or API failure was required.

## Resolution

[`StocktakeModal.jsx`](../../client/src/components/fixture/StocktakeModal.jsx) now partitions fixtures into
complementary `active` and `excluded` sets:

- Countable types keep the existing actual-quantity inputs.
- Excluded types list their fixture identity, system stock, loaned count, and reserved count, with an explanation
  that their full quantity cannot be verified on site.
- The footer reports “N types covered, M types excluded”.
- When `active.length === 0`, the dialog shows an explicit empty state and disables completion.

The resolution does not pretend to count off-site fixtures and does not write them back to stock. It makes the
boundary of the operation visible and reconcilable.

## Verification

```bash
make test-e2e ARGS="specs/stocktake-scope.spec.js"
```

[`stocktake-scope.spec.js`](../../tests/e2e/specs/stocktake-scope.spec.js) first reads the total fixture-type count
from the page, opens monthly stocktake, requires an excluded section, and asserts:

```
covered types + excluded types = total fixture types
```

It also requires at least one excluded type in the demo seed, avoiding a vacuous all-zero pass.

The E2E does not separately seed the “every type is off site” case to click-check the disabled button. That branch
is protected by `disabled={loading || active.length === 0}` in the component; it remains a residual test gap if
stocktake rules change again.

## Follow-up correction (2026-09-17)

**Timing**: the issue was found in the whole-repository architecture review on 2026-09-17; this section was written
together with the fix. The pre-fix screens were captured before the change, against an isolated demo database.

The original report called `USB-C / Gen2` the only type that could be counted fully on site. That was wrong: in the
pre-fix seed it had one overdue loan. It made the list because the check read the single word on the fixture's
status badge. The badge can show only one state, in the order out of stock > low stock > on loan > reserved;
USB-C was manually marked one unit short, so the badge said “low stock” and hid the loan. The resolution above kept
the same check, so the misclassification survived, and the E2E only asserted `covered + excluded = total`, which
still passes when an item lands on the wrong side.

Unlike the original defect, this one **writes wrong stock**: submitting the shelf count shrinks the total, and the
loaned unit does not come back when it is returned. The same outcome had three entry points:

| Entry point | Before the fix |
|---|---|
| Monthly stocktake dialog | A low-stock type with a loaned or reserved unit was listed as countable |
| Quick count on the fixture row | Accepted a count for any fixture, whether or not units were out |
| “Add a row” in inventory-log batch editing | Same as above |

The “on loan” status filter read the same badge word, so it did not show USB-C either.

For the reproduction the seed gained an `HDMI / 2.1` fixture with nothing loaned or reserved, as a genuinely
countable control; it also keeps something countable in the demo stocktake after the fix.

![Before the fix: USB-C has a unit on loan yet is listed as countable next to HDMI](assets/BUG-014-followup-stocktake-counted-loaned-fixture-before.png)

![Before the fix: M.2 has two units on loan; a quick count of 2 changed its stock from 4 to 2](assets/BUG-014-followup-quick-count-overwrote-loaned-fixture-before.png)

**Resolution** (in the same commit as this correction):

- [`fixtureStatus.js`](../../client/src/utils/fixtureStatus.js) splits “which word the badge shows”, “can it be
  counted on site”, and “the on-loan filter” into three explicit checks shared by the stocktake dialog, quick
  count, batch add, and the filter.
- The backend `record_inventory_count`, shared by both counting APIs, returns 409 while units are loaned or reserved
  and says to use “Edit” to change the total deliberately. Editing an existing inventory log is intentionally left
  unguarded: it is the way to repair totals this defect already shrank.

**Verification**:

```bash
cd backend && ../venv/bin/python -m pytest tests/test_fixtures_api.py
cd client && npm test
make test-e2e ARGS="specs/stocktake-scope.spec.js"
```

- `test_fixtures_api.py` asserts a 409 with the total unchanged for both counting APIs and for both loaned and
  reserved units; a fixture whose loans are all returned can still be counted.
- `fixtureStatus.test.js` pins that a low-stock fixture with a loan is not countable and does appear under the
  on-loan filter.
- `stocktake-scope.spec.js` adds three tests: the stocktake partition, the quick-count cell stating its reason, and
  the disabled choices in batch add.
