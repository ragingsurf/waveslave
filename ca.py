# NOAA sources for the California, Hawaii, Pacific Northwest and Alaska spots, written into snap.json under the same keys snap.py writes for Taiwan from CWA:
#   buoy   : NOAA NDBC (NDBC, CDIP and Environment Canada buoys) [time, height m, average period s, from deg, water °C], last 24 h, one row
#            per hour (NDBC keeps 45 days of 30-minute rows, so no rolling cache is needed). Environment Canada's buoys (buoyBy "eccc") send
#            only a peak period and no direction: their period is peak / PEAK rounded up to 0.01 s, which the page's x1.3 turns back into
#            the peak, and their direction is None.
#   dwind  : NDBC shore station, NWS airport station or ECCC station (BC) [time, kt, from deg]
#   wind   : NOAA HRRR/GFS wind forecast via Open-Meteo (HRRR covers the mainland coast only), 3-hourly [time, kt, from deg, 'Rain'|None, None]
#   tides  : NOAA CO-OPS highs and lows, or the Canadian Hydrographic Service's for a "chs:" station {local date: [[local HH:MM, 'H'|'L', cm]]}
#   sun    : computed {local date: {first, rise, set, last, phen}} in local time
#   tz     : the offset in force at build time (California, Oregon and Washington -7 or -8, Hawaii always -10, British Columbia -7 since
#            March 2026, Alaska -8 or -9); the page draws every time with it
# A buoy silent for more than STALE_HOURS shows no reading (buoyQuiet), and a wind reading over WIND_STALE_HOURS old is skipped. A spot's windStation (and its stationName) may be a list tried in order;
# so may its ndbc buoys, with buoyName, buoyKm and buoyBy lists that follow them; buoyMain then names the first, the only one correct.py
# and history.py learn from. A main buoy FAR_KM or more away marks the spot buoyFar: correct.py learns no height factor from it.
# A spot's own zone (IANA name) wins over its country's.
# Data times are Taipei wall clock ("YYYY-MM-DDTHH:MM", UTC+8) like the rest of snap.json, readings on the nearest hour.
# Tides and sun are the spot's own clock by its own date, as for Taiwan and Japan.
# Usage: python3 -I ca.py <dl dir> <snap.json> <spots.json> [ca|hi|nw|ak]   (each source is optional: a missing one only blanks its own fields)
import sys, os, json, math, datetime
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python3 -I leaves this folder off the path; jp.py lives here
import jp

UTC, LA = datetime.timezone.utc, ZoneInfo('America/Los_Angeles')
ZONES = {'ca': LA, 'hi': ZoneInfo('Pacific/Honolulu'), 'nw': LA, 'ak': ZoneInfo('America/Anchorage')}
STALE_HOURS, WIND_STALE_HOURS = 6, 3
PEAK = 1.3  # the page's BUOY_P: it shows average period x 1.3
FAR_KM = 100  # a main buoy this far out measures the open sea, not the beach (Yakutat's and Kodiak's are 143-176 km out)


def utc_to_tpe(dt):
    return jp.fmt(dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt)


def zone_of(country, zone=None):
    return ZoneInfo(zone) if zone else ZONES[country]


def offset(country, at, zone=None):
    return int(at.astimezone(zone_of(country, zone)).utcoffset().total_seconds() // 3600)


def pacific_offset(at):
    return offset('ca', at)


def _f(v):
    return None if v in ('MM', '', None) else float(v)


def _ndbc(txt):
    """NDBC realtime2 text (a .txt, or a .drift, whose time of day is one hhmm column) -> [(UTC datetime, {column: value str})], newest first."""
    head, out = None, []
    for l in (txt or '').splitlines():
        if l.startswith('#'):
            head = head or l[1:].split()
            continue
        v = l.split()
        if not head or len(v) < len(head): continue
        d = dict(zip(head, v))
        hh, mm = (d['hhmm'][:2], d['hhmm'][2:]) if 'hhmm' in d else (d['hh'], d['mm'])
        out.append((datetime.datetime(int(d['YY']), int(d['MM']), int(d['DD']), int(hh), int(mm), tzinfo=UTC), d))
    return out


def _period(d, peak=False):
    # the average period; with peak (Environment Canada's buoys send only the peak period), the peak period / PEAK, rounded up so the
    # page's x PEAK gives back the peak to 0.1 s and never less
    a, p = _f(d.get('APD')), _f(d.get('DPD'))
    return a if a is not None or not peak else math.ceil(p / PEAK * 100) / 100 if p is not None else None


def ndbc_rows(txt, keep_hours=24, now=None, peak=False):
    """NDBC buoy text -> [[time, height m, average period s, from deg, water °C|None]], one per hour (the reading nearest it).
    With now, a buoy whose newest reading is more than STALE_HOURS old gives [] (it has gone silent). With peak, a row with no average
    period takes its peak period (see _period)."""
    best = {}
    for t, d in _ndbc(txt):
        h = _f(d.get('WVHT'))
        if h is None: continue
        if now and not best and now - t > datetime.timedelta(hours=STALE_HOURS): return []
        hr = (t + datetime.timedelta(minutes=30)).replace(minute=0, second=0)
        gap = abs((t - hr).total_seconds())
        if hr not in best or gap < best[hr][0]:
            best[hr] = (gap, [utc_to_tpe(hr), h, _period(d, peak), _f(d.get('MWD')), _f(d.get('WTMP'))])
    rows = [best[k][1] for k in sorted(best)]
    return jp.merge_buoy([], rows, keep_hours)


def _old(t, now):
    return now is not None and now - t > datetime.timedelta(hours=WIND_STALE_HOURS)


def ndbc_wind(txt, now=None):
    """NDBC shore station text -> [[time, kt, from deg|None]] from the newest row with a wind speed, or [] (also when that
    row is too old to count as wind now)."""
    for t, d in _ndbc(txt):
        w = _f(d.get('WSPD'))
        if w is None: continue
        if _old(t, now): return []
        return [[jp.on_hour(utc_to_tpe(t)), round(w * 1.944, 1), _f(d.get('WDIR'))]]
    return []


def nws_wind(js, now=None):
    """NWS observations (a list of recent reports, or the latest one) -> [[time, kt, from deg|None]] from the newest report
    with a wind speed, or [] when none has one recent enough."""
    js = js or {}
    reports = [f.get('properties') or {} for f in js['features']] if 'features' in js else [js.get('properties') or {}]
    for p in sorted(reports, key=lambda p: p.get('timestamp') or '', reverse=True):
        w = (p.get('windSpeed') or {}).get('value')
        if w is None or not p.get('timestamp'): continue
        t = datetime.datetime.fromisoformat(p['timestamp'])
        if _old(t, now): return []
        return [[jp.on_hour(utc_to_tpe(t)), round(w / 1.852, 1), (p.get('windDirection') or {}).get('value')]]
    return []


# ECCC station report fields, best first: the 10-minute average wind at 10 m, else the 2-minute one, else a partner network's 10-minute one.
ECCC_WIND = (('avg_wnd_spd_10m_pst10mts', 'avg_wnd_dir_10m_pst10mts'), ('avg_wnd_spd_10m_pst2mts', 'avg_wnd_dir_10m_pst2mts'), ('avg_wnd_spd_pst10mts', 'avg_wnd_dir_pst10mts'))
TO_KT = {'km/h': 1 / 1.852, 'm/s': 1.944, 'knot': 1, 'kt': 1, 'kn': 1}


def eccc_wind(js, now=None):
    """ECCC real-time station reports (api.weather.gc.ca swob-realtime GeoJSON) -> [[time, kt, from deg|None]] from the newest report
    with a wind speed, or [] when none has one recent enough."""
    reports = [f.get('properties') or {} for f in (js or {}).get('features') or []]
    for p in sorted(reports, key=lambda p: p.get('date_tm-value') or '', reverse=True):
        k = next((k for k in ECCC_WIND if p.get(k[0]) is not None), None)
        if not k or not p.get('date_tm-value'): continue
        t = datetime.datetime.fromisoformat(p['date_tm-value'].replace('Z', '+00:00'))
        if _old(t, now): return []
        return [[jp.on_hour(utc_to_tpe(t)), round(p[k[0]] * TO_KT.get(p.get(k[0] + '-uom') or 'km/h', 1 / 1.852), 1), _f(p.get(k[1]))]]
    return []


def chs_tides(js, zone):
    """Canadian Hydrographic Service high and low predictions ([{eventDate: UTC, value: m}]) -> {local date: [[HH:MM, 'H'|'L', cm]]}.
    The reply doesn't say which is which; highs and lows take turns, so each is a high when it is above the next one (the last, the one before)."""
    ev = sorted((datetime.datetime.fromisoformat(e['eventDate'].replace('Z', '+00:00')), float(e['value'])) for e in js or [] if e.get('value') is not None)
    out = {}
    for i, (t, v) in enumerate(ev):
        if len(ev) < 2: break
        other = ev[i + 1][1] if i + 1 < len(ev) else ev[i - 1][1]
        lt = t.astimezone(zone)
        out.setdefault(lt.date().isoformat(), []).append([lt.strftime('%H:%M'), 'H' if v > other else 'L', round(v * 100)])
    return {d: sorted(v) for d, v in sorted(out.items())}


def tide_days(js):
    """NOAA CO-OPS hilo predictions (local time) -> {local date: [[HH:MM, 'H'|'L', cm]]}."""
    out = {}
    for e in (js or {}).get('predictions') or []:
        out.setdefault(e['t'][:10], []).append([e['t'][11:16], e['type'], round(float(e['v']) * 100)])
    return {d: sorted(v) for d, v in sorted(out.items())}


def _pick(v, i):
    return v[min(i, len(v) - 1)] if isinstance(v, list) else v


def fill(snap, spots, dl, now, country='ca'):
    """Fill every spot of one NOAA country (ca, hi, nw, ak) in snap (in place) from the downloads in dl; now (aware datetime) sets
    the offset and the cut-off for a silent buoy."""
    C = [S for S in spots if S.get('country') == country and S['id'] in snap['spots']]
    def part(name, f):
        try: return f()
        except Exception as e: print(country + ':', name, 'skipped:', e, file=sys.stderr)
    txt = lambda n: jp._load(os.path.join(dl, n), 'txt')
    om = jp._load(os.path.join(dl, 'open%s.json' % country)); om = om if isinstance(om, list) else [om] if om else []
    for n, S in enumerate(C):
        sp = snap['spots'][S['id']]
        zone = zone_of(country, S.get('zone'))
        sp['tz'] = tz = offset(country, now, S.get('zone'))
        bid, buoy, ub = None, [], 0
        for i, b in enumerate(S.get('ndbc') or []):
            rows = part('buoy ' + b, lambda: ndbc_rows(txt('ndbc-%s.txt' % b), now=now, peak=_pick(S.get('buoyBy'), i) == 'eccc')) or []
            if rows: bid, buoy, ub = b, rows, i; break
        sp['buoyId'], sp['buoy'], sp['buoyAt'] = bid, buoy, buoy[-1][0] if buoy else ''
        sp['buoyQuiet'] = bool(S.get('ndbc')) and not buoy   # the spot has a buoy, it just isn't reporting
        # the buoy label names the buoy that answered, with its distance (the first one when none did)
        sp['buoyName'], sp['buoyKm'] = _pick(S['buoyName'], ub), _pick(S.get('buoyKm'), ub)
        for L in ('zh', 'ja'):
            if 'buoyName' in (S.get(L) or {}): sp[L] = dict(sp.get(L) or {}, buoyName=_pick(S[L]['buoyName'], ub))
        by = _pick(S.get('buoyBy'), ub)
        if by: sp['buoyBy'] = by   # who runs the buoy, when it isn't NOAA's own: cdip, or eccc (Environment Canada)
        if len(S.get('ndbc') or []) > 1: sp['buoyMain'] = S['ndbc'][0]   # the past days and corrections leave out the backups' readings
        if (_pick(S.get('buoyKm'), 0) or 0) >= FAR_KM: sp['buoyFar'] = True   # shown with its distance, but no height correction from it
        ws = S.get('windStation') or []; ws = ws if isinstance(ws, list) else [ws]; dw, used = [], 0
        for i, w in enumerate(ws):
            kind, sid = w.split(':', 1)
            if kind == 'ndbc': dw = part('wind ' + sid, lambda: ndbc_wind(txt('ndbc-%s.txt' % sid), now))
            elif kind == 'eccc': dw = part('wind ' + sid, lambda: eccc_wind(jp._load(os.path.join(dl, 'eccc-%s.json' % sid)), now))
            else: dw = part('wind ' + sid, lambda: nws_wind(jp._load(os.path.join(dl, 'nws-%s.json' % sid)), now))
            if dw: used = i; break
        sp['dwind'] = dw or []
        # the wind label names the station that answered (the first one when none did)
        sp['stationName'] = _pick(S['stationName'], used)
        for L in ('zh', 'ja'):
            if 'stationName' in (S.get(L) or {}): sp[L] = dict(sp.get(L) or {}, stationName=_pick(S[L]['stationName'], used))
        sp['wind'] = (part('forecast ' + S['id'], lambda: jp.wind_rows(om[n])) or []) if n < len(om) and om[n] else []
        ts = S['tideStation']
        if ts.startswith('chs:'): sp['tides'] = part('tides ' + S['id'], lambda: chs_tides(jp._load(os.path.join(dl, 'chs-%s.json' % ts[4:])), zone)) or {}
        else: sp['tides'] = part('tides ' + S['id'], lambda: tide_days(jp._load(os.path.join(dl, 'tide-%s.json' % ts)))) or {}
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
