# Forecast-vs-observation log: correct.py learns per-spot corrections from it, and logstore.sh keeps it for good.
# Appends one record per new snapshot to log/YYYY-MM-DD.jsonl.gz (Taipei date): every spot's
# Open-Meteo hourly forecast and CWA wind forecast as issued, plus the latest buoy and station readings.
# fc stays the first 5 days (120 hours) as it was when logging started, even though the app now shows 7.
# With a country code (tw, jp), only that country's spots are logged, so each country keeps its own log folder.
# Usage: python3 -I log.py <snap.json> <logdir> [country]
import sys, json, gzip, os, datetime
snap, logdir = sys.argv[1], sys.argv[2]
d = json.load(open(snap))
if len(sys.argv) > 3:
    keep = {k for k, s in d['spots'].items() if s.get('country', 'tw') == sys.argv[3]}
    d['spots'] = {k: s for k, s in d['spots'].items() if k in keep}
    d['src'] = dict(d['src'], spots={k: v for k, v in d['src'].get('spots', {}).items() if k in keep})
os.makedirs(logdir, exist_ok=True)
key = json.dumps(d['src'], sort_keys=True)
last = os.path.join(logdir, '.last')
if os.path.exists(last) and open(last).read() == key:
    sys.exit(0)
rec = {'run': d['updated'], 'src': d['src'], 'spots': {
    k: {'buoyId': s.get('buoyId'), 'fc': (s.get('hourly') or [])[:120], 'windfc': s.get('wind'),
        'buoy': (s.get('buoy') or [])[-3:], 'station': s.get('dwind')}
    for k, s in d['spots'].items()}}
day = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)).strftime('%Y-%m-%d')
with gzip.open(os.path.join(logdir, day + '.jsonl.gz'), 'at') as f:
    f.write(json.dumps(rec, separators=(',', ':')) + '\n')
open(last, 'w').write(key)
