# Alaska forecast for WaveSlave: design

Date: 2026-10-19. Plan: `docs/superpowers/plans/2026-10-19-alaska-forecast.md`.

## Goal

Add Alaska to waveslave.tw the way the Pacific Northwest was added (PR #50): a country button, 8 spots, the same forecast page,
buoy check, map home view and a separate forecast log (`log-ak/`).

Bryan asked for the remaining countries one at a time, with Korea's keys last (thread, 2026-10-18). The to-do list's next item was
"Alaska: NOAA buoys, wind and tides, like California". No source needs a key.

Defaults I picked (say if you want otherwise):

- Country code `ak`, log folder `log-ak/`. Switch label Alaska / 阿拉斯加 / アラスカ, placed after Pacific NW.
- 8 spots in four towns: Cannon Beach and Ocean Cape (Yakutat), Sandy Beach, Shelikof Bay and Sea Lion Cove (Sitka and Kruzof
  Island), Surfers Beach and Fossil Beach (Kodiak), Bishop's Beach (Homer). Cannon Beach, Alaska's best-known surf beach, comes first.
- Left out: Summer Bay on Unalaska (its nearest buoy is 370 km away and it would stretch the spots across 31° of longitude), Point
  Carrew (it shares Ocean Cape's wave forecast), Seward and Turnagain Arm (north of 60°N; fly-in river mouths and a tidal bore).

## Spots

Coordinates sit a few hundred metres off each beach, on water NOAA's charts show as sea; `off`, the offshore wind, is the beach's
landward normal. All checked live on 2026-10-18 and 19. No public surf cam was found at any of them.

| id | Spot | Zone | Buoys (km away) | Wind now | Tides (NOAA) |
|---|---|---|---|---|---|
| cannonbeach | Cannon Beach, Yakutat | America/Yakutat | 46083 Fairweather Ground (167), then 46082 Cape Suckling (205) | Yakutat Airport | 9453220 Yakutat |
| oceancape | Ocean Cape, Yakutat | America/Yakutat | 46083 (176), then 46082 (197) | Yakutat Airport | 9453220 Yakutat |
| sandies | Sandy Beach, Sitka | America/Sitka | 46084 Cape Edgecumbe (65), then 46083 (206) | Sitka Airport, then Sitka Harbor | 9451600 Sitka |
| shelikof | Shelikof Bay, Kruzof Island | America/Sitka | 46084 (60), then 46083 (185) | Sitka Airport, then the Cape Edgecumbe buoy | 9451600 Sitka |
| sealioncove | Sea Lion Cove, Kruzof Island | America/Sitka | 46084 (78), then 46083 (168) | Sitka Airport, then the Cape Edgecumbe buoy | 9451805 Scraggy Island |
| surfersbeach | Surfers Beach, Pasagshak | America/Anchorage | 46080 Portlock Bank (145), then 46078 Albatross Bank (209), then 46001 Gulf of Alaska (295) | Kodiak Airport, then Gull Island | 9457351 Ugak Bay |
| fossilbeach | Fossil Beach, Narrow Cape | America/Anchorage | 46080 (143), then 46078 (207), then 46001 (291) | Kodiak Airport, then Gull Island | 9457351 Ugak Bay |
| bishopsbeach | Bishop's Beach, Homer | America/Anchorage | 46108 Lower Cook Inlet (16, CDIP), then 46080 (209) | Homer Airport, then Homer Spit | 9455558 Homer |

The Gulf of Alaska buoys go dark for months in winter (46083 from January to June 2025, 46084 in December 2025, 46080's waves from
February to April 2026, 46078 from January to April 2026), so each spot has two or three, tried in order, as for the Pacific NW.
The NOS stations at Yakutat and Sitka (YATA2, ITKA2) have sent no wind for 45 days, so the airports come first.

Surfers Beach and Fossil Beach, 3.4 km apart, fall in the same cell of Open-Meteo's wave model, so their wave forecasts are the same;
they face different ways (`off` 5 and 25), so their wind ratings differ.

## Far buoys

Only Homer's buoy is close (16 km) and Sitka's are 60–78 km out, as La Push's and Ichinomiya's are today. Yakutat's and Kodiak's are
143–209 km out in the open gulf.

- The page shows them as it shows every buoy, with the distance: "Right now · Fairweather Ground buoy · 167 km away".
- They are logged like every other buoy.
- The forecast does not learn its height correction from a main buoy 100 km or more away: so far out it measures the open sea, not
  the beach, and the clamp (0.6–1.4) would still let it scale the spot's waves by 40%. ca.py marks such a spot `buoyFar`, and
  correct.py leaves its height factor at 1 and scores nothing for it. The wind factor still learns from the airport. No existing
  spot is affected: the farthest main buoy today is Ichinomiya's, at 68 km.

## Data sources (no key)

| What | Source | How |
|---|---|---|
| Wave height, period, direction, water temp | NOAA NDBC real-time files | as for California (`ca.ndbc_rows`); 46108 is CDIP's (buoyBy `cdip`) |
| Wind now | NWS airport stations (Yakutat, Sitka, Kodiak, Homer), then NDBC shore stations | as for California; NWS requests send `User-Agent: waveslave.tw` |
| Wind forecast | Open-Meteo `models=gfs_seamless` (GFS in Alaska: HRRR covers the lower 48 only), one call for the 8 spots | Over the week to October 19, GFS and ECMWF tracked the four airports about equally (hourly speed correlation 0.47/0.64 at Yakutat, 0.81/0.83 Sitka, 0.74/0.76 Kodiak, 0.82/0.67 Homer; direction within 45° 84% and 81% of the hours both blew 5 kt or more), so Alaska stays on NOAA's model in the NOAA loop. Legend "NOAA GFS forecast", as for Hawaii |
| Swell forecast, model check | Open-Meteo, as for every country | answered for all 8 spots |
| Tides | NOAA CO-OPS highs and lows, `time_zone=lst_ldt` | as for California, from 5 days back on Alaska's clock. Kodiak's station is a subordinate one (Saltery Cove, in the bay the beaches face). `lst_ldt` moves from AKDT to AKST at 02:00 on November 1, also at Homer, whose station metadata says "PST" |
| Sun times | computed | |
| Map | a new Open-Meteo grid, 54–62°N at 1° and 158–130°W at 2° (9 × 15 = 135 points), refetched every ~6 h like the 2° grids, as GFS updates every 6 hours | 2° of longitude at 58°N is about as long as 1° of latitude, so the cells are close to square on the map |

No tropical cyclones reach Alaska and the typhoon feeds cover the West Pacific only, so the storm panel is hidden, as for California
and the Pacific NW.

## Clocks

Yakutat, Sitka and Anchorage time are all UTC-8 now and UTC-9 from 02:00 on November 1, the same night as California. Each spot
carries its zone and the build writes the offset in force. As for California, times can be an hour off for days past the change
inside the forecast window, since the page uses one offset per spot.

## Map

- **The Pacific box reaches 65°N** (today 60°N). Bishop's Beach (59.6°N) and Ocean Cape (59.5°N) sit at today's top edge, which a
  view can't pass, and the coast north of them (the Kenai Peninsula, Prince William Sound, Anchorage) isn't drawn. Zoomed all the way
  out, the box upright is about 8% smaller, as its height sets the zoom; sideways nothing changes.
- **Coastline**: `tools/pacific_coast.py` cuts Natural Earth's land to 65°N, adding about 7 KB to the page. Every ring wholly south of
  60°N comes out unchanged; the six that crossed 60°N are simplified again as whole rings, so their parts south of 60°N move by at most
  0.033°, within the simplification's tolerance.
- **Pacific layer**: 50°S–65°N, 24 rows (744 points), fetched in the same two chunks of rows.
- **Home view**: one view for all 8 spots, which spread over 17° of longitude (Kodiak to Sitka), centred at 144.6°W, 58.4°N and showing
  at least 24° of longitude and 6.2° of latitude. Held sideways the spots fill the middle; upright their width sets the zoom, and the
  view, kept inside the box, puts them in its upper part, clear of a spot's forecast card. With nothing saved, the first open is the home view, as for the South Pacific. The map's country button is Alaska's
  outline (the mainland's southern coast with Kodiak).

## Architecture

1. **spots.json**: 8 spots with `country: "ak"`, the same fields as the Pacific NW's (`zone`, `ndbc`, `buoyKm`, `buoyName`,
   `windStation`, `stationName`, `tideStation`, `off`, names in zh and ja).
2. **ca.py** reads `ak` too: `ZONES['ak']` (America/Anchorage, for a spot without its own zone) and `buoyFar` for a spot whose first
   buoy is 100 km or more away.
3. **correct.py**: a `buoyFar` spot keeps height factor 1, with no bands and no score.
4. **refresh.sh**: `ak` joins the NOAA loop after the Pacific NW with `ZONE=America/Anchorage`; `regrid ak 350 54 1 9 -158 2 15`,
   a `__GRIDAK__` placeholder, and history, log and correct runs with `ak` on `log-ak/`. pacific.sh asks for 24 rows.
5. **Workflow**: `log-ak` joins the log folders restored from the data branch; `.gitignore` takes `log-ak/`.
6. **template.html**: the button, the map's box, coastline, cut lines and grid, the home view and outline, the GFS legend, the
   buoy label (NOAA, or CDIP for Homer's), the hidden storm panel and the credits.

## Error handling

- Any source down: that spot keeps its forecast without the missing piece; the build never fails on it and the other countries are
  untouched. A buoy silent for 6 hours counts as not reporting; a wind reading over 3 hours old is skipped.
- A Pacific grid saved before this change (23 rows) still draws: the page reads each grid's own size.

## Testing

- `tests/test_ak.py`: the spots are complete; `ca.py` fills a Yakutat spot (far buoy, airport wind, NOAA tides, offset -8) and
  Bishop's Beach (CDIP buoy, not far) from saved downloads; the backup buoy's name and distance; correct.py leaves a far spot's height
  factor at 1 while it learns a near spot's and both spots' wind.
- The map maths, pacific.sh's request and the coast tool follow the box to 65°N; a test ties pacific.sh's rows and columns to the
  box's edges; the coast tool rebuilds every ring wholly south of 60°N exactly.
- On the same downloads, every other country's output and log is identical to `main`'s.
- `tests/map/check.js` passes upright and sideways, with a new check for Alaska's first open and home view.
