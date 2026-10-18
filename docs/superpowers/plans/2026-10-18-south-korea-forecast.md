# South Korea Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 South Korean spots (Yangyang, Gangneung, Pohang, Busan, Jeju, Taean) to waveslave.tw behind a "Korea" country button, with airport wind, the JMA MSM wind forecast, model tides, the map home view and a separate `log-kr/`. Live buoys and tide tables wait for keys (Phase 2 in the spec).

**Architecture:** Same pattern as Australia. A new `kr.py` (modeled on `au.py`) fills the Korean spots from three optional downloads; refresh.sh runs it after Australia; log/history/correct run with `kr`; the page adds a seventh country after Japan.

**Tech Stack:** POSIX sh, Python 3 stdlib (`zoneinfo`), vanilla JS in `template.html`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-18-south-korea-forecast-design.md`

## Tasks

- [ ] **1. Fixtures.** Save one reply of each new download under `tests/fixtures/kr/`: `metar-kr.json` (aviationweather.gov, RKNY, RKPK, RKPC, last 3 h), `openkr.json` (Open-Meteo `models=jma_msm` for the 8 spots), `tidekr.json` (Open-Meteo marine `sea_level_height_msl`), and a `snap_in.json` with the Korean spots as snap.py writes them.
- [ ] **2. Tests first.** `tests/test_kr.py`: METAR newest-report pick (calm, variable wind, a report over 3 hours old, a missing airport); `fill()` gives every spot `tz` 9, `dwind`, a 3-hourly `wind`, tide highs and lows, sun times and an empty buoy; a spot without an airport gets no wind now. `tests/test_logsplit.py`: `log.py`, `correct.py` and `history.py` with `kr` touch only the Korean spots.
- [ ] **3. kr.py.** `metar_wind(reports, icao, now)` and `fill(snap, spots, dl, now)`, reusing `jp.wind_rows`, `au.tide_days`, `jp.sun_times` and `ca.utc_to_tpe`. Run the tests until they pass.
- [ ] **4. spots.json.** The 8 spots, with names, regions and station names in zh and ja.
- [ ] **5. refresh.sh and the workflow.** The Korea section after Australia, history/log/correct lines for `kr`, `log-kr` in the workflow's restore list.
- [ ] **6. template.html.** Country button after Japan (zh 韓國, ja 韓国), the Korea outline in `HOME_ICONS`, `HOMES.kr` and `OLDBOX.kr`, "Model tide" for Korea, the JMA MSM legend, KMA's typhoon link, footer credits, the comment listing the countries.
- [ ] **7. Map checks.** A Korea home view in `tests/map/check.js` (`HOMES`) and the country column check; `tests/map/tool.py` builds with the Korean fixture.
- [ ] **8. Verify.** Unit tests, map math tests, `check.js` upright and sideways on a local build from real downloads; the other countries come out identical to `main`; phone screenshots of a Korean spot in en, zh and ja.
- [ ] **9. Review and PR.** A fresh reviewer on the diff, fixes, then the pull request.
