# South Pacific Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 South Pacific spots (Cloudbreak, Frigates, Ha'atafu, Salani, Amouli, Rarotonga, Papara, Teahupo'o) to waveslave.tw behind a "South Pacific" country button, with ECMWF's wind forecast, Pago Pago's airport wind and PacIOOS's buoys at Amouli, NOAA's tides where they match the gauges and the tide model elsewhere, a map grid and two home views, and a separate `log-pi/`.

**Architecture:** Like New Zealand: a new `pi.py` fills the South Pacific spots from its own downloads (reusing `ca.ndbc_rows`, `kr.metar_wind`, `jp.wind_rows`, `jp.sun_times`, `au.tide_days` and `au.offset`); refresh.sh fetches them in a South Pacific block; log/history/correct run with `pi`; a `regrid pi` line adds the map's grid; the page adds an eleventh country after New Zealand, whose map home is one of two parts, as Australia's is one of two coasts.

**Tech Stack:** POSIX sh, Python 3 stdlib (`zoneinfo`), vanilla JS in `template.html`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-18-south-pacific-forecast-design.md`

## Tasks

- [ ] **1. Fixtures.** Save one reply of each new download under `tests/fixtures/pi/`: `ndbc-51209.txt` and `ndbc-51214.txt` (NDBC, trimmed to about a day), `metar-pi.json` (aviationweather.gov for NSTU), `openpi.json` (Open-Meteo `models=ecmwf_ifs` for the 8 spots), `tidepi-<station>.json` for NOAA's four stations (UTC), `tidepi.json` (the tide model for the three spots without one), and a `snap_in.json` with South Pacific, New Zealand, Indonesian, Philippine and Korean spots as snap.py writes them.
- [ ] **2. Tests first.** `tests/test_pi.py`: the 8 spots are complete; NOAA's UTC highs and lows land on each spot's clock and date either side of the date line; `fill(...)` gives every spot its offset, Amouli its buoy rows (King-Poloa's when Aunu'u is silent) and Pago Pago's wind, 3-hourly `wind`, the right tides (NOAA's or the model's, with `tideModel`) and sun times; filling the South Pacific leaves the other countries alone; `pi.py` runs isolated like refresh.sh. `tests/test_logsplit.py`: `log.py`, `correct.py` and `history.py` with `pi` touch only the South Pacific spots.
- [ ] **3. spots.json and pi.py.** The 8 spots, with names and regions in zh and ja; the module.
- [ ] **4. refresh.sh and the workflow.** The South Pacific block (buoys, airport, ECMWF, NOAA tides in UTC, the tide model); history/log/correct lines for `pi`; `regrid pi 350 -24 2 8 170 2 24` and `__GRIDPI__` in the page; `log-pi` in the workflow's restore list and `.gitignore`.
- [ ] **5. template.html.** Country button after New Zealand (zh 南太平洋, ja 南太平洋), the outline in `HOME_ICONS`, `PARTS` for Australia's coasts and the South Pacific's two parts (home views with a width, first open on the part's home, a saved view per part), the `pi` grid in `RAW` and `GRIDS`, the ECMWF legend, "Model tide" by spot, the buoy source line, the cyclone panel, footer credits, the comments listing the countries.
- [ ] **6. Map checks.** Both South Pacific home views in `tests/map/check.js` (`HOMES`) and a check of the first open, the home views and moving between the parts; `gridsLoaded` with the `pi` grid; `mapmath.test.js` for `isoPick` with the new grid; `tests/map/tool.py` fills `__GRIDPI__`.
- [ ] **7. Verify.** Unit tests, map math tests, `check.js` upright and sideways on a local build from real downloads; the other countries come out identical to `main`; phone screenshots of South Pacific spots in en, zh and ja.
- [ ] **8. Review and PR.** A fresh reviewer on the diff, fixes, then the pull request.
