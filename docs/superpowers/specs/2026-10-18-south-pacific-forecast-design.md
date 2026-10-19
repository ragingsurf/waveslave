# South Pacific forecast for WaveSlave: design

Date: 2026-10-18. Plan: `docs/superpowers/plans/2026-10-18-south-pacific-forecast.md`.

## Goal

Add the South Pacific islands to waveslave.tw the way New Zealand was added (PR #61): a country button, 8 spots, the same
forecast page, map home views and a separate forecast log (`log-pi/`).

Bryan asked for the remaining countries one at a time, with Korea's keys last (thread, 2026-10-18). The to-do list's next item
was "Pacific islands (Fiji, Samoa, Tahiti, Guam and others): NOAA tides and airport wind". No source needs a key.

Defaults I picked (say if you want otherwise):

- One group for the islands south of the equator, code `pi`, log folder `log-pi/`. Switch label South Pacific / 南太平洋 /
  南太平洋, placed after New Zealand.
- 8 spots, west to east: Cloudbreak and Frigates Passage (Fiji), Ha'atafu (Tonga), Salani (Samoa), Amouli (American Samoa),
  Rutaki Passage (Rarotonga), Papara and Teahupo'o (Tahiti).
- Guam and Micronesia are left for a later group of their own: Guam's and Saipan's buoys have sent nothing since June, while
  Palau's, Pohnpei's, Yap's and Arno's report.

## Spots

Coordinates from surf guides and OpenStreetMap, checked against Open-Meteo on 2026-10-18 (waves, the tide model and ECMWF's
wind answered for every spot, 240 of 240 hours). `off`, the offshore wind, is the best wind the surf guides give, which matches
each reef's facing.

| id | Spot | Zone | Faces | Best | Wind now | Buoy | Tides |
|---|---|---|---|---|---|---|---|
| cloudbreak | Cloudbreak, Tavarua | Pacific/Fiji (UTC+12) | SW | south to southwest swell, east-northeast wind | none | none | NOAA, Nandi Waters (29 km) |
| frigates | Frigates Passage, Beqa | Pacific/Fiji | SW | southwest swell, east wind | none | none | NOAA, Suva (61 km) |
| haatafu | Ha'atafu Beach, Tongatapu | Pacific/Tongatapu (UTC+13) | W | south to southwest swell, east wind | none | none | tide model |
| salani | Salani, Upolu | Pacific/Apia (UTC+13) | S | southwest swell, north wind | none | none | tide model |
| amouli | Amouli, Tutuila | Pacific/Pago_Pago (UTC-11) | SE | south swell, northwest wind | Pago Pago Airport, 12 km | Aunu'u (12 km), then King-Poloa (29 km) | NOAA, Pago Pago (9 km) |
| rutaki | Rutaki Passage, Rarotonga | Pacific/Rarotonga (UTC-10) | SW | southwest swell, northeast wind | none | none | tide model |
| papara | Papara, Tahiti | Pacific/Tahiti (UTC-10) | SW | south swell, north to northeast wind | none | none | NOAA, Papeete (29 km) |
| teahupoo | Teahupo'o, Tahiti Iti | Pacific/Tahiti | SW | big south to southwest swell, north-northeast wind | none | none | NOAA, Papeete (50 km) |

None of these zones changes its clock in 2026 or 2027; the build writes the offset in force anyway, as for Australia. Samoa
and American Samoa sit either side of the date line, 24 hours apart on the clock.

## Data sources (no key)

| What | Source | How |
|---|---|---|
| Swell forecast, model check | Open-Meteo marine, as for every country | the shared `openwave` and `openmodels` calls take in the 8 spots |
| Wind forecast | ECMWF's IFS via Open-Meteo, then Open-Meteo's default | one call for the 8 spots, as for New Zealand |
| Wind now | Pago Pago airport (NSTU) via NOAA's aviationweather.gov | hourly. Over a week its wind tracked ECMWF's at Amouli (speed r 0.64, direction within 5°). The other airports near a spot tracked their spot's forecast poorly (Nadi 0.10, Nausori 0.50 but at 7 against 18 kt, Fua'amotu 0.46, Faleolo 0.32, Rarotonga -0.23, and Tahiti-Faa'a turned by the sea breeze), so those spots show no wind now |
| Buoys | PacIOOS's Aunu'u (51209) and King-Poloa (51214) wave buoys via NOAA NDBC | both every 30 minutes, with no gap over 45 days; read as for California (`ca.ndbc_rows`), King-Poloa only when Aunu'u is silent. No other South Pacific island has an open buoy |
| Tides | NOAA's tide predictions where they matched real gauges, else Open-Meteo's tide model | NOAA's highs and lows, asked for in UTC and put on each spot's clock (NOAA files Apia and Nuku'alofa under UTC-11, Samoa's and Tonga's old side of the date line). Against a week of IOC tide gauges NOAA was within 20 minutes at Lautoka, Suva, Pago Pago and Papeete, but 65 minutes early at Nuku'alofa and 84 minutes late at Rarotonga, where the model was within 30; Apia's NOAA datum sits below its lowest tide. So Ha'atafu, Salani and Rutaki take the model, and their page says "Model tide" as Australia's does |
| Sun times | computed | |
| Cyclones | the Fiji Meteorological Service (RSMC Nadi), Météo-France in Tahiti and the National Weather Service in Pago Pago | a "Cyclone watch" panel with the links, as New Zealand's has: the typhoon feeds the page uses cover the North Pacific only |
| Map | a new Open-Meteo grid, 2° apart (24–10°S, 170°E–144°W), refetched every ~6 h like New Zealand's | points past 180° are asked for as west longitudes, as for New Zealand |

The log keeps the forecast, Amouli's buoys and Pago Pago's wind; the height correction starts at Amouli once the log holds
enough buoy readings.

## Map

The islands span 34° of longitude but only 7° of latitude: on a phone held upright all 8 fit only at a third of the zoom
the other countries open at, with Tahiti's two spots 2 pixels apart. So, like Australia's two coasts, the South Pacific has
two home views, picked by the current spot's longitude:

- West, Fiji to the Samoas: centre 182.85°E, 17.8°S.
- East, Rarotonga and Tahiti: centre 205.07°E, 19.5°S.

A home view can now give a width as well as a height (`wide`, degrees of longitude), and its zoom is whichever fits. Upright
the width decides (17.6° west, 15.2° east), sideways the height (11° west, 8° east). On a phone each holds its spots at least
19 px clear of the buttons both ways up. The first open, with nothing saved, is the current part's home view; each part
keeps its own saved view (`waveslave-mapview-pi-w`, `-pi-e`), as Australia's coasts do. A spot in the other part moves the
map to that part's home view; another spot in the same part leaves the map where it is, as in the other countries, so a
close look at Tahiti's two spots stays put (any move inside Australia still recentres on its coast).

The grid holds both home views sideways, and their middle band upright (beyond it the Pacific layer fills in). It runs
between New Zealand's and the West Pacific's in the finest-first order. The button's icon is Tahiti's outline from
Natural Earth's land.

## Architecture

1. **spots.json**: 8 spots with `country: "pi"`, `zone`, `ndbc` (Amouli's two buoys) with `buoyName`, `buoyKm` and
   `buoyBy: "pacioos"`, `windStation` (`metar:NSTU` or none), `tideStation` (a NOAA station, or null for the tide model),
   `off`, names in zh and ja.
2. **pi.py** (new, like nz.py): reads `ndbc-<id>.txt` (through `ca.ndbc_rows`), `metar-pi.json` (through `kr.metar_wind`),
   `openpi.json`, `tidepi-<station>.json` (NOAA, UTC) and `tidepi.json` (the tide model for the spots without a station), and
   writes the same keys as the other countries, plus `tideModel` on the model-tide spots.
3. **refresh.sh**: a South Pacific block after New Zealand's; `regrid pi 350 -24 2 8 170 2 24`; the page gets the grid as
   `__GRIDPI__`. History, log and correct run with `pi` on `log-pi/`.
4. **Workflow**: `log-pi` joins the log folders restored from the data branch; `.gitignore` gains `log-pi/`.
5. **template.html**: the country button, the outline for the map's country column, the two home views (a `PARTS` table that
   Australia's coasts move into too), the grid, the ECMWF legend, "Model tide" on the spots that use it, the buoy source line,
   the cyclone panel and the footer credits.

## Error handling

As for New Zealand: a source that is down only blanks its own part, and the build never fails on it. A buoy silent for over
6 hours shows "No reading from the … buoy right now", after trying King-Poloa. A failed tide fetch leaves that spot without
tides until the next run. A failed grid fetch keeps the last grid, and with none the map draws the Pacific layer there.

## Testing

- Fixtures with one saved copy of each new download (the two buoys, Pago Pago's reports, ECMWF wind, NOAA's four stations in
  UTC, the tide model for the three spots); `pi.py` must produce the expected fields: buoy rows at Amouli (and King-Poloa's
  when Aunu'u is silent), Pago Pago's wind, NOAA tides on each spot's own clock either side of the date line, the model's
  tides with `tideModel`, and each spot's offset. The other countries' tests pass unchanged, and filling the South Pacific
  leaves the others alone.
- After one build, `log-pi/` holds only the 8 new ids, and every other spot comes out of the same downloads as on `main`.
- The map checks with both home views and the grid, and phone screenshots of South Pacific spots in each language.
