# Korean sources for the Korean spots, written into snap.json under the same keys snap.py writes for Taiwan from CWA:
#   dwind  : airport reports (METAR) from NOAA's Aviation Weather Center (aviationweather.gov) [time, kt, from deg|None], the
#            newest report of the spot's airport; variable wind (VRB) and calm have no direction
#   wind   : JMA MSM wind forecast via Open-Meteo, 3-hourly [time, kt, from deg, 'Rain'|None, None] (Open-Meteo's KMA models
#            answered with no data when this was built)
#   tides  : highs and lows picked from Open-Meteo's tide model (sea level, hourly), as for Australia
#            {local date: [[local HH:MM, 'H'|'L', cm]]}
#   sun    : computed {local date: {first, rise, set, last, phen}} in local time
#   tz     : each spot's offset at build time (Asia/Seoul keeps UTC+9 all year)
#   buoy   : none: the Korea Meteorological Administration's buoy feed needs a key
# Data times are Taipei wall clock ("YYYY-MM-DDTHH:MM", UTC+8) like the rest of snap.json, readings on the nearest hour.
# Stale wind follows ca.py's rule (ca.WIND_STALE_HOURS). A spot's windStation may be one "metar:ICAO" or a list tried in order
# (its stationName likewise).
# Usage: python3 -I kr.py <dl dir> <snap.json> <spots.json>   (each source is optional: a missing one only blanks its own fields)
import sys, os, json, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python3 -I leaves this folder off the path
import jp, ca, au

UTC = datetime.timezone.utc


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


def fill(snap, spots, dl, now):
    """Fill every Korean spot of snap (in place) from the downloads in dl; now (aware datetime) sets each spot's offset and the
    cut-off for stale wind. The Open-Meteo replies list every Korean spot of spots.json, in its order."""
    K = [S for S in spots if S.get('country') == 'kr']
    def part(name, f):
        try: return f()
        except Exception as e: print('kr:', name, 'skipped:', e, file=sys.stderr)
    def many(n):
        v = jp._load(os.path.join(dl, n)); return v if isinstance(v, list) else [v] if v else []
    metar = jp._load(os.path.join(dl, 'metar-kr.json'))
    om, tide = many('openkr.json'), many('tidekr.json')
    for n, S in enumerate(K):
        if S['id'] not in snap['spots']: continue
        sp = snap['spots'][S['id']]
        tz = sp['tz'] = au.offset(S['zone'], now)
        sp['buoyId'], sp['buoy'], sp['buoyAt'], sp['buoyQuiet'] = None, [], '', False
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
        snap['src']['spots'][S['id']] = '/' + (sp['dwind'][-1][0] if sp['dwind'] else '')


if __name__ == '__main__':
    dl, snapf, spotsf = sys.argv[1:4]
    d = json.load(open(snapf)); S = json.load(open(spotsf))
    fill(d, S, dl, datetime.datetime.now(UTC))
    json.dump(d, open(snapf, 'w'), ensure_ascii=False, separators=(',', ':'))
    for s in S:
        if s.get('country') == 'kr' and s['id'] in d['spots']:
            v = d['spots'][s['id']]
            print('kr:', s['id'], v['tz'], len(v['dwind']), len(v['wind']), len(v['tides']))
