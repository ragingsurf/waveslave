# Extra forecast sources, added to snap.json under new keys only (the hourly/wind/buoy fields the log reads stay as they are).
#   spots[id].swell2  : Open-Meteo MFWAM secondary swell, hourly [time, height m, period s, from deg]
#   spots[id].cwawave : CWA coastal wave forecast (F-D0047-095), 3-hourly [time, height m, period s, from deg]
#   spots[id].models  : other wave models for comparison, 3-hourly {name: [[time, height m, period s]]}
#   tc                : tropical cyclone tracks from CWA (W-C0034-005) and JTWC warnings, for the typhoon panel and map
#   spots[id].storms  : each storm gets 'cpa' (closest forecast pass to the spot); JTWC-only storms are added
# Usage: python3 -I more.py <dl dir> <snap.json> <spots.json>   (every part is optional: a missing or broken source is skipped)
import sys, os, json, math, re, glob, datetime
D, snap, spots = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(snap)); SPOTS = json.load(open(spots))
L = lambda f: json.load(open(os.path.join(D, f)))
r2 = lambda v: None if v is None else round(v, 2)
def fnum(v):
    try: return float(v)
    except (TypeError, ValueError): return None
def part(name, f):
    try: f()
    except Exception as e: print(name, 'skipped:', e, file=sys.stderr)

def swell2():
    OW = L('openwave.json'); OW = OW if isinstance(OW, list) else [OW]
    for S, o in zip(SPOTS, OW):
        h = o['hourly']
        if 'secondary_swell_wave_height' not in h: return
        rows = [[t, r2(a), r2(b), c] for t, a, b, c in zip(h['time'], h['secondary_swell_wave_height'], h['secondary_swell_wave_period'], h['secondary_swell_wave_direction'])]
        # The past 5 days go under hist.swell2, so swell2 still starts today.
        sp = d['spots'][S['id']]; today = min(r[0] for r in sp['hourly'])[:10] if sp.get('hourly') else rows[0][0][:10]
        sp['swell2'] = [r for r in rows if r[0][:10] >= today]; sp.setdefault('hist', {})['swell2'] = [r for r in rows if r[0][:10] < today]

WDIR = {'偏北': 0, '東北': 45, '偏東': 90, '東南': 135, '偏南': 180, '西南': 225, '偏西': 270, '西北': 315}
def cwawave():
    cw = L('coastal.json')['cwaopendata']
    C = {l['LocationName']: l for l in cw['Dataset']['Locations']['Location']}
    for S in SPOTS:
        if S.get('country', 'tw') != 'tw': continue  # CWA covers Taiwan only; jp.py adds jmawave for Japan
        E = {e['ElementName']: e['Time'] for e in C[S['coast']]['WeatherElement']}
        rows = []
        for i, t in enumerate(E['浪高']):
            h = fnum(t['ElementValue'].get('WaveHeight'))
            p = fnum(E['浪週期'][i]['ElementValue'].get('WavePeriod')) if '浪週期' in E else None
            w = WDIR.get(E['浪向'][i]['ElementValue'].get('WaveDirection')) if '浪向' in E else None
            if h is not None: rows.append([t['DataTime'][:16], h, p, w])
        d['spots'][S['id']]['cwawave'] = rows

MODELS = [('ECMWF', 'ecmwf_wam'), ('GFS', 'ncep_gfswave016'), ('DWD', 'dwd_gwam')]
def models():
    M = L('openmodels.json'); M = M if isinstance(M, list) else [M]
    for S, o in zip(SPOTS, M):
        h = o['hourly']; out = {}
        for name, m in MODELS:
            H, P = h.get('wave_height_' + m), h.get('wave_period_' + m)
            if not H or all(v is None for v in H): continue
            out[name] = [[t, r2(a), r2(b)] for t, a, b in zip(h['time'], H, P or [None]*len(H)) if int(t[11:13]) % 3 == 0 and a is not None]
        if out: d['spots'][S['id']]['models'] = out

# ---- Typhoons
def nm(la1, lo1, la2, lo2):
    p1, p2, dl = math.radians(la1), math.radians(la2), math.radians(lo2-lo1)
    return 2*math.asin(math.sqrt(math.sin((p2-p1)/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2))*3440.065
def bear(la1, lo1, la2, lo2):
    p1, p2, dl = math.radians(la1), math.radians(la2), math.radians(lo2-lo1)
    return (math.degrees(math.atan2(math.sin(dl)*math.cos(p2), math.cos(p1)*math.sin(p2)-math.sin(p1)*math.cos(p2)*math.cos(dl)))+360) % 360
TPE = datetime.timezone(datetime.timedelta(hours=8))
tpe = lambda dt: dt.astimezone(TPE).strftime('%Y-%m-%dT%H:%M')
kind = lambda kt: 'Super typhoon' if kt >= 130 else 'Typhoon' if kt >= 64 else 'Tropical storm' if kt >= 34 else 'Tropical depression'
TC = []
def cwa_tc():
    tc = L('typhoon.json')['records'].get('TropicalCyclones') or {}
    tcs = tc.get('TropicalCyclone') or []
    for s in ([tcs] if isinstance(tcs, dict) else tcs):
        fx = s['AnalysisData']['Fix']; fx = fx if isinstance(fx, list) else [fx]; f = fx[-1]
        fc = ((s.get('ForecastData') or {}).get('Fix')) or []; fc = fc if isinstance(fc, list) else [fc]
        out = []
        for p in fc:
            t = datetime.datetime.fromisoformat(p['InitialTime']) + datetime.timedelta(hours=int(p['ForecastHour']))
            out.append([tpe(t), float(p['CoordinateLatitude']), float(p['CoordinateLongitude']), round(fnum(p.get('MaxWindSpeed')) * 1.944) if fnum(p.get('MaxWindSpeed')) is not None else None, fnum(p.get('Radius70PercentProbability'))])
        kt = round(float(f['MaxWindSpeed'])*1.944)
        TC.append({'name': (s.get('TyphoonName') or '').title() or ('TD ' + s.get('CwaTdNo', '')), 'cwaId': s.get('CwaTyphoonName') or ('TD' + s.get('CwaTdNo', '')),
                   'kind': kind(kt), 'kt': kt, 'lat': float(f['CoordinateLatitude']), 'lon': float(f['CoordinateLongitude']), 'at': tpe(datetime.datetime.fromisoformat(f['DateTime'])),
                   'past': [[float(x['CoordinateLatitude']), float(x['CoordinateLongitude'])] for x in fx[-40:]], 'cwa': out, 'src': ['CWA']})

def zt(s):  # DDHHMM (UTC) -> datetime nearest to now
    now = datetime.datetime.now(datetime.timezone.utc); best = None
    for mo in (-1, 0, 1):
        y, m = now.year, now.month + mo
        if m < 1: y, m = y-1, 12
        if m > 12: y, m = y+1, 1
        try: t = datetime.datetime(y, m, int(s[:2]), int(s[2:4]), int(s[4:6]), tzinfo=datetime.timezone.utc)
        except ValueError: continue
        if best is None or abs(t-now) < abs(best-now): best = t
    return best
ll = lambda a, ns, b, ew: (float(a)*(1 if ns == 'N' else -1), float(b)*(1 if ew == 'E' else -1))
NUM = re.compile(r'^(ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|ELEVEN|TWELVE|THIRTEEN|FOURTEEN|FIFTEEN|SIXTEEN|SEVENTEEN|EIGHTEEN|NINETEEN|TWENTY|THIRTY|FORTY|FIFTY)')
def jtwc_tc():
    for fn in sorted(glob.glob(os.path.join(D, 'jtwc-wp*.txt'))):
        x = open(fn, errors='replace').read()
        m = re.search(r'1\.\s+(SUPER TYPHOON|TYPHOON|TROPICAL STORM|TROPICAL DEPRESSION)\s+(\d+W)\s+\(([^)]*)\)\s+WARNING', x)
        p = re.search(r'WARNING POSITION:\s*(\d{6})Z --- NEAR ([\d.]+)([NS]) ([\d.]+)([EW])', x)
        if not (m and p): continue
        w = re.search(r'MAX SUSTAINED WINDS - (\d+) KT', x[p.end():])
        lat, lon = ll(*p.groups()[1:])
        fc = [[tpe(zt(t)), *ll(a, b, c, e), int(k)] for _, t, a, b, c, e, k in re.findall(r'(\d+) HRS, VALID AT:\s*(\d{6})Z --- ([\d.]+)([NS]) ([\d.]+)([EW])\s*MAX SUSTAINED WINDS - (\d+) KT', x)]
        name = m.group(3).title(); kt = int(w.group(1)) if w else 0
        j = {'id': m.group(2), 'lat': lat, 'lon': lon, 'kt': kt, 'at': tpe(zt(p.group(1))), 'track': fc}
        same = next((s for s in TC if s['name'].upper() == name.upper() or nm(s['lat'], s['lon'], lat, lon) < 180), None)
        if same: same['jtwc'] = j['track']; same['jtwcId'] = j['id']; same['src'].append('JTWC')
        else: TC.append({'name': 'TD ' + m.group(2) if NUM.match(name.upper()) else name, 'kind': kind(kt), 'kt': kt,
                         'lat': lat, 'lon': lon, 'at': j['at'], 'past': [], 'jtwc': fc, 'jtwcId': j['id'], 'src': ['JTWC']})

def tct(s): return datetime.datetime.strptime(s, '%Y-%m-%dT%H:%M')
def cpa(s, la, lo):  # closest pass over the forecast track (interpolated hourly), from the first source that has one
    for src in ('cwa', 'jtwc'):
        tr = s.get(src)
        if not tr: continue
        pts = [[s['at'], s['lat'], s['lon']]] + [r[:3] for r in tr]; best = None
        for a, b in zip(pts, pts[1:]):
            ta, tb = tct(a[0]), tct(b[0]); n = max(1, int((tb-ta).total_seconds()//3600))
            for k in range(n+1):
                f = k/n; y, x = a[1]+(b[1]-a[1])*f, a[2]+(b[2]-a[2])*f; dd = nm(la, lo, y, x)
                if best is None or dd < best[0]: best = (dd, ta+(tb-ta)*f, y, x)
        return {'nm': round(best[0]), 'at': best[1].strftime('%Y-%m-%dT%H:%M'), 'bearing': round(bear(la, lo, best[2], best[3])), 'src': src.upper()}
    return None

def storms():
    for S in SPOTS:
        sp = d['spots'][S['id']]; lst = sp.get('storms') or []
        for s in TC:
            e = next((x for x in lst if x.get('id') in (s.get('cwaId'), s.get('jtwcId')) and x.get('id') == (s.get('cwaId') or s.get('jtwcId'))), None)
            if e is None:
                e = {'name': s['name'], 'kind': s['kind'], 'id': s.get('jtwcId'), 'distNm': round(nm(S['lat'], S['lon'], s['lat'], s['lon'])), 'bearing': round(bear(S['lat'], S['lon'], s['lat'], s['lon'])),
                     'heading': round(bear(s['lat'], s['lon'], s['jtwc'][0][1], s['jtwc'][0][2])) if s.get('jtwc') else 0, 'kt': s['kt'], 'gust': None, 'mb': None, 'swell': None}
                lst.append(e)
            e['src'] = s['src']; e['cpa'] = cpa(s, S['lat'], S['lon'])
        lst.sort(key=lambda s: s['distNm']); sp['storms'] = lst
    d['tc'] = TC

part('swell2', swell2); part('cwawave', cwawave); part('models', models)
part('cwa tc', cwa_tc); part('jtwc', jtwc_tc); part('storms', storms)
json.dump(d, open(snap, 'w'), ensure_ascii=False, separators=(',', ':'))
