# Pacific Northwest forecast for WaveSlave: design

Date: 2026-10-18. Status: building (Bryan said "yes go for it" and picked one button on the card). Plan: `docs/superpowers/plans/2026-10-18-pacific-northwest-forecast.md`.

## Goal

Add Oregon, Washington and British Columbia to waveslave.tw the way Hawaii was added (PR #39): a sixth button on the
country switch, with the same forecast, buoy check, self-correction and separate log (`log-nw/`) the other countries
have.

Decisions Bryan made in the project thread:

- Oregon, Washington and BC as one batch, because they reuse California's code ("yes go for it", 2026-10-18).
- One button, "Pacific NW", listing all 8 spots from Tofino down to Coos Bay (picked on the card).

Defaults I picked (say if you want otherwise):

- Country code `nw`, log folder `log-nw/`. Switch label Pacific NW / 太平洋西北 / 太平洋岸北西部.
- No new language. Heights in metres and wind in knots, as everywhere else.
- Two spots per state or province near Tofino and in Washington, four in Oregon, where most of the region's surfing is.

## Spots

Everything below was checked live on 2026-10-18. Every buoy reaches NOAA NDBC's real-time files, the Canadian ones
included, so California's buoy reader covers them all.

| id | Spot | Wave buoy (NDBC id) | Distance | Wind now | Tides |
|---|---|---|---|---|---|
| coxbay | Cox Bay, Tofino (BC) | 46206 La Perouse Bank (Environment Canada) | ~30 km | Tofino Airport (ECCC), then the La Perouse Bank buoy | CHS 08615 Tofino |
| longbeach | Long Beach, Pacific Rim (BC) | 46206 La Perouse Bank | ~30 km | Tofino Airport, then La Perouse Bank | CHS 08595 Ucluelet |
| lapush | First Beach, La Push (WA) | 46041 Cape Elizabeth, then 46087 Neah Bay | ~62 km | LAPW1 La Push, then DESW1 Destruction Island | NOAA 9442396 La Push |
| westport | Westport (WA) | 46211 Grays Harbor (CDIP) | ~11 km | WPTW1 Westport, then KHQM Hoquiam | NOAA 9441102 Westport |
| seaside | The Cove, Seaside (OR) | 46243 Clatsop Spit (CDIP), then 46029 Columbia River Bar | ~29 km | KAST Astoria airport, then ASTO3 Astoria | NOAA 9439011 Hammond |
| shortsands | Short Sands, Oswald West (OR) | 46278 Tillamook Bay (CDIP), then 46243 Clatsop Spit | ~23 km | KTMK Tillamook airport, then KAST | NOAA 9437585 Tillamook Bay north jetty |
| otterrock | Otter Rock (OR) | 46050 Stonewall Bank | ~38 km | NWPO3 Newport, then KONP Newport airport | NOAA 9435827 Depoe Bay |
| bastendorff | Bastendorff Beach, Coos Bay (OR) | 46229 Umpqua Offshore (CDIP), then 46015 Port Orford | ~50 km | CHAO3 Charleston, then KOTH North Bend | NOAA 9432780 Charleston |

La Push, Bastendorff and (on its backup buoy) Seaside say how far away their buoy is, as Ichinomiya does. A spot that
falls back to its second buoy shows that buoy's name and distance.

Left out: Jordan River and the rest of the Strait of Juan de Fuca. The Neah Bay buoy at the strait's mouth sent no wave
reading on 17 October, the buoy inside the strait sees far smaller waves than the spots, and Sheringham Point sends no
wind.

## Data sources

| What | Source | How |
|---|---|---|
| Wave height, period, direction, water temp | NOAA NDBC real-time files (NDBC, CDIP and Environment Canada buoys) | `ndbc.noaa.gov/data/realtime2/<id>.txt`, as for California. The Canadian buoys send height and peak period only (no average period, no direction), so their period is the peak period ÷ 1.3, which the page's ×1.3 turns back into the peak period. Their direction stays empty and the page shows a dash, not "N". |
| Wind now (US) | NDBC shore stations and NWS airport stations | as for California |
| Wind now (BC) | Environment and Climate Change Canada's real-time station feed (`api.weather.gc.ca`, collection `swob-realtime`) | the newest report from the last 3 hours, 10-minute average wind in km/h. The Tofino airport station is NAV CANADA's, whose reports ECCC passes on marked "All rights reserved"; the La Perouse Bank buoy (ECCC, open) is the backup. |
| Wind forecast | Open-Meteo `models=gfs_seamless` (NOAA HRRR then GFS), one call for all 8 spots | as for California; answered for every spot on 2026-10-18 |
| Swell forecast, model check | Open-Meteo, as for every country | |
| Tides (US) | NOAA CO-OPS predictions | as for California |
| Tides (BC) | Canadian Hydrographic Service water level API (`api-iwls.dfo-mpo.gc.ca`), high and low predictions | free for non-commercial use under the CHS licence, which asks derivative products to say they contain CHS data and that CHS does not endorse them; the footer says both. Times come in UTC; highs and lows are told apart by their neighbours. |
| Sun times | computed | |
| Map | a 1° Open-Meteo grid over 41–51°N, 129–122°W (11 × 8 = 88 points), refetched every ~3 h like California's | the existing Pacific coastline already draws this coast |

No tropical cyclones reach this coast, so the storm panel is hidden, as for California.

## Clocks

Oregon and Washington keep Pacific time (UTC-7 now, UTC-8 from November 1). British Columbia moved to permanent UTC-7
in March 2026 (tz database 2026b), so from November 1 Tofino is an hour ahead of Oregon and Washington. Each spot
carries its own zone (`America/Los_Angeles`, or `America/Vancouver` in BC) and the build writes the offset in force, as
for Australia. The build needs tz data 2026b or newer (Ubuntu 24.04's current tzdata is 2026c), and
`test_offset_by_zone` fails on older data. The week-around-a-change drift from California applies to the US spots.

## Architecture

1. **spots.json**: 8 spots with `country: "nw"`, `zone`, `ndbc` (list), `buoyKm` and `buoyName` (lists matching `ndbc`),
   `windStation` (list of `ndbc:`, `nws:` or `eccc:<station>`), `stationName` (list), `tideStation` (NOAA id or
   `chs:<code>`), names in zh and ja. BC spots also carry `buoyBy: "eccc"` for the buoy label.
2. **ca.py** reads `nw` too:
   - a spot's own `zone`, else the country's;
   - `buoyName` and `buoyKm` lists follow the buoy that answered, as `stationName` already follows the wind station;
   - peak period when a buoy has no average period;
   - `eccc:` wind from the ECCC feed, and `chs:` tides from the CHS API.
3. **refresh.sh**: `nw` joins the NOAA loop after Hawaii, with the ECCC and CHS fetches added to it (every fetch
   optional). `regrid nw`, a `__GRIDNW__` placeholder, and history, log and correct runs with `nw` on `log-nw/`.
4. **Workflow**: `log-nw` joins the list of log folders restored from the data branch, so a lost cache can't drop its
   days. The cache path list already takes in any `log-*` folder by itself.
5. **template.html**: the sixth button, the map home and first-open box, the grid, buoy labels (Environment Canada for
   BC), the HRRR legend, a Pacific NW home-button outline (Oregon, Washington and Vancouver Island), the footer, and a
   dash instead of "N" for a buoy with no wave direction.

## Error handling

- Any source down: that spot keeps its forecast without the missing piece; the build never fails on it and the other
  countries are untouched.
- `MM` values are dropped, never logged as zero. A buoy silent for 6 hours counts as not reporting; a wind reading over
  3 hours old is skipped, as for California and Hawaii.

## Testing

- Fixtures with one saved copy of each new kind of download (a Canadian buoy, an ECCC report, a CHS tide reply), and
  `ca.py` must produce the expected fields for a BC and an Oregon spot.
- After one build, `log-nw/` holds only the 8 new ids, and Taiwan, Japan, California, Hawaii and Australia come out of
  the same downloads as they do on `main`.
- Phone screenshots of a BC and an Oregon spot in each language, and the map's Pacific NW home view.
