# New Zealand Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 New Zealand spots (Raglan, Mount Maunganui, Gisborne, New Plymouth, Lyall Bay, Kaikōura, New Brighton, St Clair) to waveslave.tw behind a "New Zealand" country button, with ECMWF's wind forecast, airport wind at Lyall Bay and New Brighton, South Island Waves buoys at New Brighton and St Clair, LINZ's official tides, a map grid and home view, and a separate `log-nz/`.

**Architecture:** Like Australia: a new `nz.py` fills the New Zealand spots from its own downloads (reusing `kr.metar_wind`, `jp.wind_rows`, `jp.sun_times` and `au.offset`); refresh.sh fetches them in an NZ block; log/history/correct run with `nz`; a `regrid nz` line adds the map's grid; the page adds a tenth country after Australia.

**Tech Stack:** POSIX sh, Python 3 stdlib (`csv`, `zoneinfo`), vanilla JS in `template.html`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-18-new-zealand-forecast-design.md`

## Tasks

- [ ] **1. Fixtures.** Save one reply of each new download under `tests/fixtures/nz/`: `siw-31020.csv` and `siw-31327.csv` (South Island Waves, the last 26 hours), `metar-nz.json` (aviationweather.gov for NZWN and NZCH), `opennz.json` (Open-Meteo `models=ecmwf_ifs` for the 8 spots), the LINZ tables trimmed to a few weeks under `linz/` (named as in the cache folder), and a `snap_in.json` with New Zealand, Indonesian, Philippine and Korean spots as snap.py writes them.
- [ ] **2. Tests first.** `tests/test_nz.py`: the 8 spots are complete; the SIW reader keeps one row per hour, reads water temperature only where the header names it and the row is whole, and drops a silent buoy; the LINZ reader labels highs and lows across a year's end; `fill(...)` gives every spot `tz` 13 (NZDT), buoy rows at New Brighton and St Clair, airport wind at Lyall Bay and New Brighton, 3-hourly `wind`, each spot's own tides and sun times; filling New Zealand leaves the other countries alone; `nz.py` runs isolated like refresh.sh. `tests/test_logsplit.py`: `log.py`, `correct.py` and `history.py` with `nz` touch only the New Zealand spots.
- [ ] **3. spots.json and nz.py.** The 8 spots, with names and regions in zh and ja; the module.
- [ ] **4. refresh.sh and the workflow.** The NZ block (buoys, airports, ECMWF, LINZ tables in `cache/`); history/log/correct lines for `nz`; regrid writing longitudes past 180 as west ones, `regrid nz 350 -50 2 10 150 2 25` and `__GRIDNZ__` in the page; `log-nz` in the workflow's restore list and `.gitignore`.
- [ ] **5. template.html.** Country button after Australia (zh 紐西蘭, ja ニュージーランド), the outline in `HOME_ICONS`, `HOMES.nz` and `OLDBOX.nz`, the `nz` grid in `RAW` and `GRIDS`, the ECMWF legend, the buoy source line, the cyclone panel (MetService and RSMC Nadi), footer credits, the comments listing the countries.
- [ ] **6. Map checks.** A New Zealand home view in `tests/map/check.js` (`HOMES`) and a check like Indonesia's; `gridsLoaded` with the `nz` grid; `mapmath.test.js` for the new box and `isoPick` with the new grid; `tests/map/tool.py` fills `__GRIDNZ__`.
- [ ] **7. Verify.** Unit tests, map math tests, `check.js` upright and sideways on a local build from real downloads; the other countries come out identical to `main`; phone screenshots of New Zealand spots in en, zh and ja.
- [ ] **8. Review and PR.** A fresh reviewer on the diff, fixes, then the pull request.
