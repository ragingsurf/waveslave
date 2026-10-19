# California Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 California spots to waveslave.tw behind the country switch, with NOAA/CDIP buoys, NOAA tides, shore and airport wind, HRRR wind forecast, a California map grid and a separate `log-ca/`.

**Architecture:** Same pattern as Japan (PR #37). `ca.py` fills California spots in `snap.json` under the keys snap.py writes for Taiwan; log/history/correct run a third time with `ca`; the page adds a third country, a California map home and a second map grid.

**Tech Stack:** POSIX sh, Python 3 stdlib (`zoneinfo`), vanilla JS in `template.html`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-17-california-forecast-design.md`

## Global Constraints

- All changes in `ragingsurf/waveslave`; Taiwan's `log/` and its record shape stay untouched and keep appending.
- Every California fetch is optional (`|| echo ... >&2`); a California outage never fails the build or touches Taiwan/Japan output.
- Data times in `snap.json` stay Taipei wall clock "YYYY-MM-DDTHH:MM"; buoy and wind readings go on the nearest hour. Tides and sun are local clock by local date.
- Country code `ca`; log folder `log-ca/`.
- No new language; every California string gets `data-zh` and `data-ja` like the rest.
- Heights in metres, wind in knots.
- `MM` (NDBC) and null (NWS) mean no reading: dropped, never zero.
- NWS requests send `User-Agent: waveslave.tw`.
- Given the same downloads, Taiwan and Japan `snap.json` output is identical to `main`.

## Review Focus

1. A California spot whose day straddles Taipei midnight: tides, sun and day keys must use the local (Pacific) date, not the Taipei date.
2. NDBC rows at :00 and :30 (or :26 and :56) both rounding into one hour: one row per hour, the reading nearest the hour, never two rows with the same time.
3. Rincon (no buoy) and a buoy file that is all `MM` for height: "No nearby wave buoy", no page error.
4. Switching between Japan and California on the Map tab: the map must show the right grid and coastline, not an empty sea.
5. The day DST ends (Nov 1): the build's offset changes from -7 to -8 and nothing crashes; only drawing of far days shifts.

---

### Task 1: California spots

**Files:**
- Modify: `spots.json` (append 8 spots)
- Test: `tests/test_ca.py` (new)

**Interfaces:**
- Produces: spots with `country:"ca"`, `ndbc` (list of NDBC ids, may be empty), `buoyKm`, `buoyName`, `windStation` (`"ndbc:FTPC1"` or `"nws:KSNA"`), `stationName`, `tideStation` (NOAA id string), `off`, `lat`, `lon`, `blurb`, `cams`, `zh`, `ja`. No `tz` key (ca.py sets it).

Values (from the spec): oceanbeach 37.760,-122.511 [46237] 15 ndbc:FTPC1 9414290; steamerlane 36.951,-122.026 [46236] 25 ndbc:MLSC1 9413745; rincon 34.373,-119.476 [] null ndbc:NTBC1 9411340; malibu 34.035,-118.678 [46268] 10 ndbc:ICAC1 9410840; huntington 33.655,-118.004 [46253] 17 nws:KSNA 9410580; trestles 33.382,-117.589 [46277] 7 nws:KNFG 9410580; swamis 33.035,-117.295 [46266] 9 nws:KCRQ 9410230; blacks 32.889,-117.253 [46254] 2 ndbc:LJAC1 9410230.

- [ ] **Step 1: Write the failing test** `test_ca_spots_complete`: exactly the 8 ids above in order with `country=="ca"`, every required key present, `zh.name` and `ja.name` non-empty, no `tz` key, and Taiwan/Japan spots unchanged in count (8 + 8).
- [ ] **Step 2: Run** `python3 -m unittest tests.test_ca -v` → FAIL (ids missing).
- [ ] **Step 3: Add the spots.** `off` is the offshore wind bearing (wind blowing from land to sea), from the coastline facing.
- [ ] **Step 4: Run** the test → PASS; run a full build on saved downloads and compare Taiwan + Japan parts of `snap.json` with `main` → identical (`ids()` and `jpids` already skip other countries).
- [ ] **Step 5: Commit** "California spots in spots.json".

### Task 2: California readers

**Files:**
- Create: `ca.py`
- Create: `tests/fixtures/ca/` (saved live copies: `ndbc-46254.txt`, `ndbc-FTPC1.txt`, `nws-KSNA.json`, `tide-9410230.json`, `openca.json`)
- Test: `tests/test_ca.py`

**Interfaces:**
- Consumes: `jp.on_hour`, `jp.merge_buoy`, `jp.sun_times`, `jp.wind_rows`, `jp.fmt`, `jp.TPE`.
- Produces in `ca.py`:
  - `utc_to_tpe(dt: datetime) -> str` (Taipei "YYYY-MM-DDTHH:MM")
  - `ndbc_rows(txt: str, keep_hours=24) -> list` of `[time, WVHT m, APD s, MWD deg, WTMP °C|None]`, one per hour (the reading nearest the hour), last `keep_hours` hours, rows with `WVHT` `MM` dropped. APD (average period) is used so the page's period factor applies as it does to CWA's mean period.
  - `ndbc_wind(txt: str) -> list` of one `[time, kt, deg|None]` from the newest row with a `WSPD`, or `[]`.
  - `nws_wind(js: dict) -> list` of one `[time, kt, deg|None]` (km/h ÷ 1.852), or `[]` if `windSpeed.value` is null.
  - `tide_days(js: dict) -> dict` `{local date: [[HH:MM, 'H'|'L', cm int]]}` from NOAA `predictions` (`v` metres × 100, rounded).
  - `pacific_offset(at: datetime) -> int` (-7 or -8, via `zoneinfo.ZoneInfo('America/Los_Angeles')`).

- [ ] **Step 1: Write failing tests:**
  - `test_ndbc_one_row_per_hour`: a text with rows at 12:26, 11:56, 11:30, 11:00 UTC gives times `2026-10-17T20:00` (12:26 rounds to 12:00 UTC = 20:00 Taipei; 11:56 also rounds there and is nearer, so 11:56's values win) and `2026-10-17T19:00`, no duplicates.
  - `test_ndbc_drops_mm`: a row with `WVHT MM` is absent; `WTMP MM` gives `None` in the last column.
  - `test_ndbc_wind_kt`: FTPC1 fixture newest row with `WSPD` 1.0 m/s → kt 1.9.
  - `test_nws_wind`: `windSpeed.value` 5.544 km/h, dir 120 → `[t, 3.0, 120]`; value null → `[]`.
  - `test_tide_days`: fixture `"2026-10-17 13:15", "1.327", "H"` → `{'2026-10-17': [['13:15','H',133], ...]}`.
  - `test_pacific_offset`: 2026-10-17 → -7; 2026-11-02 → -8.
- [ ] **Step 2: Run** → FAIL (no module `ca`).
- [ ] **Step 3: Implement** the functions in `ca.py` (import `jp` for shared helpers; NDBC header lines start with `#`, columns split on whitespace, time columns are UTC).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** "ca.py: read NDBC buoys and wind, NWS wind, NOAA tides".

### Task 3: Fill California spots and fetch them

**Files:**
- Modify: `ca.py` (add `fill` and `__main__`)
- Modify: `refresh.sh` (California block after the Japan block)
- Create: `tests/fixtures/ca/snap_in.json` (one Taiwan, one Japan, `blacks` and `rincon`)
- Test: `tests/test_ca.py`

**Interfaces:**
- Produces: `fill(snap: dict, spots: list, dl: str, now: datetime) -> None`. For each California spot in snap: `tz` (pacific_offset(now)), `buoyId` (first `ndbc` id with rows, else None), `buoy`, `buoyAt`, `dwind`, `wind` (from `openca.json`, list in spot order like `openjma`), `tides` (local dates), `sun` (`jp.sun_times(lat, lon, date, tz)` for each local date covered by `hourly`), and `snap['src']['spots'][id] = buoyAt + '/' + dwind time`.
- Download names in `$W/dl/`: `ndbc-<ID>.txt`, `nws-<ID>.json`, `tide-<station>.json`, `openca.json`.
- Usage: `python3 -I ca.py <dl dir> <snap.json> <spots.json>`, prints one `ca: <id> <buoyId> <len buoy> <len dwind> <len wind> <len tides>` line per spot.

- [ ] **Step 1: Write failing tests:**
  - `test_fill_from_downloads`: blacks gets `buoyId '46254'`, non-empty buoy/dwind/tides/sun, `tz` -7 for `now=2026-10-17T12:00Z`, and `src.spots.blacks` changes.
  - `test_rincon_no_buoy`: `buoyId None`, `buoy []`, wind and tides still filled.
  - `test_nothing_downloaded`: an empty dl folder → no exception, California buoy/dwind/tides empty, Taiwan and Japan spots byte-identical.
  - `test_sun_uses_local_date`: with hourly rows covering Taipei 2026-10-18T00:00..23:00, `sun` keys include `2026-10-17` (the local date of those hours).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement `fill`** with the same `part()` guard pattern as jp.py, so one failing source only blanks its own field.
- [ ] **Step 4: Add to `refresh.sh`** a `caids` helper like `jpids` and, when there are California spots: NDBC `realtime2/<ID>.txt` for each buoy and `ndbc:` wind station; NWS `stations/<ID>/observations/latest` with `-A waveslave.tw`; NOAA tides `begin_date` = Pacific date 5 days back, `range=360`, `interval=hilo`, `time_zone=lst_ldt`, `datum=MLLW`, `units=metric`; Open-Meteo `models=gfs_hrrr` (fallback `gfs_seamless`), `timezone=Asia%2FTaipei`, `forecast_days=4`, same hourly fields as `openjma`. Then `python3 -I "$HERE/ca.py" ... || echo "california skipped" >&2`.
- [ ] **Step 5: Run** the tests → PASS; run a live build → one `ca:` line per spot, rincon `None`.
- [ ] **Step 6: Commit** "ca.py fills California spots from NDBC, NWS, NOAA tides and HRRR".

### Task 4: California log

**Files:**
- Modify: `refresh.sh` (history, log, correct with `ca` on `log-ca`)
- Modify: `.github/workflows/refresh.yml` (cache paths, restore and save `log-ca`)
- Modify: `.gitignore` (`log-ca/`)
- Test: `tests/test_logsplit.py`

- [ ] **Step 1: Write failing tests** `test_log_ca_only` (log.py with `ca` writes only California ids) and `test_tw_log_unchanged_by_ca` (a California-only change does not add a Taiwan record), using `tests/fixtures/ca/snap_in.json`.
- [ ] **Step 2: Run** → FAIL only if the scripts filter wrongly; if they already pass (the country argument is generic), record that and keep the tests as regression guards.
- [ ] **Step 3: Wire** the three `ca` runs in `refresh.sh` (each `|| echo`), and the workflow's restore/save lines `sh logstore.sh restore log-ca || echo ...` / `save log-ca`.
- [ ] **Step 4: Run** the suite → PASS; a live build gives `log-ca/<date>.jsonl.gz` with 8 California ids and `log/` with Taiwan only.
- [ ] **Step 5: Commit** "Separate California log (log-ca/)".

### Task 5: California on the page

**Files:**
- Modify: `template.html`

- [ ] **Step 1:** Third country button `<button data-c="ca" data-zh="加州" data-ja="カリフォルニア">California</button>`; `HOMES.ca = {cx: -119.5, cy: 35.3, span: 9}`.
- [ ] **Step 2:** Source labels on California spots: past-12h link to `https://www.ndbc.noaa.gov/station_page.php?station=<buoyId>`; footer and map note name NOAA NDBC, CDIP, NOAA tides and NWS (en/zh/ja); the typhoon panel is hidden on California spots (JTWC West Pacific only).
- [ ] **Step 3:** Check the no-buoy path and `far` label work for California (Rincon, Steamer Lane 25 km shows no distance, threshold stays 40 km).
- [ ] **Step 4: Verify** in the browser at 390×844, en/zh/ja, on blacks, rincon, huntington, donghe and hasaki: no console errors, local times shown, Taiwan and Japan unchanged.
- [ ] **Step 5: Commit** "Page: California in the country switch".

### Task 6: California map

**Files:**
- Modify: `refresh.sh` (second grid, `__GRIDCA__`), `template.html`
- Modify: scratch render helper only if it substitutes `__GRID__`

- [ ] **Step 1:** In `refresh.sh`, fetch `cache/grid-ca.json` like the West Pacific grid, every ~3 h, on lat 30..42 step 1 (13) × lon -128..-116 step 1 (13): `grid.py ... 30 1 13 -128 1 13`. Substitute `__GRIDCA__` (null when missing) in the final render.
- [ ] **Step 2:** In `template.html`, `const GRID = spotCountry(SPOT0)==="ca" ? __GRIDCA__ : __GRID__;` and `KX = Math.cos(HOMES[country].cy*Math.PI/180)`; switching between California and another country reloads the page on the new spot's hash (saving the spot first), since the map's grid buffers are built once.
- [ ] **Step 3:** Append a California coastline to `COAST`: Natural Earth 50m land (`nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson`) clipped to 30–43 N, 128–114 W, rounded to 2 decimals, same ring format.
- [ ] **Step 4: Verify** on the Map tab for blacks and oceanbeach (wind, waves, swell layers drawn over the California coast, Home button returns to California) and for donghe and hasaki (unchanged). No console errors.
- [ ] **Step 5: Commit** "Map: California grid and coastline".

### Task 7: Ship

- [ ] **Step 1:** `python3 -m unittest discover -s tests` → all OK; `sh build-site.sh /tmp/site` → `site ready`.
- [ ] **Step 2:** Log check: `log/` Taiwan only, `log-jp/` Japan only, `log-ca/` California only; all three together give 24 ids.
- [ ] **Step 3:** Phone screenshots (390×844) of a California spot in each language into `/mnt/project-files/surf-app/california/`.
- [ ] **Step 4:** Final whole-branch review, PR to `main`, subscribe, drive green. After merge, check the first Actions run for `ca:` lines and `gfs_hrrr`.
