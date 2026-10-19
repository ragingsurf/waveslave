# Vietnam forecast for WaveSlave: design

Date: 2026-10-19. Plan: `docs/superpowers/plans/2026-10-19-vietnam-forecast.md`.

## Goal

Add Vietnam to waveslave.tw the way Hainan was added (PR #74): a country button, 8 spots, the same forecast page, map home view and
a separate forecast log (`log-vn/`).

Bryan picked "surf spots only" on 2026-10-19: Hong Kong, Hainan, Vietnam, Papua New Guinea, Vanuatu and Baja, one pull request each.
Hong Kong (PR #72) and Hainan (PR #74) are live; Vietnam is next. No source needs a key.

Defaults I picked (say if you want otherwise):

- Country code `vn`, log folder `log-vn/`. Switch label Vietnam / 越南 / ベトナム, placed after Hainan.
- 8 spots, north to south: My Khe, Non Nuoc and An Bang along Da Nang's long beach, Quy Nhon, Hon Chong (Nha Trang), Bai Dai (Cam
  Ranh), Mui Ne and Vung Tau's Back Beach. Quy Nhon has the thinnest surf record of the 8 (one guide); it stays in to cover the
  400 km between Da Nang and Nha Trang.
- Wind now at Bai Dai from Cam Ranh's airport, which misses the bar the earlier countries used in October but tracks well in the
  surf season (below).
- Regions are the provinces as merged in 2025 (Mui Ne in Lam Dong, Quy Nhon in Gia Lai, Vung Tau in Ho Chi Minh City).

## Spots

Positions sit on open water about 450 m off each break, fitted to the OpenStreetMap coastline. `off`, the offshore wind, is the
beach's landward normal from that coastline, checked against the surf guides' best wind. Every spot is `Asia/Ho_Chi_Minh`, which
keeps UTC+7 all year, an hour behind Taipei.

| id | Spot | Region | Faces | off | Season |
|---|---|---|---|---|---|
| mykhe | My Khe Beach | Da Nang | E | 267 | September to March, best September to November; northeast monsoon and typhoon swells |
| nonnuoc | Non Nuoc Beach | Ngu Hanh Son, Da Nang | ENE | 245 | September to March; northeast swell |
| anbang | An Bang Beach | Hoi An, Da Nang | NE | 216 | September to March; northeast swell |
| quynhon | Quy Nhon Beach | Quy Nhon, Gia Lai | SE | 309 | September to March; a strong northeast swell or a typhoon swell |
| honchong | Hon Chong Beach | Nha Trang, Khanh Hoa | E | 272 | November to March; east-northeast swell |
| baidai | Bai Dai (Long Beach) | Cam Ranh, Khanh Hoa | E | 269 | November to March; east-northeast swell |
| muine | Mui Ne Beach | Mui Ne, Lam Dong | ESE | 293 | November to March; east swell |
| vungtau | Back Beach (Bai Sau) | Vung Tau, Ho Chi Minh City | SE | 303 | November to March; northeast monsoon swell |

Left out: Nam O Point (it shares My Khe's wave cell and faces the same way, so its page would repeat My Khe's swell), Lang Co (one
guide), China Beach (on Non Nuoc's stretch, with its cells), Cua Dai and Man Thai (no surf now, or sheltered), and the Mui Ne points
(fickle or unlocated).

**Cams.** My Khe gets the Da Nang Surf Cam (danangsurfcam.com), a community cam whose stream showed the beach today. The YouTube
stream the surf guides list for Hon Chong showed the same daytime frame, dated 2025, at 11:41 and again at 20:21 local time, so it
isn't live and is left out. No other spot has a public cam.

## Data sources (no key)

| What | Source | How |
|---|---|---|
| Swell forecast, model check | Open-Meteo marine, as for every country | the shared `openwave` and `openmodels` calls take in the 8 spots. MFWAM counts a strip 15 to 20 km wide along this coast as land, so its cells lie 4.8 to 20.2 km out, as the Philippines' Bagasbas (23 km) and Borongan (20 km) do; Non Nuoc and An Bang share one, so their swell is the same |
| Wind forecast | ECMWF's IFS via Open-Meteo, then Open-Meteo's default (ECMWF here too), from the sea cell nearest each spot (`cell_selection=sea`) | one call for the 8 spots, as for Hainan. Most default cells lie inland and read lighter: over 5 to 19 October the sea cells blew 15 to 85% harder. The sea cells lie 1.3 to 7.6 km from the spots |
| Wind now | Bai Dai: Cam Ranh's airport (VVCR) through NOAA's Aviation Weather Center (METAR), as for Bali | the airport is on the same beach, 11 km south, and reports every 30 minutes. In January's northeast monsoon its wind tracked ECMWF's at Bai Dai with r 0.90 and 97% of hours within 45° in direction; in October's light sea-breeze weeks only r 0.55 to 0.59 (73 to 85% in direction), below the 0.75 the earlier countries kept to. It stays, since the surf season is when it counts. The other spots have none: Da Nang's airport sits inland and reads mostly calm (r 0.24 to 0.70), and no airport near Quy Nhon, Nha Trang, Mui Ne or Vung Tau sends reports |
| Buoys | none | no open wave buoy near Vietnam: NDBC lists none within 5–22°N, 102–114°E, and OSMC's platforms there are ships |
| Tides | Open-Meteo's tide model, as for Hainan | highs and lows picked from the hourly level; the page says "Model tide". Against the open IOC gauges at Qui Nhon and Vung Tau, its highs and lows came about 35 minutes early with the right range. Vietnam's official predictions (NCHMF) are a copyrighted PDF with one high and one low a day |
| Sun times | computed | |
| Typhoons | JTWC, as today | the Typhoon watch panel links the storm bulletins of Vietnam's National Center for Hydro-Meteorological Forecasting (NCHMF), in Vietnamese for every language: its English page showed only "Updating data". NCHMF's pages are copyrighted, so the panel only links them |
| Map | the West Pacific grid already covers Vietnam, as it does Hainan | no new grid, no new Open-Meteo calls (below) |

The log keeps the forecast and Bai Dai's airport wind. With no buoy, the wave corrections leave the forecast as it is. The wind
correction learns from Bai Dai's airport after two days of readings: it read 7.1 kt against ECMWF's 8.4 kt over 12 to 19 October, so
Bai Dai's wind forecast will be trimmed by about 15% once two weeks are logged.

The past days' wind and the Map tab's wind after the four-day forecast come from the shared `openwx` call, which takes the default
cells, as for Hainan, Micronesia and Hong Kong (already a follow-up in the to-do list).

## Map

The 8 spots span 10.34–16.07°N and 107.10–109.22°E (640 km by 230 km). The home view is `vn: {cx: 108.2, cy: 13.2, span: 6.6,
wide: 3.4}`: upright the width decides, sideways the height. These are the views the map's name fitting starts from, measured on a page
built from real downloads. Held sideways, the fitted view is about 20° wide and would reach past 100°E, the Pacific box's west edge, so
it stops there and the spots sit left of the middle, clear of the buttons.

No grid of its own: the spots' own wind and waves cover the home view, and the West Pacific grid fills in beyond.

**Coastline.** The coarse West Pacific outline puts 6 of the 8 dots 2 to 5 km inland, as it does 5 of the Philippines' 8, 5 of
Korea's and 6 of Japan's. At the home view that is 2 to 5 px, so no DETAIL box: Natural Earth's 10 m coast from Vung Tau to Da Nang
would add about 20 kB to the DETAIL coast, taking it from 26 kB past its 40 kB budget, for a few pixels. The map's country button is
Vietnam's outline.

## Architecture

1. **spots.json**: 8 spots with `country: "vn"`, `zone`, `buoyKm: null`, `buoyName: ""`, `windStation` (`["metar:VVCR"]` at Bai Dai,
   else `[]`), `stationName`, `off`, `cams`, and names in zh and ja, after Hainan's.
2. **kr.py** needs no new code: `kr.py <dl> <snap.json> <spots.json> vn` reads `openvn.json`, `tidevn.json` and `metar-vn.json`, as
   for Indonesia. Its comments name Vietnam.
3. **refresh.sh**: the Korea–Philippines–Indonesia–Hainan loop takes `vn`, with `cell_selection=sea` on its wind forecast as on
   Hainan's. Bai Dai's airport puts VVCR in the loop's METAR request. History, log and correct run with `vn` on `log-vn/`.
4. **Workflow**: `log-vn` joins the log folders restored from the data branch; `.gitignore` takes `log-vn/`.
5. **template.html**: the country button, Vietnam's outline in `HOME_ICONS`, the home view in `HOMES`, "Model tide", the ECMWF legend,
   the Typhoon watch panel's NCHMF link, the footer credits and the comments listing the countries.

## Error handling

As for Hainan: a source that is down only blanks its own part, and the build never fails on it. If the sea-cell request fails, the
default model is asked for, still from the sea cells; if both fail, the spots have no wind forecast for that run. A Cam Ranh report
more than 3 hours old shows no wind now.

## Testing

- `tests/test_vn.py`, from one saved copy of each new download (ECMWF's wind from the sea cells, the tide model, Cam Ranh's METAR):
  the 8 spots are complete and last in spots.json, with Bai Dai's airport and My Khe's cam; `kr.fill(..., 'vn')` gives each spot +7,
  no buoy, wind now at Bai Dai only, 3-hourly `wind`, the tide model's highs and lows for the right days, and sun times on Vietnam's
  dates; the Open-Meteo replies follow the spot list; filling Vietnam leaves every other country alone; `kr.py ... vn` runs isolated
  like refresh.sh. refresh.sh's loop asks for Vietnam's wind from the sea cells, ECMWF's first, and Cam Ranh's reports.
- `tests/test_logsplit.py`: log, correct and history with `vn` touch only Vietnam's spots.
- The map: Vietnam's home view in `tests/map/check.js` (its first open and button, and its pressure lines from the West Pacific
  grid), and its view in the `isoPick` test.
- On the same downloads, every other country's output and log is identical to `main`'s.
- Phone screenshots of the Vietnam spots in en, zh and ja.
