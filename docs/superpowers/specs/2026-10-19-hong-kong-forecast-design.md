# Hong Kong forecast for WaveSlave: design

Date: 2026-10-19. Plan: `docs/superpowers/plans/2026-10-19-hong-kong-forecast.md`.

## Goal

Add Hong Kong to waveslave.tw the way Micronesia was added (PR #69): a country button, 3 spots, the same forecast page, map home
view and a separate forecast log (`log-hk/`).

Bryan picked "surf spots only" on 2026-10-19: Hong Kong, Hainan, Vietnam, Papua New Guinea, Vanuatu and Baja, one pull request each.
Hong Kong comes first. No source needs a key.

Defaults I picked (say if you want otherwise):

- Country code `hk`, log folder `log-hk/`. Switch label Hong Kong / 香港 / 香港, placed after Korea.
- 3 spots, west to east: Lower Cheung Sha (Lantau), Big Wave Bay (Shek O) and Tai Long Wan's Tai Wan beach (Sai Kung East).
- Left out: Pui O, Shek O and Ham Tin, 0.8 to 2.2 km from one of the three, share all its wave, wind and tide cells, so they would
  only repeat its forecast, about 10 px from it on the home view. Tung Wan on Cheung Chau has no surf reputation.
- Surfing is banned on the 42 public beaches the Leisure and Cultural Services Department runs, Big Wave Bay and Lower Cheung Sha
  among them, and the ban has been enforced since the summer of 2024 (South China Morning Post, October and November 2024). Tai Long
  Wan's beaches aren't among them. The two stay in, since Hong Kong's surfers still watch them; their spots.json blurbs say so.

## Spots

Positions were checked against OpenStreetMap and lie on open water off each beach; Open-Meteo answered waves, the tide model and
ECMWF's wind for all 3. `off`, the offshore wind, is the beach's landward normal, close to the surf guides' best wind. No public surf
cam was found at any of them (HKO's weather cameras near them look at the hills or the open sea).

| id | Spot | Zone | Wind now (km away) | Tides (km away) |
|---|---|---|---|---|
| cheungsha | Lower Cheung Sha, Lantau | Asia/Hong_Kong (UTC+8) | HKO Cheung Chau (8), then Hong Kong airport (9) | HKO Shek Pik (6) |
| bigwavebay | Big Wave Bay, Shek O | Asia/Hong_Kong | HKO Waglan Island (9) | HKO Tai Miu Wan (5) |
| tailongwan | Tai Wan, Tai Long Wan | Asia/Hong_Kong | none | HKO Ko Lau Wan (6) |

Hong Kong keeps UTC+8 all year, Taipei's clock, so its readings need no shift; the build writes the offset anyway, as everywhere.

## Data sources (no key)

| What | Source | How |
|---|---|---|
| Swell forecast, model check | Open-Meteo marine, as for every country | the shared `openwave` and `openmodels` calls take in the 3 spots. Tai Long Wan's wave cell is centred on the Long Ke shore, 4.3 km south, and read about a fifth below the open sea east of it on the day it was checked; it is kept, as nothing nearer is a sea cell |
| Wind forecast | ECMWF's IFS via Open-Meteo, then Open-Meteo's default (also ECMWF here), from the sea cell nearest each spot (`cell_selection=sea`) | one call for the 3 spots, as for Micronesia. The default land cells lie 6.5–15 km away and read about a third lighter |
| Wind now | the Hong Kong Observatory's 10-minute wind (one CSV for its 30 stations, every 10 minutes, km/h on 8 compass points), under DATA.GOV.HK's terms; the airport's reports (METAR, VHHH) via NOAA's aviationweather.gov as Cheung Sha's backup | Over 30 days, three-hourly, Waglan Island's wind tracked ECMWF's at Big Wave Bay with r 0.83 (direction within 45° in 96% of the hours) and Cheung Chau's at Cheung Sha with r 0.77 (97%). Tai Long Wan shows no wind now: Tap Mun, the nearest station, tracked it with r 0.50, and Waglan Island is 27 km away. Stanley, the station nearest Big Wave Bay, has sent no speed in a week |
| Buoys | none | no wave buoy in Hong Kong is open (DATA.GOV.HK, HKO and NDBC list none), so the spots have none, as in the Philippines |
| Tides | HKO's high and low predictions, one year per station per request, kept in `cache/` | Against two IOC gauges over a week and three Marine Department gauges over a day, HKO's were within about 15 minutes. Open-Meteo's tide model ran 22 to 42 minutes early, and near neap tide it added highs and lows of 2–5 cm that don't happen. HKO's reply doesn't label highs and lows, so they are told apart by their neighbours, as for New Zealand |
| Sun times | computed | |
| Typhoons | JTWC, as today | the build already adds every storm, with its closest pass, to every spot; Hong Kong gets the Typhoon watch panel, linked to HKO's tropical cyclone page (in English, and in Chinese for the 中文 view; HKO has no Japanese pages) |
| Map | a new Open-Meteo grid, 0.125° apart (21.5–23.125°N, 113.5–114.75°E, 154 points), refetched every ~6 h like the others | the West Pacific grid's points are 3° apart, wider than Hong Kong's whole home view |

The log keeps the forecast and the station wind. With no buoy, no height correction is learnt.

HKO's replies to a bad request are an HTML page with status 200, so a tide year is kept only when it parses as a whole year of
JSON rows; until then the spot has no tides, and the next run tries again.

## Map

The 3 spots span 22.23–22.41°N and 113.95–114.38°E (44 km by 20 km); Big Wave Bay and Tai Long Wan, the closest pair, are 23 km apart.
The home view is `hk: {cx: 114.17, cy: 22.32, span: 0.5, wide: 0.75}`: upright the width decides (about 520 px per degree, Cheung Sha
and Tai Long Wan about 80 px from the sides), sideways the height (about 720). These are the views the map's name fitting
(2026-10-18) starts from.

The grid covers the home view upright and sideways. It is the finest grid, so it runs first in the finest-first order, and the West
Pacific grid and the Pacific layer fill in around it when the map is zoomed out. The map's country button is Hong Kong's outline.

**Coastline.** Done in the commit before this work: the coarse outlines drew Hong Kong as three polygons of 4 to 7 points, so a
DETAIL box (113.44–114.66°E, 21.95–22.75°N) now holds Natural Earth's 10 m land, and every coarser outline keeps only its pieces outside
the box.

## Architecture

1. **spots.json**: 3 spots with `country: "hk"`, `zone`, `buoyKm: null`, `buoyName: ""`, `windStation` as `hko:` (the station's
   English name as HKO's CSV prints it) and `metar:` entries, `stationName`, `tideStation` (HKO's code: SPW, TMW, KLW), `off`, and
   names in zh and ja, after Micronesia's.
2. **hk.py** (new): `hko_wind` reads a station's row of HKO's CSV, `hko_events` a year of HKO's predictions; the airport goes through
   `kr.metar_wind`, the forecast through `jp.wind_rows`, and highs and lows through the alternation New Zealand's tables use, moved
   into `nz.turns` so both share it. Each year's table goes through it on its own: HKO works the years out apart, and where two meet
   it can leave out a small high or low near midnight, which would throw the alternation off. Like `nz.py`, it gives the tides for
   the forecast's days and its past days, one either side.
3. **refresh.sh**: a Hong Kong block after Korea's: HKO's wind CSV, the airport's METAR, ECMWF's wind from the sea cell, and HKO's tide
   years (on Hong Kong's clock, a week back to 12 days ahead) fetched into `cache/` when missing and kept only when whole;
   `regrid hk 350 21.5 0.125 14 113.5 0.125 11`; the page gets the grid as `__GRIDHK__`. History, log and correct run with `hk` on
   `log-hk/`.
4. **Workflow**: `log-hk` joins the log folders restored from the data branch, and HKO the list of sources; `.gitignore` takes
   `log-hk/`.
5. **template.html**: the country button, Hong Kong's outline in `HOME_ICONS`, the home view in `HOMES`, the grid in `RAW` and
   `GRIDS`, the ECMWF legend, the Typhoon watch panel's HKO link, the footer credits (HKO via DATA.GOV.HK, and Hong Kong among the
   airports) and the comments listing the countries.

## Error handling

As for Micronesia: a source that is down only blanks its own part, and the build never fails on it. A station reading over 3 hours
old, or one with no speed (HKO's `N/A`), is skipped, so Cheung Sha falls back to the airport. Calm reads 0 kt with no direction, as
does a variable wind's speed. A tide year that fails, or isn't whole, isn't kept. A failed grid fetch keeps the last grid, and with
none the map draws the coarser grids there.

## Testing

- `tests/test_hk.py`, from one saved copy of each new download (HKO's wind CSV, the airport's reports, ECMWF's wind, HKO's three tide
  stations for 2026): the 3 spots are complete; `hko_wind` gives a station's reading in kt with its direction, Calm as 0 kt with none,
  Variable with none, and nothing for `N/A`, a missing station or a stale file; `hko_events` and the alternation label each event,
  across New Year too, each year on its own; `hk.fill` gives each spot +8, Cheung Chau's wind, the airport's when Cheung Chau has no speed, none at Tai Long
  Wan, 3-hourly `wind`, HKO's tides for the right days, and sun times; filling Hong Kong leaves every other country alone; `hk.py`
  runs isolated like refresh.sh. refresh.sh's tide fetch keeps a whole year and drops HKO's error page. `tests/test_nz.py` passes
  unchanged after the move to `nz.turns`.
- `tests/test_logsplit.py`: log, correct and history with `hk` touch only Hong Kong's spots.
- The map: Hong Kong's home view in `tests/map/check.js` and its grid in `gridsLoaded`; `tests/map/tool.py` fills `__GRIDHK__`.
- On the same downloads, every other country's output and log is identical to `main`'s.
- Phone screenshots of the Hong Kong spots in en, zh and ja.
