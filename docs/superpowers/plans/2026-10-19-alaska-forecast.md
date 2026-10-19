# Alaska Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 Alaska spots (Cannon Beach, Ocean Cape, Sandy Beach, Shelikof Bay, Sea Lion Cove, Surfers Beach, Fossil Beach, Bishop's Beach) to waveslave.tw behind an "Alaska" country button, with NOAA NDBC buoys (far ones shown but not learned from), NWS airport and NDBC shore wind, NOAA tides, the GFS wind forecast, a map grid, the map reaching 65°N, and a separate `log-ak/`.

**Architecture:** Like the Pacific NW: `ca.py` reads a fourth NOAA country, `ak`, in refresh.sh's NOAA loop; log/history/correct run with `ak`; a `regrid ak` line adds the map's grid; the Pacific box, its coastline and the Pacific layer reach 65°N; the page adds a twelfth country after Pacific NW.

**Tech Stack:** POSIX sh, Python 3 stdlib (`zoneinfo`), vanilla JS in `template.html`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-19-alaska-forecast-design.md`

## Global Constraints

- All changes in `ragingsurf/waveslave`; every existing `log*/` folder keeps its shape and keeps appending.
- Every new fetch is optional; an outage never fails the build or touches other countries.
- Given the same downloads, every other country's output and log is identical to `main`'s.
- NWS requests send `User-Agent: waveslave.tw`; nothing personal goes to any service.

## Tasks

- [ ] **1. Fixtures.** Save one reply of each download under `tests/fixtures/ak/`: `ndbc-46083.txt`, `ndbc-46082.txt`, `ndbc-46108.txt`, `ndbc-46080.txt` (trimmed to about a day), `nws-PAYA.json`, `nws-PAHO.json`, `tide-9453220.json`, `tide-9455558.json`, `openak.json` (Open-Meteo `models=gfs_seamless` for the 8 spots) and a `snap_in.json` with Alaska and Pacific NW spots as snap.py writes them.
- [ ] **2. Tests first.** `tests/test_ak.py`: the 8 spots are complete; `ca.fill(..., 'ak')` gives Cannon Beach its far buoy (`buoyFar`), Yakutat's wind and tides and offset -8, Bishop's Beach the CDIP buoy (not far), a silent main buoy the backup's name and distance; the Pacific NW is left alone; `ca.py ... ak` runs isolated. `correct.py` keeps a far spot's height factor at 1 and learns a near one's. `tests/test_logsplit.py`: log/correct/history with `ak` touch only Alaska.
- [ ] **3. spots.json, ca.py, correct.py.** The 8 spots; `ZONES['ak']`, `FAR_KM` and `buoyFar`; the far rule.
- [ ] **4. The map to 65°N.** `tools/pacific_coast.py` RECTS and CUTY to 65; the new coastline line in the template; `PBOX.n` and `CUTY` in the template; pacific.sh's 24 rows; `mapmath.test.js`, `test_pacific_coast.py` and the comments that name 60°N.
- [ ] **5. refresh.sh and the workflow.** `ak` in the NOAA loop with `ZONE=America/Anchorage`; `regrid ak 350 54 1 9 -158 2 15` and `__GRIDAK__`; history/log/correct for `ak`; `log-ak` in the workflow's restore list and `.gitignore`.
- [ ] **6. template.html.** Country button after Pacific NW (zh 阿拉斯加, ja アラスカ), `HOME_ICONS.ak`, `HOMES.ak` (with a width), the `ak` grid in `RAW` and `GRIDS`, the GFS legend, the buoy line, the hidden storm panel, footer credits, the comments listing the countries.
- [ ] **7. Map checks.** Alaska's home in `tests/map/check.js` (`HOMES`) and a check of its first open and home view; `gridsLoaded` with the `ak` grid; `tests/map/tool.py` fills `__GRIDAK__`.
- [ ] **8. Verify.** Unit tests, map maths, `check.js` upright and sideways on a local build from real downloads; the other countries come out identical to `main`; phone screenshots of Alaska spots in en, zh and ja.
- [ ] **9. Review and PR.** A fresh reviewer on the diff, fixes, then the pull request.
