# Learn a per-spot wave height correction from the forecast-vs-buoy log, apply it, and score how close the forecast has been.
#   ratio : buoy height / forecast height over the last 21 days (forecasts 1-72 h ahead, as issued), shrunk toward 1 until
#           14 days of buoy readings back it up, and kept within 0.6-1.4 (a buoy is not the beach, so never trust it fully)
#   hourly heights (total, swell, wind sea) and swell2, and their past days under hist, are scaled by it; the log keeps the raw forecast (log.py runs first)
#   spots[id].adj = {f: factor, days: days of buoy data, acc: % of hours the next-day forecast (12-36 h ahead, as published)
#                    was within 0.3 m of the buoy, miss: typical miss in m, n: hours scored}
# Each run's factors go to log/<Taipei date>.adj.jsonl so the score uses what the site actually showed.
# Usage: python3 -I correct.py <snap.json> <logdir>
import sys, os, json, gzip, glob, datetime
snap, logdir = sys.argv[1], sys.argv[2]
d = json.load(open(snap))
WINDOW, FULL, LO, HI = 21, 14, 0.6, 1.4
TPE = datetime.timezone(datetime.timedelta(hours=8))
now = datetime.datetime.now(TPE)
first = (now - datetime.timedelta(days=WINDOW)).strftime('%Y-%m-%d')
t8 = lambda s: datetime.datetime.fromisoformat(s.replace('Z', '+00:00')).astimezone(TPE) if s.endswith('Z') else datetime.datetime.fromisoformat(s).replace(tzinfo=TPE)

runs, adj = [], {}
for f in sorted(glob.glob(os.path.join(logdir, '20*.jsonl*'))):
    if os.path.basename(f)[:10] < first: continue
    op = gzip.open if f.endswith('.gz') else open
    try:
        with op(f, 'rt') as fh:
            for line in fh:
                try: r = json.loads(line)
                except ValueError: continue
                if f.endswith('.adj.jsonl'): adj[r['run']] = r['adj']
                else: runs.append(r)
    except (OSError, EOFError): pass  # a cut-off gzip still gave its earlier lines

obs = {}  # spot -> {Taipei hour: buoy height}
for r in runs:
    for k, s in r['spots'].items():
        for b in s.get('buoy') or []:
            if b and b[1] is not None: obs.setdefault(k, {})[b[0][:16]] = b[1]

out = {}
for k, sp in d['spots'].items():
    O = obs.get(k, {}); so = sf = 0; hits = n = miss = 0
    for r in runs:
        s = r['spots'].get(k)
        if not s: continue
        rt = t8(r['run']); a = (adj.get(r['run']) or {}).get(k, 1)
        for row in s.get('fc') or []:
            if row[1] is None or row[0][:16] not in O: continue
            lead = (t8(row[0]) - rt).total_seconds() / 3600
            if 1 <= lead <= 72: so += O[row[0][:16]]; sf += row[1]
            if 12 <= lead <= 36:
                e = abs(row[1] * a - O[row[0][:16]]); n += 1; miss += e; hits += e <= 0.3
    days = len({t[:10] for t in O})
    f = 1.0
    if sf > 0 and days >= 2:
        f = max(LO, min(HI, 1 + (so / sf - 1) * min(1, days / FULL)))
    f = round(f, 2)
    for row in sp.get('hourly') or []:
        for i in (1, 4, 7):
            if row[i] is not None: row[i] = round(row[i] * f, 1)
    for row in (sp.get('hist') or {}).get('wave') or []:
        for i in (1, 4, 7):
            if row[i] is not None: row[i] = round(row[i] * f, 1)
    for row in (sp.get('swell2') or []) + ((sp.get('hist') or {}).get('swell2') or []):
        if row[1] is not None: row[1] = round(row[1] * f, 2)
    sp['adj'] = {'f': f, 'days': days, 'acc': round(100 * hits / n) if n else None, 'miss': round(miss / n, 2) if n else None, 'n': n}
    out[k] = f

with open(os.path.join(logdir, now.strftime('%Y-%m-%d') + '.adj.jsonl'), 'a') as fh:
    fh.write(json.dumps({'run': d['updated'], 'adj': out}, separators=(',', ':')) + '\n')
json.dump(d, open(snap, 'w'), ensure_ascii=False, separators=(',', ':'))
print('corrections:', {k: (v['adj']['f'], v['adj']['days'], v['adj']['acc']) for k, v in d['spots'].items()}, file=sys.stderr)
