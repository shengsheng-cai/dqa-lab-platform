# BUG-008 — The report's measurement summary averaged a different data window than its own uncertainty analysis, so PDF and CSV disagreed on average temperature

English · [繁體中文](BUG-008-report-summary-disagreed-with-uncertainty-analysis.zh-TW.md)

| Field | Value |
|---|---|
| **Bug ID** | BUG-008 |
| **Status** | Fixed |
| **Severity** | Medium |
| **Priority** | Medium |
| **Component** | SOP execution report generation — measurement summary calculation (`reports.py`, `uncertainty.py`) |
| **Environment** | FastAPI backend, any deployment; affects every completed execution that has a temperature target and the normal ramp-then-dwell sensor profile — not an edge case |
| **Found by** | ISO/IEC 17025 §7.8.3.1 compliance review, 2026-08-08. Extended by the four-gate review of the fix, 2026-08-09, which found the same contradiction reached the CSV report too |
| **Reporter** | Sheng-Sheng Tsai |
| **Fix commit** | `59188105590575114d666c315857f2fe9f8fff35` |

## Summary

A PDF report's own sections disagreed with each other, and the CSV report
agreed with neither.

Section 5 (量測不確定度分析) computes its mean from the **stable segment** —
the samples that fall within the SOP's temperature tolerance band — because
that is what a GUM uncertainty calculation is supposed to average. Section 6
(數據統計) computed its max/min/average from the **entire data window**, ramp
phases included. The CSV report's own measurement-summary section did the
same full-window arithmetic and never touched the uncertainty module at all.

Three numbers, three different data windows, for one execution.

## Affected paths

| Path | Wrong behaviour |
|---|---|
| `reports.py` — `_build_pdf`, §6 「數據統計」 | `temp_max`/`temp_min`/`temp_avg`/`humi_avg` were computed with `sum(temps)/len(temps)` etc. over the full `device_records` window, ignoring the `u_temp`/`u_humi` already computed a few lines earlier for §5 |
| `reports.py` — `download_csv_report`, §5 「測試數據統計」 | Same full-window arithmetic; never called `unc.calc_temp`/`calc_humi` at all, so its own 「量測不確定度」 row was a fixed placeholder string rather than a computed value |

## Preconditions

- The execution has sensor data spanning both a ramp phase (outside the
  temperature tolerance band) and a dwell/stable phase (inside it) — true of
  essentially every real thermal test, since ramp time is part of any
  profile.
- The SOP has `high_temperature`/`target_temperature` set, so an uncertainty
  analysis is attempted at all (`target_high is not None`).

## Steps to reproduce on the pre-fix revision

1. Run any SOP with a temperature target to completion (for example
   `iec60068_ab_-40_16h`), or seed sensor data spanning a ramp segment plus a
   dwell segment for an existing execution.
2. Download the PDF report for that execution. Compare the average
   temperature printed in §5.1 (量測結果：溫度 = ... ± U) against 平均溫度 in
   §6 (數據統計).
3. Download the CSV report for the same execution and compare its 平均溫度
   against both PDF values.

## Expected result

All three numbers — PDF §5.1, PDF §6, and CSV — report the same average
temperature for the same execution, reflecting the same stable-segment
definition the uncertainty analysis already used.

## Actual result

Three different numbers. §6 and CSV's full-window average was pulled toward
whatever data dominated the window — for a cold-chamber test, that meant
being biased toward room temperature during the ramp — while §5.1's
stable-segment mean sat at the actual target condition. CSV additionally
printed a static placeholder ("待儀器校正證書確認") on its uncertainty row
instead of any computed value, even though the average it displayed implied
one had been calculated.

## Evidence

- Contradiction: [`reports.py`](../../backend/app/reports.py) — pre-fix
  `_build_pdf`'s §6 block computed straight from `temps`/`humis`;
  `download_csv_report` did the same and never constructed a `u_temp`/`u_humi`
  at all.
- Stable-segment definition: [`uncertainty.py`](../../backend/app/uncertainty.py)
  `calc()` — the `stable = [v for v in values if abs(v - target) <= tolerance]`
  filter, already used by §5 before this fix.
- Regression tests:
  [`test_reports_degradation.py`](../../backend/tests/test_reports_degradation.py)
  (`test_summary_stats_matches_uncertainty_mean_not_full_window_average`,
  `test_csv_report_avg_temp_matches_uncertainty_stable_segment`),
  [`test_uncertainty.py`](../../backend/tests/test_uncertainty.py)
  (`test_stable_segment_filter`).

## Root cause

Three computations of the same statistic, kept in step by nothing. §5 was
built to run a real GUM uncertainty analysis and needed the stable segment to
do it honestly — a mean taken over ramp data would not describe measurement
repeatability at the test condition. §6 predates that addition and was never
updated to read the same segment; the CSV report never gained an uncertainty
section at all, so its average was written the simple way and stayed that
way.

Nothing tied the three computations to a single source of truth for "what
data window does the measurement summary describe" — each answered the
question independently, and two of the three answers were wrong for a
document that presents itself as one coherent set of results.

## Impact

- ISO/IEC 17025 §7.8.3.1 requires a reported measurement result to carry its
  uncertainty. Here the report carried two different measurement results, and
  only one of them carried any uncertainty at all — a reader has no way to
  tell which number is "the" result.
- Every PDF report with a temperature target and a normal ramp-then-dwell
  profile was affected. This was not an edge case.
- No stored data was wrong; the defect was in how already-correct sensor
  readings were aggregated for display. No historical record needed
  correction — only regeneration of any report issued before the fix.

## Resolution

- `uncertainty.py`'s `UncertaintyResult` now exposes `data` — the exact
  sample list its own `mean` was computed from (the stable segment, or the
  full window when the stable segment had fewer than 5 points).
- `reports.py` gained `_compute_uncertainties` (shared by both formats, so
  they cannot drift onto different uncertainty results), plus
  `_summary_stats`/`_summary_avg`. Both the PDF's §6 and the CSV's
  measurement summary now derive max/min/average from the same `u.data` §5's
  own numbers come from, falling back to the full window only when no
  uncertainty analysis was possible (no target set).
- The CSV report now computes `u_temp`/`u_humi` for the first time, so its
  average temperature agrees with the PDF's for the same execution. A later
  product-boundary decision excluded external calibration documents, so the
  uncertainty row now states that this demo estimates sensor resolution only.
- Humidity's average was fixed the same way in the same edit, since it shared
  the exact code path with temperature.

## Verification

```bash
cd backend && ../venv/bin/python -m pytest tests/test_reports_degradation.py tests/test_uncertainty.py -v
```

`test_summary_stats_matches_uncertainty_mean_not_full_window_average` builds
a ramp-plus-dwell dataset where the two averages are mathematically
guaranteed to differ, then asserts the summary helper returns the
stable-segment value rather than the full-window one — it discriminates
against the pre-fix formula instead of passing by coincidence.
`test_csv_report_avg_temp_matches_uncertainty_stable_segment` exercises the
same claim through the real HTTP route function, not just the helper: it
decodes the actual CSV bytes and checks the printed line.
