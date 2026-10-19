# Hainan forecast for WaveSlave: design

Date: 2026-10-19. Plan: `docs/superpowers/plans/2026-10-19-hainan-forecast.md`.

## Goal

Add Hainan to waveslave.tw the way the Philippines was added (PR #57): a country button, 7 spots, the same forecast page, map home
view and a separate forecast log (`log-hn/`).

Bryan picked "surf spots only" on 2026-10-19: Hong Kong, Hainan, Vietnam, Papua New Guinea, Vanuatu and Baja, one pull request each.
Hong Kong is live (PR #72); Hainan is next. No source needs a key.

Defaults I picked (say if you want otherwise):

- Country code `hn`, log folder `log-hn/`. Switch label Hainan / 海南 / 海南島, placed after Hong Kong.
- 7 spots, south-west to north-east along the Sanya–Lingshui–Wanning coast: Dadonghai, Houhai, Qingshui Bay, Xiangshui Bay, Riyue Bay,
  Shimei Bay and the Shenzhou Peninsula. Qingshui Bay has the weakest surf record of the 7 (a learners' beach with surf schools); it
  stays in as Lingshui's beginners' spot.
- No wind now (see below), though Sanya's airport could give Dadonghai a borderline reading.

## Spots

Positions sit on open water just off each break (OpenStreetMap tiles) and were placed so that each spot gets its own open-sea wave
cell. `off`, the offshore wind, is the beach's or point's landward normal from the OpenStreetMap shoreline, nudged towards the surf
guides' best wind. No public surf cam was found. Every spot is `Asia/Shanghai`, which keeps UTC+8 all year, Taipei's clock.

| id | Spot | Region | Faces | off | Season |
|---|---|---|---|---|---|
| dadonghai | Dadonghai, Sanya's town beach | Sanya | S | 350 | typhoon swells from the south-east to south, May to October |
| houhai | Houhai, Haitang Bay | Sanya | E | 290 | north-east swells, October to May |
| qingshui | Qingshui Bay | Lingshui | SSE | 335 | east swells, October to March, and typhoons |
| xiangshui | Xiangshui Bay | Lingshui | ESE | 290 | north-east swells, October to March |
| riyue | Riyue Bay, the national surf training base | Wanning | S–SSW | 0 | north-east swells, October to March |
| shimei | Shimei Bay | Wanning | S–SSE | 345 | north-east swells, October to March |
| shenzhou | Shenzhou Peninsula | Wanning | S | 340 | north-east swells, October to March |

Left out: Yalong Bay, Niuling, the Abalone Farm, Riyue's back beach and Camel Left, Xintan Bay, Dahuajiao and the Wenchang beaches are
typhoon-only, share a spot's wave cell, or are known from one guide only.

## Data sources (no key)

| What | Source | How |
|---|---|---|
| Swell forecast, model check | Open-Meteo marine, as for every country | the shared `openwave` and `openmodels` calls take in the 7 spots. Each has its own open-sea MFWAM cell, 1.5 to 11.3 km away (Xiangshui's is the farthest: MFWAM counts the nearer water off Lingshui as land) |
| Wind forecast | ECMWF's IFS via Open-Meteo, then Open-Meteo's default (ECMWF here too), from the sea cell nearest each spot (`cell_selection=sea`) | one call for the 7 spots, as for Micronesia and Hong Kong. Six spots' default cells are centred 0.7 to 4.7 km inland and read 6 to 66% lighter; the sea cells lie on the coast or at sea, 2.4 to 8.2 km away. Shimei and Shenzhou share their sea cell, so their wind forecasts are the same |
| Wind now | none | Sanya Phoenix (ZJSY) is the only airport near the surf that reports, every hour. It is 14.5 km from Dadonghai and 33 to 106 km from the rest, and over 14 days its wind tracked ECMWF's with r 0.49 to 0.62, even at its own position (earlier countries kept airports at about 0.75 or better). Bo'ao sends no METAR. China's station data (CMA) can't be used without permission |
| Buoys | none | no open wave buoy near Hainan: NDBC lists none within 10–25°N, 104–118°E, and OSMC's platforms near the island are ships. The spots have none, as in the Philippines |
| Tides | Open-Meteo's tide model, as for the Philippines | highs and lows picked from the hourly level; the page says "Model tide". China's official predictions (NMDIS) need a login. The model gives a mainly diurnal tide, about 0.7 m on average |
| Sun times | computed | |
| Typhoons | JTWC, as today | the Typhoon watch panel links the China Meteorological Administration's typhoon site (typhoon.nmc.cn, in Chinese) for the 中文 view, and its English typhoon messages (eng.nmc.cn) for the English and Japanese views. The panel only links them: CMA's data can't be reused without permission |
| Map | the West Pacific grid already covers Hainan, as it does the Philippines | no new grid, no new Open-Meteo calls (below) |

The log keeps the forecast only. With no buoy and no station wind, the corrections leave the forecast as it is; they start on their
own if a source is added later.

The wave models disagree here: at Houhai, Xiangshui, Riyue and Shimei, MFWAM (the page's model) ran at about half of ECMWF's wave model
and GFS-Wave over 19–23 October, and for the east swell due on 22–23 October its Riyue maximum was 0.6 m against 1.2 m (ECMWF), 1.8 m
(GFS) and 3.6 m (DWD). The forecast page's model check already shows the spread, and with no buoy nothing can correct it.

## Map

The 7 spots span 18.22–18.66°N and 109.52–110.34°E (87 km by 49 km). The home view is `hn: {cx: 109.93, cy: 18.44, span: 0.95,
wide: 1.3}`: upright the width decides, sideways the height. These are the views the map's name fitting starts from.

No grid of its own: the spots' own wind and waves cover the home view (the map blends them in over the grid within about 1° of the
spots), and the West Pacific grid fills in beyond. The home view's pressure lines come from the West Pacific grid.

**Coastline.** The coarse outlines draw Hainan as one ring of 22 points, which puts Riyue Bay and Shimei Bay on land. A second DETAIL box (108.44–111.26°E, 17.95–20.25°N), as for Hong Kong, holds Natural Earth's 10 m land for the whole island and the
tip of the Leizhou Peninsula across the strait; every coarser outline keeps only its pieces outside the box. Hong Kong's rings come out
unchanged. The 10 m land still closes Dadonghai's small bay, so that spot's dot sits 0.7 km inside the coast: 2 px at the home view,
about 20 px at the closest zoom. The map's country button is Hainan's outline.

## Architecture

1. **spots.json**: 7 spots with `country: "hn"`, `zone`, `buoyKm: null`, `buoyName: ""`, `windStation: []`, `stationName: ""`,
   `off`, and names in zh and ja, after Hong Kong's.
2. **kr.py** needs no new code: `kr.py <dl> <snap.json> <spots.json> hn` reads `openhn.json` and `tidehn.json`, as for the
   Philippines. Its comments name Hainan.
3. **refresh.sh**: the Korea–Philippines–Indonesia loop takes `hn`, with `cell_selection=sea` on Hainan's wind forecast only.
   No Hainan spot names an airport, so no METAR request goes out. History, log and correct run with `hn` on `log-hn/`.
4. **Workflow**: `log-hn` joins the log folders restored from the data branch; `.gitignore` takes `log-hn/`.
5. **template.html**: the country button, Hainan's outline in `HOME_ICONS`, the home view in `HOMES`, the second DETAIL box and its
   10 m coast (`tools/detail_coast.py`), "Model tide", the ECMWF legend, the Typhoon watch panel's CMA links, the footer credits and
   the comments listing the countries.

## Error handling

As for the Philippines: a source that is down only blanks its own part, and the build never fails on it. If the sea-cell request
fails, the default model is asked for, still from the sea cells; if both fail, the spots have no wind forecast for that run.

## Testing

- `tests/test_hn.py`, from one saved copy of each new download (ECMWF's wind from the sea cells, the tide model): the 7 spots are
  complete and last in spots.json; `kr.fill(..., 'hn')` gives each spot +8, no buoy and no wind now, 3-hourly `wind`, the tide
  model's highs and lows for the right days, and sun times; the Open-Meteo replies follow the spot list; filling Hainan leaves every
  other country alone; `kr.py ... hn` runs isolated like refresh.sh. refresh.sh's loop asks for Hainan's wind from the sea cells,
  ECMWF's first, and sends no METAR request for it.
- `tests/test_logsplit.py`: log, correct and history with `hn` touch only Hainan's spots.
- The map: Hainan's home view in `tests/map/check.js` (its first open and button, and its pressure lines from the West Pacific grid),
  and its view in the `isoPick` test.
- On the same downloads, every other country's output and log is identical to `main`'s.
- Phone screenshots of the Hainan spots in en, zh and ja.
