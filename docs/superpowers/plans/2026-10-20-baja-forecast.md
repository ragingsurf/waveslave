# Baja Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 Baja spots (K-38, San Miguel, Killers, Punta Baja, Punta Abreojos, Scorpion Bay, San Pedrito, Cerritos) to waveslave.tw behind a "Baja" country button, with K-38's CDIP buoy, ECMWF's wind from the sea cell, NOAA's tides for the three northern spots and Open-Meteo's tide model for the rest, two map home views (K-38 to Scorpion Bay, and the Cape), a map grid, Natural Earth's 10 m coast for the Cape, and a separate `log-bj/`.

**Architecture:** No new reader: `pi.py` already fills any island group from NDBC, Open-Meteo and NOAA's tides, as it does Micronesia's. refresh.sh's island loop takes `bj`, with `cell_selection=sea`; `regrid bj` adds the grid; log/history/correct run with `bj`; the page adds a nineteenth country after California, with two parts split at 248.5°E.

**Tech Stack:** POSIX sh, Python 3 stdlib, vanilla JS in `template.html`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-20-baja-forecast-design.md`

## Global Constraints

- All changes in `ragingsurf/waveslave`; every existing `log*/` folder keeps its shape and keeps appending.
- Every new fetch is optional; an outage never fails the build or touches other countries.
- Given the same downloads, every other country's output and log is identical to `main`'s.
- Open-Meteo requests go out as today; nothing personal goes to any service.

## Tasks

- [ ] **1. Fixtures.** Save one reply of each download under `tests/fixtures/bj/`: `ndbc-46232.txt` (a day of 46232), `openbj.json` (Open-Meteo `models=ecmwf_ifs&cell_selection=sea` for the 8 spots, one day), `tidebj.json` (the tide model for the five without a NOAA station, three days), `tidebj-9410120.json` and `tidebj-TWC0403.json` (NOAA's highs and lows), and a `snap_in.json` with the Baja spots as snap.py writes them, next to one spot each from Taiwan, California, Micronesia and Vanuatu.
- [ ] **2. Tests first.** `tests/test_bj.py`: the 8 spots are complete and last in spots.json; `pi.fill(..., 'bj')` gives −7 in October and −8/−7 after 1 November, K-38's buoy with `buoyBy` "cdip", no wind now, 3-hourly `wind`, NOAA's highs and lows for the three and the tide model's with `tideModel` for the five, sun times on Baja's dates; the replies follow the spot list; other countries untouched; `pi.py ... bj` runs isolated like refresh.sh; refresh.sh's loop asks for Baja's wind from the sea cells, 46232 from NDBC and the two NOAA stations, nothing from the Aviation Weather Center, and fetches the grid. `tests/test_logsplit.py`: `log.py`, `correct.py` and `history.py` with `bj` touch only Baja's spots. The other countries' tests find their spots before Baja's.
- [ ] **3. spots.json and pi.py.** The 8 spots after Vanuatu's, with names and regions in zh and ja; pi.py's comments name Baja and its clock change.
- [ ] **4. refresh.sh and the workflow.** `bj` in the island loop with `cell_selection=sea`; `regrid bj 350 21 1 15 -119 1 12`; `GBJ` and `__GRIDBJ__` in the page step; history/log/correct lines for `bj`; `log-bj` in the workflow's restore list and `.gitignore`.
- [ ] **5. template.html.** Country button after California (下加州 / バハ・カリフォルニア), the peninsula's outline in `HOME_ICONS`, `PARTS.bj`, `RAW.bj` and `GRIDS` (after `ca`), the Cape's DETAIL box and `tools/detail_coast.py`'s coast for it (the tool learning boxes east of 180°), the ECMWF legend, the Hurricane watch links, K-38's buoy line, footer credits (the CDIP buoy, NOAA's tides, ECMWF, the tide model), the comments listing the countries. `tests/map/tool.py` and `tests/test_mapjs.py` learn the new grid.
- [ ] **6. Home views.** Build a page from real downloads and check `PARTS.bj` so the upright width and the sideways height decide each part's zoom, with every dot and name clear of the buttons and the map's east edge.
- [ ] **7. Map checks.** Baja's home views in `tests/map/check.js` (`HOMES`, through `twoParts`, its pressure lines, the grid in `gridsLoaded`, `namesFit`, `modelTide`, Hurricane watch); its views and grid in `tests/map/mapmath.test.js`'s `isoPick` test; the DETAIL test takes the new box.
- [ ] **8. Verify.** Unit tests, map maths, `check.js` upright and sideways on a local build from real downloads; the other countries come out identical to `main`; phone screenshots of the Baja spots in en, zh and ja.
- [ ] **9. Review and PR.** A fresh reviewer on the diff, fixes, then the pull request.
