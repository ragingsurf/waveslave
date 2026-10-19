# Papua New Guinea forecast for WaveSlave: design

Date: 2026-10-19. Plan: `docs/superpowers/plans/2026-10-19-papua-new-guinea-forecast.md`.

## Goal

Add Papua New Guinea to waveslave.tw the way Micronesia was added (PR #69): a country button, 7 spots, the same forecast page, two
map home views, a map grid and a separate forecast log (`log-pg/`).

Bryan picked "surf spots only" on 2026-10-19: Hong Kong, Hainan, Vietnam, Papua New Guinea, Vanuatu and Baja, one pull request each.
Hong Kong (PR #72), Hainan (PR #74) and Vietnam (PR #78) are live; Papua New Guinea is next. No source needs a key.

Defaults I picked (say if you want otherwise):

- Country code `pg`, log folder `log-pg/`. Switch label Papua New Guinea / 巴布亞紐幾內亞 / パプアニューギニア, placed after
  Indonesia, its neighbour on New Guinea.
- 7 spots, west to east: Lido (Vanimo), Wewak Point, Tupira (Ulingan Bay), the Kavieng reefs Nusa, Nago and Ral, and Rubio on New
  Ireland's east coast. Pikinini is left out: it is 0.8 km from Nusa, shares every model cell with it and would sit on Nusa's dot at
  any home zoom.
- No spot gets wind now, and every spot takes the tide model (below). It is the thinnest country so far: the page's Right now card
  carries only the forecast.
- Every break here is under a surf management plan of the Surfing Association of PNG (SAPNG): visiting surfers come through an
  affiliated camp, club or charter, numbers are capped at about 20 per area, and a daily levy goes to the reef's custodians. The
  page has no place for a country note (the spots' blurbs are not shown), so this goes in the to-do list rather than on the page.

## Spots

Positions sit on open water just outside each reef or point, checked against OpenStreetMap at zoom 15; surfnerd's points match the
reef edges and are used wherever it has one (surf-forecast's pins here are kilometres off). `off`, the offshore wind, is the
landward normal, checked against the guides' best wind. Every spot is `Pacific/Port_Moresby`, which keeps UTC+10 all year, two
hours ahead of Taipei.

| id | Spot | Region | Faces | off | Season |
|---|---|---|---|---|---|
| lido | Lido (Lido Right and the Lefts) | Vanimo, Sandaun | NNW | 155 | November to April, best January to March; north swell |
| wewak | Wewak Point | Wewak, East Sepik | ESE | 280 | November to April; northwest to northeast swell |
| tupira | Tupira Right, Ulingan Bay | North coast, Madang | N | 180 | November to April, best December; northeast swell |
| nusa | Nusa Lefts | Kavieng, New Ireland | NNE | 200 | November to April, best December; west to north swell |
| nago | Nago Island | Kavieng, New Ireland | N | 185 | October to April; northwest swell, low to mid tide |
| ral | Ral Island | Kavieng, New Ireland | NE | 200 | November to April; north swell |
| rubio | Rubio | East coast, New Ireland | NE | 225 | October to May, best December; small to medium east-northeast swell |

Left out: Pikinini (above); Vanimo's other reefs, the reefs around Wewak (Moem Point among them), Ulingan Bay's other reefs and
Kavieng's other breaks (each has a surf-forecast page only, no checked position, or shares a cell with a spot above); New
Ireland's charter breaks and Bougainville (no published positions; Bougainville also keeps UTC+11); Port Moresby's Sero (the
south coast's opposite season, thinly documented).

No public surf cam was found at any of them.

## Data sources (no key)

| What | Source | How |
|---|---|---|
| Swell forecast, model check | Open-Meteo marine, as for every country | the shared `openwave` and `openmodels` calls take in the 7 spots. MFWAM counts a wide coastal strip along the mainland and New Ireland's east coast as land, so the cells of Lido, Wewak, Tupira and Rubio lie 10 to 22 km out (Tupira's in the open Bismarck Sea); Kavieng's lie 1.8 to 4.1 km out. No two spots share a wave cell |
| Wind forecast | ECMWF's IFS via Open-Meteo, then Open-Meteo's default (ECMWF here too), from the sea cell nearest each spot (`cell_selection=sea`) | one call for the 7 spots, as for Micronesia. The default cells lie 3 to 16 km away, several inland (Kavieng's three share one in central New Ireland), and read lighter: over 12 to 19 October the sea cells blew 6 to 52% harder. The sea cells lie 1.1 to 4.9 km from the spots; Nusa and Nago share one |
| Wind now | none | no airport near a spot reports to NOAA's Aviation Weather Center: Vanimo and Wewak have sent nothing there for 9 and 7 months, Tupira has no airport within 30 km, and Kavieng reports only on weekdays in office hours, on the PNG National Weather Service's own site, at twice ECMWF's speed (r 0.21) |
| Buoys | none | NDBC lists no station within 13°S–2°N, 138–162°E, and the Pacific Community's ocean portal shows none in PNG |
| Tides | Open-Meteo's tide model, as for Pohnpei and Kosrae | highs and lows picked from the hourly level; the page says "Model tide". NOAA has no prediction station near PNG, and the official tables (the Australian Hydrographic Office's for PNG, and BoM's calendars for Lombrum and Port Moresby) are Australian copyright, not open for reuse. Against the one open gauge, Lombrum on Manus, 350 to 680 km from the spots, the model's highs and lows came a median 17 minutes early over 11 to 19 October (37 minutes off on average) |
| Sun times | computed | |
| Cyclones | links only | the Typhoon watch panel becomes Cyclone watch, as for Indonesia, and links the PNG National Weather Service (TCWC Port Moresby, the WMO's warning centre for the Solomon Sea and the Gulf of Papua) and the Bureau of Meteorology, whose cyclone centre issued the advisories as ex-TC Maila neared PNG this April. Cyclones seldom reach 2.5–4.5°S |
| Map | a grid of its own, 2° apart (10°S–2°N, 136–156°E), refetched every ~6 h as for Micronesia | no other grid reaches these spots: the West Pacific grid stops at the equator, Indonesia's at 132°E |

The log keeps the forecast only. With no buoy and no wind station, the corrections leave the forecast as it is.

The past days' wind and the Map tab's wind after the four-day forecast come from the shared `openwx` call, which takes the default
cells, as for Micronesia, Hong Kong, Hainan and Vietnam (already a follow-up in the to-do list).

Open-Meteo: about 2,500 more calls a day (the spots in the three shared calls, the wind and tide calls, and the grid), about 68,500
in all.

## Map

The 7 spots span 2.57–4.49°S and 141.27–152.20°E, 1,220 km. Two home views, split at 148°E, as for Micronesia: the north coast, `w:
{cx: 143.35, cy: -3.57, span: 3.2, wide: 5.6}`, and New Ireland, `e: {cx: 151.46, cy: -3.01, span: 1.6, wide: 2}`. Upright the
width decides, sideways the height. Nusa and Nago, the closest pair, are 3.7 km apart, 6 px at New Ireland's first open upright.

With Papua New Guinea's the map has 17 country buttons, one more than fits in a column on a 390×844 phone held upright, so the 17th
starts a second column at the top; the fit for the names moves each country's first open clear of it, as it does for the others.

**Grid.** `regrid pg 350 -10 2 7 136 2 11`, 77 points, reaching 2° past the equator into the edge of the West Pacific grid. A grid
fades into the next coarser one over its outer two steps, so it runs at least two steps past the spots: all seven take the map's
colours from it in full (Rubio 0.95), where a grid ending at the equator and 8°S would give Lido and the Kavieng reefs about half
and Rubio 0.4, the rest coming from the 5° Pacific layer. It holds all four home views, either way up (the north coast's upright
one reaches 0.06° past its south edge, inside the half degree to spare), so their pressure lines come from it. It runs after
Micronesia's in the finest-first order.

**Coastline.** The coarse outlines draw PNG's half of New Guinea north of 5°S as one open outline of 12 points, from the border at
5°S round to 5°S again by Madang, and New Ireland as a ring of 18,
which puts Wewak 3.6 km, Tupira 1.3 km and Rubio 4.1 km on land (Rubio 7 to 9 px at New Ireland's home view), and they leave out the
islands off the north coast. Three DETAIL boxes, as for Hong Kong and Hainan, take Natural Earth's 10 m land instead:

- 141.09–145.84°E, 5.05–2.42°S: the north coast from the border to Madang, with Kairiru, the Schouten Islands and Manam. Its west
  edge keeps just over 0.1° off the border, so the border stays a coarse outline's.
- 149.91–153.42°E, 4.05–2.10°S and 152.56–153.42°E, 4.91–4.00°S: New Ireland with New Hanover, Djaul, Tabar, Lihir and Tanga. The
  two overlap by 5 km so that New Ireland's coarse ring goes whole; together they keep clear of New Britain, which stays as it is.

Each edge also keeps more than 0.1° from any long straight stretch of a coarse outline along its line, as the map's cut-line test
asks: the larger New Ireland box's north edge sits out in open sea at 2.10°S, because 2.32°S passes within 0.1° of a 0.9° stretch of
the Bird's Head's coast in Indonesia.

The detailed coast's line in the page grows from 26 kB to 39.4 kB, inside its 40 kB budget, and Hong Kong's and Hainan's rings come
out unchanged. Wewak then sits 40 m off the drawn coast, Tupira 0.9 km and Rubio 0.3 km on land, and Lido, 1.1 km offshore before,
1.5 km on land: Natural Earth rounds off the Vanimo peninsula. That is under 2 px at the north coast's home view. Natural Earth has
none of Kavieng's small islands, so Nusa, Nago and Ral sit 3 to 9 km off New Ireland's drawn coast. Karkar, beside Tupira just east
of the north coast's box, keeps its coarse outline: taking it and Bagabag in would put the line 117 bytes over its budget.

The north coast's box is the first to cut an open outline. The page's clip used to drop every outline's last point, taking each to
be closed, which here drew a 12 km line at the foot of the border; it now keeps an open outline's points and closes it from its last
point to its first, along the 5°S cut line, as tools/pacific_coast.py and tools/detail_coast.py do.

The map's country button is PNG's outline.

## Architecture

1. **spots.json**: 7 spots with `country: "pg"`, `zone`, empty `ndbc`, `buoyKm: null`, `buoyName: ""`, `windStation: []`,
   `stationName: ""`, `tideStation: null`, `off`, `cams: []`, and names in zh and ja, after Vietnam's.
2. **pi.py** needs no new code: `pi.py <dl> <snap.json> <spots.json> pg` reads `openpg.json` and `tidepg.json` as it does Micronesia's
   files. Its comments name Papua New Guinea.
3. **refresh.sh**: the South Pacific–Micronesia loop takes `pg`, with `cell_selection=sea` on its wind forecast as on Micronesia's;
   with no buoy, airport or NOAA station it asks only for the wind forecast and the tide model. `regrid pg`, the grid's file in the
   page as `__GRIDPG__`, and history, log and correct with `pg` on `log-pg/`.
4. **Workflow**: `log-pg` joins the log folders restored from the data branch; `.gitignore` takes `log-pg/`.
5. **template.html**: the country button, PNG's outline in `HOME_ICONS`, the two parts in `PARTS`, the grid in `RAW` and `GRIDS`,
   the three DETAIL boxes and their 10 m coast (`tools/detail_coast.py`), the ECMWF legend, the Cyclone watch links, the footer
   credits and the comments listing the countries. "Model tide" comes from `tideModel`, as for Pohnpei.

## Error handling

As for Micronesia: a source that is down only blanks its own part, and the build never fails on it. If the sea-cell request fails,
the default model is asked for, still from the sea cells; if both fail, the spots have no wind forecast for that run. A failed grid
fetch keeps the last grid.

## Testing

- `tests/test_pg.py`, from one saved copy of each new download (ECMWF's wind from the sea cells and the tide model): the 7 spots are
  complete and last in spots.json; `pi.fill(..., 'pg')` gives each spot +10, no buoy, no wind now, 3-hourly `wind`, the tide model's
  highs and lows on PNG's dates with `tideModel`, and sun times; the replies follow the spot list; filling PNG leaves every other
  country alone; `pi.py ... pg` runs isolated like refresh.sh. refresh.sh's loop asks for PNG's wind from the sea cells, ECMWF's
  first, sends no buoy, airport or NOAA request for it, and fetches its grid.
- `tests/test_logsplit.py`: log, correct and history with `pg` touch only PNG's spots.
- The map: PNG's two home views in `tests/map/check.js` (first opens, parts and button), its pressure lines (`papuaNewGuineaIso`), the
  grid in the `isoPick` test, and the DETAIL test with overlapping boxes.
- On the same downloads, every other country's output and log is identical to `main`'s.
- Phone screenshots of the PNG spots in en, zh and ja, and of both map views both ways up.
