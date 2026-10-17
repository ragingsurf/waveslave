# Japan sources for the Japan spots, written into snap.json under the same keys snap.py writes for Taiwan from CWA:
#   buoy   : NOWPHAS wave gauges and offshore GPS buoys [time, height m, period s, from deg, None], last 24 h (kept in cache/jp-buoy.json,
#            since the NOWPHAS map feed only carries the latest 20-minute reading)
#   dwind  : JMA AMeDAS wind station [time, kt, from deg]
#   wind   : JMA MSM wind forecast via Open-Meteo, 3-hourly [time, kt, from deg, 'Rain'|None, None] (the shape of CWA's forecast)
#   tides  : JMA tide table highs and lows {date: [[HH:MM, 'H'|'L', cm]]} (the yearly file is kept in cache/)
#   sun    : computed {date: {first, rise, set, last, phen}}
#   jmawave: JMA forecasters' wave height for the spot's area, 3-hourly [time, m, None, None] (the Japan twin of cwawave)
# Every time is Taipei wall clock ("YYYY-MM-DDTHH:MM", UTC+8) like the rest of snap.json; JST sources are shifted back an hour.
# Usage: python3 -I jp.py <dl dir> <snap.json> <spots.json> <cache dir>   (each source is optional: a missing one only blanks its own fields)
import sys, os, json, re, datetime
import xml.etree.ElementTree as ET

JST, TPE = datetime.timezone(datetime.timedelta(hours=9)), datetime.timezone(datetime.timedelta(hours=8))
CMP = {k: i * 22.5 for i, k in enumerate(['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'])}
fmt = lambda dt: dt.astimezone(TPE).strftime('%Y-%m-%dT%H:%M')


def jst_to_tpe(s):
    """'YYYYMMDDHHMM' (JST) or an ISO time with offset -> Taipei 'YYYY-MM-DDTHH:MM'."""
    if re.fullmatch(r'\d{12}', s):
        return fmt(datetime.datetime.strptime(s, '%Y%m%d%H%M').replace(tzinfo=JST))
    dt = datetime.datetime.fromisoformat(s)
    return fmt(dt if dt.tzinfo else dt.replace(tzinfo=JST))


def num(v):
    try: x = float(v)
    except (TypeError, ValueError): return None
    return None if x >= 99999 else x


def nowphas_rows(xml):
    """NOWPHAS real-time map XML -> {station code: [time, height m, period s, from deg, None]}; stations without a reading are left out."""
    root = ET.fromstring(xml.lstrip('﻿').encode('utf-8'))
    t = jst_to_tpe(root.get('time20min'))
    out = {}
    for m in root.iter('mapdata'):
        h, p = num(m.findtext('yugiha')), num(m.findtext('shiyuki'))
        if h is None or p is None: continue
        out[m.get('code')] = [t, h, p, CMP.get((m.findtext('namimuki') or '').strip()), None]
    return out


def amedas_wind(js, time_jst):
    """AMeDAS map JSON -> {station id: [time, kt, from deg]}. Direction is in 16ths (16 = N); 0 with no wind is calm."""
    t, out = jst_to_tpe(time_jst), {}
    for sid, v in js.items():
        w, d = v.get('wind'), v.get('windDirection')
        if not w or w[0] is None or w[1] != 0: continue
        deg = None if not d or d[1] != 0 or not d[0] else d[0] * 22.5 % 360
        out[sid] = [t, round(w[0] * 1.944, 1), deg]
    return out


def merge_buoy(old, new, keep_hours=24):
    """Union of buoy rows by time (a new reading replaces an old one at the same time), sorted, the last keep_hours before the newest."""
    rows = {r[0]: r for r in old}
    rows.update({r[0]: r for r in new})
    if not rows: return []
    last = datetime.datetime.fromisoformat(max(rows))
    return [rows[t] for t in sorted(rows) if datetime.datetime.fromisoformat(t) > last - datetime.timedelta(hours=keep_hours)]


def tide_table(txt, point):
    """JMA yearly tide table text -> {Taipei date: [[HH:MM, 'H'|'L', cm], ...]} for one tide point.
    Each line: 24 hourly heights (3 chars each), date YYMMDD (space padded) at 72, point code at 78, then four highs and four lows
    of HHMM + 3-char cm each from 80 (9999 = none)."""
    out = {}
    for l in txt.splitlines():
        if len(l) < 136 or l[78:80] != point: continue
        day = datetime.date(2000 + int(l[72:74]), int(l[74:76]), int(l[76:78]))
        for k in range(8):
            f = l[80 + 7 * k:87 + 7 * k]
            if f[:4] == '9999' or not f[:4].strip(): continue
            dt = datetime.datetime(day.year, day.month, day.day, int(f[:2]), int(f[2:4]), tzinfo=JST).astimezone(TPE)
            out.setdefault(dt.strftime('%Y-%m-%d'), []).append([dt.strftime('%H:%M'), 'H' if k < 4 else 'L', int(f[4:7])])
    return {d: sorted(v) for d, v in sorted(out.items())}


def sun_times(lat, lon, date):
    """Sunrise, sunset and civil twilight (-6 deg) for a Taipei calendar date, NOAA solar equations, Taipei wall clock 'HH:MM'."""
    import math
    d = datetime.date.fromisoformat(date)
    g = 2 * math.pi / 365 * (d.timetuple().tm_yday - 1)
    eqt = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    dec = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g) + 0.000907 * math.sin(2 * g)
           - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    noon = 720 - 4 * lon - eqt  # minutes after UTC midnight
    def at(alt, sign):
        c = (math.sin(math.radians(alt)) - math.sin(math.radians(lat)) * math.sin(dec)) / (math.cos(math.radians(lat)) * math.cos(dec))
        m = noon + sign * 4 * math.degrees(math.acos(max(-1, min(1, c)))) + 8 * 60
        return '%02d:%02d' % divmod(round(m) % 1440, 60)
    return {'first': at(-6, -1), 'rise': at(-0.833, -1), 'set': at(-0.833, 1), 'last': at(-6, 1), 'phen': []}


def jma_wave_m(text):
    """'１．５メートル　後　２メートル' -> 2.0: the largest height in a JMA wave forecast text."""
    t = (text or '').translate(str.maketrans('０１２３４５６７８９．', '0123456789.'))
    v = [float(x) for x in re.findall(r'(\d+(?:\.\d+)?)メートル', t)]
    return max(v) if v else None


def jmawave_rows(fc, area):
    """JMA prefecture forecast JSON -> [[time, m, None, None]] every 3 h (Taipei clock) over each forecast period of one area."""
    ts = fc[0]['timeSeries'][0]
    a = next((x for x in ts['areas'] if x['area']['code'] == area), None)
    if not a or not a.get('waves'): return []
    T = [datetime.datetime.fromisoformat(t) for t in ts['timeDefines']]
    out = []
    for i, w in enumerate(a['waves']):
        m = jma_wave_m(w)
        if m is None or i >= len(T): continue
        t, end = T[i], T[i + 1] if i + 1 < len(T) else T[i] + datetime.timedelta(hours=24)
        t = t.astimezone(TPE); t += datetime.timedelta(minutes=-t.minute, hours=(-t.hour) % 3)
        while t < end:
            out.append([fmt(t), m, None, None]); t += datetime.timedelta(hours=3)
    return out


def wind_rows(om):
    """Open-Meteo hourly reply (knots, Taipei clock) -> 3-hourly [time, kt, from deg, 'Rain'|None, None]."""
    h = om['hourly']; P = h.get('precipitation') or [None] * len(h['time'])
    return [[t, round(k, 1), d, 'Rain' if (p or 0) >= 0.5 else None, None]
            for t, k, d, p in zip(h['time'], h['wind_speed_10m'], h['wind_direction_10m'], P) if k is not None and int(t[11:13]) % 3 == 0]


def _load(path, how='json'):
    try:
        with open(path, encoding='utf-8') as f: return json.load(f) if how == 'json' else f.read()
    except (OSError, ValueError): return None


def fill(snap, spots, dl, cache):
    """Fill every Japan spot of snap (in place) from the downloads in dl; keeps rolling buoy history in cache/jp-buoy.json."""
    J = [S for S in spots if S.get('country') == 'jp' and S['id'] in snap['spots']]
    def part(name, f):
        try: return f()
        except Exception as e: print('jp:', name, 'skipped:', e, file=sys.stderr)
    x = _load(os.path.join(dl, 'nowphas.xml'), 'txt')
    now = part('nowphas', lambda: nowphas_rows(x)) if x else None
    bc = _load(os.path.join(cache, 'jp-buoy.json')) or {}
    for code, row in (now or {}).items(): bc[code] = merge_buoy(bc.get(code, []), [row])
    if now:
        os.makedirs(cache, exist_ok=True)
        with open(os.path.join(cache, 'jp-buoy.json.new'), 'w') as f: json.dump(bc, f, separators=(',', ':'))
        os.replace(os.path.join(cache, 'jp-buoy.json.new'), os.path.join(cache, 'jp-buoy.json'))
    am, at = _load(os.path.join(dl, 'amedas.json')), (_load(os.path.join(dl, 'amedas_time.txt'), 'txt') or '').strip()
    wind_now = (part('amedas', lambda: amedas_wind(am, at)) if am and at else None) or {}
    om = _load(os.path.join(dl, 'openjma.json')); om = om if isinstance(om, list) else [om] if om else []
    for n, S in enumerate(J):
        sp = snap['spots'][S['id']]
        days = sorted({r[0][:10] for r in sp.get('hourly') or []})
        codes = S.get('nowphas') or []
        bid, buoy = (codes[0], bc.get(codes[0], [])) if codes else (None, [])
        for b in codes[1:]:
            alt = bc.get(b, [])
            if alt and (not buoy or buoy[-1][0][:10] < alt[-1][0][:10]): bid, buoy = b, alt
        sp['buoyId'], sp['buoy'] = (bid, buoy) if buoy else (None, [])
        sp['buoyAt'] = buoy[-1][0] if buoy else ''
        sp['dwind'] = [wind_now[S['amedas']]] if S.get('amedas') in wind_now else []
        sp['wind'] = part('wind ' + S['id'], lambda: wind_rows(om[n])) or [] if n < len(om) and om[n] else []
        def tides():
            out = {}
            for y in sorted({d[:4] for d in days}):
                t = _load(os.path.join(cache, 'jp-tide-%s-%s.txt' % (S['tidePoint'], y)), 'txt')
                if t: out.update(tide_table(t, S['tidePoint']))
            return {d: v for d, v in out.items() if d in days}
        sp['tides'] = part('tides ' + S['id'], tides) or {}
        sp['sun'] = {d: sun_times(S['lat'], S['lon'], d) for d in days}
        office, area = (S.get('jmaArea') or [None, None])
        fc = _load(os.path.join(dl, 'jmafc-%s.json' % office)) if office else None
        sp['jmawave'] = (part('jmawave ' + S['id'], lambda: jmawave_rows(fc, area)) or []) if fc else []
        snap['src']['spots'][S['id']] = sp['buoyAt'] + '/' + (sp['dwind'][-1][0] if sp['dwind'] else '')


if __name__ == '__main__':
    dl, snapf, spotsf, cache = sys.argv[1:5]
    d = json.load(open(snapf)); S = json.load(open(spotsf))
    fill(d, S, dl, cache)
    json.dump(d, open(snapf, 'w'), ensure_ascii=False, separators=(',', ':'))
    for s in S:
        if s.get('country') == 'jp' and s['id'] in d['spots']:
            v = d['spots'][s['id']]
            print('jp:', s['id'], v['buoyId'], len(v['buoy']), len(v['dwind']), len(v['wind']), len(v['tides']), len(v['jmawave']))
