# California forecast for WaveSlave: design

Date: 2026-10-17. Status: awaiting Bryan's review.

## Goal

Add California to waveslave.tw the way Japan was added (PR #37): a third country on the switch, with the same
forecast, buoy check, self-correction and separate log the Taiwan and Japan spots have.

Decisions Bryan made in the project thread:

- California lives inside waveslave.tw behind the country switch (same as Japan).
- Spots across the whole state: the 8 listed below, San Francisco to San Diego.
- Same approach as Japan, with its own log folder, `log-ca/`.

Defaults I picked (say if you want otherwise):

- No new language. English already covers California, and the Chinese and Japanese text covers its spots too.
- Heights in metres and wind in knots, the same as the other countries.

## Spots

All buoys below were reporting live on 2026-10-17. Every one is a CDIP buoy mirrored by NOAA NDBC, so a single
reader covers them.

| id | Spot | Buoy (NDBC id, CDIP no.) | Distance | Wind now | Tides (NOAA) |
|---|---|---|---|---|---|
| oceanbeach | Ocean Beach, San Francisco | 46237 SF Bar (142) | ~15 km | FTPC1 Fort Point | 9414290 San Francisco |
| steamerlane | Steamer Lane, Santa Cruz | 46236 Monterey Canyon Outer (156) | ~25 km | MLSC1 Moss Landing | 9413745 Santa Cruz |
| rincon | Rincon | none (46053 has no wave sensor right now) | | NTBC1 Santa Barbara | 9411340 Santa Barbara |
| malibu | Malibu (Surfrider) | 46268 Topanga Nearshore (103) | ~10 km | ICAC1 Santa Monica Pier | 9410840 Santa Monica |
| huntington | Huntington Beach Pier | 46253 San Pedro South (213) | ~17 km | KSNA John Wayne Airport (NWS) | 9410580 Newport Beach |
| trestles | Lower Trestles | 46277 Green Beach Offshore (271) | ~7 km | KNFG Camp Pendleton (NWS) | 9410580 Newport Beach |
| swamis | Swamis, Encinitas | 46266 Del Mar Nearshore (153) | ~9 km | KCRQ Carlsbad (NWS) | 9410230 La Jolla |
| blacks | Blacks Beach, La Jolla | 46254 Scripps Nearshore (201) | ~2 km | LJAC1 La Jolla | 9410230 La Jolla |

Rincon works like Shonan: the forecast is shown and the page says there is no nearby wave buoy. Any spot with a
buoy more than 40 km away says how far away it is, as Ichinomiya does.

## Data sources (California)

| What | Source | How |
|---|---|---|
| Wave height, period, direction, water temp | NOAA NDBC (CDIP buoys) | `ndbc.noaa.gov/data/realtime2/<id>.txt`: 45 days of 30-minute rows, so no rolling cache is needed (unlike NOWPHAS). `MM` means no reading. |
| Wind now | NDBC shore stations (same `.txt` format), and NWS airport stations where NDBC has none | `api.weather.gov/stations/<id>/observations/latest` (km/h, needs a User-Agent) |
| Wind forecast | Open-Meteo, NOAA HRRR 3 km model (`models=gfs_hrrr`, falling back to `gfs_seamless`) | same call shape as `openjma`; answered live from here |
| Swell forecast, model check | Open-Meteo, as for Taiwan and Japan | existing calls with California coordinates |
| Tides | NOAA CO-OPS predictions | `api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&interval=hilo&time_zone=lst_ldt&datum=MLLW&units=metric`, 10 days per call |
| Sun times | computed (`sun_times` from jp.py) | no network |
| Map | a second, smaller Open-Meteo grid covering the California coast (30-42 N, 128-116 W, 1 degree) | fetched every ~3 h like the West Pacific grid; the map uses the grid for the current country |

All of these are US government open data with no key and no terms that block a public site. Forecaster text like
JMA's has no clean NOAA equivalent, so the model check gets no extra row for California.

## Architecture

The same pattern as Japan, so nothing after `snap.json` needs to know about a third country beyond its id:

1. **spots.json** gets the 8 spots with `country: "ca"`, `ndbc`, `buoyKm`, `windStation`,
   `tideStation`, plus `zh` and `ja` names.
2. **refresh.sh** gets a California block after the Japan one. Every fetch is optional (`|| echo`), so California
   being down never touches Taiwan or Japan.
3. **ca.py** (new) fills each California spot's `buoy`, `buoyId`, `buoyAt`, `dwind`, `wind`, `tides` and `sun`,
   and sets the spot's `tz` to the Pacific offset in force at build time (-7 or -8), reusing jp.py's helpers where they fit (`merge_buoy`, `sun_times`, `wind_rows`). Data times stay on the Taipei
   clock like every other field, readings go on the nearest hour, and tides and sun are kept on the local clock.
4. **log.py, correct.py, history.py** run a third time with `ca` on `log-ca/`. The workflow and `logstore.sh`
   restore and save `log-ca/` alongside the other two. Taiwan's `log/` is untouched.
5. **template.html**: a third button on the country switch, a California map home and grid, and source labels
   (NOAA / CDIP) on California spots.

### Daylight saving

California moves its clocks (UTC-7 now, UTC-8 from Nov 1). Japan and Taiwan never do, so the page currently keeps
one fixed offset per spot. For California the build writes the offset in force at build time, and the page uses
it. In the week around a clock change, forecast days on the far side of the change are drawn an hour off. The rest
of the year is exact. Making the page follow the change hour by hour would mean reworking every time label, so I'd
leave that out unless you want it.

## Error handling

- Any California source down: that spot keeps its Open-Meteo forecast without the missing piece. The build never
  fails on a California fetch.
- `MM` values are dropped, never logged as zero.
- NWS airport stations report every hour, and a missing wind reading just leaves "wind now" blank.

## Testing

- Fixtures with one saved copy of each California download; `ca.py` must produce the expected `snap.json` fields
  (unit tests next to `tests/test_jp.py`).
- Given the same downloads, the Taiwan and Japan output must be identical to `main`.
- After one build, `log-ca/` holds only California ids and `log/` and `log-jp/` are unchanged in shape.
- Phone screenshots of a California spot in each language before merging.
