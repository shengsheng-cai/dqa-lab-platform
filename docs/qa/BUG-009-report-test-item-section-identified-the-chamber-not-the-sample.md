# BUG-009 — The report's test-item section identified the chamber, not the sample under test

English · [繁體中文](BUG-009-report-test-item-section-identified-the-chamber-not-the-sample.zh-TW.md)

| Field | Value |
|---|---|
| **Bug ID** | BUG-009 |
| **Status** | Fixed |
| **Severity** | High |
| **Priority** | High |
| **Component** | SOP execution report generation — report identification and test-item sections (`reports.py`) |
| **Environment** | FastAPI backend, any deployment; affects every CSV and PDF report ever produced |
| **Found by** | ISO/IEC 17025 §7.8.2.1 compliance review, 2026-08-08 |
| **Reporter** | Sheng-Sheng Tsai |
| **Fix commit** | `d01f68fb405d33bba8288663b4a8bf4d07fd1216` (report written before the fix, per the project's defect workflow) |

## Summary

Both report formats carry a section headed 「受測樣品資訊 Test Item Information」
(CSV) / 「受測樣品 Test Item」 (PDF). Neither section contains a single field
that identifies the item under test. What they actually print is the **chamber**
— `CH-01` — followed by the identity of the test method.

The sample name, the project number, and the customer all exist in the database
on the `schedules` row that drove the test. None of them reach the report,
because `sop_executions` has no foreign key back to `schedules` — the report has
no path to that data at all.

ISO/IEC 17025:2017 §7.8.2.1 lists the items a report shall contain. Six are
missing: (b) laboratory name and address, (e) customer identification,
(g) identification of the item tested, (h) date of receipt of the item,
(l) a statement that the results relate only to the items tested, and
(n) additions to or deviations from the method.

Of these, **(g) is the serious one**: the report does not merely omit the item
identification, it presents equipment identification under a heading that claims
to be item identification.

## Affected paths

| Path | Wrong behaviour |
|---|---|
| `reports.py` — `download_csv_report`, §2 「受測樣品資訊 Test Item Information」 | Prints 設備編號 (the chamber), then SOP ID, 測試名稱, 測試類型, SOP 版本, 參考法規 — all of which identify the *method*, not the item. No sample name, no project number, no customer |
| `reports.py` — `_build_pdf`, §2 「受測樣品 Test Item」 | Same content, same omission |
| `reports.py` — §1 「報告識別 Report Identification」, and the report banner | The banner prints the bare string `DQA Lab Platform` and no address; §1 carries no laboratory identification at all. Nothing states that results relate only to the items tested |
| `models.py` — `SopExecution` | No `schedule_id`, so no execution record can be traced to the case that ordered it. This is what makes the omission structural rather than a forgotten query |

## Preconditions

None. Every report is affected — there is no input, SOP, or device for which
the test-item section identifies the item.

## Steps to reproduce on the pre-fix revision

1. Create a schedule carrying real case data (sample name, project number,
   applicant), assigned to `CH-01`.
2. Run it, or seed an `sop_executions` row for `CH-01` covering the same window.
3. Download the CSV or the PDF report for that execution.
4. Read §2, the section headed 「受測樣品」.

## Expected result

§2 identifies the item that was tested: at minimum its name and the project or
case number it belongs to, so a reader can tell *what* was tested apart from
*how* it was tested. The report also identifies the issuing laboratory, and
states that the results relate only to the items tested.

## Actual result

§2 identifies the chamber and the method. Reproduced against the current
revision on a seeded database:

```
============================================================
  2. 受測樣品資訊  Test Item Information
============================================================
  設備編號 Device ID:               CH-01
  SOP ID:                       iec60068_ab_-40_16h
  測試名稱 Test Name:               低溫儲存 Test Ab：-40°C，16 小時（非通電）
  測試類型 Test Type:               chamber
  SOP 版本 SOP Version:           IEC 60068-2-1:2007
  參考法規 Reference:               IEC 60068-2-1:2007 Test Ab
```

The case data present in the database at that moment
(`MX-1000 工業乙太網路交換器` / `PRJ-2026-0042` / `王小明`) appears nowhere in
the report; a substring search for each of the three returns `False` against the
full report text.

The laboratory identification is the banner in its entirety:

```
  ========================================================
  DQA Lab Platform
  環境測試報告  Environmental Test Report
  ========================================================
```

## Evidence

- Test-item sections: [`reports.py`](../../backend/app/reports.py) —
  `download_csv_report` §2 and `_build_pdf` §2, both of which build their rows
  from `execution.device_id` and `sop_data`.
- Missing link: [`models.py`](../../backend/app/models.py) — `SopExecution` has
  `sop_id`, `device_id`, `operator`, timestamps and photo paths, and no
  `schedule_id`.
- The data that should be printed: [`models.py`](../../backend/app/models.py) —
  `Schedule.sample_name`, `Schedule.project_number`, `Schedule.applicant_name`.
- Reproduction: a throwaway script seeded one schedule plus one execution and
  printed §1–§2 of the CSV report, with the console output quoted above. It was
  run from the scratchpad and deliberately not kept; the standing regression
  protection will be the tests added with the fix.

## Root cause

The execution record was never linked to the case that ordered the test. An
`sop_executions` row records what was run (`sop_id`), where (`device_id`), by
whom (`operator`) and when — everything about the *execution*. The item under
test is not a property of the execution; it is a property of the *case*, which
lives on `schedules`. With no foreign key between them, the report layer had no
data to print even if it had asked.

The section heading was then written to describe what the section *ought* to
contain rather than what it could actually source, which is what turned a
missing field into a misleading one.

The laboratory identification has a simpler cause: the banner was written as a
title, not as the §7.8.2.1(b) field, so it never grew an address or any other
identifying detail.

## Impact

- The report claims to identify the item tested and does not. A reader —
  including the customer the report is issued to — sees a populated section and
  has no signal that it describes the chamber rather than their sample. This is
  worse than an obviously empty report: it is wrong in a way that looks right.
- Two ISO/IEC 17025 §7.8.2.1 "shall" items with an available data source
  ((e) and (g)) are unmet, plus (b) and (l) which need only fixed text.
- Every report ever produced by this system is affected.
- No stored data is wrong or lost. The sample name, project number, and customer
  are all still on the schedule; only the link and the printing are missing, so
  no historical record needs correcting — affected reports need regenerating
  once the link exists for records created after the fix.

## Resolution

- `SopExecution` gained `schedule_id`, a nullable foreign key to `schedules`,
  with an Alembic migration. Nullable because a genuinely ad-hoc test has no
  case, and that must remain representable.
- Both start paths (ad-hoc and scheduled) already funnel through one place,
  which receives the schedule when there is one, so they populate the column
  directly.
- The record saved from the SOP page at the end of a test — the row a user
  actually downloads a report for — carries no schedule context from the
  browser. It resolves the case by matching *device plus exact test start
  instant* against the row created at test start, and inheriting that row's
  `schedule_id`.

  An earlier draft of this fix instead asked "which schedule is running on this
  device right now". Review rejected that: it is a proxy, not the fact. If the
  operator saves after the next schedule has already started on the same
  chamber, the proxy attaches **another customer's sample** to this report —
  a worse defect than the one being fixed. Inheriting from the start row cannot
  do that; when it fails to match it yields nothing, and the report says there
  is no case.

  This is why the start instant is now taken once and shared between the
  device-state cache and the execution row rather than each calling `now()`
  separately: a few microseconds of drift would break the match silently, and
  every report would quietly lose its sample identification. A test pins that
  invariant, and `.claude/rules/api-conventions.md` records it.
- §2 prints the case data when the link exists. When it does not, it says so
  explicitly rather than falling back to equipment identification: an ad-hoc
  test with no case reads as having no case.
- Laboratory identification (b) and the "results relate only to the items
  tested" statement (l) were added as fixed text. The laboratory is labelled
  explicitly as a portfolio simulation with no physical address, rather than
  carrying an invented one.
- The chamber identifier moved from §2 to §3 「測試條件」, where equipment
  belongs. §2 was retitled 「受測樣品與測試方法」 and lists the sample before
  the method, so the section answers "what was tested" before "how".
- (h) date of receipt and (n) method deviations are **deliberately out of
  scope**: this Demo has no sample-intake process and no method-deviation
  record, so there is no data source to print. Inventing either would be worse
  than declaring them absent.

## Verification

```bash
cd backend && ../venv/bin/python -m pytest tests/test_reports_degradation.py tests/test_schema_migrations.py -v
```

The CSV assertions are made against the rendered report text: a linked
execution prints its sample name, project number and customer in §2 and no
longer prints the chamber there; an unlinked one prints the no-case statement
instead. Two further tests pin the inheritance itself — that a saved record
adopts the start row's case, and that it refuses to adopt a *later* schedule's
case, which is the failure the rejected approach would have had.

The timestamp invariant the mechanism rests on is pinned twice: once that the
start row and the device-state cache hold the same instant, and once that the
device API serialises it without truncating. Both were checked against their
pre-fix behaviour — reverting the shared instant fails the first with a
27-microsecond difference, which is exactly the silent breakage the test
exists to catch.

The migration was run against a fresh database and inspected directly: the
column, its index and the foreign key all survive the SQLite batch table
rebuild, and `downgrade` reverses it cleanly. `test_schema_migrations.py`
covers the column itself on every run, though not indexes.

PDF content is **not** asserted. Extracting text from the rendered PDF would
require a parsing dependency this project does not carry, and adding one for a
single assertion is not worth it. The PDF and CSV share the same case-resolution
helper, so the data itself is pinned by the CSV tests; the PDF path is covered
by a build smoke test only. This is the same trade-off the project already makes
for rendered output elsewhere.
