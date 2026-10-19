# Hong Kong Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3 Hong Kong spots (Lower Cheung Sha, Big Wave Bay, Tai Long Wan) to waveslave.tw behind a "Hong Kong" country button, with the Hong Kong Observatory's station wind and tide predictions, the airport's reports as a backup, ECMWF's wind from the sea cell, a fine map grid, a home view and a separate `log-hk/`.

**Architecture:** A new reader, `hk.py`, as `nz.py` is for New Zealand: HKO's 10-minute wind CSV and its yearly tide predictions (kept in `cache/`), with the airport through `kr.metar_wind` and highs and lows through New Zealand's alternation, moved into `nz.turns`; a Hong Kong block in refresh.sh after Korea's; log/history/correct run with `hk`; a `regrid hk` line adds the map's grid; the page adds a fourteenth country after Korea.

**Tech Stack:** POSIX sh, Python 3 stdlib (`zoneinfo`, `csv`), vanilla JS in `template.html`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-19-hong-kong-forecast-design.md`

## Global Constraints

- All changes in `ragingsurf/waveslave`; every existing `log*/` folder keeps its shape and keeps appending.
- Every new fetch is optional; an outage never fails the build or touches other countries.
- Given the same downloads, every other country's output and log is identical to `main`'s, New Zealand's included.
- HKO, NOAA and NWS requests send `User-Agent: waveslave.tw`; nothing personal goes to any service.

## Tasks

- [ ] **1. Fixtures.** Save one reply of each download under `tests/fixtures/hk/`: `hko-wind.csv` (HKO's 10-minute wind), `metar-hk.json` (aviationweather.gov for VHHH), `openhk.json` (Open-Meteo `models=ecmwf_ifs&cell_selection=sea` for the 3 spots), `hk-tide-SPW-2026.json`, `hk-tide-TMW-2026.json` and `hk-tide-KLW-2026.json` (HKO's predictions), and a `snap_in.json` with Hong Kong and New Zealand spots as snap.py writes them.
- [ ] **2. Tests first.** `tests/test_hk.py`: the 3 spots are complete; `hko_wind` (a reading, Calm, Variable, `N/A`, a missing station, a stale file); `hko_events` and `nz.turns` across New Year; `hk.fill` gives +8, Cheung Chau's wind and the airport's when Cheung Chau has no speed, none at Tai Long Wan, 3-hourly `wind`, HKO's tides for the forecast's and past days, sun times; other countries untouched; `hk.py` runs isolated like refresh.sh; refresh.sh keeps a whole tide year and drops HKO's error page. `tests/test_logsplit.py`: `log.py`, `correct.py` and `history.py` with `hk` touch only Hong Kong's spots.
- [ ] **3. spots.json, nz.py and hk.py.** The 3 spots after Micronesia's, with names and regions in zh and ja; `nz.turns` out of `nz.linz_tides`; `hk.py`.
- [ ] **4. refresh.sh and the workflow.** The Hong Kong block (`hkids <field>`); history/log/correct lines for `hk`; `regrid hk 350 21.5 0.125 14 113.5 0.125 11` and `__GRIDHK__` in the page; `log-hk` in the workflow's restore list and `.gitignore`, HKO in its list of sources.
- [ ] **5. template.html.** Country button after Korea (香港), Hong Kong's outline in `HOME_ICONS`, `HOMES.hk`, the `hk` grid first in `RAW` and `GRIDS`, the ECMWF legend, the Typhoon watch panel's HKO link, footer credits, the comments listing the countries.
- [ ] **6. Map checks.** Hong Kong's home view in `tests/map/check.js` (`HOMES`) and a check of the first open; `gridsLoaded` with the `hk` grid; `tests/map/tool.py` fills `__GRIDHK__`.
- [ ] **7. Verify.** Unit tests, map maths, `check.js` upright and sideways on a local build from real downloads; the other countries come out identical to `main`; phone screenshots of the Hong Kong spots in en, zh and ja.
- [ ] **8. Review and PR.** A fresh reviewer on the diff, fixes, then the pull request.
