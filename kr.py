# Sources for the countries with no open buoy feed of their own, Korea (whose buoys come through NOAA), the Philippines, Indonesia
# and Hainan, written into snap.json under the same keys snap.py writes for Taiwan from CWA:
#   dwind  : airport reports (METAR) from NOAA's Aviation Weather Center (aviationweather.gov) [time, kt, from deg|None], the
#            newest report of the spot's airport; variable wind (VRB) and calm have no direction. No Philippine or Hainan spot has
#            an airport near enough; in Indonesia only Bali's west-coast spots do
#   wind   : a wind forecast model via Open-Meteo, 3-hourly [time, kt, from deg, 'Rain'|None, None]: JMA's MSM for Korea
#            (Open-Meteo's KMA models answered with no data when this was built), ECMWF's IFS for the Philippines, Indonesia and
#            Hainan (Hainan's from the sea cell nearest each spot)
#   tides  : highs and lows picked from Open-Meteo's tide model (sea level, hourly), as for Australia
#            {local date: [[local HH:MM, 'H'|'L', cm]]}
#   sun    : computed {local date: {first, rise, set, last, phen}} in local time
#   tz     : each spot's offset at build time (Asia/Seoul keeps UTC+9 all year, Asia/Manila, Asia/Makassar and Asia/Shanghai
#            UTC+8, Asia/Jakarta UTC+7)
#   buoy   : Korea only: the Korea Meteorological Administration's moored buoys as NOAA NDBC copies them from the WMO weather
#            reports (realtime2 .drift, 45 days, hourly) [time, height m, None, None, water °C], last 24 h, one row per hour, read
#            as for California (ca.ndbc_rows). The heights come in 0.5 m steps and the .drift's period isn't a real one (0 or 1 s),
#            so the period and the direction are None (buoyBy "kma"); KMA's own feed needs a key and a Korean mobile number. Each
#            spot's list is tried in order, as for the Pacific islands (pi.py), and a main buoy ca.FAR_KM or more away marks the
#            spot buoyFar. The Philippines, Indonesia and Hainan have no open buoy
# Data times are Taipei wall clock ("YYYY-MM-DDTHH:MM", UTC+8) like the rest of snap.json, readings on the nearest hour.
# Silent buoys and stale wind follow ca.py's rules (ca.STALE_HOURS, ca.WIND_STALE_HOURS). A spot's windStation may be one
# "metar:ICAO" or a list tried in order (its stationName likewise).
# Usage: python3 -I kr.py <dl dir> <snap.json> <spots.json> [kr|ph|id|hn]   (Korea when no country is given; it reads ndbc-<id>.drift,
#        metar-<c>.json, open<c>.json and tide<c>.json, and each is optional: a missing one only blanks its own fields)
import sys, os, json, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python3 -I leaves this folder off the path
import jp, ca, au

UTC = datetime.timezone.utc
# A KMA buoy that has sent only 0.0 m this long has lost its wave sensor: Marado's sent 0.0 for three weeks in September 2026, while
# the longest calm on a main buoy that autumn, Oeyeondo's in October with the whole Yellow Sea flat, lasted 56 hours
ZERO_HOURS = 72


def _when(r):
    if isinstance(r.get('obsTime'), (int, float)): return datetime.datetime.fromtimestamp(r['obsTime'], UTC)
    try: return datetime.datetime.fromisoformat(r['reportTime'].replace('Z', '+00:00'))
    except (KeyError, AttributeError, ValueError): return None


def metar_wind(reports, icao, now=None):
    """aviationweather.gov METAR JSON (a list of reports) -> [[time, kt, from deg|None]] from icao's newest report with a wind
    speed, or [] (also when that report is more than ca.WIND_STALE_HOURS old)."""
    mine = [(_when(r), r) for r in reports or [] if isinstance(r, dict) and r.get('icaoId') == icao and isinstance(r.get('wspd'), (int, float))]
    mine = [x for x in mine if x[0]]
    if not mine: return []
    t, r = max(mine, key=lambda x: x[0])
    if ca._old(t, now): return []
    k, d = float(r['wspd']), r.get('wdir')
    return [[jp.on_hour(ca.utc_to_tpe(t)), k, float(d) if k and isinstance(d, (int, float)) else None]]


def kma_rows(txt, now=None):
    """NOAA's copy of a KMA buoy (realtime2 .drift text) -> [[time, height m, None, None, water °C]] as ca.ndbc_rows gives them, or []
    when the buoy has gone silent or has sent only 0.0 m for the last ZERO_HOURS. A calm's 0.0 (under a quarter metre) stays: the
    Yellow Sea's buoys read it for days at a time."""
    rows = ca.ndbc_rows(txt, now=now)
    if not rows: return []
    R = [(t, ca._f(d.get('WVHT'))) for t, d in ca._ndbc(txt)]
    end = max(t for t, h in R if h is not None)
    return rows if any(h for t, h in R if end - t < datetime.timedelta(hours=ZERO_HOURS)) else []


def fill(snap, spots, dl, now, c='kr'):
    """Fill every spot of country c (kr, ph, id or hn) of snap (in place) from the downloads in dl; now (aware datetime) sets each
    spot's offset and the cut-off for stale wind. The Open-Meteo replies list every spot of c in spots.json, in its order."""
    K = [S for S in spots if S.get('country') == c]
    def part(name, f):
        try: return f()
        except Exception as e: print(c + ':', name, 'skipped:', e, file=sys.stderr)
    def many(n):
        v = jp._load(os.path.join(dl, n)); return v if isinstance(v, list) else [v] if v else []
    txt = lambda n: jp._load(os.path.join(dl, n), 'txt')
    metar = jp._load(os.path.join(dl, 'metar-%s.json' % c))
    om, tide = many('open%s.json' % c), many('tide%s.json' % c)
    for n, S in enumerate(K):
        if S['id'] not in snap['spots']: continue
        sp = snap['spots'][S['id']]
        tz = sp['tz'] = au.offset(S['zone'], now)
        bid, buoy, ub = None, [], 0
        for i, b in enumerate(S.get('ndbc') or []):
            rows = part('buoy ' + b, lambda: kma_rows(txt('ndbc-%s.drift' % b), now)) or []
            if rows: bid, buoy, ub = b, rows, i; break
        sp['buoyId'], sp['buoy'], sp['buoyAt'] = bid, buoy, buoy[-1][0] if buoy else ''
        sp['buoyQuiet'] = bool(S.get('ndbc')) and not buoy   # the spot has a buoy, it just isn't reporting
        if S.get('ndbc'):
            # the buoy label names the buoy that answered, with its distance (the first one when none did)
            sp['buoyName'], sp['buoyKm'], sp['buoyBy'] = ca._pick(S['buoyName'], ub), ca._pick(S.get('buoyKm'), ub), ca._pick(S.get('buoyBy'), ub)
            for L in ('zh', 'ja'):
                if 'buoyName' in (S.get(L) or {}): sp[L] = dict(sp.get(L) or {}, buoyName=ca._pick(S[L]['buoyName'], ub))
            if len(S['ndbc']) > 1: sp['buoyMain'] = S['ndbc'][0]   # the past days and corrections leave out the backup's readings
            if (ca._pick(S.get('buoyKm'), 0) or 0) >= ca.FAR_KM: sp['buoyFar'] = True   # shown with its distance, but no height correction from it
        ws = S.get('windStation') or []; ws = ws if isinstance(ws, list) else [ws]; dw, used = [], 0
        for i, w in enumerate(ws):
            kind, _, sid = w.partition(':')
            if kind == 'metar': dw = part('wind ' + sid, lambda: metar_wind(metar, sid, now)) or []
            if dw: used = i; break
        sp['dwind'] = dw
        # the wind label names the station that answered (the first one when none did)
        sp['stationName'] = ca._pick(S['stationName'], used)
        for L in ('zh', 'ja'):
            if 'stationName' in (S.get(L) or {}): sp[L] = dict(sp.get(L) or {}, stationName=ca._pick(S[L]['stationName'], used))
        sp['wind'] = (part('forecast ' + S['id'], lambda: jp.wind_rows(om[n])) or []) if n < len(om) and om[n] else []
        sp['tides'] = (part('tides ' + S['id'], lambda: au.tide_days(tide[n]['hourly']['time'], tide[n]['hourly']['sea_level_height_msl'], tz)) or {}) if n < len(tide) and tide[n] else {}
        local = lambda t: (datetime.datetime.fromisoformat(t) + datetime.timedelta(hours=tz - 8)).date().isoformat()
        days = sorted({local(r[0]) for r in sp.get('hourly') or []})
        sp['sun'] = {d: jp.sun_times(S['lat'], S['lon'], d, tz) for d in days}
        snap['src']['spots'][S['id']] = sp['buoyAt'] + '/' + (sp['dwind'][-1][0] if sp['dwind'] else '')


if __name__ == '__main__':
    dl, snapf, spotsf = sys.argv[1:4]; c = sys.argv[4] if len(sys.argv) > 4 else 'kr'
    d = json.load(open(snapf)); S = json.load(open(spotsf))
    fill(d, S, dl, datetime.datetime.now(UTC), c)
    json.dump(d, open(snapf, 'w'), ensure_ascii=False, separators=(',', ':'))
    for s in S:
        if s.get('country') == c and s['id'] in d['spots']:
            v = d['spots'][s['id']]
            print(c + ':', s['id'], v['tz'], v['buoyId'], len(v['buoy']), len(v['dwind']), len(v['wind']), len(v['tides']))
