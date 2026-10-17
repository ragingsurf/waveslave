# Japan forecast for WaveSlave: design

Date: 2026-10-17. Status: awaiting Bryan's review.

## Goal

Add Japan to waveslave.tw with the same forecast, buoy check and self-correction the Taiwan spots have, so a surfer
can pick Taiwan or Japan in one app. Japanese becomes a third language next to English and Chinese.

Decisions Bryan made in the project thread:

- Japan lives inside waveslave.tw behind a country switch, sharing one build (not a separate site).
- Spots across the whole country: the 8 listed below.
- Japanese is added as a third language for the whole app.
- Extra Japan sources: NOWPHAS offshore buoys, JMA forecasters' wave heights, JMA's 5 km wind model.

Out of scope: the Philippines (no public ocean buoys) and California (open NOAA/CDIP data, a later spot list
once the country switch exists).

## Spots

| id | Spot | Wave gauge (NOWPHAS code) | Offshore buoy | Note |
|---|---|---|---|---|
| hasaki | Hasaki, Ibaraki | Kashima (222), ~20 km | none | |
| ichinomiya | Ichinomiya, Chiba | Kashima (222), ~70 km | none | rough check, shown as such |
| shonan | Shonan (Kugenuma), Kanagawa | none | none | forecast only, no buoy check |
| shirahama | Shirahama, Shimoda (Izu) | Shimoda (504) | none | |
| ikumi | Ikumi, Kochi | Murotsu (307), ~7 km | Muroto Cape (817) | |
| okuragahama | Okuragahama, Miyazaki | Hosojima (411), ~10 km | Hyuga (818, off tonight) | |
| niigata | Niigata | Niigata (112) | none | Sea of Japan, winter swell |
| okinawa | Okinawa east coast | Nakagusuku Bay (701) | none | gauge is inside the bay, reads small |

Each spot also gets the nearest AMeDAS wind station, a JMA tide table point, a JMA forecast area code and an
offshore bearing (`off`), picked during implementation and recorded in spots.json. A spot's `buoy` list keeps the
same meaning as for Taiwan: the first id with readings in the last day wins, later ids are backups. Offshore buoys
are listed first where they exist, harbour gauges after.

Live check on 2026-10-17 20:20 JST: 63 of 124 NOWPHAS stations reporting, all gauges above reporting except Hyuga.

## Data sources (Japan)

| What | Source | How | Verified |
|---|---|---|---|
| Wave height, period, direction (and swell / wind-sea split) | NOWPHAS real-time map feed | `https://nowphas.mlit.go.jp/mapxml/<any>` (XML, every 20 min) plus `PROG/xml/POINT_SETUP.xml` for station names and positions. `99999` and empty tags mean no reading. | yes, live |
| Wind now | JMA AMeDAS | `bosai/amedas/data/latest_time.txt`, then `bosai/amedas/data/map/<yyyymmddHHMMSS>.json` (m/s, direction in 16ths) | yes, 1,286 stations |
| Wind forecast | Open-Meteo, JMA MSM 5 km model (`models=jma_msm`, falling back to `jma_seamless`) | same call shape as the existing `openwx` fetch | not yet: Open-Meteo refused connections from the build container on 10-17 |
| Swell forecast | Open-Meteo marine, Météo-France (as Taiwan) | existing `openwave` call, Japan coordinates | yes (marine API answered for other points) |
| Model comparison | Open-Meteo ECMWF, GFS, DWD (as Taiwan) | existing `openmodels` call | as Taiwan |
| Forecaster wave heights | JMA area forecast | `bosai/forecast/data/forecast/<prefecture>.json`, `waves` text per area, 3 days ("1.5メートル 後 2メートル") | yes |
| Tides | JMA tide tables | `data.jma.go.jp/kaiyou/data/db/tide/suisan/txt/<year>/<point>.txt`, fixed-width hourly heights plus highs and lows; fetched once a year and kept in `cache/` | yes (Tokyo table) |
| Sun times | computed | NOAA sunrise equation in Python, no network | n/a |
| Typhoons | CWA + JTWC (as now) | unchanged; JTWC already covers Japan | as Taiwan |
| Map grid | Open-Meteo grid 0-45 N, 100-160 E (as now) | unchanged; already covers all 8 spots | as Taiwan |

NOWPHAS has no published API. The site loads the same XML file, so reading it is the same load as one visitor.
Before the Japan pages go public, Bryan should check MLIT's terms of use for NOWPHAS data.

## Architecture

The rule: everything after `snap.json` stays country-blind. Japan only adds a way to fill the same fields.

1. **spots.json** gains `"country": "tw"` or `"jp"` on every spot (Taiwan spots default to `tw` if missing), plus
   Japan-only keys: `nowphas` (gauge and buoy codes), `amedas`, `tidePoint`, `jmaArea`, `tz` (`Asia/Tokyo`).
   Japanese names go under `"ja"`, mirroring the existing `"zh"` block.
2. **refresh.sh** keeps the CWA fetches for Taiwan spots. Japan spots are left out of the CWA id lists. A new block
   fetches the Japan sources above into `$W/dl/jp-*.json|xml|txt`. Every Japan fetch is optional: a failure logs a
   line and the build carries on, the same way `openwx` and `openmodels` do. The Open-Meteo calls already take a
   list of coordinates, so Japan spots ride in the same calls.
3. **jp.py** (new, one file) reads the Japan downloads and writes each Japan spot into `snap.json` with the same keys
   snap.py writes for Taiwan: `buoy` rows `[time, height, period, from deg, sea temp]`, `buoyId`, `dwind`, `wind`
   (forecast), `tides`, `sun`, plus `jmawave` (forecaster wave heights, the Japan twin of `cwawave`). Times are
   stored as Taipei wall clock ("YYYY-MM-DDTHH:MM", UTC+8) like every other field, so log, history and
   corrections stay unchanged; the page shifts them to Japan time for display. Tides and sun times are the exception:
   like CWA's for Taiwan they are the spot's own clock (JST) by its own date, because the page shows them as local times.
4. **snap.py and more.py** skip spots whose country is not `tw` for their CWA-only parts.
5. **Separate logs.** Taiwan keeps `log/` exactly as today; Japan logs to `log-jp/` in the same record format, also kept for good on the `data` branch. `log.py`, `correct.py` and `history.py` take an optional country so each country learns only from its own log. Merging later is reading both folders together.
   **log.py, correct.py, history.py** otherwise need no logic change: they read `buoy`, `dwind`, `hourly`, `wind` per spot.
   The log keeps Taipei-date files and the same record shape, so the forecast-vs-buoy log never stops and old
   days stay readable. `correct.py`'s wind factor compares station wind to `wind`, which for Japan is the JMA model.
6. **template.html** gets:
   - a Taiwan / 日本 country switch above the spot picker, remembered like the language pick;
   - local times per country (UTC+9 for Japan) wherever times are drawn;
   - a third language button 日本語, with `data-ja` strings next to every `data-zh`; browsers set to Japanese open
     in it;
   - source labels that follow the country ("CWA forecast" becomes "JMA forecast" on Japan spots);
   - the JMA forecaster heights in the model check, where CWA's coastal forecast sits for Taiwan.

## Error handling

- Any Japan source down: that spot shows the Open-Meteo forecast without the missing piece, as Taiwan does when a
  CWA feed is empty. The build never fails on a Japan fetch.
- NOWPHAS `99999` or empty values are dropped, never logged as zero.
- No gauge for a spot (Shonan) or a far one (Ichinomiya): the buoy check reads "no nearby buoy" or "buoy 70 km away"
  instead of a score that looks precise.
- Tide table missing for the new year: keep last year's file and show no tides past its end.

## Testing

- A fixture folder with one saved copy of each Japan download; `jp.py` run against it must produce the expected
  `snap.json` fields (checked by a small Python test, the repo's first).
- Run the full build locally with and without network to the Japan hosts; the Taiwan page must be byte-identical in
  its Taiwan data either way.
- Check the log after one run: Japan spots appear with buoy and station readings, Taiwan records unchanged.
- Phone screenshots of the country switch and Japanese text before merging.

## Open items for implementation

- Pick the AMeDAS station, tide point and forecast area for each spot.
- Confirm Open-Meteo's `jma_msm` from GitHub Actions on the first run.
- Japanese translations of every label (machine draft, then Bryan's review if he wants).
