# Vanuatu forecast for WaveSlave: design

Date: 2026-10-20. Plan: `docs/superpowers/plans/2026-10-20-vanuatu-forecast.md`.

## Goal

Add Vanuatu to waveslave.tw the way Papua New Guinea was added (PR #80): a country button, 6 spots, the same forecast page, two map
home views, a map grid and a separate forecast log (`log-vu/`).

Bryan picked "surf spots only" on 2026-10-19: Hong Kong, Hainan, Vietnam, Papua New Guinea, Vanuatu and Baja, one pull request each.
Hong Kong (PR #72), Hainan (PR #74), Vietnam (PR #78) and Papua New Guinea (PR #80) are live; Vanuatu is next. No source needs a key.
The sources and spots come from the research of 2026-10-19 (`surf-app/expansion/research/vanuatu.md` in the project files).

Defaults I picked (say if you want otherwise):

- Country code `vu`, log folder `log-vu/`. Switch label Vanuatu / 萬那杜 / バヌアツ, placed after New Zealand and before the South
  Pacific, its neighbour to the east.
- 6 spots, four on Efate and two on Tanna, west to east on each: Devil's Point, Pango Point, Breakas and Tapi Point, then Lenakel and
  Port Resolution. Pango Point and Breakas share every model cell, so their forecasts differ only in how the wind suits each (a
  northeasterly is offshore at Pango, a northerly at Breakas); both stay, because they are the two best-known breaks and sit 13 px
  apart at Efate's home view.
- No spot gets wind now, and every spot takes the tide model (below). Like Papua New Guinea, the page's Right now card carries only
  the forecast.

## Spots

Positions sit on open water just outside each reef or point, checked against OpenStreetMap at zoom 15. `off`, the offshore wind, is
the landward normal, checked against the guides' best wind. Every spot is `Pacific/Efate`, which keeps UTC+11 all year, three hours
ahead of Taipei.

| id | Spot | Region | Faces | off | Swell |
|---|---|---|---|---|---|
| devils | Devil's Point | Mele, Efate | W | 100 | south to southwest |
| pango | Pango Point | Port Vila, Efate | SW | 45 | southeast, mid to high tide |
| breakas | Breakas | Port Vila, Efate | S | 0 | southeast, mid to high tide |
| tapi | Tapi Point | Eratap, Efate | SW | 45 | southeast, mid to high tide |
| lenakel | Lenakel | West coast, Tanna | SW | 50 | south to southwest, mid to high tide |
| portres | Port Resolution | East coast, Tanna | E | 270 | east to southeast, all tides |

The season is April to September, when storms east of New Zealand send southeast swell; the cyclone season, about November to April,
adds north to east swell.

- **Devil's Point** is the one judgement call. The guides place the wave on the west side of the point with an easterly offshore, so
  `off` is 100, which makes the east-southeast trade wind offshore. The pin sits 0.9 km SSW of the tip: any pin nearer the point
  takes Météo-France's wave cell centred on the peninsula, half land, which ran 15 to 20% under the open-sea cell to the south.
- **Pango Point** is the left at the tip of Pango's eastern lobe, not the lighthouse on the western one. "Pounders" names it in one
  guide and Breakas in another, so neither name is used.

Left out: Erakor Island (1 km east of Breakas, every model cell shared with Pango and Breakas), the Eratap Island right (on the islet
west of Tapi Point, in Tapi's cells), Pounders on Pango's western lobe ("rarely breaks"), Teouma Bay and the other south-coast entries
in one guide only (each in a chosen spot's cells), and Efate's east coast and the other islands (minor, or no published position).

No public surf cam exists anywhere in Vanuatu.

## Data sources (no key)

| What | Source | How |
|---|---|---|
| Swell forecast, model check | Open-Meteo marine, as for every country | the shared `openwave` and `openmodels` calls take in the 6 spots. Météo-France's cells lie 1.2 to 5.4 km from the Efate spots and 2.9 km from Lenakel; it counts every cell within 9 km of Tanna's east coast as land, so Port Resolution's lies 11.9 km out, in open sea with the same exposure. GFS-Wave 0.16° has no data this far south, as at Cloudbreak and Teahupo'o, so the model check shows two models |
| Wind forecast | ECMWF's IFS via Open-Meteo, then Open-Meteo's default (ECMWF here too), from the sea cell nearest each spot (`cell_selection=sea`) | one call for the 6 spots, as for Micronesia and Papua New Guinea. The default cells put Pango, Breakas and Tapi on one cell in Port Vila's harbour and Devil's Point and Port Resolution 9 to 10 km inland, and read 3 to 8 kt lighter; the sea cells lie 4.0 to 4.6 km from the spots, on the water each faces. Pango and Breakas share one |
| Wind now | none | Port Vila's airport (Bauerfield) reports every hour but sits 2.6 km inland and nearly calm at night (2.7 kt against ECMWF's 9 to 17); against the sea cells it tracks the Efate spots with r 0.36 to 0.53. Tanna's airport reports only by day (57% of hours), r 0.34 and 0.45. Earlier countries kept 0.64 and up |
| Buoys | none | the Van-KIRAP wave buoys on the Pacific Community's portal have all been silent since 2023 to 2025, and NDBC lists only a tsunami buoy |
| Tides | Open-Meteo's tide model, as for Papua New Guinea | highs and lows picked from the hourly level; the page says "Model tide". NOAA has no Vanuatu station, and the official predictions (BoM's and the University of Hawaii's, through the Pacific Community's portal) need a token. Against the IOC gauges at Port Vila and Lenakel over 12 to 19 October, the model's highs and lows came a median 19 and 23 minutes early |
| Sun times | computed | |
| Cyclones | links only | the Typhoon watch panel becomes Cyclone watch, as for Papua New Guinea, and links the Vanuatu Meteorology and Geo-Hazards Department's cyclone page and the Fiji Meteorological Service (RSMC Nadi, the WMO's warning centre for the area). The department's terms rule out reusing its data; linking is fine |
| Map | a grid of its own, 2° apart (24–12°S, 164–174°E), refetched every ~6 h as for Papua New Guinea | no other grid reaches these spots: the South Pacific's starts at 170°E, Australia's stops at 20°S and 156°E |

The log keeps the forecast only. With no buoy and no wind station, the corrections leave the forecast as it is.

The past days' wind and the Map tab's wind after the four-day forecast come from the shared `openwx` call, which takes the default
cells, as for Micronesia, Hong Kong, Hainan, Vietnam and Papua New Guinea (already a follow-up in the to-do list).

Open-Meteo: about 2,000 more calls a day (the spots in the three shared calls, the wind and tide calls, and the grid), about 70,500
in all.

## Map

The 6 spots sit in two clusters 221 km apart: Efate's four within 18 km of each other along its south-west coast, Tanna's two on
opposite coasts, 26 km apart. Two home views, split at 169°E, as for Papua New Guinea: Efate, `w: {cx: 168.265, cy: -17.78, span:
0.45, wide: 0.4}`, and Tanna, `e: {cx: 169.39, cy: -19.53, span: 0.6, wide: 0.5}`. Upright the width decides, sideways the height.
One view of both would put Pango Point and Breakas, 1.4 km apart, 2 px apart; Efate's home view puts them 13 px apart upright. Efate's
is the closest home view of any country, a little closer than Hong Kong's (`span: 0.5, wide: 0.75`).

With Vanuatu's the map has 18 country buttons; upright on a 390×844 phone they take two columns, as with Papua New Guinea's.

**Grid.** `regrid vu 350 -24 2 7 164 2 6`, 42 points. A grid fades into the next coarser one over its outer two steps, so it runs at
least two steps past the spots, and all six take the map's colours from it in full. Its east edge reaches into the South Pacific's
grid, which keeps the first say there: Vanuatu's comes after it in the finest-first order (after Papua New Guinea's), so it only fills
in under the South Pacific's west edge, 170–174°E, where the 5° Pacific layer did before. It holds both home views, so their
pressure lines come from it.

**Coastline.** The coarse outlines draw Efate as a ring of 9 points and Tanna as one of 8, which puts Breakas 0.4 km on land and
Devil's Point 4.5 km off the drawn coast, about 40 px at Efate's home view. Two DETAIL boxes, as for Hong Kong, Hainan and Papua New
Guinea, take Natural Earth's 10 m land instead, each holding its island and its coarse ring whole:

- 168.0371–168.7129°E, 17.9483–17.3517°S: Efate, with Moso and Nguna off its north coast.
- 169.1371–169.6129°E, 19.7483–19.2517°S: Tanna.

Natural Earth then puts Pango Point and Breakas 0.7 km off the drawn coast (196 and 270 m off the real one), Tapi Point on it, Devil's
Point 1.2 km off it and Port Resolution 0.9 km off it. Lenakel's dot sits 1.2 km on land: the 10 m outline fills the bay in front of
Lenakel. That is 9 px at Tanna's home view.

The two islands take 2.8 kB, and the detailed coast's line had 0.6 kB left of its 40 kB budget, so the budget goes to 45 kB. The
budget only guards against a wrong tolerance blowing the line up; the page is about 10 MB, and the line grows to about 42 kB.

The map's country button is Efate's outline, as Micronesia's is Guam's and the South Pacific's Tahiti's: the whole chain, 900 km long,
would be specks at button size.

## Architecture

1. **spots.json**: 6 spots with `country: "vu"`, `zone`, empty `ndbc`, `buoyKm: null`, `buoyName: ""`, `windStation: []`,
   `stationName: ""`, `tideStation: null`, `off`, `cams: []`, and names in zh and ja, after Papua New Guinea's.
2. **pi.py** needs no new code: `pi.py <dl> <snap.json> <spots.json> vu` reads `openvu.json` and `tidevu.json` as it does Papua New
   Guinea's files. Its comments name Vanuatu.
3. **refresh.sh**: the island loop takes `vu`, with `cell_selection=sea` on its wind forecast as for Micronesia and Papua New Guinea;
   with no buoy, airport or NOAA station it asks only for the wind forecast and the tide model. `regrid vu`, the grid's file in the
   page as `__GRIDVU__`, and history, log and correct with `vu` on `log-vu/`.
4. **Workflow**: `log-vu` joins the log folders restored from the data branch; `.gitignore` takes `log-vu/`.
5. **template.html**: the country button, Efate's outline in `HOME_ICONS`, the two parts in `PARTS`, the grid in `RAW` and `GRIDS`,
   the two DETAIL boxes and their 10 m coast (`tools/detail_coast.py`, with its budget raised), the ECMWF legend, the Cyclone watch
   links, the footer credits and the comments listing the countries. "Model tide" comes from `tideModel`, as for Papua New Guinea.

## Error handling

As for Papua New Guinea: a source that is down only blanks its own part, and the build never fails on it. If the sea-cell request
fails, the default model is asked for, still from the sea cells; if both fail, the spots have no wind forecast for that run. A failed
grid fetch keeps the last grid.

## Testing

- `tests/test_vu.py`, from one saved copy of each new download (ECMWF's wind from the sea cells and the tide model): the 6 spots are
  complete and last in spots.json; `pi.fill(..., 'vu')` gives each spot +11, no buoy, no wind now, 3-hourly `wind`, the tide model's
  highs and lows on Vanuatu's dates with `tideModel`, and sun times; the replies follow the spot list; filling Vanuatu leaves every
  other country alone; `pi.py ... vu` runs isolated like refresh.sh. refresh.sh's loop asks for Vanuatu's wind from the sea cells,
  ECMWF's first, sends no buoy, airport or NOAA request for it, and fetches its grid.
- `tests/test_logsplit.py`: log, correct and history with `vu` touch only Vanuatu's spots.
- The map: Vanuatu's two home views in `tests/map/check.js` (first opens, parts and button), its pressure lines (`vanuatuIso`), the
  grid in the `isoPick` test, and the DETAIL test with the two new boxes.
- On the same downloads, every other country's output and log is identical to `main`'s.
- Phone screenshots of the Vanuatu spots in en, zh and ja, and of both map views both ways up.
