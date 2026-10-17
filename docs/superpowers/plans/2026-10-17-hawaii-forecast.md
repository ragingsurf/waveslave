# Hawaii Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 Hawaii spots (four islands) to waveslave.tw behind the country switch, with NOAA/CDIP buoys, NOAA tides, shore and airport wind, the GFS wind forecast, a Hawaii map grid and a separate `log-hi/`.

**Architecture:** Same pattern as California (PR #38). `ca.py` becomes the reader for every NOAA country (`ca`, `hi`), run once per country; log/history/correct run a fourth time with `hi`; the page adds a fourth country, a Hawaii map home, and picks its map grid by region.

**Tech Stack:** POSIX sh, Python 3 stdlib (`zoneinfo`), vanilla JS in `template.html`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-17-hawaii-forecast-design.md`

## Global Constraints

- All changes in `ragingsurf/waveslave`; `log/`, `log-jp/`, `log-ca/` keep their shape and keep appending.
- Every Hawaii fetch is optional (`|| echo ... >&2`); a Hawaii outage never fails the build or touches other countries.
- Data times in `snap.json` stay Taipei wall clock; readings on the nearest hour; tides and sun local clock by local date.
- Country code `hi`; log folder `log-hi/`; Hawaii offset always -10 (Pacific/Honolulu).
- No new language; switch label 夏威夷 / ハワイ; every Hawaii string gets zh and ja.
- `MM` / null mean no reading, never zero. NWS requests send `User-Agent: waveslave.tw`.
- Given the same downloads, Taiwan and Japan output is identical to `main`; California differs only by the two fixes.

## Review Focus

1. A buoy silent for days (51205, 51208 today): no "right now" reading, the spot reads like Rincon, no page error.
2. An NWS station whose newest reports all lack wind speed (PHHI today): fall back to the spot's second station, else blank.
3. Switching Hawaii ↔ California ↔ Japan on the Map tab: the right grid and coastline each time, not an empty sea; saved map view per region.
4. Hawaii days straddling Taipei midnight (HST is 18 h behind Taipei): local dates for tides, sun and day keys.
5. A missing Hawaii grid (first run, fetch failed): the map centres on Hawaii, not Taiwan.

---

### Task 1: Hawaii spots

**Files:** Modify `spots.json` (append 8, one spot per line, same keys as California); Test `tests/test_hi.py` (new).

Values from the spec — id lat,lon [ndbc] buoyKm windStation tideStation:
pipeline 21.665,-158.053 [51201] 7 ["nws:PHHI","nws:PHJR"] 1612668; waikiki 21.270,-157.830 [51211] 14 ndbc:OOUH1 1612340; makaha 21.476,-158.222 [51212] 19 nws:PHJR 1612482; sandybeach 21.285,-157.672 [51202] 14 ndbc:MOKH1 1612301; honolua 21.014,-156.638 [51205] 23 ndbc:KLIH1 1615680; hookipa 20.936,-156.356 [51205] 11 ndbc:KLIH1 1615680; hanalei 22.215,-159.500 [51208] 11 nws:PHLI 1611683; honolii 19.756,-155.090 [51206] 13 ndbc:ILOH1 1617760.
`windStation` may be a string or a list tried in order.

- [ ] **Step 1:** `test_hi_spots_complete`: the 8 ids in order, `country=="hi"`, required keys, zh/ja names, no `tz`; tw/jp/ca still 8 each.
- [ ] **Step 2:** Run `python3 -m unittest tests.test_hi -v` → FAIL.
- [ ] **Step 3:** Add spots (`off` = offshore bearing from the coast's facing).
- [ ] **Step 4:** Run → PASS. Commit "Hawaii spots in spots.json".

### Task 2: NOAA reader for both countries, plus the two fixes

**Files:** Modify `ca.py`; fixtures `tests/fixtures/hi/` (live copies: `ndbc-51201.txt`, `ndbc-51205.txt` (stale), `ndbc-ILOH1.txt`, `nws-PHHI.json`, `nws-PHJR.json`, `tide-1612668.json`, `openhi.json`, `snap_in.json`); Test `tests/test_hi.py`, `tests/test_ca.py`.

**Interfaces:**
- `ZONES = {'ca': America/Los_Angeles, 'hi': Pacific/Honolulu}`; `offset(country, at) -> int`.
- `fill(snap, spots, dl, now, country='ca')` reads `open<country>.json`.
- `nws_wind(js)` accepts an observations collection (`features`) and takes the newest feature with a wind speed; still accepts a single `properties` object.
- A buoy whose newest row is more than 6 h before `now` counts as silent (next `ndbc` id tried, else `buoyId None`).
- Usage: `python3 -I ca.py <dl> <snap> <spots> [country]`, prints `<country>:` lines.

- [ ] **Step 1: Failing tests:** `test_offset_hawaii` (-10 in Jan and Jul); `test_stale_buoy_is_silent` (51205 fixture, now 2026-10-17 → `buoyId None`, `buoy []`); `test_nws_newest_with_wind` (PHJR collection → the 11:53 UTC 9.36 km/h row → 5.1 kt); `test_wind_station_fallback` (pipeline: PHHI all null → PHJR reading); `test_fill_hawaii` (pipeline buoyId 51201, tides from 1612668 keyed by HST date, sun dates local, `tz == -10`, California spots untouched); `test_ca_stale_buoy` in test_ca.
- [ ] **Step 2:** Run both test files → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run full suite `python3 -m unittest discover -s tests` → PASS. Commit "ca.py reads Hawaii; skip silent buoys; NWS wind from recent reports".

### Task 3: Build and workflow

**Files:** `refresh.sh`, `.github/workflows/refresh.yml`, `.gitignore`, `tests/test_logsplit.py`.

- `caids` becomes `noaaids <country> <field>`; ndbc/nws fields read string-or-list `windStation`. NWS fetch uses `observations?limit=6`.
- Hawaii block after California's: same fetches with `TZ=Pacific/Honolulu` tide start, `get openhi ...models=gfs_seamless`, `ca.py ... hi`.
- Hawaii grid `cache/grid-hi.json`: lat 18..23, lon -161..-154 step 0.5 (11 × 15), `grid.py ... 18 0.5 11 -161 0.5 15`, every ~170 min; null fallback `GH`; render replaces `__GRIDHI__` (before `__GRID__`).
- history/log/correct with `hi` on `log-hi`; workflow caches, restores and saves `log-hi`; `.gitignore` `log-hi/`.

- [ ] **Step 1:** `LogSplitHawaii` in test_logsplit: a snap with tw/jp/ca/hi spots logged with `hi` holds only the 8 Hawaii ids. Run → FAIL only if log.py needed a change (else passes as a guard; note it).
- [ ] **Step 2:** Edit files; run `sh refresh.sh` on live downloads (no `logstore.sh save`) → `hi:` lines for 8 spots, built page contains a non-null Hawaii grid.
- [ ] **Step 3:** Compare tw/jp parts of `snap.json` with a `main` build on the same downloads → identical. Commit "Build Hawaii: downloads, map grid, log-hi".

### Task 4: Page

**Files:** `template.html`.

- Fourth switch button `hi` (夏威夷 / ハワイ); `HOMES.hi {cx:-157.4, cy:20.6, span:5}`.
- Map region: `REGION = c => c==="ca"||c==="hi" ? c : "wp"`; `GRID = {wp:__GRID__, ca:__GRIDCA__, hi:__GRIDHI__}[REGION(SPOT0)]`; `KX` from the home latitude; reload when the region changes; map view key `waveslave-mapview` + `-ca` / `-hi`; `clampView` fallback for Hawaii `[-161,-154,18,23]`.
- Hawaii coastline from Natural Earth 10m land (small islands), clipped to the box, pushed onto `COAST`.
- Labels: NOAA buoy link for `ca` or `hi`; legend "Offshore wind (NOAA GFS forecast)" for Hawaii; "Back to Hawaii"; storm panel for Hawaii shows "Hurricane watch" with a CPHC link (https://www.nhc.noaa.gov/?cpac), no tracks; footer/map note mention Hawaii under NOAA.

- [ ] **Step 1:** Build, open in Chromium at phone width in en/zh/ja for pipeline and hanalei, plus the Hawaii map and a switch Hawaii → California → Taiwan → Hawaii: no console errors, right grid and coast each time. Screenshots to `/mnt/project-files/surf-app/hawaii/`.
- [ ] **Step 2:** Commit "Page: Hawaii on the country switch and map".
