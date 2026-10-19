# South Korea forecast for WaveSlave: design

Date: 2026-10-18. Status: the parts that need no key are built, and since 2026-10-19 the buoys too, from NOAA's copies with no key (Phase 2 below); Bryan dropped the keys on 2026-10-19. Plan: `docs/superpowers/plans/2026-10-18-south-korea-forecast.md`.

## Goal

Add South Korea to waveslave.tw the way Pacific NW was added (PR #50): a country button, 8 spots, the same forecast page,
map home view and a separate forecast-vs-buoy log (`log-kr/`).

Bryan said yes to Korea next (project chat, 2026-10-18). Korea's live wave buoys and official tide tables need free keys
whose sign-ups check a Korean mobile number or ID; Bryan chose to sign up for them (card in the thread). This design
builds everything that needs no key first, and leaves room for the keyed sources (Phase 2 below).

Defaults I picked (say if you want otherwise):

- Country code `kr`, log folder `log-kr/`. Switch label Korea / 韓國 / 韓国, placed after Japan so the East Asian
  countries sit together.
- 8 spots: two in Yangyang (the surf hub), and one each in Gangneung, Pohang, Busan, south and north Jeju, and Taean on
  the west coast.

## Spots

Coordinates from OpenStreetMap, checked against Open-Meteo on 2026-10-18 (waves, tide model, sea temperature and JMA MSM
wind all answered for every spot).

| id | Spot | Faces | Wind now | Notes |
|---|---|---|---|---|
| jukdo | Jukdo Beach, Yangyang | ENE | RKNY Yangyang Airport (12 km) | Korea's best-known surf beach |
| surfyy | Surfyy Beach, Hajodae (Yangyang) | E | RKNY Yangyang Airport (5 km) | shares Jukdo's wave model point |
| geumjin | Geumjin Beach, Gangneung | NE | none within 50 km | |
| wolpo | Wolpo Beach, Pohang | E | none (Pohang's airport is missing from NOAA's feed) | |
| songjeong | Songjeong Beach, Busan | SE | RKPK Gimhae Airport (24 km) | |
| jungmun | Jungmun Saekdal Beach, Jeju | S | none: Jeju Airport (31 km) is on the north coast, across Hallasan | summer typhoon swells |
| iho | Iho Tewoo Beach, Jeju City | NNW | RKPC Jeju Airport (4 km) | winter north swells |
| manlipo | Manlipo Beach, Taean | W | none within 80 km | the west coast's surf beach, big tides |

## Data sources (no key)

| What | Source | How |
|---|---|---|
| Swell forecast, model check | Open-Meteo marine, as for every country | the shared `openwave` and `openmodels` calls take in the 8 spots |
| Wind forecast | JMA MSM (5 km) via Open-Meteo, then JMA's global model | one call for the 8 spots, as for Japan. Open-Meteo's KMA models answered with no data on 2026-10-18 |
| Wind now | Airport reports (METAR) from NOAA's Aviation Weather Center, `aviationweather.gov/api/data/metar` | free, no key; the newest report from the last 3 hours, as for the other countries. Variable wind has no direction |
| Tides | Open-Meteo's tide model (sea level), as for Australia | highs and lows picked from the hourly level; the page says "Model tide" |
| Sun times | computed | |
| Typhoons | the West Pacific feeds the page already uses (CWA, JTWC) | the storm panel links KMA's typhoon page |
| Map | the West Pacific grid already covers Korea, as it does Taiwan and Japan | no new grid, no new Open-Meteo calls |

Without a buoy the Right now card shows a dash and points to the forecast, as for Rincon today, and the spot logs its
forecast and airport wind only. Wave corrections start once a buoy reports, but `correct.py` already scales a spot's wind
forecast by its airport's readings after two days, as in every country. That is why Jungmun takes no wind from Jeju Airport:
across Hallasan, the airport's wind would skew Jungmun's wind forecast as well as its wind now.

## Phase 2: the keyed sources

- **Wave buoys:** the Korea Meteorological Administration's API Hub (`apihub.kma.go.kr/api/typ01/url/kma_buoy.php`),
  its moored and nearshore wave buoys (height, period, direction, water temperature, wind). Sign-up needs an email and a
  mobile number in Korean format, checked by text. 20,000 calls a day.
- **Tide tables:** the Korea Hydrographic and Oceanographic Agency's high and low tide forecast on Korea's public data
  portal (`apis.data.go.kr`, datasets 15156018 and 15156022), development use approved automatically.
- **Wind now** at the beaches without an airport, Jungmun included: KMA's automatic weather stations through the same API Hub key.

Each key goes in the workflow as a secret beside `CWA_KEY`, and every keyed fetch stays optional. The readers are written
against real replies once a key exists, not from documentation alone.

**2026-10-19:** the sign-ups stopped at the Korean mobile check and Bryan dropped them. The buoys came without a key instead:
NOAA NDBC copies KMA's eight moored buoys from the WMO weather reports (`ndbc.noaa.gov/data/realtime2/<id>.drift`, hourly,
45 days). Those copies carry the height in 0.5 m steps and the water temperature, but no real period (0 or 1 s) and no
direction, so the page says "Heights in 0.5 m steps" where the period would be. Seven spots have a buoy (Iho faces north,
away from Marado); Jukdo and Surfyy are 119 and 125 km from Donghae's buoy, so it shows there without correcting their
heights. A buoy that sends only 0.0 m for 72 hours counts as silent (Marado's lost its wave sensor for three weeks in
September). The tide tables and the wind at the beaches without an airport stay as they are.

## Clocks

Korea keeps UTC+9 all year. Each spot carries `zone: Asia/Seoul` and the build writes the offset, as for Australia and
Pacific NW.

## Architecture

1. **spots.json**: 8 spots with `country: "kr"`, `zone`, `windStation` (list of `metar:<ICAO>`), `stationName` (list),
   `off`, names in zh and ja.
2. **kr.py** (new, modeled on au.py): METAR station wind, the JMA wind forecast, tide highs and lows from the model (au.py's
   `tide_days`), sun times and the offset. Each source is optional and only blanks its own fields.
3. **refresh.sh**: a Korea section after Australia (METAR, Open-Meteo wind and tide model, then kr.py), and history, log
   and correct runs with `kr` on `log-kr/`.
4. **Workflow**: `log-kr` joins the log folders restored from the data branch.
5. **template.html**: the country button, a Korea outline for the map's country column, the map home view, the model-tide
   label, the JMA forecast legend, KMA's typhoon link and the footer credits.

## Error handling

- Any source down: that spot keeps its forecast without the missing piece; the build never fails on it.
- A METAR report over 3 hours old is skipped (ca.py's `WIND_STALE_HOURS`), and an airport that sends no report leaves the
  spot without wind now.

## Testing

- Fixtures with one saved copy of each new download (METAR, Open-Meteo wind, tide model), and `kr.py` must produce the
  expected fields.
- After one build, `log-kr/` holds only the 8 new ids, and every other country comes out of the same downloads as on `main`.
- The map checks with a Korea home view, and phone screenshots of a Korean spot in each language.
