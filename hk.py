# Sources for the Hong Kong spots, written into snap.json under the same keys snap.py writes for Taiwan from CWA:
#   dwind  : the Hong Kong Observatory's 10-minute wind ("hko:<station>", the station's English name as HKO's CSV prints it), one CSV
#            for all its stations [time, kt, from deg|None]: km/h on 8 compass points, where calm reads 0 kt and it and a variable
#            wind have no direction; then the airport's report (METAR) from NOAA's Aviation Weather Center, read as for Korea
#            (kr.metar_wind). A spot's windStation is a list tried in order. HKO's data are used under DATA.GOV.HK's terms, which ask
#            for the source to be credited
#   wind   : ECMWF's IFS via Open-Meteo, from the sea cell nearest each spot, 3-hourly [time, kt, from deg, 'Rain'|None, None]
#   tides  : HKO's high and low predictions, one JSON per station and year kept in the cache folder as hk-tide-<station>-<year>.json;
#            {local date: [[local HH:MM, 'H'|'L', cm above Chart Datum]]} for the days the forecast and its past days cover and one
#            either side
#   sun    : computed {local date: {first, rise, set, last, phen}} in local time
#   tz     : 8 (Asia/Hong_Kong keeps UTC+8 all year)
# Hong Kong has no open wave buoy, so its spots have none, as in the Philippines.
# Data times are Taipei wall clock ("YYYY-MM-DDTHH:MM", UTC+8) like the rest of snap.json, readings on the nearest hour.
# Stale wind follows ca.py's rule (ca.WIND_STALE_HOURS).
# Usage: python3 -I hk.py <dl dir> <snap.json> <spots.json> <cache dir>   (it reads hko-wind.csv, metar-hk.json and openhk.json, and
#        each is optional: a missing one only blanks its own fields)
import sys, os, csv, io, json, datetime
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python3 -I leaves this folder off the path
import jp, ca, au, kr, nz

UTC, DAY, HKT = datetime.timezone.utc, datetime.timedelta(days=1), ZoneInfo('Asia/Hong_Kong')
POINTS = {p: i * 45.0 for i, p in enumerate(('North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'))}


def hko_wind(txt, station, now=None):
    """HKO's 10-minute wind CSV (a header, then a row per station: Hong Kong time YYYYMMDDHHMM, station, direction, mean km/h, gust
    km/h) -> [[time, kt, from deg|None]] from station's row, or [] when it has no speed (N/A), isn't listed or is more than
    ca.WIND_STALE_HOURS old. Calm reads 0 kt; it and a variable wind (Variable) have no direction."""
    for r in csv.reader(io.StringIO((txt or '').lstrip('﻿'))):
        if len(r) < 4 or r[1].strip() != station: continue
        try: t = datetime.datetime.strptime(r[0].strip(), '%Y%m%d%H%M').replace(tzinfo=HKT)
        except ValueError: return []
        d, v = r[2].strip(), r[3].strip()
        kmh = 0.0 if 'Calm' in (d, v) else nz._f(v)
        if kmh is None or ca._old(t, now): return []
        return [[jp.on_hour(ca.utc_to_tpe(t)), round(kmh / 1.852, 1), POINTS.get(d) if kmh else None]]
    return []


def hko_events(js, year):
    """One year of HKO's tide predictions (dataType=HLT JSON: a row per day of month, day and up to four pairs of Hong Kong time HHMM
    and height in metres above Chart Datum, blank where the day has fewer) -> [(date, HH:MM, m)] in order. HKO doesn't say which is a
    high and which a low; nz.turns tells them apart."""
    ev = []
    for r in (js or {}).get('data') or []:
        try: day = datetime.date(year, int(r[0]), int(r[1])).isoformat()
        except (TypeError, ValueError, IndexError): continue
        for i in range(2, len(r) - 1, 2):
            t, v = str(r[i]).strip(), nz._f(r[i + 1])
            if len(t) == 4 and t.isdigit() and int(t[:2]) < 24 and int(t[2:]) < 60 and v is not None: ev.append((day, t[:2] + ':' + t[2:], v))
    return sorted(ev)


def fill(snap, spots, dl, now, cache):
    """Fill every Hong Kong spot of snap (in place) from the downloads in dl and the tide tables in cache; now (aware datetime) sets each
    spot's offset and the cut-off for stale wind. The Open-Meteo reply lists every Hong Kong spot of spots.json, in its order."""
    C = [S for S in spots if S.get('country') == 'hk']
    def part(name, f):
        try: return f()
        except Exception as e: print('hk:', name, 'skipped:', e, file=sys.stderr)
    hko = jp._load(os.path.join(dl, 'hko-wind.csv'), 'txt')
    metar = jp._load(os.path.join(dl, 'metar-hk.json'))
    om = jp._load(os.path.join(dl, 'openhk.json')); om = om if isinstance(om, list) else [om] if om else []
    for n, S in enumerate(C):
        if S['id'] not in snap['spots']: continue
        sp = snap['spots'][S['id']]
        tz = sp['tz'] = au.offset(S['zone'], now)
        sp['buoyId'], sp['buoy'], sp['buoyAt'], sp['buoyQuiet'] = None, [], '', False   # no open buoy
        ws = S.get('windStation') or []; ws = ws if isinstance(ws, list) else [ws]; dw, used = [], 0
        for i, w in enumerate(ws):
            kind, _, sid = w.partition(':')
            if kind == 'hko': dw = part('wind ' + sid, lambda: hko_wind(hko, sid, now)) or []
            elif kind == 'metar': dw = part('wind ' + sid, lambda: kr.metar_wind(metar, sid, now)) or []
            if dw: used = i; break
        sp['dwind'] = dw
        # the wind label names the station that answered (the first one when none did)
        sp['stationName'] = ca._pick(S['stationName'], used)
        for L in ('zh', 'ja'):
            if 'stationName' in (S.get(L) or {}): sp[L] = dict(sp.get(L) or {}, stationName=ca._pick(S[L]['stationName'], used))
        sp['wind'] = (part('forecast ' + S['id'], lambda: jp.wind_rows(om[n])) or []) if n < len(om) and om[n] else []
        local = lambda t: (datetime.datetime.fromisoformat(t) + datetime.timedelta(hours=tz - 8)).date()
        days = sorted({local(r[0]) for r in sp.get('hourly') or []})
        # the tides cover the forecast's days and its past days (hist.wave), and one day either side for the tide curve's ends
        seen = sorted(set(days) | {local(r[0]) for r in (sp.get('hist') or {}).get('wave') or []})
        if not seen: today = now.astimezone(ZoneInfo(S['zone'])).date(); seen = [today - 5 * DAY, today + 9 * DAY]
        first, last = seen[0] - DAY, seen[-1] + DAY
        # each year's table is read on its own: HKO works them out apart, and where two meet it can leave out a small high or low near
        # midnight (Ko Lau Wan's and Tai Miu Wan's on the night into 2027), which would throw the turns off
        years = [(y, jp._load(os.path.join(cache, 'hk-tide-%s-%d.json' % (S['tideStation'], y)))) for y in range(first.year, last.year + 1)]
        sp['tides'] = part('tides ' + S['id'], lambda: {d: v for y, js in years if js for d, v in nz.turns(hko_events(js, y), first.isoformat(), last.isoformat()).items()}) or {}
        sp['sun'] = {d.isoformat(): jp.sun_times(S['lat'], S['lon'], d.isoformat(), tz) for d in days}
        snap['src']['spots'][S['id']] = '/' + (sp['dwind'][-1][0] if sp['dwind'] else '')


if __name__ == '__main__':
    dl, snapf, spotsf, cache = sys.argv[1:5]
    d = json.load(open(snapf)); S = json.load(open(spotsf))
    fill(d, S, dl, datetime.datetime.now(UTC), cache)
    json.dump(d, open(snapf, 'w'), ensure_ascii=False, separators=(',', ':'))
    for s in S:
        if s.get('country') == 'hk' and s['id'] in d['spots']:
            v = d['spots'][s['id']]
            print('hk:', s['id'], v['tz'], len(v['dwind']), len(v['wind']), len(v['tides']))
