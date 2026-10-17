# Japan sources for the Japan spots, written into snap.json under the same keys snap.py writes for Taiwan from CWA:
#   buoy   : NOWPHAS wave gauges and offshore GPS buoys [time, height m, period s, from deg, None], last 24 h (kept in cache/jp-buoy.json,
#            since the NOWPHAS map feed only carries the latest 20-minute reading)
#   dwind  : JMA AMeDAS wind station [time, kt, from deg]
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
