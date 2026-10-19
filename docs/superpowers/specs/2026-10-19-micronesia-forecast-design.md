# Micronesia forecast for WaveSlave: design

Date: 2026-10-19. Plan: `docs/superpowers/plans/2026-10-19-micronesia-forecast.md`.

## Goal

Add Micronesia to waveslave.tw the way the South Pacific was added (PR #62): a country button, 8 spots, the same forecast page,
buoy check, map home views and a separate forecast log (`log-mi/`).

Bryan asked for the remaining countries one at a time, with Korea's keys last (thread, 2026-10-18). The to-do list's next item was
"Micronesia (Guam, Saipan, Palau, Pohnpei): next after Alaska, as a group of its own". No source needs a key.

Defaults I picked (say if you want otherwise):

- Country code `mi`, log folder `log-mi/`. Switch label Micronesia / 密克羅尼西亞 / ミクロネシア, the region's name, placed after
  the South Pacific. Each spot's region names its island (Guam, Saipan, Pohnpei, Kosrae, Majuro).
- 8 spots, west to east: Umatac, Boat Basin and Talofofo (Guam), Tank Beach (Saipan), P-Pass and Mwand Pass (Pohnpei), Sidedish
  (Kosrae) and The Bridge (Majuro).
- Left out: Palau's Melekeok (rarely on, and Palau, 10° west of Guam, would shrink the Guam view tenfold, with Guam's three spots
  4 px apart), Ylig Bay (it shares Talofofo's wave forecast), Tanguisson (few mentions), Walung (Sidedish is better known), and Yap
  and Chuuk, which have good data but no named surf spot.

## Spots

Positions were checked against OpenStreetMap and lie on open water outside the reef; Open-Meteo answered waves, the tide model and
ECMWF's wind for all 8. `off`, the offshore wind, is the reef's or beach's landward normal, close to the surf guides' best wind.
No public surf cam was found at any of them.

| id | Spot | Zone | Buoys (km away) | Wind now | Tides |
|---|---|---|---|---|---|
| umatac | Umatac Bay, Guam | Pacific/Guam (UTC+10) | 52202 Ritidian Point (46), then 52200 Ipan (16) | Guam Airport, then Apra Harbor | NOAA 1630000 Apra Harbor |
| boatbasin | Boat Basin, Hagåtña | Pacific/Guam | 52202 Ritidian Point (23), then 52200 Ipan (15) | Guam Airport, then Apra Harbor | NOAA 1630000 Apra Harbor |
| talofofo | Talofofo Bay, Guam | Pacific/Guam | 52200 Ipan (2), then 52202 Ritidian Point (39) | Guam Airport, then Apra Harbor | NOAA 1630000 Apra Harbor |
| tankbeach | Tank Beach, Kagman | Pacific/Saipan (UTC+10) | 52211 Tanapag (17) | Saipan Airport | NOAA 1633227 Saipan |
| ppass | P-Pass (Palikir Pass), Pohnpei | Pacific/Pohnpei (UTC+11) | 52213 North Point (17) | none | tide model |
| mwand | Mwand Pass, Pohnpei | Pacific/Pohnpei | 52213 North Point (9) | none | tide model |
| sidedish | Sidedish, Kosrae | Pacific/Kosrae (UTC+11) | 52215 Utwe (13) | Kosrae Airport, daytime only | tide model |
| majuro | The Bridge, Majuro | Pacific/Majuro (UTC+12) | 52201 Kalo (3), then 52216 Arno (42) | none | NOAA TPT2721 Majuro Atoll |

None of these zones changes its clock in 2026 or 2027; the build writes the offset in force anyway, as for the South Pacific.

## Buoys

All are PacIOOS Waverider buoys, run with CDIP and served by NOAA NDBC like Amouli's (`buoyBy: "pacioos"`). Only Pohnpei's reports
today: Guam's two have sent nothing since June, Saipan's since 7 August and Kosrae's since January, and Majuro's Kalo buoy sends rows
with no wave height (CDIP flags every reading bad). They stay listed: the page says the buoy isn't reporting, and each comes back on
its own when PacIOOS redeploys it.

- Each Guam spot takes first the buoy on its own side of the island, since that one sees the spot's swell: Ipan, off the east coast,
  for Talofofo; Ritidian Point, off the north tip, for Boat Basin (which faces north) and Umatac (best in a northwest swell, which
  Ipan never sees). As for every spot with backups, the corrections learn only from the first (`buoyMain`).
- Majuro shows Arno's buoy, 42 km east, while Kalo is broken, with its distance. Arno faces north and The Bridge south, so the
  height correction keeps to Kalo and learns nothing until Kalo's waves come back.
- No main buoy is 100 km or more away, so the far-buoy rule doesn't come in.

## Data sources (no key)

| What | Source | How |
|---|---|---|
| Swell forecast, model check | Open-Meteo marine, as for every country | the shared `openwave` and `openmodels` calls take in the 8 spots |
| Wind forecast | ECMWF's IFS via Open-Meteo, then Open-Meteo's default, from the sea cell nearest each spot (`cell_selection=sea`) | one call for the 8 spots, as for the South Pacific. The default land cell puts both Pohnpei spots on one inland cell 12 km away, with about a third less wind |
| Wind now | Guam, Saipan and Kosrae airports (METAR) via NOAA's aviationweather.gov; Apra Harbor's NOS station (NDBC APRP7) when Guam's airport is silent | Over a week their wind tracked ECMWF's at the spots (hourly speed r 0.91–0.94, direction within 45° in 92–99% of the hours). Kosrae's airport reports only in local daytime, so its spot shows the wind then and nothing at night. Pohnpei's and Majuro's airports report a few hours a day and tracked their spots poorly (r 0.19–0.54), so those three spots show no wind now |
| Buoys | PacIOOS's buoys via NOAA NDBC | read as for the South Pacific (`ca.ndbc_rows`), backups only when the first is silent |
| Tides | NOAA's highs and lows where it has a station, else Open-Meteo's tide model | NOAA's asked for in UTC and put on each spot's clock, as for the South Pacific. Against a week of tide gauges NOAA was within about 20 minutes at Apra Harbor, Saipan and Majuro. NOAA has no station on Pohnpei or Kosrae, so P-Pass, Mwand and Sidedish take the model, which ran about 25 minutes early against Pohnpei's gauge, and their page says "Model tide". Pago Bay's NOAA station is closer to Talofofo but sits on a reef flat whose tide neither NOAA nor the model matches, so every Guam spot takes Apra Harbor's |
| Sun times | computed | |
| Typhoons | JTWC, as today | the build already adds every storm, with its closest pass, to every spot; Micronesia gets the Typhoon watch panel, linked to the National Weather Service in Guam (the official warnings for Guam, the Marianas, the FSM and the Marshalls) |
| Map | a new Open-Meteo grid, 2° apart (2°S–14°N, 152–176°E, 117 points), refetched every ~6 h like the South Pacific's | the east part lies past the West Pacific grid's 160°E edge; the west part lies inside it, as Taiwan's view does |

The log keeps the forecast, the buoys and the station wind; the height correction starts at Pohnpei now, and at the others once their
buoys report.

## Map

The 8 spots span 26.7° of longitude: in one view Guam's three would be 1–2 px apart. So, like the South Pacific, Micronesia has two
home views, split at 152°E and picked by the current spot's longitude:

- West, Guam and Saipan: centre 145.22°E, 14.24°N, showing 3.3° of latitude and at least 1.7° of longitude. Upright the width
  decides (about 229 px per degree, Guam's spots 29 px apart), sideways the height (about 115).
- East, Pohnpei to Majuro: centre 164.74°E, 6.21°N, 9.5° of latitude and at least 19° of longitude (about 20 px per degree upright,
  41 sideways). P-Pass and Mwand are 3.5 px apart upright and 7 sideways, tighter than Tahiti's pair; zooming in separates them.

These are the views the map's name fitting (2026-10-18) starts from. On a phone, upright and sideways, every name of each part fits
at these zooms in English, Chinese and Japanese, so neither part zooms out further.

Each part keeps its own saved view (`waveslave-mapview-mi-w`, `-mi-e`), the first open with nothing saved is the current part's home
view, and only a move to the other part recentres, as for the South Pacific. The grid holds the east part sideways and the middle
band upright; the West Pacific grid and the Pacific layer fill in the rest. It runs after the South Pacific's in the finest-first
order. The map's country button is Guam's outline.

**Coastline.** The map's outlines of these islands are coarse (Guam 7 points, Saipan 4, Kosrae 4), and Guam's puts Boat Basin 3 km
inland, which shows at this zoom. The four island groups with spots (the Marianas from Guam to Saipan, Pohnpei with Ant Atoll,
Kosrae and Majuro) get Natural Earth's 10 m land instead, about 230 points, as Hawaii has, and the coarser rings there are dropped
when the map is built, as Taiwan's are. Boat Basin then sits 0.9 km inland and Umatac 0.5 km (Natural Earth's Guam still cuts
across both bays), which is on a par with Hawaii's and Australia's spots today.

## Architecture

1. **spots.json**: 8 spots with `country: "mi"` and the South Pacific's fields (`zone`, `ndbc`, `buoyKm`, `buoyName`,
   `buoyBy: "pacioos"`, `windStation` as `metar:` or `ndbc:` entries, `stationName`, `tideStation` or null, `off`, names in zh and ja),
   after Alaska's.
2. **pi.py** reads `mi` too, as ca.py reads four NOAA countries: `fill(..., country)` and a fourth argument, `pi` by default, pick
   the spots and the download names (`metar-mi.json`, `openmi.json`, `tidemi-<station>.json`, `tidemi.json`), and a wind station
   may be `ndbc:` (through `ca.ndbc_wind`). The South Pacific comes out as before.
3. **refresh.sh**: the South Pacific block becomes a loop over `pi` and `mi`, with `cell_selection=sea` on Micronesia's wind
   forecast; `regrid mi 350 -2 2 9 152 2 13`; the page gets the grid as `__GRIDMI__`. History, log and correct run with `mi` on
   `log-mi/`.
4. **Workflow**: `log-mi` joins the log folders restored from the data branch; `.gitignore` takes `log-mi/`.
5. **template.html**: the country button, Guam's outline in `HOME_ICONS`, the two parts in `PARTS`, the grid in `RAW` and `GRIDS`,
   the islands' 10 m coastline, the ECMWF legend, the PacIOOS buoy line, the Typhoon watch panel's NWS Guam link, the footer credits
   and the comments listing the countries.

## Error handling

As for the South Pacific: a source that is down only blanks its own part, and the build never fails on it. A buoy silent for over
6 hours shows no reading, after trying the backup. A wind reading over 3 hours old is skipped, so Kosrae's airport shows nothing
overnight. A failed tide fetch leaves that spot without tides until the next run. A failed grid fetch keeps the last grid, and with
none the map draws the coarser grids there.

## Testing

- `tests/test_mi.py`, from one saved copy of each new download (Pohnpei's and Arno's buoys, Kalo's rows with no waves, Apra Harbor's
  station, the airports' reports, ECMWF's wind, NOAA's three stations in UTC, the tide model; Guam's, Saipan's and Kosrae's buoys have
  no file: NDBC serves none for a buoy silent this long, so the build's fetch fails, as it did on 2026-10-19): the 8 spots are
  complete; `pi.py mi` gives each spot its offset (+10, +11, +12), P-Pass North Point's rows, Majuro Arno's when Kalo has no waves,
  a quiet buoy at Guam's spots, Guam's airport wind and Apra Harbor's when the airport is silent, no wind at Kosrae from a stale
  report, NOAA's tides on each spot's clock and the model's with `tideModel`; filling Micronesia leaves the South Pacific alone and
  the reverse; `pi.py` runs isolated like refresh.sh. `tests/test_pi.py`'s checks of refresh.sh follow the loop (`piids pi`, the
  loop's download names); its other tests pass unchanged.
- `tests/test_logsplit.py`: log, correct and history with `mi` touch only Micronesia's spots.
- The map: Micronesia's two home views and the move between them in `tests/map/check.js`, and its grid in `gridsLoaded`. A test on
  the template that every 10 m ring lies inside one of the four island boxes, and every coarser ring that reaches into a box lies
  wholly inside it, so the page drops it and no island is drawn twice.
- On the same downloads, every other country's output and log is identical to `main`'s.
- Phone screenshots of Micronesia spots in en, zh and ja.
