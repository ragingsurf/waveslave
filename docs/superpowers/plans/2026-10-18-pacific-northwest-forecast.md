# Pacific Northwest Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 Pacific Northwest spots (Tofino, Washington, Oregon) to waveslave.tw behind one "Pacific NW" country button, with NOAA, CDIP and Environment Canada buoys, NOAA and CHS tides, US and Canadian station wind, the HRRR/GFS wind forecast, a map grid and a separate `log-nw/`.

**Architecture:** Same pattern as Hawaii (PR #39). `ca.py` reads a third NOAA country, `nw`, plus two Canadian sources (ECCC wind, CHS tides); refresh.sh runs it in the NOAA loop; log/history/correct run with `nw`; the page adds a sixth country.

**Tech Stack:** POSIX sh, Python 3 stdlib (`zoneinfo`), vanilla JS in `template.html`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-18-pacific-northwest-forecast-design.md`

## Global Constraints

- All changes in `ragingsurf/waveslave`; `log/`, `log-jp/`, `log-ca/`, `log-hi/`, `log-au/` keep their shape and keep appending.
- Every new fetch is optional (`|| echo ... >&2`); an outage never fails the build or touches other countries.
- Data times in `snap.json` stay Taipei wall clock; readings on the nearest hour; tides and sun local clock by local date.
- Country code `nw`; log folder `log-nw/`; each spot's `zone` gives its offset.
- No new language; switch label Pacific NW / 太平洋西北 / 太平洋岸北西部; every new string gets zh and ja.
- `MM` / null mean no reading, never zero. NWS requests send `User-Agent: waveslave.tw`.
- Given the same downloads, every other country's output is identical to `main`.

## Review Focus

1. A Canadian buoy row (height and peak period only): period shown as the peak period, direction a dash, no "waves from the N".
2. A spot on its backup buoy: the backup's name and distance, in all three languages.
3. CHS tides in UTC: highs and lows on the right local date around midnight.
4. Switching Pacific NW ↔ California ↔ Taiwan on the Map tab: the right home view each time, saved view per country.
5. A missing Pacific NW grid: the Pacific layer covers the coast at 5°, no hole.

---

### Task 1: Spots

**Files:** `spots.json` (append 8, one spot per line); `tests/test_nw.py` (new).

- [ ] **Step 1:** `test_nw_spots_complete`: the 8 ids in order, `country=="nw"`, required keys, zh/ja names, no `tz`, `ndbc`/`buoyName`/`buoyKm` lists of one length (zh and ja `buoyName` too), `windStation` entries `ndbc:`/`nws:`/`eccc:`, `stationName` lists matching; tw/jp/ca/hi/au still 8 each. Run → FAIL.
- [ ] **Step 2:** Add the spots (values in the spec's table). Run → PASS. Commit "Pacific NW spots in spots.json".

### Task 2: ca.py reads Pacific NW

**Files:** `ca.py`; fixtures `tests/fixtures/nw/` (live copies: `ndbc-46206.txt`, `ndbc-46041.txt`, `ndbc-46087.txt`, `ndbc-46243.txt`, `ndbc-ASTO3.txt`, `eccc-1038210.json`, `nws-KAST.json`, `tide-9439011.json`, `chs-08615.json`, `opennw.json`, `snap_in.json`); `tests/test_nw.py`.

**Interfaces:**
- `ZONES['nw'] = America/Los_Angeles`; a spot's own `zone` wins (`offset(country, at, zone=None)`).
- `ndbc_rows`: period is `APD`, else `DPD / 1.3` (rounded to 0.1).
- `eccc_wind(js, now=None) -> [[time, kt, from deg|None]]`: newest feature with a 10-minute (else 2-minute) average speed, km/h or m/s by its `-uom`.
- `chs_tides(js, zone) -> {local date: [[HH:MM, 'H'|'L', cm]]}`: UTC `eventDate`, H/L from the neighbours.
- In `fill`: `buoyName`/`buoyKm` (and zh/ja `buoyName`) lists follow the buoy that answered; `eccc:` wind kind; `chs:` tide stations; `buoyBy` copied.

- [ ] **Step 1: Failing tests:** Canadian buoy period and empty direction; ECCC wind (km/h → kt, stale dropped); CHS tides on local dates; fill for coxbay (buoy 46206, ECCC wind, CHS tides, `tz == -7`), lapush backup buoy name/distance in three languages, seaside (NWS + NOAA tides), other countries untouched; `python3 -I ca.py ... nw` runs. Run → FAIL.
- [ ] **Step 2:** Implement. Run the full suite → PASS (fix `test_ca.test_runs_isolated_like_refresh`, which reads today's clock against an October 17 fixture). Commit "ca.py reads Pacific NW: Canadian buoys, ECCC wind, CHS tides".

### Task 3: Build and workflow

**Files:** `refresh.sh`, `.github/workflows/refresh.yml`, `.gitignore`, `tests/test_logsplit.py`.

- `noaaids` also lists `eccc` and `chs` ids; the NOAA loop runs `ca hi nw` with `ZONE=America/Los_Angeles` for `nw`; NOAA tides skip `chs:` stations; ECCC and CHS fetches for `nw`.
- `regrid nw 170 41 1 11 -129 1 8`; `GN` null fallback; template fill replaces `__GRIDNW__` (before `__GRID__`).
- history/log/correct with `nw` on `log-nw`; workflow restore list gains `log-nw`; `.gitignore` `log-nw/`.

- [ ] **Step 1:** `LogSplit` guard for `nw`. Run → PASS (log.py is country-blind).
- [ ] **Step 2:** Edit; run `sh refresh.sh` on live downloads → `nw:` lines for 8 spots; the built page has a Pacific NW grid.
- [ ] **Step 3:** Compare the other countries' `snap.json` parts with `main`'s scripts on the same downloads → identical. Commit "Build Pacific NW: downloads, map grid, log-nw".

### Task 4: Page

**Files:** `template.html`, `tests/map/tool.py`, `tests/map/check.js`.

- Sixth button `nw`; `OLDBOX.nw {l: 231, r: 238, s: 42, n: 50}`; `HOMES.nw {cx: 235.3, cy: 46.1, span: 8.2}` (Bastendorff clear of the time bar, Cox Bay of the layer buttons); `RAW.nw`/`GRIDS` with `nw` first (finest); view key `-nw`.
- Storm panel hidden; legend "Offshore wind (NOAA HRRR forecast)"; buoy label NOAA, or Environment Canada for `buoyBy: "eccc"`; "Back to Pacific NW"; home outline `HOME_ICONS.nw`; footer.
- A buoy row with no direction shows "–" in the Right now card and the table.
- tool.py and check.js learn the `nw` grid and home view.

- [ ] **Step 1:** Build; Chromium at phone width, en/zh/ja for coxbay and seaside, the Map home and a switch Pacific NW → California → Taiwan → Pacific NW: no console errors, right home view each time. Screenshots to `/mnt/project-files/surf-app/pacific-northwest/`.
- [ ] **Step 2:** Commit "Page: Pacific NW on the country switch and map".
