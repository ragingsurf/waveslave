#!/bin/sh
# Rebuild WaveSlave for every spot in spots.json straight from the original sources (CWA open data + Open-Meteo).
# Usage: sh refresh.sh <workdir>   -> writes <workdir>/taitung-surf.html
set -e
HERE=$(cd "$(dirname "$0")" && pwd); W=${1:-/tmp/surf}; mkdir -p "$W/dl"; rm -f "$W/dl"/*.json
# CWA key: the CWA_KEY environment variable (a GitHub Actions secret), else cwa_key.txt when run by hand.
K=${CWA_KEY:-$(tr -d ' \n\r' < "$HERE/cwa_key.txt")}
[ -n "$K" ] || { echo "no CWA key" >&2; exit 1; }
A="https://opendata.cwa.gov.tw/api/v1/rest/datastore"
TODAY=$(TZ=Asia/Taipei date +%Y-%m-%d); END=$(TZ=Asia/Taipei date -d '+10 days' +%Y-%m-%d)
# Comma-joined id lists from spots.json (url-encoded where needed).
ids(){ python3 -I -c "import json,sys,urllib.parse as u;S=json.load(open(sys.argv[1]));f=sys.argv[2];v=[]
for s in S:
  for x in (s[f] if isinstance(s[f],list) else [s[f]]):
    if f in ('lat','lon') or x not in v: v.append(x)
print(','.join(u.quote(str(x),safe='') for x in v))" "$HERE/spots.json" "$1"; }
get(){ curl -fsSL --retry 3 --retry-all-errors --retry-delay 5 -m 120 -o "$W/dl/$1.json" "$2"; }
# Coastal forecast for all townships (wind, sky). Only served as a file, ~6 MB.
get coastal "https://opendata.cwa.gov.tw/fileapi/v1/opendataapi/F-D0047-095?Authorization=$K&downloadType=WEB&format=JSON"
get tide "$A/F-A0021-001?Authorization=$K&LocationId=$(ids tide)&timeFrom=${TODAY}T00:00:00"
get sun "$A/A-B0062-001?Authorization=$K&CountyName=$(ids county)&timeFrom=$TODAY&timeTo=$END"
get buoy "$A/O-B0075-001?Authorization=$K&StationID=$(ids buoy)"
get obs "$A/O-A0001-001?Authorization=$K&StationId=$(ids station)"
get typhoon "$A/W-C0034-005?Authorization=$K"
get openwave "https://marine-api.open-meteo.com/v1/marine?latitude=$(ids lat)&longitude=$(ids lon)&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,wind_wave_height,wind_wave_period,secondary_swell_wave_height,secondary_swell_wave_period,secondary_swell_wave_direction&models=meteofrance_wave&timezone=Asia%2FTaipei&forecast_days=10"
# Air temperature and gusts for the forecast table (optional: the build carries on without them).
get openwx "https://api.open-meteo.com/v1/forecast?latitude=$(ids lat)&longitude=$(ids lon)&hourly=temperature_2m,wind_gusts_10m,precipitation,wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&timezone=Asia%2FTaipei&forecast_days=10" || echo "openwx fetch failed" >&2
python3 -I "$HERE/snap.py" "$W/dl" "$W/snap.json" "$HERE/spots.json"
python3 -I "$HERE/wx.py" "$W/dl/openwx.json" "$W/snap.json"
# Extra sources (optional, never block the build): ECMWF/GFS/DWD wave models for comparison, JTWC typhoon warnings; more.py adds them plus
# CWA's coastal wave forecast, secondary swell and typhoon tracks to snap.json under new keys only.
get openmodels "https://marine-api.open-meteo.com/v1/marine?latitude=$(ids lat)&longitude=$(ids lon)&hourly=wave_height,wave_period,wave_direction&models=ecmwf_wam,ncep_gfswave016,dwd_gwam&timezone=Asia%2FTaipei&forecast_days=5" || echo "openmodels fetch failed" >&2
rm -f "$W/dl"/jtwc-*.txt
{ get jtwc "https://www.metoc.navy.mil/jtwc/rss/jtwc.rss" && for u in $(grep -o 'https://www.metoc.navy.mil/jtwc/products/wp[0-9]*web.txt' "$W/dl/jtwc.json" | sort -u); do
  curl -fsSL --retry 2 -m 60 -o "$W/dl/jtwc-$(basename "$u" web.txt).txt" "$u" || true; done; } || echo "jtwc fetch failed" >&2
python3 -I "$HERE/more.py" "$W/dl" "$W/snap.json" "$HERE/spots.json" || echo "extras skipped" >&2
# West Pacific wind + wave grid for the Map tab (3-hourly model, so refetched only every ~3 h; a failed fetch keeps the last grid).
G="$HERE/cache"; mkdir -p "$G"
if [ -z "$(find "$G/grid.json" -mmin -170 2>/dev/null)" ]; then
  GLA=$(python3 -I -c "print(','.join(str(a) for a in range(0,46,3) for o in range(100,161,3)))")
  GLO=$(python3 -I -c "print(','.join(str(o) for a in range(0,46,3) for o in range(100,161,3)))")
  { curl -fsSL --retry 3 --retry-all-errors --retry-delay 5 -m 120 -o "$G/gwind.json" "https://api.open-meteo.com/v1/forecast?latitude=$GLA&longitude=$GLO&hourly=wind_speed_10m,wind_direction_10m,pressure_msl,precipitation&wind_speed_unit=kn&timezone=Asia%2FTaipei&forecast_days=10&temporal_resolution=hourly_3" &&
    curl -fsSL --retry 3 --retry-all-errors --retry-delay 5 -m 120 -o "$G/gwave.json" "https://marine-api.open-meteo.com/v1/marine?latitude=$GLA&longitude=$GLO&hourly=wave_height,wave_direction,swell_wave_height,swell_wave_direction,swell_wave_period&models=meteofrance_wave&timezone=Asia%2FTaipei&forecast_days=10&temporal_resolution=hourly_3" &&
    python3 -I "$HERE/grid.py" "$G/gwind.json" "$G/gwave.json" "$G/grid.new" 0 3 16 100 3 21 && mv "$G/grid.new" "$G/grid.json"; } || echo "grid fetch failed, keeping last grid" >&2
fi
GJ="$G/grid.json"; [ -f "$GJ" ] || { echo null > "$W/gridnull.json"; GJ="$W/gridnull.json"; }
# Forecast vs buoy log for later corrections; never blocks the build.
python3 -I "$HERE/log.py" "$W/snap.json" "$HERE/log" || true
# Wave of the week photo (wotw.jpg) is embedded inline.
python3 -I -c "import sys,base64;t=open(sys.argv[1]).read();d=open(sys.argv[2]).read();img='data:image/jpeg;base64,'+base64.b64encode(open(sys.argv[4],'rb').read()).decode();open(sys.argv[3],'w').write(t.replace('__DATA__',d).replace('__WOTW__',img).replace('__GRID__',open(sys.argv[5]).read()))" "$HERE/template.html" "$W/snap.json" "$W/taitung-surf.html" "$HERE/wotw.jpg" "$GJ"
echo "built $W/taitung-surf.html"
