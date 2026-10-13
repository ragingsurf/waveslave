# Forecast-vs-observation log for learning per-spot corrections later.
# Appends one record per new snapshot to log/YYYY-MM-DD.jsonl.gz (Taipei date): every spot's
# Open-Meteo hourly forecast and CWA wind forecast as issued, plus the latest buoy and station readings.
# fc stays the first 5 days (120 hours) as it was when logging started, even though the app now shows 7.
# Usage: python3 -I log.py <snap.json> <logdir>
import sys, json, gzip, os, datetime
snap, logdir = sys.argv[1], sys.argv[2]
d = json.load(open(snap))
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
