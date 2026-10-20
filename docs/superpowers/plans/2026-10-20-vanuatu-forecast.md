# Vanuatu Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 6 Vanuatu spots (Devil's Point, Pango Point, Breakas, Tapi Point, Lenakel, Port Resolution) to waveslave.tw behind a "Vanuatu" country button, with ECMWF's wind from the sea cell, Open-Meteo's tide model, two map home views (Efate and Tanna), a map grid, Natural Earth's 10 m coast for both islands, and a separate `log-vu/`.

**Architecture:** No new reader: `pi.py` already fills any island group from Open-Meteo's wind and tide replies, as it does Papua New Guinea's. refresh.sh's island loop takes `vu`, with `cell_selection=sea` as for Micronesia and Papua New Guinea; `regrid vu` adds the grid; log/history/correct run with `vu`; the page adds an eighteenth country after New Zealand, with two parts split at 169°E.

**Tech Stack:** POSIX sh, Python 3 stdlib, vanilla JS in `template.html`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-20-vanuatu-forecast-design.md`

## Global Constraints

- All changes in `ragingsurf/waveslave`; every existing `log*/` folder keeps its shape and keeps appending.
- Every new fetch is optional; an outage never fails the build or touches other countries.
- Given the same downloads, every other country's output and log is identical to `main`'s.
- Open-Meteo requests go out as today; nothing personal goes to any service.

## Tasks

- [ ] **1. Fixtures.** Save one reply of each download under `tests/fixtures/vu/`: `openvu.json` (Open-Meteo `models=ecmwf_ifs&cell_selection=sea` for the 6 spots, one day), `tidevu.json` (the tide model, three days), and a `snap_in.json` with the Vanuatu spots as snap.py writes them, next to one spot each from Taiwan, Korea, the Philippines, Micronesia, Vietnam and Papua New Guinea.
- [ ] **2. Tests first.** `tests/test_vu.py`: the 6 spots are complete and last in spots.json; `pi.fill(..., 'vu')` gives +11, no buoy, no wind now, 3-hourly `wind`, the tide model's highs and lows with `tideModel`, sun times on Vanuatu's dates; the replies follow the spot list; other countries untouched; `pi.py ... vu` runs isolated like refresh.sh; refresh.sh's loop asks for Vanuatu's wind from the sea cells and nothing from NDBC, the Aviation Weather Center or NOAA's tides, and fetches the grid. `tests/test_logsplit.py`: `log.py`, `correct.py` and `history.py` with `vu` touch only Vanuatu's spots. `tests/test_mi.py`, `tests/test_hk.py`, `tests/test_hn.py`, `tests/test_vn.py` and `tests/test_pg.py` find their spots before Vanuatu's.
- [ ] **3. spots.json and pi.py.** The 6 spots after Papua New Guinea's, with names and regions in zh and ja; pi.py's comments name Vanuatu.
- [ ] **4. refresh.sh and the workflow.** `vu` in the island loop with `cell_selection=sea`; `regrid vu 350 -24 2 7 164 2 6`; `GVU` and `__GRIDVU__` in the page step; history/log/correct lines for `vu`; `log-vu` in the workflow's restore list and `.gitignore`.
- [ ] **5. template.html.** Country button after New Zealand (萬那杜 / バヌアツ), Efate's outline in `HOME_ICONS`, `PARTS.vu`, `RAW.vu` and `GRIDS` (after `pg`), the two DETAIL boxes and `tools/detail_coast.py`'s coast for them (its budget raised to 45 kB), the ECMWF legend, the Cyclone watch links, footer credits (ECMWF, the tide model), the comments listing the countries. `tests/map/tool.py` and `tests/test_mapjs.py` learn the new grid.
- [ ] **6. Home views.** Build a page from real downloads and check `PARTS.vu` so the upright width and the sideways height decide each part's zoom, with every dot and name clear of the buttons.
- [ ] **7. Map checks.** Vanuatu's home views in `tests/map/check.js` (`HOMES`, `vanuatu` through `twoParts`, `vanuatuIso`, the grid in `gridsLoaded`, `namesFit`, `modelTide`); its views and grid in `tests/map/mapmath.test.js`'s `isoPick` test; the DETAIL test takes the two new boxes.
- [ ] **8. Verify.** Unit tests, map maths, `check.js` upright and sideways on a local build from real downloads; the other countries come out identical to `main`; phone screenshots of the Vanuatu spots in en, zh and ja.
- [ ] **9. Review and PR.** A fresh reviewer on the diff, fixes, then the pull request.
