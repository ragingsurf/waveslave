# The Philippines forecast for WaveSlave: design

Date: 2026-10-18. Plan: `docs/superpowers/plans/2026-10-18-philippines-forecast.md`.

## Goal

Add the Philippines to waveslave.tw the way Korea was added (PR #55): a country button, 8 spots, the same forecast page,
map home view and a separate forecast log (`log-ph/`).

Bryan asked for the remaining countries one at a time, with Korea's keys last (thread, 2026-10-18). The Philippines goes
first: it is the closest to Taiwan, and the island plan it replaces fell through (Guam's and Saipan's buoys have been off
since June). No source needs a key.

Defaults I picked (say if you want otherwise):

- Country code `ph`, log folder `log-ph/`. Switch label Philippines / 菲律賓 / フィリピン, placed after Korea so the Asian
  countries sit together.
- 8 spots: Siargao, La Union, Zambales, Baler, Daet, Catanduanes, Eastern Samar and Pagudpud.

## Spots

Coordinates from OpenStreetMap, checked against Open-Meteo on 2026-10-18 (waves, the tide model and ECMWF's wind all
answered for every spot). Each beach's facing comes from the coastline (OpenStreetMap and Natural Earth); `off`, the
offshore wind, is the opposite way.

| id | Spot | Faces | Best |
|---|---|---|---|
| cloud9 | Cloud 9, General Luna, Siargao | E | typhoon swells, September to November |
| sanjuan | Urbiztondo Beach, San Juan, La Union | W | October to March, when the northeast monsoon blows offshore |
| liwliwa | Liwliwa, San Felipe, Zambales | W | southwest monsoon and typhoon swells, June to October |
| baler | Sabang Beach, Baler, Aurora | ENE | October to February |
| bagasbas | Bagasbas Beach, Daet, Camarines Norte | ENE | northeast monsoon swells, October to March |
| puraran | Puraran Beach, Baras, Catanduanes | E | typhoon swells, August to October |
| borongan | Baybay Beach, Borongan, Eastern Samar | E | open to Pacific swells most of the year |
| pagudpud | Blue Lagoon, Pagudpud, Ilocos Norte | ENE | October to March |

## Data sources (no key)

| What | Source | How |
|---|---|---|
| Swell forecast, model check | Open-Meteo marine, as for every country | the shared `openwave` and `openmodels` calls take in the 8 spots |
| Wind forecast | ECMWF's IFS (9 km) via Open-Meteo, then Open-Meteo's default | one call for the 8 spots. JMA's MSM, used for Japan and Korea, stops north of the Philippines; the default picks ECMWF here anyway |
| Wind now | none | the Philippine airports in NOAA's feed (aviationweather.gov) are all far from the surf: Laoag is 55 km from Pagudpud, and Subic Bay sits at the head of its bay. Baler, Daet and Virac airports are listed but sent no report in a week. PAGASA's PANaHON map shows station wind but has no open API |
| Tides | Open-Meteo's tide model, as for Australia and Korea | highs and lows picked from the hourly level; the page says "Model tide". NAMRIA's tide tables are PDFs only |
| Sun times | computed | |
| Typhoons | the West Pacific feeds the page already uses (CWA, JTWC) | the storm panel links PAGASA's bulletins |
| Map | the West Pacific grid already covers the Philippines, as it does Taiwan | no new grid, no new Open-Meteo calls |

The Philippines has no open live wave buoy, so the Right now card shows a dash and "No nearby wave buoy", as for Rincon,
and the log keeps the forecast only. With no buoy and no station wind, the corrections leave the forecast as it is; they
start on their own if a source is added later.

## Clocks

Manila keeps UTC+8 all year, Taipei's clock. Each spot carries `zone: Asia/Manila` and the build writes the offset, as for
Korea.

## Architecture

1. **spots.json**: 8 spots with `country: "ph"`, `zone`, `windStation: []`, `off`, names in zh and ja.
2. **kr.py** takes a country, as `ca.py` does for California, Hawaii and the Pacific NW:
   `kr.py <dl> <snap.json> <spots.json> [kr|ph]` reads `metar-<c>.json`, `open<c>.json` and `tide<c>.json`. Without
   the argument it fills Korea, as now.
3. **refresh.sh**: Korea's section becomes a loop over `kr ph`. The METAR request goes out only for a country whose spots
   name an airport; the wind model is JMA's MSM for Korea and ECMWF's IFS for the Philippines, each with a fallback.
   History, log and correct run with `ph` on `log-ph/`.
4. **Workflow**: `log-ph` joins the log folders restored from the data branch.
5. **template.html**: the country button, a Philippines outline for the map's country column, the map home view and
   first-open box, "Model tide", the ECMWF forecast legend, PAGASA's typhoon link and the footer credits.

## Error handling

As for Korea: a source that is down only blanks its own part, and the build never fails on it.

## Testing

- Fixtures with one saved copy of each new download (ECMWF wind, tide model); `kr.py ... ph` must produce the expected
  fields. Korea's tests pass unchanged, and filling one country leaves the other alone.
- After one build, `log-ph/` holds only the 8 new ids, and every other spot comes out of the same downloads as on `main`.
- The map checks with a Philippines home view, and phone screenshots of a Philippine spot in each language.
