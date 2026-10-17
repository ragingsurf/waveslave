# Australia Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 Australian spots (whole country) to waveslave.tw behind the country switch, with IMOS/AODN buoys, BoM wind now, BoM ACCESS wind forecast, Open-Meteo model tides, an Australia map grid and a separate `log-au/`.

**Architecture:** Same pattern as Hawaii (PR #39). A new `au.py` fills Australian spots in `snap.json` under the keys snap.py writes for Taiwan, reusing ca.py's rules (silent buoy, stale wind, `buoyQuiet`) and jp.py's helpers; each spot carries its own time zone. log/history/correct run a fifth time with `au`; the page adds a fifth country and an Australia map region.

**Tech Stack:** POSIX sh, Python 3 stdlib (`zoneinfo`, `csv`), vanilla JS in `template.html`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-17-australia-forecast-design.md`

## Global Constraints

- All changes in `ragingsurf/waveslave`; other logs keep their shape and keep appending.
- Every Australian fetch is optional; an outage never fails the build or touches other countries.
- Data times in `snap.json` stay Taipei wall clock; readings on the nearest hour; tides and sun local clock by local date.
- Country `au`; log `log-au/`; per-spot `zone` (Australia/Brisbane, Sydney, Melbourne, Perth); whole-hour offsets only.
- BoM requests send `User-Agent: waveslave.tw`.
- Empty buoy fields dropped, never zero. Switch label 澳洲 / オーストラリア.

## Review Focus

1. Two Australian spots on different clocks the same day (Snapper UTC+10, Byron UTC+11): each spot's tides, sun and day keys use its own date.
2. An MHL/Queensland buoy row with `WSSH` empty but `WHTH` set: the height comes from `WHTH`, period from `WPMH`/`WPFM`.
3. Margaret River's buoy hours old: `buoyQuiet`, no page error.
4. Switching Australia ↔ Hawaii ↔ Taiwan on the Map tab, and Snapper ↔ Trigg inside Australia: the map recentres on that spot's coast.
5. A tide curve with a flat top or a missing hour: no doubled or phantom highs/lows.

---

### Task 1: Australian spots

**Files:** `spots.json` (append 8), `tests/test_au.py` (new).

Values — id lat,lon zone aodn bomStation buoyKm:
noosa -26.383,153.093 Brisbane [Mooloolaba] IDQ60801.94570 22; snapper -28.163,153.549 Brisbane [Tweed Heads] IDQ60801.94592 4; byron -28.636,153.627 Sydney [Byron Bay] IDN60801.94599 27; manly -33.797,151.288 Sydney [Collaroy Narrabeen, Sydney] IDN60801.95768 8; bells -38.370,144.281 Melbourne [Apollo Bay] IDV60801.94846 65; woolamai -38.555,145.346 Melbourne [Inverloch] IDV60801.94892 43; margaret -33.973,114.983 Perth [Cape Naturaliste] IDW60801.95641 53; trigg -31.877,115.751 Perth [Hillarys] IDW60801.94614 10.

- [ ] **Step 1:** `test_au_spots_complete`: the 8 ids in order, `country=="au"`, keys (`zone`, `aodn`, `bomStation`, `buoyKm`, `buoyName`, `stationName`, `off`, `lat`, `lon`, `blurb`, `cams`, `zh`, `ja`), no `tz`, other countries 8 each. Run → FAIL.
- [ ] **Step 2:** Add spots → PASS. Commit "Australian spots in spots.json".

### Task 2: au.py

**Files:** `au.py`; fixtures `tests/fixtures/au/` (`aodn-<site>.csv` for Tweed Heads, Collaroy Narrabeen, Sydney, Cape Naturaliste; `bom-IDQ60801.94592.json`, `bom-IDN60801.94599.json`; `tideau.json` (Open-Meteo marine, 2 spots); `openau.json`; `snap_in.json`); `tests/test_au.py`.

**Interfaces (au.py):**
- `aodn_rows(csv_text, now=None) -> list` `[time, height m, period s, from deg, None]` one per hour, height `WSSH` else `WHTH`, period `WPFM` else `WPMH`, direction `SSWMD` else `WPDI`; `[]` when newest is over `ca.STALE_HOURS` old.
- `bom_wind(js, now=None) -> list` `[[time, kt, from deg|None]]` from the newest row with `wind_spd_kt`; 16-point `wind_dir` → degrees, `CALM` → kt 0 dir None; `[]` when over `ca.WIND_STALE_HOURS` old.
- `tide_days(times, levels) -> dict` `{local date: [[HH:MM, 'H'|'L', cm]]}` from an hourly local series: turning points refined by a parabola through the 3 hours around each one; equal neighbours do not double-count.
- `fill(snap, spots, dl, now)` sets per spot `tz` (offset of its `zone` at `now`), `buoyId` (the AODN site used), `buoy`, `buoyAt`, `buoyQuiet`, `dwind`, `wind` (`jp.wind_rows` on `openau.json[n]`), `tides` (from `tideau.json[n]`), `sun` (local dates), `src.spots`.
- Usage `python3 -I au.py <dl> <snap> <spots>`; download names `aodn-<site with spaces as _>.csv`, `bom-<station>.json`.

- [ ] **Step 1: Failing tests:** `test_aodn_whth_fallback` (Sydney fixture → height from WHTH); `test_aodn_one_row_per_hour`; `test_aodn_stale` (Cape Naturaliste, now 6+ h after newest → `[]`); `test_bom_wind` (Coolangatta fixture: kt, 'SSE' → 157.5, on the hour, Taipei time); `test_bom_calm`; `test_tide_days_turning_points` (synthetic sine, highs/lows within 10 min of truth, no duplicates on a flat top); `test_fill_per_spot_clock` (snapper tz 10, byron tz 11 on 2026-10-17; their sun date sets differ where Taipei midnight falls); `test_runs_isolated_like_refresh`. Run → FAIL.
- [ ] **Step 2:** Implement → full suite PASS. Commit "au.py reads IMOS buoys, BoM wind and model tides".

### Task 3: Build and workflow

**Files:** `refresh.sh`, `.github/workflows/refresh.yml`, `.gitignore`, `tests/test_logsplit.py`.

- Australia block after the NOAA loop: per AODN site one WFS GetFeature (`typeName=aodn:aodn_wave_nrt_v2_timeseries_data`, `version=1.1.0`, `outputFormat=csv`, `maxFeatures=48`, `sortBy=TIME D`, `CQL_FILTER=site_name='<site>'`); per BoM station `https://www.bom.gov.au/fwo/<product>/<product>.<wmo>.json` with `-A waveslave.tw`; `get tideau` from Open-Meteo marine `hourly=sea_level_height_msl&past_days=5&forecast_days=10&timezone=` per spot zone (one call per zone group is fine; simplest: `timezone=auto`); `get openau` with Open-Meteo's default model (its `bom_access_global` feed returns nulls); then `au.py`.
- Australia grid `regrid au -44 2 13 110 2 24`, refreshed every ~350 min (pass the age to `regrid`); `GA` null fallback; render `__GRIDAU__`.
- history/log/correct with `au` on `log-au`; workflow cache/restore/save `log-au`; `.gitignore`.

- [ ] **Step 1:** `LogSplitAustralia` (log with `au` holds only Australian ids). Run.
- [ ] **Step 2:** Edit; full live `sh refresh.sh` (no `logstore.sh save`) → `au:` lines for 8 spots. Commit "Build Australia: downloads, map grid, log-au".

### Task 4: Page

**Files:** `template.html`.

- Fifth button `au`; `mapRegion` gains `au`; grid `__GRIDAU__`; `KX` at 32°S; map view key `-au`; clamp fallback `[110,156,-44,-20]`.
- Home for Australia is the current spot's coast: `HOMES.au` east `{cx:151.5, cy:-31, span:12}`, west `{cx:115.5, cy:-32.5, span:6}` chosen by spot longitude; `WS.home` and switching spots inside Australia recentre.
- Coastline: Natural Earth 50 m land clipped to 45-19 S, 109-157 E.
- Labels: buoy source "IMOS/AODN" with the site name; legend "Offshore wind (Open-Meteo forecast)"; tide line says "model tide"; "Back to Australia"; storm panel shows a BoM tropical cyclone link; footer mentions IMOS/AODN, BoM and Open-Meteo tides.

- [ ] **Step 1:** Phone screenshots in en/zh/ja for snapper and margaret, the map, and a switch Australia → Hawaii → Taiwan → Australia plus snapper → trigg: no console errors. Screenshots to `/mnt/project-files/surf-app/australia/`. Commit "Page: Australia on the country switch and map".
