# Japan Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 Japan spots to waveslave.tw behind a Taiwan / 日本 switch, fed by NOWPHAS, JMA and Open-Meteo, with Japanese as a third language.

**Architecture:** Japan spots ride through the existing pipeline. `snap.py` and `more.py` skip their CWA parts for non-Taiwan spots, and a new `jp.py` fills the same `snap.json` fields (`buoy`, `buoyId`, `dwind`, `wind`, `tides`, `sun`) from Japan sources, plus `jmawave`. Everything after `jp.py` (history, log, correct, the page) stays country-blind except for display: the page shifts times to the spot's time zone and labels sources by country.

**Tech Stack:** POSIX sh, Python 3 standard library only (scripts run with `python3 -I`), one HTML template with inline JS, GitHub Actions + Pages.

**Spec:** `docs/superpowers/specs/2026-10-17-japan-forecast-design.md`

## Global Constraints

- All changes in `ragingsurf/waveslave`, on a branch, merged by PR. Never republish the old WaveSlave artifact page.
- The forecast-vs-buoy log must never stop: `log.py`'s record shape, Taipei-date file names and `logstore.sh` stay as they are.
- Every Japan fetch and step is optional: a failure prints one line to stderr and the build carries on (`|| echo "... failed" >&2`).
- Every time string in `snap.json` stays Taipei wall clock, `"YYYY-MM-DDTHH:MM"` (UTC+8). JST sources are shifted −1 h on the way in.
- Python standard library only; no new packages. Tests use `unittest`.
- Taiwan output must not change: same downloads in, same Taiwan spot data out.
- NOWPHAS missing values are `99999` or empty tags; drop them, never store 0.
- Spot ids: `hasaki`, `ichinomiya`, `shonan`, `shirahama`, `ikumi`, `okuragahama`, `niigata`, `okinawa`.

## Review Focus

1. A JST time just after midnight (00:20 JST) must land on the previous Taipei date (23:20), for buoy rows, tides and sun. Tested in Tasks 2 and 3.
2. All Japan hosts down: `jp.py` exits 0, Japan spots keep their Open-Meteo forecast with empty `buoy`/`dwind`/`tides`, Taiwan spots untouched. Tested in Task 4.
3. JMA wave text in full-width digits with "後", "うねりを伴う" or a single value parses to the right maximum. Tested in Task 4.
4. When only Japan readings change between runs, `snap.json`'s `src` key must change so `log.py` still appends a record. Tested in Task 4.
5. A saved language of `ja` must be honoured before first paint (no English flash) and on reload. Checked in Task 6.

---

### Task 1: Japan spots in spots.json, CWA parts skip them

**Files:**
- Modify: `spots.json` (add `"country": "tw"` to the 4 existing spots; append 8 Japan spots)
- Modify: `refresh.sh` (`ids()` filters by country for CWA fields)
- Modify: `snap.py:42-80` (CWA lookups only for `tw`; copy `ja` and new meta keys)
- Modify: `more.py:31-42` (`cwawave` skips non-`tw` spots)

**Interfaces:**
- Produces: each Japan spot in `spots.json` has the same keys as a Taiwan spot that the page reads (`id, name, full, region, buoyName, stationName, off, lat, lon, blurb, cams, zh`) plus `country: "jp"`, `tz: 9`, `ja: {name, full, region, buoyName, stationName, cams}`, `nowphas: [codes as strings, best first]`, `buoyKm: int | null`, `amedas: "<5-digit id>"`, `tidePoint: "<2-char JMA code>"`, `jmaArea: ["<prefecture code>", "<area name>"]`. Taiwan spots gain `country: "tw"`, `tz: 8`.
- Produces: in `snap.json`, every spot carries `country`, `tz`, `ja`, `buoyKm` (null for Taiwan) in its meta. Japan spots come out of `snap.py` with `buoy: []`, `buoyId: null`, `dwind: []`, `wind: []`, `tides: {}`, `sun: {}` and full `hourly`/`hist.wave`/`storms`.

- [ ] **Step 1: Get the key.** Copy `/mnt/project-files/surf-app/cwa_key.txt` to `cwa_key.txt` in the repo root (it is git-ignored; never commit it).
- [ ] **Step 2: Pick each Japan spot's ids.** Gauges from the spec table (`hasaki`/`ichinomiya` → `["222"]`, `shirahama` → `["504"]`, `ikumi` → `["817","307"]`, `okuragahama` → `["818","411"]`, `niigata` → `["112"]`, `okinawa` → `["701"]`, `shonan` → `[]`; `buoyKm` 20 / 70 / null / 3 / 7 / 10 / 2 / 15). AMeDAS: the nearest station in `https://www.jma.go.jp/bosai/amedas/const/amedastable.json` whose `elems` has `1` as its 3rd and 4th characters (wind direction and speed). Tide point: nearest station on `https://www.data.jma.go.jp/kaiyou/db/tide/suisan/station.php`. Forecast area: prefecture office code from `https://www.jma.go.jp/bosai/common/const/area.json` (`offices`) and the area name as it appears in that office's `forecast/<code>.json` `timeSeries[0].areas[].area.name`. `off` = the bearing the wind blows *from* when offshore at that beach. Write English, `zh` (Traditional Chinese) and `ja` names; `cams` may be `[]`.
- [ ] **Step 3: Filter CWA ids by country in refresh.sh.** In `ids()`, skip spots whose `country` is not `tw` (default `tw`) unless the field is `lat` or `lon`.
- [ ] **Step 4: Make snap.py skip CWA for Japan.** In the spot loop, when `S.get('country','tw')!='tw'`, skip the coastal, tide, sun, buoy and station blocks and use the empty values listed above. Add `country`, `tz` (default 8), `buoyKm` to `meta` and `meta['ja']=S.get('ja') or {}`.
- [ ] **Step 5: Make more.py's cwawave skip Japan.** Skip spots whose country is not `tw`, so one Japan spot no longer aborts the whole part.
- [ ] **Step 6: Check Taiwan is unchanged.** Run `sh refresh.sh /tmp/new` on the branch. Then run `main`'s snap.py on the same downloads: `git show main:snap.py > /tmp/snap_main.py; git show main:spots.json > /tmp/spots_main.json; python3 -I /tmp/snap_main.py /tmp/new/dl /tmp/base.json /tmp/spots_main.json` (Taiwan spots come first in the Open-Meteo replies, so main's indexes still line up). Expected: for each Taiwan id, the branch's `/tmp/new/snap.json` spot minus `country, tz, ja, buoyKm` equals `/tmp/base.json`'s; a short `python3 -c` compare prints `TW SAME`. Japan spots have `len(hourly) > 0`.
- [ ] **Step 7: Commit** `spots.json refresh.sh snap.py more.py` with "Japan spots in spots.json; CWA parts skip them".

### Task 2: jp.py readers for NOWPHAS and AMeDAS

**Files:**
- Create: `jp.py`
- Create: `tests/test_jp.py`, `tests/fixtures/jp/nowphas.xml`, `tests/fixtures/jp/amedas.json`, `tests/fixtures/jp/amedas_time.txt`

**Interfaces:**
- Produces in `jp.py` (importable; the script body sits under `if __name__ == '__main__':`):
  - `jst_to_tpe(s: str) -> str` — `"YYYYMMDDHHMM"` or ISO JST to Taipei `"YYYY-MM-DDTHH:MM"`.
  - `nowphas_rows(xml: str) -> dict[str, list]` — code → `[time, height m, period s, from deg, None]`, time from `DataMap@time20min`; height from `<yugiha>`, period `<shiyuki>`, direction `<namimuki>` (16-point compass → degrees). Stations with empty or `99999` height or period are absent.
  - `amedas_wind(js: dict, time_jst: str) -> dict[str, list]` — id → `[time, kt, from deg]`; m/s × 1.944 rounded to 0.1; `windDirection` n of 16 → `n*22.5 % 360`; `0` direction with wind 0 is calm (`[t, 0.0, None]`); missing or quality flag ≠ 0 is absent.
  - `merge_buoy(old: list, new: list, keep_hours=24) -> list` — union by time, sorted, last 24 h.

- [ ] **Step 1: Save fixtures.** Trim a live `https://nowphas.mlit.go.jp/mapxml/x` to 4 `<mapdata>` blocks: one live (`609`), one empty (`614`), one `99999` (`603`), one live (`222`); set `time20min="202610170020"`. Trim a live AMeDAS map JSON to 3 stations (one with wind, one with `windDirection` 0 and `wind` 0, one without `wind`).
- [ ] **Step 2: Write failing tests.**

```python
def test_jst_to_tpe_crosses_midnight(self):
    self.assertEqual(jp.jst_to_tpe('202610170020'), '2026-10-16T23:20')
def test_nowphas_drops_missing(self):
    r = jp.nowphas_rows(FIX('nowphas.xml'))
    self.assertEqual(sorted(r), ['222', '609'])
    self.assertEqual(r['609'], ['2026-10-16T23:20', 1.36, 6.0, 67.5, None])  # ENE
def test_amedas_kt_and_calm(self):
    w = jp.amedas_wind(json.loads(FIX('amedas.json')), '2026-10-17T20:50:00+09:00')
    self.assertEqual(w['<id with wind>'][1], round(<m/s> * 1.944, 1))
    self.assertEqual(w['<calm id>'][1:], [0.0, None])
    self.assertNotIn('<id without wind>', w)
def test_merge_buoy_keeps_24h(self):
    old = [['2026-10-15T10:00', 1, 6, 90, None], ['2026-10-16T22:00', 1, 6, 90, None]]
    new = [['2026-10-16T23:20', 1.2, 7, 90, None]]
    self.assertEqual([r[0] for r in jp.merge_buoy(old, new)], ['2026-10-16T22:00', '2026-10-16T23:20'])
```

- [ ] **Step 3: Run** `python3 -m unittest discover -s tests -v`. Expected: FAIL, `No module named 'jp'`.
- [ ] **Step 4: Implement the four functions in `jp.py`** with `xml.etree` and `datetime` only. `merge_buoy` keeps rows within 24 h of the newest row.
- [ ] **Step 5: Run the tests.** Expected: 4 tests OK.
- [ ] **Step 6: Commit** `jp.py tests/` with "jp.py: read NOWPHAS gauges and AMeDAS wind".

### Task 3: jp.py tides and sun

**Files:**
- Modify: `jp.py`
- Modify: `tests/test_jp.py`; Create: `tests/fixtures/jp/tide.txt`

**Interfaces:**
- Produces:
  - `tide_table(txt: str, point: str) -> dict[str, list]` — Taipei date → `[[ "HH:MM", "H"|"L", cm ], ...]` sorted by time, the shape `snap.py` writes for Taiwan. Format per JMA line: chars 0–71 hourly heights (24 × 3), 72–77 date `YYMMDD` (space padded), 78–79 point code, 80–107 four highs (`HHMM` + 3-char cm), 108–135 four lows; `9999`/`999` mean none.
  - `sun_times(lat: float, lon: float, date: str) -> dict` — `{first, rise, set, last, phen: []}`, `"HH:MM"` Taipei wall clock, civil twilight at −6°, the shape `snap.py` writes from CWA.

- [ ] **Step 1: Save a fixture.** Two lines of a real 2026 table for the Choshi or Tokyo point, one of which has a high tide before 01:00 JST.
- [ ] **Step 2: Write failing tests.**

```python
def test_tide_highs_lows_shift_to_taipei(self):
    t = jp.tide_table(FIX('tide.txt'), 'TK')
    # a 00:34 JST high on the 2nd lands on the 1st at 23:34
    self.assertIn(['23:34', 'H', <cm>], t['2026-01-01'])
def test_tide_skips_9999(self):
    self.assertTrue(all(len(v) <= 8 for v in jp.tide_table(FIX('tide.txt'), 'TK').values()))
def test_sun_tokyo_known_day(self):
    s = jp.sun_times(35.68, 139.77, '2026-06-21')
    self.assertEqual(s['rise'][:4], '03:2')   # 04:25 JST, within the minute range of NAOJ's table
    self.assertLess(s['first'], s['rise']); self.assertLess(s['set'], s['last'])
```

- [ ] **Step 3: Run tests.** Expected: the 3 new tests FAIL.
- [ ] **Step 4: Implement** `tide_table` by fixed-width slicing and `sun_times` with the NOAA solar equations (declination and equation of time from the day of year; hour angle for −0.833° and −6°), output shifted to UTC+8.
- [ ] **Step 5: Run tests.** Expected: all OK.
- [ ] **Step 6: Commit** with "jp.py: JMA tide tables and computed sun times".

### Task 4: jp.py wind forecast, JMA wave text, and filling snap.json

**Files:**
- Modify: `jp.py`, `refresh.sh`, `tests/test_jp.py`
- Create: `tests/fixtures/jp/forecast.json`, `tests/fixtures/jp/openjma.json`, `tests/fixtures/jp/snap_in.json`

**Interfaces:**
- Consumes: Task 2 and 3 functions; spot keys from Task 1.
- Produces:
  - `jma_wave_m(text: str) -> float | None` — normalise full-width digits and `．`, return the largest number before `メートル`.
  - `jmawave_rows(fc: dict, area: str) -> list` — `[[time, m, None, None], ...]` every 3 h across each `timeDefines` period (until the next define, last one 24 h), Taipei time.
  - `wind_rows(om: dict) -> list` — Open-Meteo JMA reply → 3-hourly `[time, kt, from deg, "Rain"|None, None]` (Rain when `precipitation >= 0.5`), the shape of CWA `wind`.
  - `fill(snap: dict, spots: list, dl: str, cache: str) -> None` — for each `country == "jp"` spot sets `buoy` (merged with `cache/jp-buoy.json`, first code in `nowphas` with a reading in the last day wins), `buoyId`, `buoyAt`, `dwind`, `wind`, `tides` (dates in the forecast range, from `cache/jp-tide-<point>-<year>.txt`), `sun`, `jmawave`, and `snap['src']['spots'][id] = buoyAt + '/' + dwind time`. Each source is wrapped so its failure only blanks its own fields.
  - Command line: `python3 -I jp.py <dl dir> <snap.json> <spots.json> <cache dir>`.

- [ ] **Step 1: Save fixtures.** A trimmed `forecast/120000.json` (Chiba), an Open-Meteo reply for one point with `wind_speed_10m, wind_direction_10m, precipitation` (hand-written if the API is unreachable, same keys), and a `snap_in.json` with one Taiwan spot and one Japan spot as Task 1 produces them.
- [ ] **Step 2: Write failing tests.**

```python
def test_jma_wave_text(self):
    self.assertEqual(jp.jma_wave_m('１．５メートル　後　２メートル'), 2.0)
    self.assertEqual(jp.jma_wave_m('３メートル　うねりを伴う'), 3.0)
    self.assertIsNone(jp.jma_wave_m(''))
def test_fill_with_nothing_downloaded(self):
    snap = json.loads(FIX('snap_in.json')); tw = copy.deepcopy(snap['spots']['donghe'])
    jp.fill(snap, SPOTS, '/nonexistent', tmpdir)
    self.assertEqual(snap['spots']['donghe'], tw)
    self.assertEqual(snap['spots']['hasaki']['buoy'], [])
    self.assertTrue(snap['spots']['hasaki']['hourly'])
def test_fill_changes_src_key(self):
    snap = json.loads(FIX('snap_in.json')); before = json.dumps(snap['src'], sort_keys=True)
    jp.fill(snap, SPOTS, FIXDIR, tmpdir)
    self.assertNotEqual(json.dumps(snap['src'], sort_keys=True), before)
    self.assertEqual(snap['spots']['hasaki']['buoyId'], '222')
```

- [ ] **Step 3: Run tests.** Expected: the 3 new tests FAIL.
- [ ] **Step 4: Implement** the four functions and the `__main__` block (load, `fill`, write back, print one summary line per Japan spot like `snap.py` does).
- [ ] **Step 5: Run tests.** Expected: all OK.
- [ ] **Step 6: Add the fetches to refresh.sh**, after `more.py` and before `history.py`, each optional. A helper `jpids <field>` lists Japan values. Fetch `nowphas` (`https://nowphas.mlit.go.jp/mapxml/$(date +%s)`), `amedas` (latest time, then the map JSON), `jmafc-<office>` per distinct office, `openjma` (Open-Meteo `models=jma_msm` with `hourly=wind_speed_10m,wind_direction_10m,precipitation&wind_speed_unit=kn&timezone=Asia%2FTaipei&forecast_days=4` for Japan coordinates only; if that fails, the same with `models=jma_seamless`), and each tide table into `cache/` only when the year's file is missing. Then `python3 -I "$HERE/jp.py" "$W/dl" "$W/snap.json" "$HERE/spots.json" "$G" || echo "japan skipped" >&2`.
- [ ] **Step 7: Run the real build.** `sh refresh.sh /tmp/surf`. Expected: a `jp:` summary line per Japan spot with a buoy id for every spot but `shonan`, a non-empty `dwind`, `wind` and `tides`, and `built /tmp/surf/taitung-surf.html`. Record whether `jma_msm` answered.
- [ ] **Step 8: Commit** with "jp.py fills Japan spots from NOWPHAS, AMeDAS, JMA and Open-Meteo".

### Task 5: Country switch and local time on the page

**Files:**
- Modify: `template.html` (CSS near `.picker` lines 158-163; markup at line 315; `boot()` time helpers near line 1149; Map tab helpers using `8*36e5` near lines 488, 855-874, 902-1019; spot picker near 1507-1523)

**Interfaces:**
- Consumes: `spots[id].country`, `spots[id].tz` from Task 1.
- Produces: JS globals `COUNTRY` (`"tw"|"jp"`, saved in `localStorage["waveslave-country"]`, else the country of the spot in the URL hash, else `"tw"`) and `viewTz()` returning hours (8 or 9) for the current spot. Data parsing keeps UTC+8; only display uses `viewTz()`.

- [ ] **Step 1: Add the switch.** A segmented control `#country` with buttons `data-c="tw"` "Taiwan" / `data-c="jp"` "Japan" above `#picker`, styled like `.lang`. The picker lists only spots of `COUNTRY`; switching country opens that country's first spot (Taiwan: `donghe`; Japan: `hasaki`). A hash pointing at a spot of the other country switches the country.
- [ ] **Step 2: Split parse and display time zones.** In `boot()`, `tp` keeps parsing with 8 h; `local`, `hhmm`, `dayKey` use `DATA.tz||8`. In the Map tab, replace each display use of `8*36e5` with `viewTz()*36e5` and keep `pt` parsing at 8. The map's starting view centres on the current country.
- [ ] **Step 3: Check in a browser.** Build with `sh build-site.sh /tmp/site`, serve `/tmp/site` with `python3 -m http.server`, open in Playwright at 390×844. Expected: Taiwan view unchanged against a `main` build screenshot; Japan view shows 8 Japan spots, "Today" and tide times in JST (a tide at 23:34 Taipei shows 00:34 next day), no console errors.
- [ ] **Step 4: Commit** with "Page: Taiwan / Japan switch and local times".

### Task 6: Japanese as a third language

**Files:**
- Modify: `template.html` (head script line 2; `LANG`, `isZh`, `TR`, `SPT`, `camName`, `applyLang`, `setLang` near lines 403-437; `#lang` markup line 311; every `data-zh` element and every `isZh()` sentence)

**Interfaces:**
- Produces: `LANG` ∈ `"en"|"zh"|"ja"`; `T(word)` looks up `TR_ZH` or `TR_JA`; `L3(en, zh, ja)` returns the string for `LANG` (falls back to `en` when `ja` is missing); `SPT` and `camName` read `s.ja` when `LANG==="ja"`; elements carry `data-ja` beside `data-zh`.

- [ ] **Step 1: Head script and detection.** Saved `ja` wins; else `navigator.language` `^ja` → `ja`, `^zh` → `zh`, else `en`; `document.documentElement.lang` becomes `ja` for Japanese.
- [ ] **Step 2: Third button** `<button data-l="ja" lang="ja">日本語</button>` in `#lang`.
- [ ] **Step 3: Convert every `isZh() ? zh : en` sentence (41 today) to `L3(en, zh, ja)`**, add `data-ja` to all 27 `data-zh` elements, add `TR_JA` with a Japanese entry for every `TR` key. Font stacks gain `"Hiragino Sans","Noto Sans JP"`.
- [ ] **Step 4: Check none were missed.** `grep -c "isZh()" template.html` → only uses inside `L3`/`isZh` definitions remain; a short script lists `data-zh` elements without `data-ja` → none; a script lists `TR_ZH` keys missing from `TR_JA` → none.
- [ ] **Step 5: Browser check** in Japanese at 390×844 on a Taiwan and a Japan spot, plus a reload with `ja` saved. Expected: no English labels left except brand and model names, no English flash on reload, no console errors.
- [ ] **Step 6: Commit** with "Page: Japanese as a third language".

### Task 7: Japan sources on the page

**Files:**
- Modify: `template.html` (spot picker labels near 1507-1520; legend lines 343-350; model table row near line 888 and line 1467; buoy check text)

**Interfaces:**
- Consumes: `spots[id].jmawave`, `buoyKm`, `country`, `buoyId` from Tasks 1 and 4.

- [ ] **Step 1: Source names follow the country.** "CWA forecast" / 氣象署預報 becomes "JMA forecast" / 日本氣象廳預報 / 気象庁予報 on Japan spots; the buoy record link points to `https://nowphas.mlit.go.jp/` with text "NOWPHAS record" instead of CWA's 30-day page.
- [ ] **Step 2: JMA forecaster heights in the model check.** Where `cwawave` is shown (row near line 888 and the series list near line 1467), use `DATA.cwawave` labelled "CWA" or `DATA.jmawave` labelled "JMA".
- [ ] **Step 3: Buoy notes.** No gauge (`buoyId` null): the "Right now" box and buoy history say "No nearby wave buoy" (三語) and no accuracy score is shown. `buoyKm >= 40`: the buoy heading adds "· 70 km away" so the check reads as rough.
- [ ] **Step 4: Browser check** on `shonan`, `ichinomiya`, `ikumi` in all three languages. Expected: the texts above, a JMA row in the model chart, no "CWA" anywhere on Japan spots, no console errors.
- [ ] **Step 5: Commit** with "Page: Japan source labels, JMA wave row and buoy notes".

### Task 8: Ship

**Files:**
- Modify: `.github/workflows/refresh.yml` comment line 3 only ("CWA + Open-Meteo" → "CWA, NOWPHAS, JMA + Open-Meteo")

- [ ] **Step 1: Full build and tests.** `python3 -m unittest discover -s tests -v` → all OK; `sh build-site.sh /tmp/site` → `site ready`.
- [ ] **Step 2: Log check.** Run `python3 -I log.py` on the new `snap.json` against a copy of the restored log. Expected: one record appended containing all 12 spot ids; Taiwan records have the same keys as yesterday's.
- [ ] **Step 3: Phone screenshots** (390×844) of Taiwan and Japan in each language into `/mnt/project-files/surf-app/japan/`.
- [ ] **Step 4: Open the PR** to `main`, subscribe to its activity, drive CI green. After merge, check the first Actions run's log for the `jp:` lines and whether `jma_msm` answered.
