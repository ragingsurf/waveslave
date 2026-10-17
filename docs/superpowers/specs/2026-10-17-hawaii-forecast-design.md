# Hawaii forecast for WaveSlave: design

Date: 2026-10-17. Status: awaiting Bryan's review.

## Goal

Add Hawaii to waveslave.tw the way California was added (PR #38): a fourth button on the country switch, with the
same forecast, buoy check, self-correction and separate log the other countries have.

Decisions so far:

- Hawaii lives inside waveslave.tw behind the country switch, like Japan and California.
- Same approach as California: NOAA NDBC/CDIP buoys, NOAA tides, NOAA wind stations, its own log folder `log-hi/`.
- Spots: the "Four islands" set below (my recommended option on the card; swapped for the Oahu-only set if Bryan
  picks that).

Defaults I picked (say if you want otherwise):

- No new language. The Chinese and Japanese text covers the Hawaii spots too (夏威夷 / ハワイ on the switch).
- Heights in metres and wind in knots, as everywhere else.

## Spots

All buoys, tide stations and wind stations below were checked live on 2026-10-17.

| id | Spot | Buoy (NDBC id, CDIP no.) | Distance | Wind now | Tides (NOAA) |
|---|---|---|---|---|---|
| pipeline | Pipeline, North Shore Oahu | 51201 Waimea Bay (106) | ~7 km | PHHI Wheeler (NWS), then PHJR Kalaeloa | 1612668 Haleiwa |
| waikiki | Waikiki (Queens) | 51211 Pearl Harbor Entrance (233) | ~14 km | OOUH1 Honolulu | 1612340 Honolulu |
| makaha | Makaha | 51212 Barbers Point (238) | ~19 km | PHJR Kalaeloa (NWS) | 1612482 Waianae |
| sandybeach | Sandy Beach | 51202 Mokapu Point (098) | ~14 km | MOKH1 Mokuoloe | 1612301 Hanauma Bay |
| honolua | Honolua Bay, Maui | 51205 Pauwela (187), silent since Oct 13 | ~23 km | KLIH1 Kahului | 1615680 Kahului |
| hookipa | Hookipa, Maui | 51205 Pauwela (187), silent since Oct 13 | ~11 km | KLIH1 Kahului | 1615680 Kahului |
| hanalei | Hanalei Bay, Kauai | 51208 Hanalei (202), silent since Sep 9 | ~11 km | PHLI Lihue (NWS) | 1611683 Hanalei Bay |
| honolii | Honolii, Hilo | 51206 Hilo (188) | ~13 km | ILOH1 Hilo | 1617760 Hilo |

While the Maui and Kauai buoys are silent, those three spots show the forecast and say there is no buoy reading
right now, as Rincon does. They pick the buoy up again on their own when it comes back.

## Data sources (Hawaii)

The same readers as California, so no new source types:

| What | Source |
|---|---|
| Wave height, period, direction, water temp | NOAA NDBC `realtime2/<id>.txt` (CDIP buoys) |
| Wind now | NDBC shore stations, or NWS airport stations |
| Wind forecast | Open-Meteo `gfs_seamless`. HRRR does not cover Hawaii, so this is NOAA GFS; the legend says "NOAA GFS forecast". |
| Swell forecast, model check | Open-Meteo, as for every country |
| Tides | NOAA CO-OPS high/low predictions |
| Sun times | computed |
| Map | a third small Open-Meteo grid around the islands (18-23 N, 161-154 W, 0.5 degree), fetched every ~3 h |

Hurricanes: the typhoon panel is West Pacific only, so for Hawaii it shows a link to the Central Pacific Hurricane
Center instead of tracks.

## Architecture

1. **spots.json** gets the 8 spots with `country: "hi"` and the same keys as California.
2. **ca.py** becomes the reader for every NOAA country: `fill(..., country)` with a time zone per country
   (America/Los_Angeles, Pacific/Honolulu). Hawaii never changes its clocks, so its offset is always -10.
   refresh.sh runs it once per country with its own Open-Meteo file (`openca.json`, `openhi.json`).
3. **refresh.sh** gets a Hawaii block shaped like California's, plus the Hawaii grid. Every fetch is optional.
4. **log.py, correct.py, history.py** run a fourth time with `hi` on `log-hi/`; the workflow restores and saves it.
5. **template.html**: the fourth button, a Hawaii map home and grid, Hawaii coastline, NOAA source labels.
   The map today picks between two grids (West Pacific and California); this becomes a lookup by country with
   Taiwan and Japan sharing one grid, and the page reloads when switching between map regions.

Two fixes that also help California:

- **Stale buoys.** A buoy whose newest reading is more than 6 hours old is treated as silent. Today a buoy that
  stopped days ago would show its last reading as "right now".
- **Missing NWS wind.** Airport stations often leave the wind speed out of a single report (this is why Swamis had
  no wind reading). The reader asks for the last few reports and takes the newest one that has a wind speed, and a
  spot can list a second station to fall back on.

## Error handling

- Any Hawaii source down: that spot keeps its forecast without the missing piece. The build never fails on a Hawaii
  fetch, and Taiwan, Japan and California are untouched.
- `MM` values are dropped, never logged as zero.

## Testing

- Fixtures with one saved copy of each Hawaii download; the reader must produce the expected fields.
- Tests for the stale buoy and the NWS fallback.
- Given the same downloads, Taiwan, Japan and California output must be identical to `main` (apart from the two fixes).
- After one build, `log-hi/` holds only Hawaii ids.
- Phone screenshots of a Hawaii spot in each language, and the Hawaii map, before merging.
