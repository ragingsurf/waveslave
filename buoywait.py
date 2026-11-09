# Says "wait" when the build should ask CWA for its buoy readings again, else "ok". Usage: python3 buoywait.py buoy.json
# CWA adds the HH:00 readings at about HH:30, so between :30 and :45 (Taiwan time) a build expects the newest reading of
# at least one buoy to be this hour's. Outside that window, or once any buoy has it, there is nothing to wait for. A single
# buoy that drops out (or Chenggong, which reports an hour later) doesn't hold the build: only all of them being behind does.
import datetime, json, sys

def num(v):
  try: return float(v)
  except (TypeError, ValueError): return 0.0

def verdict(doc, now):
  if not 30 <= now.minute < 45: return "ok"
  want = now.replace(minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:%M")
  newest = ""
  for loc in doc["Records"]["SeaSurfaceObs"]["Location"]:
    times = loc["StationObsTimes"]["StationObsTime"]
    for x in times if isinstance(times, list) else [times]:
      w = x.get("WeatherElements") or {}
      if num(w.get("WaveHeight")) > 0 and num(w.get("WavePeriod")) > 0:  # a reading snap.py would show
        newest = max(newest, x["DateTime"][:16])
  return "ok" if newest >= want else "wait"

if __name__ == "__main__":
  now = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)).replace(tzinfo=None)
  print(verdict(json.load(open(sys.argv[1])), now))
