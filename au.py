# Australian sources for the Australian spots, written into snap.json under the same keys snap.py writes for Taiwan from CWA:
#   buoy   : IMOS/AODN national real-time wave feed (Queensland, NSW MHL, Victoria, WA buoys) [time, height m, mean period s,
#            from deg, None], last 24 h, one row per hour (the fullest reading nearest the hour); no water temperature in this feed
#   dwind  : Bureau of Meteorology station observations [time, kt, from deg]
#   wind   : Open-Meteo's best-match wind forecast, 3-hourly (its BoM ACCESS feed returns no data),  [time, kt, from deg, 'Rain'|None, None]
#   tides  : highs and lows picked from Open-Meteo's tide model (sea level, hourly, metres about mean sea level)
#            {local date: [[local HH:MM, 'H'|'L', cm]]}; Australia has no open tide-table feed
#   sun    : computed {local date: {first, rise, set, last, phen}} in local time
#   tz     : each spot's own offset at build time (its zone: Brisbane and Perth never change, Sydney and Melbourne do)
# Data times are Taipei wall clock ("YYYY-MM-DDTHH:MM", UTC+8) like the rest of snap.json, readings on the nearest hour.
# Silent buoys and stale wind follow ca.py's rules (ca.STALE_HOURS, ca.WIND_STALE_HOURS).
# Usage: python3 -I au.py <dl dir> <snap.json> <spots.json>   (each source is optional: a missing one only blanks its own fields)
import sys, os, csv, io, json, datetime
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python3 -I leaves this folder off the path
import jp, ca

UTC = datetime.timezone.utc
POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']


def compass(w):
    return POINTS.index(w) * 22.5 if w in POINTS else None


def _f(v):
    try: return float(v)
    except (TypeError, ValueError): return None


def offset(zone, at):
    return int(at.astimezone(ZoneInfo(zone)).utcoffset().total_seconds() // 3600)


def aodn_rows(txt, keep_hours=24, now=None):
    """AODN real-time wave CSV -> [[time, height m, mean period s, from deg, None]], one per hour.
    Height is WSSH (IMOS buoys) or WHTH (NSW and Queensland), mean period WPFM or WPMH, direction SSWMD or WPDI.
    A 0 period means the row carries height only (Queensland's half-hour rows); it takes the period and direction of a
    full reading up to an hour before, else neither.
    Of the readings near an hour, a full one beats a nearer height-only one. With now, a buoy silent for more than
    ca.STALE_HOURS gives []."""
    read = []
    for d in csv.DictReader(io.StringIO(txt or '')):
        try: t = datetime.datetime.fromisoformat(d['TIME']).replace(tzinfo=UTC)
        except (KeyError, ValueError): continue
        h = _f(d.get('WSSH')) or _f(d.get('WHTH'))
        if not h: continue
        p = _f(d.get('WPFM')) or _f(d.get('WPMH')) or None
        r = _f(d.get('SSWMD')) if _f(d.get('SSWMD')) is not None else _f(d.get('WPDI'))
        read.append((t, h, p, r if p else None))
    best, newest, full = {}, None, None
    for t, h, p, r in sorted(read, key=lambda x: x[0]):
        newest = t
        full = (t, p, r) if p else full
        # a height-only reading borrows period and direction from a full one up to an hour before it
        q, s = (p, r) if p else (full[1], full[2]) if full and t - full[0] <= datetime.timedelta(hours=1) else (None, None)
        hr = (t + datetime.timedelta(minutes=30)).replace(minute=0, second=0)
        score = abs((t - hr).total_seconds()) + (0 if p else 3600)
        if hr not in best or score < best[hr][0]:
            best[hr] = (score, [ca.utc_to_tpe(hr), h, q, s, None])
    if now and newest and now - newest > datetime.timedelta(hours=ca.STALE_HOURS): return []
    return jp.merge_buoy([], [best[k][1] for k in sorted(best)], keep_hours)


def bom_wind(js, now=None):
    """BoM observations JSON -> [[time, kt, from deg|None]] from the newest row with a wind speed, or [] (also when it is
    more than ca.WIND_STALE_HOURS old)."""
    for d in ((js or {}).get('observations') or {}).get('data') or []:
        k = d.get('wind_spd_kt')
        if k is None or not d.get('aifstime_utc'): continue
        t = datetime.datetime.strptime(d['aifstime_utc'], '%Y%m%d%H%M%S').replace(tzinfo=UTC)
        if now and now - t > datetime.timedelta(hours=ca.WIND_STALE_HOURS): return []
        return [[jp.on_hour(ca.utc_to_tpe(t)), float(k), compass(d.get('wind_dir')) if k else None]]
    return []


def tide_days(times, levels, tz):
    """Hourly UTC sea level (m) -> {local date: [[HH:MM, 'H'|'L', cm]]}. A run of equal hours counts as one point, a
    turn only when the level rises into it and falls out of it (or the reverse), placed at the middle of the run; a
    single-hour turn is refined with a parabola through its hour and the two around it."""
    out, n, i = {}, len(levels), 1
    while i < n - 1:
        y1 = levels[i]
        j = i
        while j + 1 < n and levels[j + 1] == y1: j += 1
        y0, y2 = levels[i - 1], levels[j + 1] if j + 1 < n else None
        nxt = j + 1
        if None in (y0, y1, y2): i = nxt; continue
        kind = 'H' if y0 < y1 > y2 else 'L' if y0 > y1 < y2 else None
        if kind:
            if j > i: x, y = (i + j) / 2, y1
            else:
                den = y0 - 2 * y1 + y2
                dx = max(-0.5, min(0.5, (y0 - y2) / (2 * den) if den else 0))
                x, y = i + dx, y1 - (y0 - y2) * dx / 4
            t = datetime.datetime.fromisoformat(times[i]) + datetime.timedelta(hours=x - i + tz)
            t = (t + datetime.timedelta(seconds=30)).replace(second=0, microsecond=0)
            out.setdefault(t.date().isoformat(), []).append([t.strftime('%H:%M'), kind, round(y * 100)])
        i = nxt
    return {d: sorted(v) for d, v in sorted(out.items())}


def fill(snap, spots, dl, now):
    """Fill every Australian spot of snap (in place) from the downloads in dl; now (aware datetime) sets each spot's offset
    and the cut-offs for a silent buoy and stale wind."""
    C = [S for S in spots if S.get('country') == 'au' and S['id'] in snap['spots']]
    def part(name, f):
        try: return f()
        except Exception as e: print('au:', name, 'skipped:', e, file=sys.stderr)
    txt = lambda n: jp._load(os.path.join(dl, n), 'txt')
    def many(n):
        v = jp._load(os.path.join(dl, n)); return v if isinstance(v, list) else [v] if v else []
    om, tide = many('openau.json'), many('tideau.json')
    for n, S in enumerate(C):
        sp = snap['spots'][S['id']]
        tz = sp['tz'] = offset(S['zone'], now)
        bid, buoy = None, []
        for b in S.get('aodn') or []:
            rows = part('buoy ' + b, lambda: aodn_rows(txt('aodn-%s.csv' % b.replace(' ', '_')), now=now)) or []
            if rows: bid, buoy = b, rows; break
        sp['buoyId'], sp['buoy'], sp['buoyAt'] = bid, buoy, buoy[-1][0] if buoy else ''
        sp['buoyQuiet'] = bool(S.get('aodn')) and not buoy   # the spot has a buoy, it just isn't reporting
        sid = S.get('bomStation') or ''
        sp['dwind'] = part('wind ' + sid, lambda: bom_wind(jp._load(os.path.join(dl, 'bom-%s.json' % sid)), now)) or []
        sp['wind'] = (part('forecast ' + S['id'], lambda: jp.wind_rows(om[n])) or []) if n < len(om) and om[n] else []
        sp['tides'] = (part('tides ' + S['id'], lambda: tide_days(tide[n]['hourly']['time'], tide[n]['hourly']['sea_level_height_msl'], tz)) or {}) if n < len(tide) and tide[n] else {}
        local = lambda t: (datetime.datetime.fromisoformat(t) + datetime.timedelta(hours=tz - 8)).date().isoformat()
        days = sorted({local(r[0]) for r in sp.get('hourly') or []})
        sp['sun'] = {d: jp.sun_times(S['lat'], S['lon'], d, tz) for d in days}
        snap['src']['spots'][S['id']] = sp['buoyAt'] + '/' + (sp['dwind'][-1][0] if sp['dwind'] else '')


if __name__ == '__main__':
    dl, snapf, spotsf = sys.argv[1:4]
    d = json.load(open(snapf)); S = json.load(open(spotsf))
    fill(d, S, dl, datetime.datetime.now(UTC))
    json.dump(d, open(snapf, 'w'), ensure_ascii=False, separators=(',', ':'))
    for s in S:
        if s.get('country') == 'au' and s['id'] in d['spots']:
            v = d['spots'][s['id']]
            print('au:', s['id'], v['tz'], v['buoyId'], len(v['buoy']), len(v['dwind']), len(v['wind']), len(v['tides']))
