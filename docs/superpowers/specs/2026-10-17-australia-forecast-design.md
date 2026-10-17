# Australia forecast for WaveSlave: design

Date: 2026-10-17. Status: awaiting Bryan's review.

## Goal

Add Australia to waveslave.tw the way Hawaii was added (PR #39): a fifth button on the country switch, with the same
forecast, buoy check, self-correction and separate log (`log-au/`) the other countries have.

Decisions so far:

- Australia lives inside waveslave.tw behind the country switch.
- Spots across the whole country (Bryan picked "Whole country" on the card): the 8 below.

Defaults I picked (say if you want otherwise):

- No new language. Switch label 澳洲 / オーストラリア.
- Heights in metres, wind in knots, as everywhere else.

## Spots

Everything below was checked live on 2026-10-17.

| id | Spot | State, clock | Wave buoy (AODN site) | Distance | Wind now (BoM) |
|---|---|---|---|---|---|
| noosa | Noosa (First Point) | QLD, UTC+10 | Mooloolaba | ~22 km | Tewantin |
| snapper | Snapper Rocks | QLD, UTC+10 | Tweed Heads | ~4 km | Coolangatta |
| byron | Byron Bay (The Pass) | NSW, UTC+10/+11 | Byron Bay | ~27 km | Cape Byron |
| manly | Manly | NSW, UTC+10/+11 | Collaroy Narrabeen, then Sydney | ~8 km | North Head |
| bells | Bells Beach | VIC, UTC+10/+11 | Apollo Bay | ~65 km | Aireys Inlet |
| woolamai | Cape Woolamai, Phillip Island | VIC, UTC+10/+11 | Inverloch | ~43 km | Rhyll |
| margaret | Margaret River (Main Break) | WA, UTC+8 | Cape Naturaliste | ~53 km | Witchcliffe West |
| trigg | Trigg Point, Perth | WA, UTC+8 | Hillarys | ~10 km | Swanbourne |

Bells, Phillip Island and Margaret River say how far away their buoy is, as Ichinomiya does. The Cape Naturaliste buoy
reaches the national feed only a few times a day, so Margaret River will often show "no reading from the buoy right
now" (the rule from Hawaii: a buoy with nothing in the last 6 hours counts as silent).

## Data sources (Australia)

| What | Source | Notes |
|---|---|---|
| Wave height, period, direction | IMOS/AODN national real-time wave feed (`aodn_wave_nrt_v2_timeseries_data`, one request per buoy for its newest ~30 readings) | Carries the Queensland, NSW (MHL), Victoria (Deakin, IMOS) and WA buoys in one place, about an hour behind. Open data, CC BY 4.0. No water temperature in this feed. |
| Wind now | Bureau of Meteorology station observations (JSON, every 10-30 min) | Answers our plain `waveslave.tw` user agent. BoM's copyright page limits reuse of its website data, so please check it is fine for a free public site, as with NOWPHAS. |
| Wind forecast | Open-Meteo's best-match model | Open-Meteo's BoM ACCESS feed (`bom_access_global`) returned no data on 2026-10-17, so the default blend is used. Legend: "Open-Meteo forecast". |
| Swell forecast, model check | Open-Meteo, as for every country | |
| Tides | Open-Meteo marine `sea_level_height_msl` (a global tide model), highs and lows picked from the hourly curve | Australia has no open tide-table feed (BoM tide tables are copyright). Times should be within ~30 min; heights are relative to mean sea level and run smaller than the official tables, so the page labels them "model tide". |
| Sun times | computed | |
| Map | an Open-Meteo grid over southern Australia (44-20 S, 110-156 E, 2 degrees), fetched every ~6 h to keep Open-Meteo calls down | The whole country does not fit on a phone at a useful zoom, so the map opens on the current spot's coast (east or west) and you can pan across. |

Cyclones: the typhoon panel is West Pacific only, so Australian spots get a link to BoM's tropical cyclone page.

## Clocks

Australia is the first country where spots run on different clocks: Queensland and WA never change, NSW and Victoria
move to daylight time on the first Sunday of October (so they are on UTC+11 now). Each spot gets its own time zone in
spots.json (`Australia/Brisbane`, `Australia/Sydney`, `Australia/Melbourne`, `Australia/Perth`), and the build writes
the offset in force for that spot. The page already draws every spot in its own `tz`. The week-around-a-change drift
from California applies here too. South Australia (half-hour offset) is left out.

## Architecture

1. **spots.json**: 8 spots with `country: "au"`, `zone`, `aodn` (list of AODN site names tried in order), `bomStation`
   (`IDN60801.94599` style), `buoyKm`, names in zh and ja.
2. **au.py** (new): reads the AODN CSVs, BoM JSONs and Open-Meteo tides, and fills `buoy`, `buoyId`, `buoyAt`,
   `buoyQuiet`, `dwind`, `wind`, `tides`, `sun`, `tz` the same way ca.py does, reusing its helpers (silent buoy and
   stale wind rules, sun times).
3. **refresh.sh**: an Australia block after Hawaii's (every fetch optional), the Australia grid, and history, log and
   correct runs with `au` on `log-au/`; the workflow restores and saves `log-au/`.
4. **template.html**: the fifth button, the Australia map region and coastline, BoM/IMOS labels, the cyclone link.

## Error handling

- Any Australian source down: that spot keeps its forecast without the missing piece; the build never fails on it and
  the other countries are untouched.
- Empty buoy fields are dropped, never logged as zero. A buoy reporting only some fields (the MHL and Queensland buoys
  send height and direction under different column names than the IMOS buoys) is read from whichever is present.

## Testing

- Fixtures with one saved copy of each Australian download; au.py must produce the expected fields.
- Tests for the per-spot clocks (Brisbane vs Sydney on the same day), the tide high/low picking, and the BoM wind
  direction words (ENE etc.) to degrees.
- After one build, `log-au/` holds only Australian ids.
- Phone screenshots of an east-coast and a west-coast spot in each language, and the map.
