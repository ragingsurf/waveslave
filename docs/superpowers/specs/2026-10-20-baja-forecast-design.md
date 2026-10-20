# Baja forecast for WaveSlave: design

Date: 2026-10-20. Plan: `docs/superpowers/plans/2026-10-20-baja-forecast.md`.

## Goal

Add Baja California's Pacific coast to waveslave.tw the way Vanuatu was added (PR #85): a country button, 8 spots, the same
forecast page, two map home views, a map grid and a separate forecast log (`log-bj/`).

Bryan picked "surf spots only" on 2026-10-19: Hong Kong, Hainan, Vietnam, Papua New Guinea, Vanuatu and Baja, one pull request each.
The first five are live; Baja is the last. No source needs a key. The sources and spots come from the research of 2026-10-19
(`surf-app/expansion/research/baja.md` in the project files).

Defaults I picked (say if you want otherwise):

- Country code `bj`, log folder `log-bj/`. Switch label Baja / 下加州 / バハ・カリフォルニア, placed after California, its neighbour to
  the north.
- 8 spots from the border south: K-38, San Miguel, Killers (Todos Santos Island), Punta Baja, Punta Abreojos, Scorpion Bay, San Pedrito
  and Cerritos. The research's other candidate for the middle of the coast, Bahía Asunción, is left out: Abreojos is the better known,
  and their data are no better or worse.
- K-38 takes the CDIP buoy off Point Loma, 50 km away; San Miguel and Killers, 93 and 97 km from it across the border, take none.
- Punta Baja's `off` is 0, not the research's 330 (below).

## Spots

Positions sit on open water just outside each reef or point, checked against OpenStreetMap at zoom 15. `off`, the offshore wind, is
the landward normal, moved toward the guides' best wind and swell where that cost under 40°.

| id | Spot | Region | Faces | off | Swell | Zone |
|---|---|---|---|---|---|---|
| kthirtyeight | K-38 | Rosarito | SSW | 45 | west to south, all year | America/Tijuana |
| sanmiguel | San Miguel | Ensenada | SW | 70 | west-northwest, autumn to spring | America/Tijuana |
| killers | Killers | Todos Santos Island | NW | 100 | northwest to west, winter | America/Tijuana |
| puntabaja | Punta Baja | El Rosario | S | 0 | west to northwest, winter | America/Tijuana |
| abreojos | Punta Abreojos | Baja California Sur | SSE | 340 | south-southwest, summer | America/Mazatlan |
| scorpion | Scorpion Bay | San Juanico | SSE | 340 | south-southwest, summer | America/Mazatlan |
| sanpedrito | San Pedrito | Todos Santos | SW | 50 | west to northwest, October to March | America/Mazatlan |
| cerritos | Cerritos | Todos Santos | SW | 50 | west-southwest to northwest, all year | America/Mazatlan |

- **K-38**'s id spells out the number because ids are letters only.
- **San Miguel**'s pin sits on the take-off side of the point, where Open-Meteo answers from the wave cell at the bay's mouth; the
  cell inside the bay sits in the point's lee and read 16% lower.
- **Killers** breaks off the northwest tip of the north island, 18 km off Ensenada.
- **Punta Baja** is a right that wraps into the bay inside the point, where the shore faces south and the prevailing northwest wind
  blows offshore. The page takes one direction for both the wind and the swell, so a point like this can't have both right: with
  `off` 330, the shore's own normal, a winter west swell would rate at a fifth of its height. `off` 0 keeps the northwest wind
  offshore and rates a west swell at half, as Rincon (`off` 20) already does in California.
- **San Pedrito and Cerritos** sit 5.3 km apart and share every wave model's cell, so their forecasts differ only in how the wind
  suits each. Both stay: they are the Cape's two best-known Pacific breaks, and 13 px apart at their home view.

Left out: Bahía Asunción (above); the Los Cabos breaks (Costa Azul, Monuments, Shipwrecks and others), which lie east of 110°W, the
map's edge; Migriño, 0.11° inside the edge; the breaks within 7 km of K-38 (Calafia, Alfonsos, K-40) and K-55/K-58, which would crowd
it on the map; and the remote points between El Rosario and the Vizcaíno (Santa Rosalillita, the Seven Sisters, Isla Natividad), with
nothing to measure them and access controlled or by boat only.

The only cams found are Surfline's at K-38 and Cerritos, which are behind its login for most viewers. They are listed as for California.

## Data sources (no key)

| What | Source | How |
|---|---|---|
| Swell forecast, model check | Open-Meteo marine, as for every country | the shared `openwave` and `openmodels` calls take in the 8 spots; all three models in the check answer at every spot. K-38's Météo-France cell has its centre 4 km inland, but the model keeps it wet and its heights run within 6% of the next cell south's |
| Wind forecast | ECMWF's IFS via Open-Meteo, then Open-Meteo's default, from the sea cell nearest each spot (`cell_selection=sea`) | one call for the 8 spots, as for Vanuatu. The default cells put San Miguel and Punta Baja 10 to 11 km inland and San Pedrito and Cerritos on one inland cell, reading 2 to 3 kt lighter; the sea cells lie 1.6 to 6.5 km from the spots |
| Wind now | none | Ensenada's airport has sent no report in 15 days. The airports that report are 32 km or more away, inland or on the Gulf side, and the best tracks the forecast at K-38 with r 0.59 |
| Buoy | CDIP 46232 Point Loma South via NOAA NDBC, for K-38 only | read as California's CDIP buoys are (`ca.ndbc_rows`), every 30 minutes, 50 km from K-38 on the open sea west of the Coronado Islands, which shade K-38 a little from a northwest swell. It is under the 100 km at which correct.py stops learning, so K-38's heights are tuned to it as California's are to theirs. No buoy reports from Mexican waters |
| Tides | NOAA's predictions for K-38 (Imperial Beach, 9410120, 38 km), San Miguel and Killers (Ensenada, TWC0403, 12 and 17 km); Open-Meteo's tide model for the other five | NOAA's highs and lows, asked for in UTC and put on each spot's clock per event, as for Guam. The model's ("Model tide") came 27 to 35 minutes early against every open-coast reference from San Diego to Cabo San Lucas, with ranges within about 0.1 m. CICESE's own tables are "all rights reserved", so they were only used to check the others |
| Sun times | computed | |
| Hurricanes | links only | the panel becomes Hurricane watch, as for Hawaii, and links NOAA's National Hurricane Center (eastern Pacific) and Mexico's National Meteorological Service (its Pacific tropical cyclone page, in Spanish) |
| Map | a grid of its own, 1° apart (21–35°N, 119–108°W), refetched every ~6 h | 1° as California's next door, so the swell colours match along the coast. California's grid covers K-38, San Miguel and Killers, but its edge band reaches them; south of 30°N only the 5° Pacific layer did |

The log keeps the forecast and K-38's buoy. With the buoy, correct.py tunes K-38's wave heights once it has days of readings; the other
seven keep the forecast as it is.

The past days' wind and the Map tab's wind after the four-day forecast come from the shared `openwx` call, which takes the default
cells, as for Vanuatu (already a follow-up in the to-do list).

Open-Meteo: about 3,500 more calls a day (about 2,100 for the 8 spots, 1,400 for the grid), about 74,000 in all.

## Clocks

The four northern spots keep Tijuana's time, which follows US daylight saving: UTC−7 now, UTC−8 from 1 November to 14 March. The four
in Baja California Sur keep UTC−7 all year (`America/Mazatlan`; `America/La_Paz` is Bolivia). Each spot takes its offset when the page
is built, as California's do, so before 1 November the north's forecast hours, sun times and Punta Baja's model tide for the days
after the change read an hour late, until the first build after it. NOAA's tides are put on the clock per event, so they are right
either side.

## Map

The 8 spots run 1,200 km down the coast, from K-38 by the border to Cerritos 0.18° inside the map's east edge at 110°W. One view of all
of them would put San Pedrito and Cerritos 2 px apart, and Cerritos needs at least 124 px per degree to keep its dot clear of the
edge. Two home views, split at 111.5°W (248.5°E): the six from K-38 to Scorpion Bay, `w: {cx: 245.27, cy: 29.3, span: 7.6, wide:
5.6}`, and the Cape's two, `e: {cx: 249.81, cy: 23.35, span: 1.0, wide: 1.6}`. Upright the width decides, sideways the height. The
Cape's is the closest home view of any country; the map clamps it to the edge.

With Baja's the map has 19 country buttons; upright on a 390×844 phone they take two columns, as with Vanuatu's.

**Grid.** `regrid bj 350 21 1 15 -119 1 12`, 180 points. A grid fades into the next coarser one over its outer two steps, so it runs
two steps past the spots on every side, east of the map's edge too, and all eight take the map's colours from it in full. It comes
after California's in the finest-first order, so California's keeps the first say where they overlap (30–35°N, 119–116°W): there
California's edge band, which faded into the 5° Pacific layer, now fades into Baja's. It holds both first views on a 390×844 phone
held upright, the Pacific coast's reaching 35.46°N, inside the half degree to spare, and the Cape's held sideways, so their pressure
lines come from it. The Pacific coast's view reaches 36°N on a 360×800 phone and runs west past the grid held sideways, so the 5°
Pacific layer draws there.

**Coastline.** South of 30°N the coarse outline is one 98-point ring with 27 km segments, which puts Cerritos 0.1 km from the drawn
coast, on the line at the Cape's home view. One DETAIL box, as for Hong Kong, Hainan, Papua New Guinea and Vanuatu, takes Natural
Earth's 10 m land instead from the Cape to La Paz: 111.0629–109.9371°W, 22.7517–24.2483°N. Its east edge lies past the map's, so the
coarse outline goes whole there. `tools/detail_coast.py` learns to cut boxes east of 180°, where Natural Earth's longitudes are
negative. The box takes 1.9 kB, inside the 45 kB budget.

Isla Todos Santos, where Killers breaks, isn't in Natural Earth's land at either scale, so Killers' dot sits on the water 13 km off
the drawn coast. North of 30°N the coarse outline's segments are 13 km, 9 px at the northern home view.

The map's country button is the peninsula's outline.

## Architecture

1. **spots.json**: 8 spots with `country: "bj"`, `zone`, `ndbc` (`["46232"]` for K-38, else empty), `buoyKm`, `buoyName`, `buoyBy:
   "cdip"` for K-38, `windStation: []`, `stationName: ""`, `tideStation` (`"9410120"`, `"TWC0403"` or `null`), `off`, `cams`, and names
   in zh and ja, after Vanuatu's.
2. **pi.py** needs no new code: `pi.py <dl> <snap.json> <spots.json> bj` reads `ndbc-46232.txt`, `openbj.json`, `tidebj-<station>.json`
   and `tidebj.json` as it does Micronesia's files. Its comments name Baja and its clock change.
3. **refresh.sh**: the island loop takes `bj`, with `cell_selection=sea`; with K-38's buoy and two NOAA stations it asks NDBC for
   46232 and NOAA for 9410120 and TWC0403, and the tide model for the other five; no airport. `regrid bj`, the grid's file in the page
   as `__GRIDBJ__`, and history, log and correct with `bj` on `log-bj/`.
4. **Workflow**: `log-bj` joins the log folders restored from the data branch; `.gitignore` takes `log-bj/`.
5. **template.html**: the country button, the peninsula's outline in `HOME_ICONS`, the two parts in `PARTS`, the grid in `RAW` and
   `GRIDS`, the DETAIL box and its 10 m coast, the ECMWF legend, the Hurricane watch links, K-38's buoy line (as the Pacific Northwest's
   CDIP buoys), the footer credits and the comments listing the countries. "Model tide" comes from `tideModel`, as for Vanuatu.

## Error handling

As for Vanuatu: a source that is down only blanks its own part, and the build never fails on it. A silent buoy leaves K-38 with the
forecast and says so; if the ECMWF request fails, the default model is asked for, still from the sea cells. A failed grid fetch keeps
the last grid.

## Testing

- `tests/test_bj.py`, from one saved copy of each new download (46232's readings, ECMWF's wind from the sea cells, the tide model and
  NOAA's two stations): the 8 spots are complete and last in spots.json; `pi.fill(..., 'bj')` gives each spot its zone's offset (−7
  in October; −8 in the north and −7 in the south after 1 November), K-38's buoy rows with `buoyBy` "cdip", no wind now, 3-hourly
  `wind`, NOAA's highs and lows on the local dates for the three, the tide model's with `tideModel` for the five, and sun times; the
  replies follow the spot list; filling Baja leaves every other country alone; `pi.py ... bj` runs isolated like refresh.sh.
  refresh.sh's loop asks for Baja's wind from the sea cells, ECMWF's first, fetches 46232 and the two NOAA stations, asks no airport,
  and fetches its grid.
- `tests/test_logsplit.py`: log, correct and history with `bj` touch only Baja's spots.
- The map: Baja's two home views in `tests/map/check.js` (first opens, parts and button), its pressure lines, the grid in the
  `isoPick` test, the DETAIL test with the new box, and Hurricane watch's links.
- On the same downloads, every other country's output and log is identical to `main`'s.
- Phone screenshots of the Baja spots in en, zh and ja, and of both map views both ways up.
