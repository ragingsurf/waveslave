# Add Open-Meteo air temperature, wind gusts, rain (mm in the hour) and wind speed (kt) and direction to each spot in snap.json (for the Map tab's forecast table).
# Usage: python3 -I wx.py <openwx.json> <snap.json>   (openwx.json is a multi-location reply in spots.json order)
import sys, json, datetime
wx, snap = sys.argv[1], sys.argv[2]
d = json.load(open(snap))
TODAY = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)).strftime('%Y-%m-%d')
try:
    rows = json.load(open(wx))
    rows = rows if isinstance(rows, list) else [rows]
    for sid, r in zip(d['order'], rows):
        h = r['hourly']
        hrs = [list(r) for r in zip(h['time'], h['temperature_2m'], h['wind_gusts_10m'], h.get('precipitation') or [None]*len(h['time']), h.get('wind_speed_10m') or [None]*len(h['time']), h.get('wind_direction_10m') or [None]*len(h['time']))]
        # The past 5 days (past_days=5) go under hist.wx; wx still starts today for the Map tab.
        d['spots'][sid]['wx'] = [x for x in hrs if x[0][:10] >= TODAY]
        d['spots'][sid].setdefault('hist', {})['wx'] = [x for x in hrs if x[0][:10] < TODAY]
except Exception as e:
    print('wx skipped:', e, file=sys.stderr)
json.dump(d, open(snap, 'w'), ensure_ascii=False, separators=(',', ':'))
