# New Zealand forecast for WaveSlave: design

Date: 2026-10-18. Plan: `docs/superpowers/plans/2026-10-18-new-zealand-forecast.md`.

## Goal

Add New Zealand to waveslave.tw the way Indonesia was added (PR #59): a country button, 8 spots, the same forecast page,
map home view and a separate forecast log (`log-nz/`).

Bryan asked for the remaining countries one at a time, with Korea's keys last (thread, 2026-10-18). New Zealand is next on
the list; the to-do list named a forecast, airport wind, official LINZ tide tables and one buoy. No source needs a key.

Defaults I picked (say if you want otherwise):

- Country code `nz`, log folder `log-nz/`. Switch label New Zealand / 紐西蘭 / ニュージーランド, placed after Australia.
- 8 spots, Raglan first as the country's best-known wave, then north to south: Mount Maunganui, Gisborne (Wainui),
  New Plymouth (Fitzroy), Lyall Bay, Kaikōura (Mangamaunu), New Brighton and St Clair.
- Left out for now: Piha (no tide table, buoy or cam of its own, on Raglan's coast), Whangamatā and Ahipara (only offset
  tides), Aramoana (a later option on the Dunedin buoy network).

## Spots

Coordinates from OpenStreetMap, checked against Open-Meteo on 2026-10-18 (waves, the tide model and ECMWF's wind answered
for every spot). Several spots sit a little off the beach so that the wave model's nearest cell is open sea; at New
Brighton and St Clair it is the cell that tracked their buoy best. Each spot's facing comes
from the coastline; `off`, the offshore wind, is the opposite way. Raglan is the exception: its coast faces north, but the
swell wraps around the point and the offshore wind there is east to southeast, so `off` is 135.

| id | Spot | Faces | Best | Wind now | Buoy | Tides (LINZ) |
|---|---|---|---|---|---|---|
| raglan | Manu Bay, Raglan | NW | southwest to west groundswell, east to southeast wind | none | none | Manu Bay |
| mount | Mount Maunganui Main Beach | NE | northeast swell (cyclones, easterly lows), southwest wind | none | none | Moturiki Island |
| gisborne | Wainui Beach, Gisborne | ESE | east swell, westerly wind | none | none | Gisborne |
| newplymouth | Fitzroy Beach, New Plymouth | NW | west swell, southeast wind | none | none | Port Taranaki |
| lyall | Lyall Bay, Wellington | S | south swell, northerly wind | Wellington Airport, 1 km | none | Wellington |
| kaikoura | Mangamaunu, Kaikōura | ESE | big south or east swell, westerly wind | none | none | Kaikōura |
| brighton | New Brighton, Christchurch | ENE | east swell or a big southerly, westerly wind | Christchurch Airport, 17 km | Pegasus Bay, 15 km | New Brighton Pier |
| stclair | St Clair Beach, Dunedin | SE | south swell, northwest wind | none | White Island, 3 km | Green Island |

Every spot keeps `Pacific/Auckland`: UTC+13 in summer (NZDT, until 5 April 2027), UTC+12 in winter. The build writes the
offset in force, as for Australia.

## Data sources (no key)

| What | Source | How |
|---|---|---|
| Swell forecast, model check | Open-Meteo marine, as for every country | the shared `openwave` and `openmodels` calls take in the 8 spots |
| Wind forecast | ECMWF's IFS (9 km) via Open-Meteo, then Open-Meteo's default | one call for the 8 spots, as for the Philippines and Indonesia |
| Wind now | Wellington (NZWN) and Christchurch (NZCH) airports via NOAA's aviationweather.gov | both report every 30 minutes. Over a week Wellington's wind tracked ECMWF's at Lyall Bay (r 0.93) and Christchurch's at New Brighton (0.74). Tauranga's, Gisborne's, New Plymouth's and Kaikōura's airports sent no report to that feed in 7 days; Dunedin's is 23 km inland and tracked St Clair's forecast poorly (0.39); Hamilton's is 46 km inland from Raglan |
| Buoys | the University of Canterbury's South Island Waves network (CC BY 4.0, credit the University of Canterbury) | Pegasus Bay (31020, hourly, with water temperature) for New Brighton and White Island (31327, every 3 hours, Dunedin City Council's) for St Clair, one CSV request per buoy for the last 26 hours. Hourly rows like the other buoys: significant height, mean period, peak direction, water temperature where the buoy has it. The other spots have no open buoy: Wellington's Baring Head buoys need Greater Wellington's permission to republish, and Napier's allow non-commercial use only |
| Tides | LINZ's official tide tables (Toitū Te Whenua Land Information New Zealand, CC BY 4.0) | one CSV per port and year (about 19 KB), kept in `cache/` and fetched again after 30 days because LINZ reissues them; a reply is kept only if it has a tide row for that year. Times are New Zealand's clock (NZDT in summer), kept as given like NOAA's; heights above chart datum. Highs and lows aren't labelled: each is a high when it is above the next. Open-Meteo's tide model ran 28 to 53 minutes early against LINZ at Manu Bay, Tauranga and Gisborne, so the page doesn't say "Model tide" here |
| Sun times | computed | |
| Cyclones | MetService (TCWC Wellington) and the Fiji Meteorological Service (RSMC Nadi) | a "Cyclone watch" panel with both links, as Australia's has BoM's: the typhoon feeds the page uses cover the North Pacific only |
| Map | a new Open-Meteo grid, 2° apart (50–32°S, 150°E–162°W), refetched every ~6 h like Australia's | Open-Meteo takes longitudes up to 180°, so points past it are asked for as west longitudes, as pacific.sh does |

The log keeps the forecast, the two buoys and the two airports' wind; the height corrections start at New Brighton and
St Clair once the log holds enough buoy readings.

## Map

- Home view: centre 174.3°E, 41.8°S, 16° of latitude on the map's height. On a phone it holds all 8 spots clear of the
  buttons both ways up (at least 45 px upright, 33 px sideways).
- First-open box: `{l: 151.08, r: 197.52, s: -49.3, n: -33.31}`, the home view on a phone both ways up, as for Korea,
  the Philippines and Indonesia.
- The grid runs 150–198°E, so it holds the home view either way up, even on a 20:9 phone held sideways (150.5–198.2°E),
  and the pressure lines there come from it. It runs between Indonesia's and the West Pacific's in the finest-first order.
- The button's icon is the outline of the main islands from Natural Earth's land.

## Architecture

1. **spots.json**: 8 spots with `country: "nz"`, `zone`, `siw` (buoy ids) with `buoyName` and `buoyKm` (and `buoyBy: "dcc"`
   on St Clair, whose White Island buoy is Dunedin City Council's, so the page credits the council there), `windStation`
   (`metar:NZWN`, `metar:NZCH` or none), `tidePort` (the LINZ table's name), `off`, names in zh and ja, live cams where an
   open one shows the spot.
2. **nz.py** (new, like au.py): reads `siw-<id>.csv`, `metar-nz.json` (through `kr.metar_wind`), `opennz.json` and the
   LINZ tables from the cache folder, and writes the same keys as the other countries.
3. **refresh.sh**: an NZ block after Indonesia's; `regrid nz 350 -50 2 10 150 2 25` (regrid now writes longitudes past 180
   as west ones, which changes nothing for the other grids); the page gets the grid as `__GRIDNZ__`. History, log and
   correct run with `nz` on `log-nz/`.
4. **Workflow**: `log-nz` joins the log folders restored from the data branch; `.gitignore` gains `log-nz/`.
5. **template.html**: the country button, the outline for the map's country column, the map home view, first-open box
   and grid, the ECMWF legend, the buoy source line, the cyclone panel and the footer credits.

## Error handling

As for Australia: a source that is down only blanks its own part, and the build never fails on it. A buoy silent for over
6 hours shows "No reading from the … buoy right now". A LINZ table that fails to download, or comes back without a tide row
for its year, keeps the cached one; with none the spot has no tides. After a timeout the other tables wait for the next run, so a
slow LINZ costs one build a minute at most. A failed grid fetch keeps the last grid, and with none the map draws the Pacific layer there.

## Testing

- Fixtures with one saved copy of each new download (the two buoys, the two airports' reports, ECMWF wind, trimmed LINZ
  tables); `nz.py` must produce the expected fields: buoy rows at New Brighton and St Clair, airport wind at Lyall Bay and
  New Brighton, tides from each spot's own table across a year's end, and a ragged CSV row's water temperature left out.
  The other countries' tests pass unchanged, and filling New Zealand leaves the others alone.
- After one build, `log-nz/` holds only the 8 new ids, and every other spot comes out of the same downloads as on `main`.
- The map checks with a New Zealand home view and its grid, and phone screenshots of New Zealand spots in each language.
