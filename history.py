# What the last 5 days were actually like, for the Forecast tab's past days (next to the model's hist.wave from snap.py):
#   spots[id].hist.buoy    : buoy readings [time, height m, period s, from deg], from the forecast-vs-buoy log plus the latest feed
#   spots[id].hist.station : wind station readings [time, kt, from deg], from the same log
#   spots[id].tides        : gains the past days' highs and lows, kept in cache/tides.json (CWA only serves tides from today on)
# With a country code (tw, jp), only that country's spots are filled, from its own log; tides other than Taiwan's go to cache/tides-<country>.json.
# Reads the log only; never writes to it. Usage: python3 -I history.py <snap.json> <logdir> <cachedir> [country]
import sys, os, json, gzip, glob, datetime
snap, logdir, cache = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(snap))
TODAY = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)).date()
FIRST = (TODAY - datetime.timedelta(days=5)).isoformat()

buoy, station = {}, {}  # spot -> {time: row}
for f in sorted(glob.glob(os.path.join(logdir, '20*.jsonl.gz'))):
    if os.path.basename(f)[:10] < (TODAY - datetime.timedelta(days=6)).isoformat(): continue
    try:
        with gzip.open(f, 'rt') as fh:
            for line in fh:
                try: r = json.loads(line)
                except ValueError: continue
                for k, s in r.get('spots', {}).items():
                    main = (d['spots'].get(k) or {}).get('buoyMain')  # a spot with backup buoys keeps its main one's past readings only
                    for b in s.get('buoy') or []:
                        if b and b[1] is not None and (not main or s.get('buoyId') == main): buoy.setdefault(k, {})[b[0][:16]] = b[:4]
                    for w in s.get('station') or []:
                        if w and w[1] is not None: station.setdefault(k, {})[w[0][:16]] = w[:3]
    except (OSError, EOFError): pass  # a cut-off gzip still gave its earlier lines

os.makedirs(cache, exist_ok=True)
COUNTRY = sys.argv[4] if len(sys.argv) > 4 else None
tf = os.path.join(cache, 'tides.json' if COUNTRY in (None, 'tw') else 'tides-%s.json' % COUNTRY)
try: TH = json.load(open(tf))
except (OSError, ValueError): TH = {}
for k, sp in d['spots'].items():
    if COUNTRY and sp.get('country', 'tw') != COUNTRY: continue
    B = buoy.get(k, {})
    for b in sp.get('buoy') or []: B[b[0][:16]] = b[:4]
    W = station.get(k, {})
    for w in sp.get('dwind') or []: W[w[0][:16]] = w[:3]
    h = sp.setdefault('hist', {})
    h['buoy'] = [B[t] for t in sorted(B) if t[:10] >= FIRST]
    h['station'] = [W[t] for t in sorted(W) if t[:10] >= FIRST]
    th = TH.setdefault(k, {}); th.update(sp.get('tides') or {})
    for day in list(th):
        if day < FIRST: del th[day]
    sp['tides'] = dict(sorted({**{x: v for x, v in th.items() if x < TODAY.isoformat()}, **(sp.get('tides') or {})}.items()))
json.dump(TH, open(tf + '.new', 'w'), separators=(',', ':')); os.replace(tf + '.new', tf)
json.dump(d, open(snap, 'w'), ensure_ascii=False, separators=(',', ':'))
print('history:', {k: (len(s['hist'].get('wave') or []), len(s['hist']['buoy']), len(s['hist']['station'])) for k, s in d['spots'].items() if not COUNTRY or s.get('country', 'tw') == COUNTRY}, file=sys.stderr)
