# Indonesia forecast for WaveSlave: design

Date: 2026-10-18. Plan: `docs/superpowers/plans/2026-10-18-indonesia-forecast.md`.

## Goal

Add Indonesia to waveslave.tw the way the Philippines was added (PR #57): a country button, 8 spots, the same forecast page,
map home view and a separate forecast log (`log-id/`).

Bryan asked for the remaining countries one at a time, with Korea's keys last (thread, 2026-10-18). Indonesia is next on
the list; the to-do list named Bali, Lombok and G-Land. No source needs a key.

Defaults I picked (say if you want otherwise):

- Country code `id`, log folder `log-id/`. Switch label Indonesia / 印尼 / インドネシア, placed after the Philippines so the
  Asian countries sit together.
- 8 spots from East Java to Sumbawa: Uluwatu first, as Bali's best-known wave, then west to east G-Land, Canggu, Kuta,
  Keramas, Desert Point, Gerupuk and Lakey Peak.
- Left out: the Mentawais and Nias lie west of the map's 100°E edge. Sumatra's Krui and West Java's Cimaja would need a
  second home view, as Australia has, because one view can't hold them and Sumbawa on a phone held sideways.

## Spots

Coordinates from OpenStreetMap, checked against Open-Meteo on 2026-10-18 (waves, the tide model and ECMWF's wind all
answered for every spot). Kuta, Gerupuk and Desert Point sit a little off the beach so that the wave model's nearest cell is
open sea. Each spot's facing comes from the coastline; `off`, the offshore wind, is the opposite way.

| id | Spot | Faces | Best | Wind now |
|---|---|---|---|---|
| uluwatu | Uluwatu, Bukit Peninsula, Bali | WNW | April to October, southeast trade wind offshore | Ngurah Rai Airport, 12 km |
| gland | G-Land, Plengkung, East Java | NNW | big south swells, April to October | none |
| canggu | Batu Bolong, Canggu, Bali | SW | April to October, early | Ngurah Rai Airport, 11 km |
| kuta | Kuta Beach, Bali | W | April to October, early | Ngurah Rai Airport, 3 km |
| keramas | Keramas, Bali | SSE | November to March, northwest monsoon offshore | none |
| desert | Desert Point, Lombok | W | big southwest swells, May to September | none |
| gerupuk | Gerupuk Bay, Lombok | S | April to October | none |
| lakey | Lakey Peak, Sumbawa | W | May to October, southeast trade wind offshore | none |

Bali, Lombok and Sumbawa keep UTC+8 all year (`Asia/Makassar`), Taipei's clock; G-Land, in East Java, keeps UTC+7
(`Asia/Jakarta`). Each spot carries its zone and the build writes the offset, as for Korea and the Philippines.

## Data sources (no key)

| What | Source | How |
|---|---|---|
| Swell forecast, model check | Open-Meteo marine, as for every country | the shared `openwave` and `openmodels` calls take in the 8 spots |
| Wind forecast | ECMWF's IFS (9 km) via Open-Meteo, then Open-Meteo's default | one call for the 8 spots, as for the Philippines. The default picks ECMWF's IFS here too (checked: the same values at every hour at 11 places) |
| Wind now | Ngurah Rai Airport, Bali (WADD), via NOAA's aviationweather.gov | on the coast by Kuta, reporting every 30 minutes. Over a week it tracked ECMWF's wind at Kuta (r 0.87), Canggu (0.80) and Uluwatu (0.75). Lombok's airport is 20 km inland from Gerupuk and reads lighter than the forecast there, Banyuwangi's is 47 km from G-Land on another coast, and Bima's, the nearest to Lakey, sent no report in a week |
| Tides | Open-Meteo's tide model, as for Australia, Korea and the Philippines | the page says "Model tide". Against the Benoa tide gauge (IOC), the model's highs and lows came 18 to 39 minutes off over two days, and its rise and fall between them within 13 cm. BIG's own predictions aren't an open API |
| Sun times | computed | |
| Cyclones | BMKG's TCWC Jakarta and the Bureau of Meteorology | a "Cyclone watch" panel with both links, as Australia's has BoM's: the typhoon feeds the page uses cover the North Pacific only |
| Map | a new Open-Meteo grid, 2° apart (16–2°S, 102–130°E), refetched every ~6 h like Australia's | the West Pacific grid stops at the equator and Australia's at 20°S |

Indonesia has no open live wave buoy (NDBC and OSMC list none near the surf; BMKG's station data needs a login), so the
Right now card shows a dash and "No nearby wave buoy", as for the Philippines, and the log keeps the forecast and the
airport's wind. The wind corrections start at Uluwatu, Canggu and Kuta once the log holds enough readings.

## Map

- Home view: centre 116.0°E, 8.75°S, 13° of latitude on the map's height. On a phone it holds all 8 spots clear of the
  buttons both ways up (at least 41 px upright, 132 px sideways).
- First-open box: `{l: 101.77, r: 130.23, s: -15.18, n: -2.21}`, the home view on a phone both ways up, as for Korea and the
  Philippines.
- The grid covers both phone views, so the pressure lines come from it there.
- The button's icon is Indonesia's outline from Natural Earth's provinces.

## Architecture

1. **spots.json**: 8 spots with `country: "id"`, `zone`, `windStation` (`metar:WADD` or none), `off`, names in zh and ja.
2. **kr.py**: unchanged code; it already takes a country and per-spot zones (`kr.py <dl> <snap.json> <spots.json> id`).
   Only its comments name Indonesia.
3. **refresh.sh**: the loop runs over `kr ph id`, with ECMWF's IFS for every country but Korea; the METAR request goes out
   for WADD. A `regrid id` line adds the map grid, and the page gets it as `__GRIDID__`. History, log and correct run
   with `id` on `log-id/`.
4. **Workflow**: `log-id` joins the log folders restored from the data branch; `.gitignore` gains `log-id/`.
5. **template.html**: the country button, the outline for the map's country column, the map home view, first-open box
   and grid, "Model tide", the ECMWF legend, the cyclone panel and the footer credits.

## Error handling

As for the Philippines: a source that is down only blanks its own part, and the build never fails on it. A failed grid
fetch keeps the last grid, and with none the map draws the Pacific layer there.

## Testing

- Fixtures with one saved copy of each new download (WADD's reports, ECMWF wind, tide model); `kr.py ... id` must produce
  the expected fields, including the airport wind for the three Bali west-coast spots and none elsewhere. Korea's and the
  Philippines' tests pass unchanged, and filling one country leaves the others alone.
- After one build, `log-id/` holds only the 8 new ids, and every other spot comes out of the same downloads as on `main`.
- The map checks with an Indonesia home view and its grid, and phone screenshots of an Indonesian spot in each language.
