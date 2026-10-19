# Sources for the Pacific island spots, written into snap.json under the same keys snap.py writes for Taiwan from CWA, for two groups:
# the South Pacific (pi: Fiji, Tonga, Samoa, American Samoa, the Cook Islands and Tahiti) and Micronesia (mi: Guam, Saipan, Pohnpei,
# Kosrae and Majuro).
#   buoy   : PacIOOS's wave buoys via NOAA NDBC (buoyBy "pacioos") [time, height m, average period s, from deg, water °C], last 24 h, one
#            row per hour, read as for California (ca.ndbc_rows), each spot's list tried in order (Aunu'u, then King-Poloa when it is
#            silent); buoyMain names the first, the only one correct.py and history.py learn from
#   dwind  : airport reports (METAR) from NOAA's Aviation Weather Center [time, kt, from deg|None], read as for Korea (kr.metar_wind),
#            where an airport near a spot tracks its wind (Pago Pago; Guam, Saipan and Kosrae), then an NDBC shore station
#            ("ndbc:APRP7", Apra Harbor, read as for California by ca.ndbc_wind)
#   wind   : ECMWF's IFS via Open-Meteo, 3-hourly [time, kt, from deg, 'Rain'|None, None]
#   tides  : NOAA's high and low predictions where the spot has a tideStation, asked for in UTC and put on the spot's clock here, so
#            they don't rest on NOAA's idea of each island's clock; else highs and lows picked from Open-Meteo's tide model, as for
#            Australia, with tideModel set so the page says so {local date: [[local HH:MM, 'H'|'L', cm]]}
#   sun    : computed {local date: {first, rise, set, last, phen}} in local time
#   tz     : each spot's offset at build time (Fiji +12, Tonga and Samoa +13, American Samoa -11, the Cook Islands and Tahiti -10;
#            Guam and Saipan +10, Pohnpei and Kosrae +11, Majuro +12; none changes its clock)
# Data times are Taipei wall clock ("YYYY-MM-DDTHH:MM", UTC+8) like the rest of snap.json, readings on the nearest hour.
# Silent buoys and stale wind follow ca.py's rules (ca.STALE_HOURS, ca.WIND_STALE_HOURS).
# Usage: python3 -I pi.py <dl dir> <snap.json> <spots.json> [pi|mi]   (for group c it reads ndbc-<id>.txt, metar-c.json, openc.json,
#        tidec-<station>.json and tidec.json, and each is optional: a missing one only blanks its own fields)
import sys, os, json, datetime
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python3 -I leaves this folder off the path
import jp, ca, au, kr

UTC = datetime.timezone.utc


def noaa_tides(js, zone):
    """NOAA CO-OPS hilo predictions asked for in UTC (time_zone=gmt) -> {local date: [[HH:MM, 'H'|'L', cm]]} on zone's clock."""
    out = {}
    for e in (js or {}).get('predictions') or []:
        t = datetime.datetime.strptime(e['t'], '%Y-%m-%d %H:%M').replace(tzinfo=UTC).astimezone(zone)
        out.setdefault(t.date().isoformat(), []).append([t.strftime('%H:%M'), e['type'], round(float(e['v']) * 100)])
    return {d: sorted(v) for d, v in sorted(out.items())}


def fill(snap, spots, dl, now, country='pi'):
    """Fill every spot of one island group (pi, mi) in snap (in place) from the downloads in dl; now (aware datetime) sets each spot's
    offset and the cut-offs for a silent buoy and stale wind. The ECMWF reply lists every spot of the group in spots.json's order, the
    tide model's reply the ones without a tideStation."""
    C = [S for S in spots if S.get('country') == country]
    def part(name, f):
        try: return f()
        except Exception as e: print(country + ':', name, 'skipped:', e, file=sys.stderr)
    def many(n):
        v = jp._load(os.path.join(dl, n)); return v if isinstance(v, list) else [v] if v else []
    txt = lambda n: jp._load(os.path.join(dl, n), 'txt')
    metar = jp._load(os.path.join(dl, 'metar-%s.json' % country))
    om, model = many('open%s.json' % country), many('tide%s.json' % country)
    M = [S['id'] for S in C if not S.get('tideStation')]
    for n, S in enumerate(C):
        if S['id'] not in snap['spots']: continue
        sp = snap['spots'][S['id']]
        tz = sp['tz'] = au.offset(S['zone'], now)
        bid, buoy, ub = None, [], 0
        for i, b in enumerate(S.get('ndbc') or []):
            rows = part('buoy ' + b, lambda: ca.ndbc_rows(txt('ndbc-%s.txt' % b), now=now)) or []
            if rows: bid, buoy, ub = b, rows, i; break
        sp['buoyId'], sp['buoy'], sp['buoyAt'] = bid, buoy, buoy[-1][0] if buoy else ''
        sp['buoyQuiet'] = bool(S.get('ndbc')) and not buoy   # the spot has a buoy, it just isn't reporting
        # the buoy label names the buoy that answered, with its distance (the first one when none did)
        sp['buoyName'], sp['buoyKm'] = ca._pick(S['buoyName'], ub), ca._pick(S.get('buoyKm'), ub)
        for L in ('zh', 'ja'):
            if 'buoyName' in (S.get(L) or {}): sp[L] = dict(sp.get(L) or {}, buoyName=ca._pick(S[L]['buoyName'], ub))
        by = ca._pick(S.get('buoyBy'), ub)
        if by: sp['buoyBy'] = by   # who runs the buoy that answered: pacioos (the Pacific Islands Ocean Observing System)
        if len(S.get('ndbc') or []) > 1: sp['buoyMain'] = S['ndbc'][0]   # the past days and corrections leave out the backup's readings
        ws = S.get('windStation') or []; ws = ws if isinstance(ws, list) else [ws]; dw, used = [], 0
        for i, w in enumerate(ws):
            kind, _, sid = w.partition(':')
            if kind == 'metar': dw = part('wind ' + sid, lambda: kr.metar_wind(metar, sid, now)) or []
            elif kind == 'ndbc': dw = part('wind ' + sid, lambda: ca.ndbc_wind(txt('ndbc-%s.txt' % sid), now)) or []
            if dw: used = i; break
        sp['dwind'] = dw
        # the wind label names the station that answered (the first one when none did)
        sp['stationName'] = ca._pick(S['stationName'], used)
        for L in ('zh', 'ja'):
            if 'stationName' in (S.get(L) or {}): sp[L] = dict(sp.get(L) or {}, stationName=ca._pick(S[L]['stationName'], used))
        sp['wind'] = (part('forecast ' + S['id'], lambda: jp.wind_rows(om[n])) or []) if n < len(om) and om[n] else []
        if S.get('tideStation'):
            sp['tides'] = part('tides ' + S['id'], lambda: noaa_tides(jp._load(os.path.join(dl, 'tide%s-%s.json' % (country, S['tideStation']))), ZoneInfo(S['zone']))) or {}
        else:
            m = M.index(S['id']); r = model[m] if m < len(model) else None
            sp['tides'] = (part('tides ' + S['id'], lambda: au.tide_days(r['hourly']['time'], r['hourly']['sea_level_height_msl'], tz)) or {}) if r else {}
            sp['tideModel'] = True
        local = lambda t: (datetime.datetime.fromisoformat(t) + datetime.timedelta(hours=tz - 8)).date().isoformat()
        days = sorted({local(r[0]) for r in sp.get('hourly') or []})
        sp['sun'] = {d: jp.sun_times(S['lat'], S['lon'], d, tz) for d in days}
        snap['src']['spots'][S['id']] = sp['buoyAt'] + '/' + (sp['dwind'][-1][0] if sp['dwind'] else '')


if __name__ == '__main__':
    dl, snapf, spotsf = sys.argv[1:4]; country = (sys.argv[4:] or ['pi'])[0]
    d = json.load(open(snapf)); S = json.load(open(spotsf))
    fill(d, S, dl, datetime.datetime.now(UTC), country)
    json.dump(d, open(snapf, 'w'), ensure_ascii=False, separators=(',', ':'))
    for s in S:
        if s.get('country') == country and s['id'] in d['spots']:
            v = d['spots'][s['id']]
            print(country + ':', s['id'], v['tz'], v['buoyId'], len(v['buoy']), len(v['dwind']), len(v['wind']), len(v['tides']))
