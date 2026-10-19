# Micronesia Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 Micronesia spots (Umatac, Boat Basin, Talofofo, Tank Beach, P-Pass, Mwand Pass, Sidedish, The Bridge) to waveslave.tw behind a "Micronesia" country button, with PacIOOS's buoys, airport and Apra Harbor wind, NOAA's tides where it has a station and the tide model elsewhere, ECMWF's wind from the sea cell, a map grid, two home views, Natural Earth 10 m outlines for the islands, and a separate `log-mi/`.

**Architecture:** Like the South Pacific: `pi.py` reads a second island group, `mi`, as `ca.py` reads four NOAA countries; refresh.sh's South Pacific block becomes a loop over `pi` and `mi`; log/history/correct run with `mi`; a `regrid mi` line adds the map's grid; the page adds a thirteenth country after the South Pacific, whose map home is one of two parts.

**Tech Stack:** POSIX sh, Python 3 stdlib (`zoneinfo`), vanilla JS in `template.html`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-19-micronesia-forecast-design.md`

## Global Constraints

- All changes in `ragingsurf/waveslave`; every existing `log*/` folder keeps its shape and keeps appending.
- Every new fetch is optional; an outage never fails the build or touches other countries.
- Given the same downloads, every other country's output and log is identical to `main`'s, the South Pacific's included.
- NOAA and NWS requests send `User-Agent: waveslave.tw` where they do today; nothing personal goes to any service.

## Tasks

- [ ] **1. Fixtures.** Save one reply of each download under `tests/fixtures/mi/`: `ndbc-52213.txt` (North Point) and `ndbc-52216.txt` (Arno) trimmed to about a day, `ndbc-52201.txt` (Kalo, rows with no wave height), `ndbc-APRP7.txt` (Apra Harbor), `metar-mi.json` (aviationweather.gov for PGUM, PGSN and PTSA), `openmi.json` (Open-Meteo `models=ecmwf_ifs&cell_selection=sea` for the 8 spots), `tidemi-1630000.json`, `tidemi-1633227.json` and `tidemi-TPT2721.json` (NOAA in UTC), `tidemi.json` (the tide model for P-Pass, Mwand and Sidedish), and a `snap_in.json` with Micronesia and South Pacific spots as snap.py writes them.
- [ ] **2. Tests first.** `tests/test_mi.py`: the 8 spots are complete; `pi.fill(..., 'mi')` gives every spot its offset (+10, +11, +12), P-Pass and Mwand North Point's rows, Majuro Arno's (Kalo has no waves) with `buoyMain` Kalo, Guam's spots a quiet buoy with the first buoy's name, Guam's airport wind and Apra Harbor's when the airport's report is missing, no wind at Sidedish from a stale report, 3-hourly `wind`, NOAA's UTC tides on each spot's clock, the model's tides with `tideModel`, and sun times; filling Micronesia leaves the South Pacific alone and the reverse; `pi.py ... mi` runs isolated like refresh.sh. `tests/test_logsplit.py`: `log.py`, `correct.py` and `history.py` with `mi` touch only Micronesia's spots.
- [ ] **3. spots.json and pi.py.** The 8 spots after Alaska's, with names and regions in zh and ja; `pi.py` takes the country (default `pi`) for its spots and download names, and reads `ndbc:` wind stations through `ca.ndbc_wind`.
- [ ] **4. refresh.sh and the workflow.** The South Pacific block as a loop over `pi` and `mi` (`piids <country> <field>`, `ndbc` taking `ndbc:` wind stations too, `cell_selection=sea` for `mi`); history/log/correct lines for `mi`; `regrid mi 350 -2 2 9 152 2 13` and `__GRIDMI__` in the page; `log-mi` in the workflow's restore list and `.gitignore`.
- [ ] **5. template.html.** Country button after the South Pacific (zh 密克羅尼西亞, ja ミクロネシア), Guam's outline in `HOME_ICONS`, `PARTS.mi` (split at 152°E), the `mi` grid in `RAW` and `GRIDS` after `pi`, the Natural Earth 10 m rings for the Marianas, Pohnpei, Kosrae and Majuro with the coarser rings in those boxes dropped, the ECMWF legend, the PacIOOS buoy line, the Typhoon watch panel's NWS Guam link, footer credits, the comments listing the countries.
- [ ] **6. Map checks.** Micronesia's parts in `tests/map/check.js` (`HOMES`) and a check of the first open, both home views and the move between them; `gridsLoaded` with the `mi` grid; `tests/map/tool.py` fills `__GRIDMI__`; a test that the 10 m rings sit inside the island boxes and every coarser ring reaching into a box lies wholly inside it.
- [ ] **7. Verify.** Unit tests, map maths, `check.js` upright and sideways on a local build from real downloads; the other countries come out identical to `main`; phone screenshots of Micronesia spots in en, zh and ja.
- [ ] **8. Review and PR.** A fresh reviewer on the diff, fixes, then the pull request.
