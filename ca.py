# NOAA sources for the California and Hawaii spots, written into snap.json under the same keys snap.py writes for Taiwan from CWA:
#   buoy   : NOAA NDBC (CDIP buoys) [time, height m, average period s, from deg, water °C], last 24 h, one row per hour
#            (NDBC keeps 45 days of 30-minute rows, so no rolling cache is needed)
#   dwind  : NDBC shore station or NWS airport station [time, kt, from deg]
#   wind   : NOAA HRRR/GFS wind forecast via Open-Meteo (HRRR covers California only), 3-hourly [time, kt, from deg, 'Rain'|None, None]
#   tides  : NOAA CO-OPS highs and lows {local date: [[local HH:MM, 'H'|'L', cm]]}
#   sun    : computed {local date: {first, rise, set, last, phen}} in local time
#   tz     : the offset in force at build time (California -7 or -8, Hawaii always -10); the page draws every time with it
# A buoy silent for more than STALE_HOURS shows no reading. A spot's windStation (and its stationName) may be a list tried in order.
# Data times are Taipei wall clock ("YYYY-MM-DDTHH:MM", UTC+8) like the rest of snap.json, readings on the nearest hour.
# Tides and sun are the spot's own clock by its own date, as for Taiwan and Japan.
# Usage: python3 -I ca.py <dl dir> <snap.json> <spots.json> [ca|hi]   (each source is optional: a missing one only blanks its own fields)
import sys, os, json, datetime
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python3 -I leaves this folder off the path; jp.py lives here
import jp

UTC, LA = datetime.timezone.utc, ZoneInfo('America/Los_Angeles')
ZONES = {'ca': LA, 'hi': ZoneInfo('Pacific/Honolulu')}
STALE_HOURS = 6


def utc_to_tpe(dt):
    return jp.fmt(dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt)


def offset(country, at):
    return int(at.astimezone(ZONES[country]).utcoffset().total_seconds() // 3600)


def pacific_offset(at):
    return offset('ca', at)


def _f(v):
    return None if v in ('MM', '', None) else float(v)


def _ndbc(txt):
    """NDBC realtime2 text -> [(UTC datetime, {column: value str})], newest first."""
    head, out = None, []
    for l in (txt or '').splitlines():
        if l.startswith('#'):
            head = head or l[1:].split()
            continue
        v = l.split()
        if not head or len(v) < len(head): continue
        d = dict(zip(head, v))
        out.append((datetime.datetime(int(d['YY']), int(d['MM']), int(d['DD']), int(d['hh']), int(d['mm']), tzinfo=UTC), d))
    return out


def ndbc_rows(txt, keep_hours=24, now=None):
    """NDBC buoy text -> [[time, height m, average period s, from deg, water °C|None]], one per hour (the reading nearest it).
    With now, a buoy whose newest reading is more than STALE_HOURS old gives [] (it has gone silent)."""
    best = {}
    for t, d in _ndbc(txt):
        h = _f(d.get('WVHT'))
        if h is None: continue
        if now and not best and now - t > datetime.timedelta(hours=STALE_HOURS): return []
        hr = (t + datetime.timedelta(minutes=30)).replace(minute=0, second=0)
        gap = abs((t - hr).total_seconds())
        if hr not in best or gap < best[hr][0]:
            best[hr] = (gap, [utc_to_tpe(hr), h, _f(d.get('APD')), _f(d.get('MWD')), _f(d.get('WTMP'))])
    rows = [best[k][1] for k in sorted(best)]
    return jp.merge_buoy([], rows, keep_hours)


def ndbc_wind(txt):
    """NDBC shore station text -> [[time, kt, from deg|None]] from the newest row with a wind speed, or []."""
    for t, d in _ndbc(txt):
        w = _f(d.get('WSPD'))
        if w is None: continue
        return [[jp.on_hour(utc_to_tpe(t)), round(w * 1.944, 1), _f(d.get('WDIR'))]]
    return []


def nws_wind(js):
    """NWS observations (a list of recent reports, or the latest one) -> [[time, kt, from deg|None]] from the newest report
    with a wind speed, or [] when none has one."""
    js = js or {}
    reports = [f.get('properties') or {} for f in js['features']] if 'features' in js else [js.get('properties') or {}]
    for p in sorted(reports, key=lambda p: p.get('timestamp') or '', reverse=True):
        w = (p.get('windSpeed') or {}).get('value')
        if w is None or not p.get('timestamp'): continue
        t = datetime.datetime.fromisoformat(p['timestamp'])
        return [[jp.on_hour(utc_to_tpe(t)), round(w / 1.852, 1), (p.get('windDirection') or {}).get('value')]]
    return []


def tide_days(js):
    """NOAA CO-OPS hilo predictions (local time) -> {local date: [[HH:MM, 'H'|'L', cm]]}."""
    out = {}
    for e in (js or {}).get('predictions') or []:
        out.setdefault(e['t'][:10], []).append([e['t'][11:16], e['type'], round(float(e['v']) * 100)])
    return {d: sorted(v) for d, v in sorted(out.items())}


def _pick(v, i):
    return v[min(i, len(v) - 1)] if isinstance(v, list) else v


def fill(snap, spots, dl, now, country='ca'):
    """Fill every spot of one NOAA country (ca, hi) in snap (in place) from the downloads in dl; now (aware datetime) sets
    the offset and the cut-off for a silent buoy."""
    C = [S for S in spots if S.get('country') == country and S['id'] in snap['spots']]
    tz = offset(country, now)
    def part(name, f):
        try: return f()
        except Exception as e: print(country + ':', name, 'skipped:', e, file=sys.stderr)
    txt = lambda n: jp._load(os.path.join(dl, n), 'txt')
    om = jp._load(os.path.join(dl, 'open%s.json' % country)); om = om if isinstance(om, list) else [om] if om else []
    for n, S in enumerate(C):
        sp = snap['spots'][S['id']]
        sp['tz'] = tz
        bid, buoy = None, []
        for b in S.get('ndbc') or []:
            rows = part('buoy ' + b, lambda: ndbc_rows(txt('ndbc-%s.txt' % b), now=now)) or []
            if rows: bid, buoy = b, rows; break
        sp['buoyId'], sp['buoy'], sp['buoyAt'] = bid, buoy, buoy[-1][0] if buoy else ''
        ws = S.get('windStation') or []; ws = ws if isinstance(ws, list) else [ws]; dw, used = [], 0
        for i, w in enumerate(ws):
            kind, sid = w.split(':', 1)
            if kind == 'ndbc': dw = part('wind ' + sid, lambda: ndbc_wind(txt('ndbc-%s.txt' % sid)))
            else: dw = part('wind ' + sid, lambda: nws_wind(jp._load(os.path.join(dl, 'nws-%s.json' % sid))))
            if dw: used = i; break
        sp['dwind'] = dw or []
        # the wind label names the station that answered (the first one when none did)
        sp['stationName'] = _pick(S['stationName'], used)
        for L in ('zh', 'ja'):
            if 'stationName' in (S.get(L) or {}): sp[L] = dict(sp.get(L) or {}, stationName=_pick(S[L]['stationName'], used))
        sp['wind'] = (part('forecast ' + S['id'], lambda: jp.wind_rows(om[n])) or []) if n < len(om) and om[n] else []
        sp['tides'] = part('tides ' + S['id'], lambda: tide_days(jp._load(os.path.join(dl, 'tide-%s.json' % S['tideStation'])))) or {}
        local = lambda t: (datetime.datetime.fromisoformat(t) + datetime.timedelta(hours=tz - 8)).date().isoformat()
        days = sorted({local(r[0]) for r in sp.get('hourly') or []})
        sp['sun'] = {d: jp.sun_times(S['lat'], S['lon'], d, tz) for d in days}
        snap['src']['spots'][S['id']] = sp['buoyAt'] + '/' + (sp['dwind'][-1][0] if sp['dwind'] else '')


if __name__ == '__main__':
    dl, snapf, spotsf = sys.argv[1:4]; country = (sys.argv[4:] or ['ca'])[0]
    d = json.load(open(snapf)); S = json.load(open(spotsf))
    fill(d, S, dl, datetime.datetime.now(UTC), country)
    json.dump(d, open(snapf, 'w'), ensure_ascii=False, separators=(',', ':'))
    for s in S:
        if s.get('country') == country and s['id'] in d['spots']:
            v = d['spots'][s['id']]
            print(country + ':', s['id'], v['buoyId'], len(v['buoy']), len(v['dwind']), len(v['wind']), len(v['tides']))
