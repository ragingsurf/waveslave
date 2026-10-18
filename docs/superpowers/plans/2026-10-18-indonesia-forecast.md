# Indonesia Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 Indonesian spots (Uluwatu, G-Land, Canggu, Kuta, Keramas, Desert Point, Gerupuk, Lakey Peak) to waveslave.tw behind an "Indonesia" country button, with ECMWF's wind forecast, Bali airport wind at three spots, model tides, a map grid and home view, and a separate `log-id/`. No buoys: none is open.

**Architecture:** Same pattern as the Philippines. `kr.py` already takes a country; refresh.sh's loop runs `kr ph id`; log/history/correct run with `id`; a `regrid id` line adds the map's grid; the page adds a ninth country after the Philippines.

**Tech Stack:** POSIX sh, Python 3 stdlib (`zoneinfo`), vanilla JS in `template.html`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-18-indonesia-forecast-design.md`

## Tasks

- [ ] **1. Fixtures.** Save one reply of each new download under `tests/fixtures/id/`: `metar-id.json` (aviationweather.gov for WADD), `openid.json` (Open-Meteo `models=ecmwf_ifs` for the 8 spots), `tideid.json` (Open-Meteo marine `sea_level_height_msl`), and a `snap_in.json` with Indonesian, Philippine and Korean spots as snap.py writes them.
- [ ] **2. Tests first.** `tests/test_id.py`: the 8 spots are complete; `fill(..., 'id')` gives Bali, Lombok and Sumbawa `tz` 8 and G-Land 7, WADD's wind now at Uluwatu, Canggu and Kuta only, a 3-hourly `wind`, tide highs and lows, sun times and an empty buoy; filling Indonesia leaves the Korean and Philippine spots alone; `kr.py ... id` runs isolated like refresh.sh. `tests/test_logsplit.py`: `log.py`, `correct.py` and `history.py` with `id` touch only the Indonesian spots.
- [ ] **3. spots.json.** The 8 spots, with names and regions in zh and ja.
- [ ] **4. refresh.sh and the workflow.** The loop over `kr ph id` (ECMWF's IFS for all but Korea); history/log/correct lines for `id`; `regrid id 350 -16 2 8 100 2 17` and `__GRIDID__` in the page; `log-id` in the workflow's restore list and `.gitignore`. kr.py's comments name Indonesia.
- [ ] **5. template.html.** Country button after the Philippines (zh 印尼, ja インドネシア), the outline in `HOME_ICONS`, `HOMES.id` and `OLDBOX.id`, the `id` grid in `RAW` and `GRIDS`, "Model tide", the ECMWF legend, the cyclone panel (BMKG's TCWC Jakarta and BoM), footer credits, the comment listing the countries.
- [ ] **6. Map checks.** An Indonesia home view in `tests/map/check.js` (`HOMES`) and a check like the Philippines'; `gridsLoaded` with the `id` grid; `mapmath.test.js` for the new box and `isoPick` with the new grid.
- [ ] **7. Verify.** Unit tests, map math tests, `check.js` upright and sideways on a local build from real downloads; the other countries come out identical to `main`; phone screenshots of Indonesian spots in en, zh and ja.
- [ ] **8. Review and PR.** A fresh reviewer on the diff, fixes, then the pull request.
