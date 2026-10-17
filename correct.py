# Learn per-spot corrections from the forecast-vs-buoy log (the same buoy and wind station history the past days show), apply them,
# and score how close the forecast has been.
#   height : buoy height / forecast height over the last 21 days (forecasts 1-72 h ahead, as issued), shrunk toward 1 until
#            14 days of buoy readings back it up, and kept within 0.6-1.4 (a buoy is not the beach, so never trust it fully).
#            Then per wave period band (<7, 7-9, 9-11, 11+ s, the forecast's own period): the band's own ratio relative to the spot's,
#            shrunk the same way by the days that band was seen, so long-period swell and short wind chop each get their own trim.
#   wind   : wind station kt / CWA forecast kt (forecasts 0-36 h ahead, as issued), shrunk the same way and kept within 0.6-1.2.
#            Skipped where the station barely moves (it reads under 30% of the forecast: a sheltered anemometer, not the beach).
#   hourly heights (total, swell, wind sea) and swell2, and their past days under hist, are scaled by the height factor for the
#   hour's period band; CWA wind speeds by the wind factor. The log keeps the raw forecast (log.py runs first).
#   spots[id].adj = {f: spot-wide height factor, bands: {band: factor}, wf: wind factor, wdays: days of station data,
#                    days: days of buoy data, acc: % of hours the next-day forecast (12-36 h ahead, as published)
#                    was within 0.3 m of the buoy, miss: typical miss in m, n: hours scored}
# Each run's factors go to log/<Taipei date>.adj.jsonl so the score uses what the site actually showed.
# With a country code (tw, jp), only that country's spots are corrected, from that country's own log folder.
# Usage: python3 -I correct.py <snap.json> <logdir> [country]
import sys, os, json, gzip, glob, datetime
snap, logdir = sys.argv[1], sys.argv[2]
d = json.load(open(snap))
WINDOW, FULL, LO, HI = 21, 14, 0.6, 1.4
WLO, WHI, WMIN = 0.6, 1.2, 0.3
BANDS = ((7, '<7'), (9, '7-9'), (11, '9-11'), (99, '11+'))
band = lambda p: next(b for top, b in BANDS if p < top) if p is not None else None
TPE = datetime.timezone(datetime.timedelta(hours=8))
now = datetime.datetime.now(TPE)
first = (now - datetime.timedelta(days=WINDOW)).strftime('%Y-%m-%d')
t8 = lambda s: datetime.datetime.fromisoformat(s.replace('Z', '+00:00')).astimezone(TPE) if s.endswith('Z') else datetime.datetime.fromisoformat(s).replace(tzinfo=TPE)
clamp = lambda x, lo, hi: max(lo, min(hi, x))

runs, adj = [], {}
for f in sorted(glob.glob(os.path.join(logdir, '20*.jsonl*'))):
    if os.path.basename(f)[:10] < first: continue
    op = gzip.open if f.endswith('.gz') else open
    try:
        with op(f, 'rt') as fh:
            for line in fh:
                try: r = json.loads(line)
                except ValueError: continue
                if f.endswith('.adj.jsonl'): adj[r['run']] = r
                else: runs.append(r)
    except (OSError, EOFError): pass  # a cut-off gzip still gave its earlier lines

obs, stn = {}, {}  # spot -> {Taipei hour: buoy height / station kt}
for r in runs:
    for k, s in r['spots'].items():
        for b in s.get('buoy') or []:
            if b and b[1] is not None: obs.setdefault(k, {})[b[0][:16]] = b[1]
        for w in s.get('station') or []:
            if w and w[1] is not None: stn.setdefault(k, {})[w[0][:16]] = w[1]

def shown(run, k, p):
    """The height factor the site applied for this spot and period in that run (older runs logged one factor per spot)."""
    a = adj.get(run) or {}
    return ((a.get('bands') or {}).get(k) or {}).get(band(p)) or (a.get('adj') or {}).get(k, 1)

out, outb, outw = {}, {}, {}
COUNTRY = sys.argv[3] if len(sys.argv) > 3 else None
for k, sp in d['spots'].items():
    if COUNTRY and sp.get('country', 'tw') != COUNTRY: continue
    O = obs.get(k, {}); W = stn.get(k, {}); so = sf = 0; hits = n = miss = 0
    B = {}  # band -> [buoy sum, forecast sum, set of days]
    wo, wf, wdays = 0, 0, set()
    for r in runs:
        s = r['spots'].get(k)
        if not s: continue
        rt = t8(r['run'])
        for row in s.get('fc') or []:
            if row[1] is None or row[0][:16] not in O: continue
            lead = (t8(row[0]) - rt).total_seconds() / 3600
            o = O[row[0][:16]]
            if 1 <= lead <= 72:
                so += o; sf += row[1]
                if band(row[2]):
                    x = B.setdefault(band(row[2]), [0, 0, set()]); x[0] += o; x[1] += row[1]; x[2].add(row[0][:10])
            if 12 <= lead <= 36:
                e = abs(row[1] * shown(r['run'], k, row[2]) - o); n += 1; miss += e; hits += e <= 0.3
        for row in s.get('windfc') or []:
            if row[1] is None or row[0][:16] not in W: continue
            if 0 <= (t8(row[0]) - rt).total_seconds() / 3600 <= 36:
                wo += W[row[0][:16]]; wf += row[1]; wdays.add(row[0][:10])
    days = len({t[:10] for t in O})
    f, bands = 1.0, {}
    if sf > 0 and days >= 2:
        f = clamp(1 + (so / sf - 1) * min(1, days / FULL), LO, HI)
        for b, (bo, bf, bd) in B.items():
            if bf > 0 and len(bd) >= 2:
                bands[b] = round(clamp(f * (1 + ((bo / bf) / (so / sf) - 1) * min(1, len(bd) / FULL)), LO, HI), 2)
    f = round(f, 2)
    fb = lambda p: bands.get(band(p), f)
    wr = wo / wf if wf > 0 else None
    w = round(clamp(1 + (wr - 1) * min(1, len(wdays) / FULL), WLO, WHI), 2) if wr is not None and wr >= WMIN and len(wdays) >= 2 else 1.0
    for row in (sp.get('hourly') or []) + ((sp.get('hist') or {}).get('wave') or []):
        for i in (1, 4, 7):
            if row[i] is not None: row[i] = round(row[i] * fb(row[2]), 1)
    # Secondary swell carries its own period, so it takes that period's factor.
    for row in (sp.get('swell2') or []) + ((sp.get('hist') or {}).get('swell2') or []):
        if row[1] is not None: row[1] = round(row[1] * fb(row[2] if len(row) > 2 else None), 2)
    if w != 1:
        for row in sp.get('wind') or []:
            if row[1] is not None: row[1] = round(row[1] * w, 1)
    sp['adj'] = {'f': f, 'bands': bands, 'wf': w, 'wdays': len(wdays), 'days': days,
                 'acc': round(100 * hits / n) if n else None, 'miss': round(miss / n, 2) if n else None, 'n': n}
    out[k], outb[k], outw[k] = f, bands, w

os.makedirs(logdir, exist_ok=True)
with open(os.path.join(logdir, now.strftime('%Y-%m-%d') + '.adj.jsonl'), 'a') as fh:
    fh.write(json.dumps({'run': d['updated'], 'adj': out, 'bands': outb, 'wind': outw}, separators=(',', ':')) + '\n')
json.dump(d, open(snap, 'w'), ensure_ascii=False, separators=(',', ':'))
print('corrections:', {k: (v['adj']['f'], v['adj']['bands'], v['adj']['wf'], v['adj']['days'], v['adj']['acc']) for k, v in d['spots'].items() if k in out}, file=sys.stderr)
