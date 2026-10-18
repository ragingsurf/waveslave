# The Philippines Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 Philippine spots (Siargao, La Union, Zambales, Baler, Daet, Catanduanes, Eastern Samar, Pagudpud) to waveslave.tw behind a "Philippines" country button, with ECMWF's wind forecast, model tides, the map home view and a separate `log-ph/`. No buoys and no station wind: none is open near the surf.

**Architecture:** Same pattern as Korea. `kr.py` takes a country (`kr` or `ph`), as `ca.py` does for its three; refresh.sh runs it in a loop; log/history/correct run with `ph`; the page adds an eighth country after Korea.

**Tech Stack:** POSIX sh, Python 3 stdlib (`zoneinfo`), vanilla JS in `template.html`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-18-philippines-forecast-design.md`

## Tasks

- [ ] **1. Fixtures.** Save one reply of each new download under `tests/fixtures/ph/`: `openph.json` (Open-Meteo `models=ecmwf_ifs` for the 8 spots), `tideph.json` (Open-Meteo marine `sea_level_height_msl`), and a `snap_in.json` with Philippine and Korean spots as snap.py writes them.
- [ ] **2. Tests first.** `tests/test_ph.py`: the 8 spots are complete; `fill(..., 'ph')` gives every spot `tz` 8, no wind now, a 3-hourly `wind`, tide highs and lows, sun times and an empty buoy, with no METAR download at all; filling the Philippines leaves the Korean spots alone and the other way round; `kr.py ... ph` runs isolated like refresh.sh. `tests/test_logsplit.py`: `log.py`, `correct.py` and `history.py` with `ph` touch only the Philippine spots.
- [ ] **3. kr.py.** A country argument for `fill()` and the command line, defaulting to `kr`; download names and messages follow it. Korea's tests pass unchanged.
- [ ] **4. spots.json.** The 8 spots, with names and regions in zh and ja.
- [ ] **5. refresh.sh and the workflow.** The Korea section becomes a loop over `kr ph` (METAR only where a spot names an airport; JMA's MSM for Korea, ECMWF's IFS for the Philippines); history/log/correct lines for `ph`; `log-ph` in the workflow's restore list and `.gitignore`.
- [ ] **6. template.html.** Country button after Korea (zh 菲律賓, ja フィリピン), the outline in `HOME_ICONS`, `HOMES.ph` and `OLDBOX.ph`, "Model tide" for the Philippines, the ECMWF legend, PAGASA's typhoon link, footer credits, the comment listing the countries.
- [ ] **7. Map checks.** A Philippines home view in `tests/map/check.js` (`HOMES`) and a check like Korea's; `mapmath.test.js` for the new box.
- [ ] **8. Verify.** Unit tests, map math tests, `check.js` upright and sideways on a local build from real downloads; the other countries come out identical to `main`; phone screenshots of a Philippine spot in en, zh and ja.
- [ ] **9. Review and PR.** A fresh reviewer on the diff, fixes, then the pull request.
