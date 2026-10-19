# New Zealand sources for the New Zealand spots, written into snap.json under the same keys snap.py writes for Taiwan from CWA:
#   buoy   : the University of Canterbury's South Island Waves network (southislandwaves.co.nz, CC BY 4.0, credit the University of
#            Canterbury): Pegasus Bay off New Brighton, and the Dunedin network's White Island off St Clair (Dunedin City Council's,
#            buoyBy "dcc") [time, height m, mean period s, from deg, water °C|None], last 24 h, one row per hour (the reading nearest it)
#   dwind  : airport reports (METAR) from NOAA's Aviation Weather Center [time, kt, from deg|None], read as for Korea (kr.metar_wind);
#            only Wellington's and Christchurch's airports are near a spot and report to it
#   wind   : ECMWF's IFS via Open-Meteo, 3-hourly [time, kt, from deg, 'Rain'|None, None]
#   tides  : LINZ's tide tables (Toitū Te Whenua Land Information New Zealand, CC BY 4.0), one CSV per port and year, kept in the cache
#            folder as nz-tide-<port, url-encoded>-<year>.csv; {local date: [[local HH:MM, 'H'|'L', cm above chart datum]]} on New
#            Zealand's clock as LINZ gives it (daylight time in summer), for the days the forecast and its past days cover and one
#            either side
#   sun    : computed {local date: {first, rise, set, last, phen}} in local time
#   tz     : the offset in force at build time (Pacific/Auckland: 13 in summer, 12 in winter); the page draws every time with it
# Data times are Taipei wall clock ("YYYY-MM-DDTHH:MM", UTC+8) like the rest of snap.json, readings on the nearest hour.
# Silent buoys and stale wind follow ca.py's rules (ca.STALE_HOURS, ca.WIND_STALE_HOURS).
# Usage: python3 -I nz.py <dl dir> <snap.json> <spots.json> <cache dir>   (each source is optional: a missing one only blanks its own
#        fields)
import sys, os, csv, io, json, math, datetime, urllib.parse
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python3 -I leaves this folder off the path
import jp, ca, au, kr

UTC, DAY = datetime.timezone.utc, datetime.timedelta(days=1)
BAD = (3, 4, 9)  # quality flags for suspect, failed and missing (QARTOD's), read as numbers; the feed sends 1


def _f(v):
    try: x = float(v)
    except (TypeError, ValueError): return None
    return x if math.isfinite(x) and x != -9999 else None   # -9999 is the feed's no data; nan and inf aren't readings either


def siw_rows(txt, keep_hours=24, now=None):
    """South Island Waves CSV -> [[time, height m, mean period s, from deg, water °C|None]], one per hour (the reading nearest it).
    Columns are found by the header's names. A row can end in more or fewer columns than the header has (an unlabelled water
    temperature and pressure added, a field dropped), so the water temperature is read only from a row with exactly the header's
    columns. The direction is the peak direction, as NOAA's buoys send, else the mean one. With now, a buoy silent for more than
    ca.STALE_HOURS gives []."""
    rows = list(csv.reader(io.StringIO((txt or '').lstrip('﻿'))))
    if not rows: return []
    head = rows[0]; col = {k.strip(): i for i, k in enumerate(head)}
    def get(r, k):
        i = col.get(k); return r[i].strip() if i is not None and i < len(r) else None
    best, newest = {}, None
    for r in rows[1:]:
        try: t = datetime.datetime.fromtimestamp(int(float(get(r, 'Time (UNIX/UTC)'))), UTC)
        except (TypeError, ValueError, OverflowError, OSError): continue
        h = _f(get(r, 'Hsig (m)'))
        if not h or h < 0 or _f(get(r, 'QF_waves')) in BAD: continue
        d = _f(get(r, 'Dp (deg)'))
        sst = _f(get(r, 'SST (degC)')) if len(r) == len(head) and _f(get(r, 'QF_sst')) not in BAD else None
        newest = max(newest or t, t)
        hr = (t + datetime.timedelta(minutes=30)).replace(minute=0, second=0)
        gap = abs((t - hr).total_seconds())
        if hr not in best or gap < best[hr][0]:
            best[hr] = (gap, [ca.utc_to_tpe(hr), h, _f(get(r, 'Tm (s)')), d if d is not None else _f(get(r, 'Dm (deg)')), sst])
    if now and newest and now - newest > datetime.timedelta(hours=ca.STALE_HOURS): return []
    return jp.merge_buoy([], [best[k][1] for k in sorted(best)], keep_hours)


def linz_events(txt):
    """One LINZ tide table (a CSV: three header lines, then a row per day of day, weekday, month, year and three to five pairs of local
    time and height in metres, five only on the 25-hour day daylight saving ends) -> [(date, HH:MM, m)] in order."""
    ev = []
    for line in (txt or '').lstrip('﻿').splitlines():
        f = [x.strip() for x in line.split(',')]
        if len(f) < 6 or not all(x.isdigit() for x in (f[0], f[2], f[3])): continue
        day = '%04d-%02d-%02d' % (int(f[3]), int(f[2]), int(f[0]))
        for i in range(4, len(f) - 1, 2):
            hm, v = f[i].split(':'), _f(f[i + 1])
            if len(hm) == 2 and all(x.isdigit() for x in hm) and v is not None: ev.append((day, '%02d:%02d' % (int(hm[0]), int(hm[1])), v))
    return ev


def linz_tides(texts, first=None, last=None):
    """A port's LINZ tide tables, in year order -> {local date: [[HH:MM, 'H'|'L', cm]]}, only the dates from first to last when given.
    The tables don't say which is which; highs and lows take turns, so each is a high when it is above the next one (the last, the
    one before), and one level with it takes the other kind from the one before."""
    ev, out, kind = [e for t in texts for e in linz_events(t)], {}, None
    for i, (day, t, v) in enumerate(ev):
        if len(ev) < 2: break
        other = ev[i + 1][2] if i + 1 < len(ev) else ev[i - 1][2]
        kind = 'H' if v > other else 'L' if v < other else 'L' if kind == 'H' else 'H'
        if (first is None or day >= first) and (last is None or day <= last):
            out.setdefault(day, []).append([t, kind, round(v * 100)])
    return out


def fill(snap, spots, dl, now, cache):
    """Fill every New Zealand spot of snap (in place) from the downloads in dl and the tide tables in cache; now (aware datetime) sets
    each spot's offset and the cut-offs for a silent buoy and stale wind. The Open-Meteo reply lists every New Zealand spot of
    spots.json, in its order."""
    C = [S for S in spots if S.get('country') == 'nz']
    def part(name, f):
        try: return f()
        except Exception as e: print('nz:', name, 'skipped:', e, file=sys.stderr)
    txt = lambda *p: jp._load(os.path.join(*p), 'txt')
    metar = jp._load(os.path.join(dl, 'metar-nz.json'))
    om = jp._load(os.path.join(dl, 'opennz.json')); om = om if isinstance(om, list) else [om] if om else []
    for n, S in enumerate(C):
        if S['id'] not in snap['spots']: continue
        sp = snap['spots'][S['id']]
        tz = sp['tz'] = au.offset(S['zone'], now)
        bid, buoy = None, []
        for b in S.get('siw') or []:
            rows = part('buoy ' + b, lambda: siw_rows(txt(dl, 'siw-%s.csv' % b), now=now)) or []
            if rows: bid, buoy = b, rows; break
        sp['buoyId'], sp['buoy'], sp['buoyAt'] = bid, buoy, buoy[-1][0] if buoy else ''
        sp['buoyQuiet'] = bool(S.get('siw')) and not buoy   # the spot has a buoy, it just isn't reporting
        if S.get('buoyBy'): sp['buoyBy'] = S['buoyBy']   # who runs the buoy, when it isn't the University of Canterbury: dcc (Dunedin City Council)
        ws = S.get('windStation') or []; ws = ws if isinstance(ws, list) else [ws]; dw, used = [], 0
        for i, w in enumerate(ws):
            kind, _, sid = w.partition(':')
            if kind == 'metar': dw = part('wind ' + sid, lambda: kr.metar_wind(metar, sid, now)) or []
            if dw: used = i; break
        sp['dwind'] = dw
        # the wind label names the airport that answered (the first one when none did)
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
        port = urllib.parse.quote(S['tidePort'])
        texts = [txt(cache, 'nz-tide-%s-%d.csv' % (port, y)) for y in range(first.year, last.year + 1)]
        sp['tides'] = part('tides ' + S['id'], lambda: linz_tides([t for t in texts if t], first.isoformat(), last.isoformat())) or {}
        sp['sun'] = {d.isoformat(): jp.sun_times(S['lat'], S['lon'], d.isoformat(), tz) for d in days}
        snap['src']['spots'][S['id']] = sp['buoyAt'] + '/' + (sp['dwind'][-1][0] if sp['dwind'] else '')


if __name__ == '__main__':
    dl, snapf, spotsf, cache = sys.argv[1:5]
    d = json.load(open(snapf)); S = json.load(open(spotsf))
    fill(d, S, dl, datetime.datetime.now(UTC), cache)
    json.dump(d, open(snapf, 'w'), ensure_ascii=False, separators=(',', ':'))
    for s in S:
        if s.get('country') == 'nz' and s['id'] in d['spots']:
            v = d['spots'][s['id']]
            print('nz:', s['id'], v['tz'], v['buoyId'], len(v['buoy']), len(v['dwind']), len(v['wind']), len(v['tides']))
