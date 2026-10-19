# Papua New Guinea Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 7 Papua New Guinea spots (Lido, Wewak Point, Tupira, Nusa, Nago, Ral, Rubio) to waveslave.tw behind a "Papua New Guinea" country button, with ECMWF's wind from the sea cell, Open-Meteo's tide model, two map home views, a map grid, Natural Earth's 10 m coast where the spots are, and a separate `log-pg/`.

**Architecture:** No new reader: `pi.py` already fills any island group from Open-Meteo's wind and tide replies, as it does Micronesia's Pohnpei. refresh.sh's South Pacific–Micronesia loop takes `pg`, with `cell_selection=sea` as for Micronesia; `regrid pg` adds the grid; log/history/correct run with `pg`; the page adds a seventeenth country after Indonesia, with two parts split at 148°E.

**Tech Stack:** POSIX sh, Python 3 stdlib, vanilla JS in `template.html`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-19-papua-new-guinea-forecast-design.md`

## Global Constraints

- All changes in `ragingsurf/waveslave`; every existing `log*/` folder keeps its shape and keeps appending.
- Every new fetch is optional; an outage never fails the build or touches other countries.
- Given the same downloads, every other country's output and log is identical to `main`'s.
- Open-Meteo requests go out as today; nothing personal goes to any service.

## Tasks

- [ ] **1. Fixtures.** Save one reply of each download under `tests/fixtures/pg/`: `openpg.json` (Open-Meteo `models=ecmwf_ifs&cell_selection=sea` for the 7 spots, one day), `tidepg.json` (the tide model, three days), and a `snap_in.json` with the PNG spots as snap.py writes them, next to one spot each from Taiwan, Korea, the Philippines, Micronesia and Vietnam.
- [ ] **2. Tests first.** `tests/test_pg.py`: the 7 spots are complete and last in spots.json; `pi.fill(..., 'pg')` gives +10, no buoy, no wind now, 3-hourly `wind`, the tide model's highs and lows with `tideModel`, sun times on PNG's dates; the replies follow the spot list; other countries untouched; `pi.py ... pg` runs isolated like refresh.sh; refresh.sh's loop asks for PNG's wind from the sea cells and nothing from NDBC, the Aviation Weather Center or NOAA's tides, and fetches the grid. `tests/test_logsplit.py`: `log.py`, `correct.py` and `history.py` with `pg` touch only PNG's spots. `tests/test_mi.py`, `tests/test_hk.py`, `tests/test_hn.py` and `tests/test_vn.py` find their spots before PNG's.
- [ ] **3. spots.json and pi.py.** The 7 spots after Vietnam's, with names and regions in zh and ja; pi.py's comments name Papua New Guinea.
- [ ] **4. refresh.sh and the workflow.** `pg` in the pi/mi loop with `cell_selection=sea`; `regrid pg 350 -8 2 5 138 2 9`; `GPG` and `__GRIDPG__` in the page step; history/log/correct lines for `pg`; `log-pg` in the workflow's restore list and `.gitignore`.
- [ ] **5. template.html.** Country button after Indonesia (巴布亞紐幾內亞 / パプアニューギニア), PNG's outline in `HOME_ICONS`, `PARTS.pg`, `RAW.pg` and `GRIDS`, the three DETAIL boxes and `tools/detail_coast.py`'s coast for them, the ECMWF legend, the Cyclone watch links, footer credits (ECMWF, the tide model), the comments listing the countries. `tests/map/tool.py` and `tests/test_mapjs.py` learn the new grid.
- [ ] **6. Home views.** Build a page from real downloads and check `PARTS.pg` so the upright width and the sideways height decide each part's zoom, with every dot and name clear of the buttons.
- [ ] **7. Map checks.** PNG's home views in `tests/map/check.js` (`HOMES`, `papuaNewGuinea` through `twoParts`, `papuaNewGuineaIso`, the grid in `gridsLoaded`); its views and grid in `tests/map/mapmath.test.js`'s `isoPick` test; the DETAIL test takes overlapping boxes.
- [ ] **8. Verify.** Unit tests, map maths, `check.js` upright and sideways on a local build from real downloads; the other countries come out identical to `main`; phone screenshots of the PNG spots in en, zh and ja.
- [ ] **9. Review and PR.** A fresh reviewer on the diff, fixes, then the pull request.
