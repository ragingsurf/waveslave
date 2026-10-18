#!/bin/sh
# Rebuild WaveSlave for every spot in spots.json straight from the original sources (CWA open data + Open-Meteo).
# Usage: sh refresh.sh <workdir>   -> writes <workdir>/taitung-surf.html
set -e
HERE=$(cd "$(dirname "$0")" && pwd); W=${1:-/tmp/surf}; mkdir -p "$W/dl"; rm -f "$W/dl"/*.json
# CWA key: the CWA_KEY environment variable (a GitHub Actions secret), else cwa_key.txt when run by hand.
K=${CWA_KEY:-$(tr -d ' \n\r' < "$HERE/cwa_key.txt")}
[ -n "$K" ] || { echo "no CWA key" >&2; exit 1; }
A="https://opendata.cwa.gov.tw/api/v1/rest/datastore"
TODAY=$(TZ=Asia/Taipei date +%Y-%m-%d); PAST=$(TZ=Asia/Taipei date -d '-5 days' +%Y-%m-%d); END=$(TZ=Asia/Taipei date -d '+10 days' +%Y-%m-%d)
# Comma-joined id lists from spots.json (url-encoded where needed). CWA fields list Taiwan spots only; lat/lon list every spot.
ids(){ python3 -I -c "import json,sys,urllib.parse as u;S=json.load(open(sys.argv[1]));f=sys.argv[2];v=[]
for s in S:
  if f not in ('lat','lon') and s.get('country','tw')!='tw': continue
  for x in (s[f] if isinstance(s[f],list) else [s[f]]):
    if f in ('lat','lon') or x not in v: v.append(x)
print(','.join(u.quote(str(x),safe='') for x in v))" "$HERE/spots.json" "$1"; }
get(){ curl -fsSL --retry 3 --retry-all-errors --retry-delay 5 -m 120 -o "$W/dl/$1.json" "$2"; }
# Coastal forecast for all townships (wind, sky). Only served as a file, ~6 MB.
get coastal "https://opendata.cwa.gov.tw/fileapi/v1/opendataapi/F-D0047-095?Authorization=$K&downloadType=WEB&format=JSON"
get tide "$A/F-A0021-001?Authorization=$K&LocationId=$(ids tide)&timeFrom=${TODAY}T00:00:00"
get sun "$A/A-B0062-001?Authorization=$K&CountyName=$(ids county)&timeFrom=$PAST&timeTo=$END"
get buoy "$A/O-B0075-001?Authorization=$K&StationID=$(ids buoy)"
get obs "$A/O-A0001-001?Authorization=$K&StationId=$(ids station)"
get typhoon "$A/W-C0034-005?Authorization=$K"
get openwave "https://marine-api.open-meteo.com/v1/marine?latitude=$(ids lat)&longitude=$(ids lon)&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,wind_wave_height,wind_wave_period,secondary_swell_wave_height,secondary_swell_wave_period,secondary_swell_wave_direction&models=meteofrance_wave&timezone=Asia%2FTaipei&forecast_days=10&past_days=5"
# Air temperature and gusts for the forecast table (optional: the build carries on without them).
get openwx "https://api.open-meteo.com/v1/forecast?latitude=$(ids lat)&longitude=$(ids lon)&hourly=temperature_2m,wind_gusts_10m,precipitation,wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&timezone=Asia%2FTaipei&forecast_days=10&past_days=5" || echo "openwx fetch failed" >&2
python3 -I "$HERE/snap.py" "$W/dl" "$W/snap.json" "$HERE/spots.json"
python3 -I "$HERE/wx.py" "$W/dl/openwx.json" "$W/snap.json"
# Extra sources (optional, never block the build): ECMWF/GFS/DWD wave models for comparison, JTWC typhoon warnings; more.py adds them plus
# CWA's coastal wave forecast, secondary swell and typhoon tracks to snap.json under new keys only.
get openmodels "https://marine-api.open-meteo.com/v1/marine?latitude=$(ids lat)&longitude=$(ids lon)&hourly=wave_height,wave_period,wave_direction&models=ecmwf_wam,ncep_gfswave016,dwd_gwam&timezone=Asia%2FTaipei&forecast_days=5" || echo "openmodels fetch failed" >&2
rm -f "$W/dl"/jtwc-*.txt
{ get jtwc "https://www.metoc.navy.mil/jtwc/rss/jtwc.rss" && for u in $(grep -o 'https://www.metoc.navy.mil/jtwc/products/wp[0-9]*web.txt' "$W/dl/jtwc.json" | sort -u); do
  curl -fsSL --retry 2 -m 60 -o "$W/dl/jtwc-$(basename "$u" web.txt).txt" "$u" || true; done; } || echo "jtwc fetch failed" >&2
python3 -I "$HERE/more.py" "$W/dl" "$W/snap.json" "$HERE/spots.json" || echo "extras skipped" >&2
# Japan spots (optional, never block the build): NOWPHAS wave gauges, JMA AMeDAS wind, JMA forecasters' wave heights, JMA MSM wind
# via Open-Meteo, JMA tide tables (one file per point and year, kept in cache/); jp.py writes them under the same keys as CWA's.
jpids(){ python3 -I -c "import json,sys;S=[s for s in json.load(open(sys.argv[1])) if s.get('country')=='jp'];f=sys.argv[2]
v=[str(s[f]) if f in ('lat','lon') else s[f][0] if f=='jmaArea' else s[f] for s in S]
print(','.join(v if f in ('lat','lon') else dict.fromkeys(v)))" "$HERE/spots.json" "$1"; }
G="$HERE/cache"; mkdir -p "$G"
if [ -n "$(jpids lat)" ]; then
  rm -f "$W/dl/nowphas.xml" "$W/dl/amedas_time.txt"
  get nowphas "https://nowphas.mlit.go.jp/mapxml/$(date +%s)" && mv "$W/dl/nowphas.json" "$W/dl/nowphas.xml" || echo "nowphas fetch failed" >&2
  { curl -fsSL --retry 2 -m 30 -o "$W/dl/amedas_time.txt" "https://www.jma.go.jp/bosai/amedas/data/latest_time.txt" &&
    get amedas "https://www.jma.go.jp/bosai/amedas/data/map/$(TZ=Asia/Tokyo date -d "$(cat "$W/dl/amedas_time.txt")" +%Y%m%d%H%M%S).json"; } || echo "amedas fetch failed" >&2
  for o in $(jpids jmaArea | tr ',' ' '); do get "jmafc-$o" "https://www.jma.go.jp/bosai/forecast/data/forecast/$o.json" || echo "jma forecast $o fetch failed" >&2; done
  JQ="latitude=$(jpids lat)&longitude=$(jpids lon)&hourly=wind_speed_10m,wind_direction_10m,precipitation&wind_speed_unit=kn&timezone=Asia%2FTaipei&forecast_days=4"
  get openjma "https://api.open-meteo.com/v1/forecast?$JQ&models=jma_msm" || get openjma "https://api.open-meteo.com/v1/forecast?$JQ&models=jma_seamless" || echo "openjma fetch failed" >&2
  for y in $(TZ=Asia/Taipei date +%Y) $(TZ=Asia/Taipei date -d '+10 days' +%Y); do for p in $(jpids tidePoint | tr ',' ' '); do
    [ -s "$G/jp-tide-$p-$y.txt" ] || curl -fsSL --retry 2 -m 60 -o "$G/jp-tide-$p-$y.txt" "https://www.data.jma.go.jp/kaiyou/data/db/tide/suisan/txt/$y/$p.txt" || { rm -f "$G/jp-tide-$p-$y.txt"; echo "tide $p $y fetch failed" >&2; }
  done; done
  python3 -I "$HERE/jp.py" "$W/dl" "$W/snap.json" "$HERE/spots.json" "$G" || echo "japan skipped" >&2
fi
# NOAA countries (optional, never block the build): California, Hawaii, then the Pacific Northwest. NOAA NDBC buoys (NDBC, CDIP and
# Environment Canada's), NDBC shore and NWS airport wind, NOAA tide predictions, NOAA HRRR/GFS wind via Open-Meteo, and in BC
# Environment Canada station wind and Canadian Hydrographic Service tides; ca.py writes them under the same keys as CWA's.
# noaaids <country> <field>: a spot's windStation may be one "ndbc:ID"/"nws:ID"/"eccc:ID" or a list tried in order; its tideStation
# is a NOAA id or "chs:<code>" (field tideStation lists the NOAA ones, chs the CHS codes).
noaaids(){ python3 -I -c "import json,sys;S=[s for s in json.load(open(sys.argv[1])) if s.get('country')==sys.argv[2]];f=sys.argv[3]
W=[w for s in S for w in (lambda v: v if isinstance(v,list) else [v] if v else [])(s.get('windStation'))]
if f=='ndbc': v=[b for s in S for b in s['ndbc']]+[w[5:] for w in W if w.startswith('ndbc:')]
elif f in ('nws','eccc'): v=[w[len(f)+1:] for w in W if w.startswith(f+':')]
elif f in ('tideStation','chs'): v=[t[4:] if f=='chs' else t for t in (s['tideStation'] for s in S) if t.startswith('chs:')==(f=='chs')]
else: v=[str(s[f]) for s in S]
print(','.join(v if f in ('lat','lon') else dict.fromkeys(v)))" "$HERE/spots.json" "$1" "$2"; }
# midnight of a day relative to today on BC's clock, in UTC: mid '-5 days'
mid(){ date -u -d "TZ=\"America/Vancouver\" $(TZ=America/Vancouver date -d "$1" +%F) 00:00" +%FT%TZ; }
rm -f "$W/dl"/ndbc-*.txt "$W/dl"/nws-*.json "$W/dl"/eccc-*.json "$W/dl"/chs-*.json
for C in ca hi nw; do
  [ -n "$(noaaids $C lat)" ] || continue
  ZONE=America/Los_Angeles; [ $C = hi ] && ZONE=Pacific/Honolulu
  for b in $(noaaids $C ndbc | tr ',' ' '); do [ -s "$W/dl/ndbc-$b.txt" ] || curl -fsSL --retry 2 -m 60 -o "$W/dl/ndbc-$b.txt" "https://www.ndbc.noaa.gov/data/realtime2/$b.txt" || echo "ndbc $b fetch failed" >&2; done
  # the last few reports, since airport stations often leave the wind speed out of one
  for s in $(noaaids $C nws | tr ',' ' '); do curl -fsSL --retry 2 -m 60 -A "waveslave.tw" -o "$W/dl/nws-$s.json" "https://api.weather.gov/stations/$s/observations?limit=6" || echo "nws $s fetch failed" >&2; done
  # BC: Environment Canada station reports from the last 3 hours, newest first (ca.py skips a reading over 3 hours old). The Canadian
  # fetches get one quick retry each, so a slow server costs a run its reading, never half an hour.
  for s in $(noaaids $C eccc | tr ',' ' '); do curl -fsSL --retry 1 -m 30 -o "$W/dl/eccc-$s.json" "https://api.weather.gc.ca/collections/swob-realtime/items?f=json&msc_id-value=$s&datetime=$(date -u -d '-3 hours' +%FT%TZ)/$(date -u +%FT%TZ)&sortby=-date_tm-value&limit=6" || echo "eccc $s fetch failed" >&2; done
  # BC: Canadian Hydrographic Service highs and lows (UTC times) for the same 15 local days as NOAA's; the API takes the station's id, looked up by its code
  for c in $(noaaids $C chs | tr ',' ' '); do
    { id=$(curl -fsSL --retry 1 -m 30 "https://api-iwls.dfo-mpo.gc.ca/api/v1/stations?code=$c" | python3 -I -c "import json,sys;print(json.load(sys.stdin)[0]['id'])" 2>/dev/null) &&
      curl -fsSL --retry 1 -m 30 -o "$W/dl/chs-$c.json" "https://api-iwls.dfo-mpo.gc.ca/api/v1/stations/$id/data?time-series-code=wlp-hilo&from=$(mid '-5 days')&to=$(mid '+10 days')"; } || echo "chs $c fetch failed" >&2
  done
  for t in $(noaaids $C tideStation | tr ',' ' '); do get "tide-$t" "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&station=$t&begin_date=$(TZ=$ZONE date -d '-5 days' +%Y%m%d)&range=360&datum=MLLW&interval=hilo&units=metric&time_zone=lst_ldt&format=json&application=waveslave.tw" || echo "tide $t fetch failed" >&2; done
  CQ="latitude=$(noaaids $C lat)&longitude=$(noaaids $C lon)&hourly=wind_speed_10m,wind_direction_10m,precipitation&wind_speed_unit=kn&timezone=Asia%2FTaipei&forecast_days=4"
  # gfs_seamless is HRRR for the first ~2 days in California and the Pacific Northwest, then GFS, so the wind covers all 4 days; Hawaii gets GFS throughout.
  get open$C "https://api.open-meteo.com/v1/forecast?$CQ&models=gfs_seamless" || get open$C "https://api.open-meteo.com/v1/forecast?$CQ" || echo "open$C fetch failed" >&2
  python3 -I "$HERE/ca.py" "$W/dl" "$W/snap.json" "$HERE/spots.json" $C || echo "$C skipped" >&2
done
# Australian spots (optional, never block the build): IMOS/AODN real-time wave buoys (one request per buoy, newest readings
# first), Bureau of Meteorology station wind, Open-Meteo wind forecast and tide model; au.py writes them under the same keys.
auids(){ python3 -I -c "import json,sys;S=[s for s in json.load(open(sys.argv[1])) if s.get('country')=='au'];f=sys.argv[2]
v=[b for s in S for b in s['aodn']] if f=='aodn' else [str(s[f]) for s in S]
print('|'.join(v if f in ('lat','lon') else dict.fromkeys(v)))" "$HERE/spots.json" "$1"; }
if [ -n "$(auids lat)" ]; then
  rm -f "$W/dl"/aodn-*.csv "$W/dl"/bom-*.json
  OLDIFS=$IFS; IFS='|'
  for b in $(auids aodn); do curl -fsSL --retry 2 -m 60 -G -o "$W/dl/aodn-$(echo "$b" | tr ' ' _).csv" "https://geoserver-123.aodn.org.au/geoserver/ows" --data-urlencode "service=WFS" --data-urlencode "version=1.1.0" --data-urlencode "request=GetFeature" --data-urlencode "typeName=aodn:aodn_wave_nrt_v2_timeseries_data" --data-urlencode "outputFormat=csv" --data-urlencode "maxFeatures=48" --data-urlencode "sortBy=TIME D" --data-urlencode "CQL_FILTER=site_name='$b'" || echo "aodn $b fetch failed" >&2; done
  for s in $(auids bomStation); do curl -fsSL --retry 2 -m 60 -A "waveslave.tw" -o "$W/dl/bom-$s.json" "https://www.bom.gov.au/fwo/${s%%.*}/$s.json" || echo "bom $s fetch failed" >&2; done
  IFS=$OLDIFS
  AQ="latitude=$(auids lat | tr '|' ,)&longitude=$(auids lon | tr '|' ,)"
  # Open-Meteo's BoM ACCESS feed returns no data, so the wind forecast is its default blend.
  get openau "https://api.open-meteo.com/v1/forecast?$AQ&hourly=wind_speed_10m,wind_direction_10m,precipitation&wind_speed_unit=kn&timezone=Asia%2FTaipei&forecast_days=4" || echo "openau fetch failed" >&2
  get tideau "https://marine-api.open-meteo.com/v1/marine?$AQ&hourly=sea_level_height_msl&timezone=GMT&past_days=5&forecast_days=10" || echo "tideau fetch failed" >&2
  python3 -I "$HERE/au.py" "$W/dl" "$W/snap.json" "$HERE/spots.json" || echo "australia skipped" >&2
fi
# Korean and Philippine spots (optional, never block the build): airport reports (METAR) from NOAA's Aviation Weather Center, the
# last 3 hours, where a spot has an airport near enough (none does in the Philippines); a wind forecast and the tide model via
# Open-Meteo, as for Japan and Australia; kr.py writes them under the same keys. No buoys: the Korea Meteorological
# Administration's buoy feed needs a key, and the Philippines has no open one. The wind forecast is JMA's MSM for Korea, as for
# Japan, and ECMWF's IFS for the Philippines, south of the MSM's area (Open-Meteo's default, the fallback, is ECMWF there too).
# krids <country> <field>: the spots' lat or lon, or metar for their airports (a spot's windStation may be one "metar:ICAO" or a list).
krids(){ python3 -I -c "import json,sys;S=[s for s in json.load(open(sys.argv[1])) if s.get('country')==sys.argv[2]];f=sys.argv[3]
W=[w for s in S for w in (lambda v: v if isinstance(v,list) else [v] if v else [])(s.get('windStation'))]
v=[w[6:] for w in W if w.startswith('metar:')] if f=='metar' else [str(s[f]) for s in S]
print(','.join(v if f in ('lat','lon') else dict.fromkeys(v)))" "$HERE/spots.json" "$1" "$2"; }
for C in kr ph; do
  [ -n "$(krids $C lat)" ] || continue
  M=jma_msm M2=jma_seamless; [ $C = ph ] && M=ecmwf_ifs M2=best_match
  [ -z "$(krids $C metar)" ] || curl -fsSL --retry 2 -m 60 -A "waveslave.tw" -o "$W/dl/metar-$C.json" "https://aviationweather.gov/api/data/metar?ids=$(krids $C metar)&format=json&hours=3" || echo "metar $C fetch failed" >&2
  KQ="latitude=$(krids $C lat)&longitude=$(krids $C lon)"
  get open$C "https://api.open-meteo.com/v1/forecast?$KQ&hourly=wind_speed_10m,wind_direction_10m,precipitation&wind_speed_unit=kn&timezone=Asia%2FTaipei&forecast_days=4&models=$M" ||
    get open$C "https://api.open-meteo.com/v1/forecast?$KQ&hourly=wind_speed_10m,wind_direction_10m,precipitation&wind_speed_unit=kn&timezone=Asia%2FTaipei&forecast_days=4&models=$M2" || echo "open$C fetch failed" >&2
  get tide$C "https://marine-api.open-meteo.com/v1/marine?$KQ&hourly=sea_level_height_msl&timezone=GMT&past_days=5&forecast_days=10" || echo "tide$C fetch failed" >&2
  python3 -I "$HERE/kr.py" "$W/dl" "$W/snap.json" "$HERE/spots.json" $C || echo "$C skipped" >&2
done
WPNEW=
# West Pacific wind + wave grid for the Map tab (3-hourly model, so refetched only every ~3 h; a failed fetch keeps the last grid).
if [ -z "$(find "$G/grid.json" -mmin -170 2>/dev/null)" ]; then
  GLA=$(python3 -I -c "print(','.join(str(a) for a in range(0,46,3) for o in range(100,161,3)))")
  GLO=$(python3 -I -c "print(','.join(str(o) for a in range(0,46,3) for o in range(100,161,3)))")
  { curl -fsSL --retry 3 --retry-all-errors --retry-delay 5 -m 120 -o "$G/gwind.json" "https://api.open-meteo.com/v1/forecast?latitude=$GLA&longitude=$GLO&hourly=wind_speed_10m,wind_direction_10m,pressure_msl,precipitation&wind_speed_unit=kn&timezone=Asia%2FTaipei&forecast_days=10&temporal_resolution=hourly_3" &&
    curl -fsSL --retry 3 --retry-all-errors --retry-delay 5 -m 120 -o "$G/gwave.json" "https://marine-api.open-meteo.com/v1/marine?latitude=$GLA&longitude=$GLO&hourly=wave_height,wave_direction,swell_wave_height,swell_wave_direction,swell_wave_period&models=meteofrance_wave&timezone=Asia%2FTaipei&forecast_days=10&temporal_resolution=hourly_3" &&
    python3 -I "$HERE/grid.py" "$G/gwind.json" "$G/gwave.json" "$G/grid.new" 0 3 16 100 3 21 && mv "$G/grid.new" "$G/grid.json" && WPNEW=1; } || echo "grid fetch failed, keeping last grid" >&2
fi
# Wind + wave grids for the other map regions, the same way; only when the country has spots. regrid <country> <minutes> <grid>.
# California 1° apart (30–42°N, 128–116°W); Hawaii 1° apart (15–26°N, 162–152°W), wide enough to frame the whole chain on a phone;
# the Pacific Northwest 1° apart (41–51°N, 129–122°W);
# Australia 2° apart (44–20°S, 110–156°E), refetched only every ~6 h to keep Open-Meteo calls down.
regrid(){ C=$1; AGE=$2; shift 2
  [ -n "$(python3 -I -c "import json,sys;print(any(s.get('country')==sys.argv[2] for s in json.load(open(sys.argv[1]))) or '')" "$HERE/spots.json" $C)" ] && [ -z "$(find "$G/grid-$C.json" -mmin -$AGE 2>/dev/null)" ] || return 0
  LA=$(python3 -I -c "import sys;a0,da,na,o0,do,no=map(float,sys.argv[1:]);print(','.join(str(round(a0+i*da,2)) for i in range(int(na)) for j in range(int(no))))" "$@") || return 0
  LO=$(python3 -I -c "import sys;a0,da,na,o0,do,no=map(float,sys.argv[1:]);print(','.join(str(round(o0+j*do,2)) for i in range(int(na)) for j in range(int(no))))" "$@") || return 0
  { curl -fsSL --retry 3 --retry-all-errors --retry-delay 5 -m 120 -o "$G/gwind-$C.json" "https://api.open-meteo.com/v1/forecast?latitude=$LA&longitude=$LO&hourly=wind_speed_10m,wind_direction_10m,pressure_msl,precipitation&wind_speed_unit=kn&timezone=Asia%2FTaipei&forecast_days=10&temporal_resolution=hourly_3" &&
    curl -fsSL --retry 3 --retry-all-errors --retry-delay 5 -m 120 -o "$G/gwave-$C.json" "https://marine-api.open-meteo.com/v1/marine?latitude=$LA&longitude=$LO&hourly=wave_height,wave_direction,swell_wave_height,swell_wave_direction,swell_wave_period&models=meteofrance_wave&timezone=Asia%2FTaipei&forecast_days=10&temporal_resolution=hourly_3" &&
    python3 -I "$HERE/grid.py" "$G/gwind-$C.json" "$G/gwave-$C.json" "$G/grid-$C.new" "$@" && mv "$G/grid-$C.new" "$G/grid-$C.json"; } || echo "$C grid fetch failed, keeping last grid" >&2; }
regrid ca 170 30 1 13 -128 1 13
regrid hi 170 15 1 12 -162 1 11
regrid nw 170 41 1 11 -129 1 8
regrid au 350 -44 2 13 110 2 24
# The whole Pacific, 5° apart (50°S–60°N, 100°E–110°W), by pacific.sh: refetched only every ~6 h, and never in a run that refetched the West Pacific grid, so the two biggest requests don't land together.
[ -n "$WPNEW" ] || [ -n "$(find "$G/grid-pac.json" -mmin -350 2>/dev/null)" ] || sh "$HERE/pacific.sh" "$G" || echo "pacific grid fetch failed, keeping last grid" >&2
GJ="$G/grid.json"; [ -f "$GJ" ] || { echo null > "$W/gridnull.json"; GJ="$W/gridnull.json"; }
GC="$G/grid-ca.json"; [ -f "$GC" ] || { echo null > "$W/gridnull.json"; GC="$W/gridnull.json"; }
GH="$G/grid-hi.json"; [ -f "$GH" ] || { echo null > "$W/gridnull.json"; GH="$W/gridnull.json"; }
GN="$G/grid-nw.json"; [ -f "$GN" ] || { echo null > "$W/gridnull.json"; GN="$W/gridnull.json"; }
GA="$G/grid-au.json"; [ -f "$GA" ] || { echo null > "$W/gridnull.json"; GA="$W/gridnull.json"; }
GP="$G/grid-pac.json"; [ -f "$GP" ] || { echo null > "$W/gridnull.json"; GP="$W/gridnull.json"; }
# The last 5 days for the Forecast tab: buoy and wind station readings from the log, past tides kept in cache/; never blocks the build.
python3 -I "$HERE/history.py" "$W/snap.json" "$HERE/log" "$G" tw || echo "history skipped" >&2
python3 -I "$HERE/history.py" "$W/snap.json" "$HERE/log-jp" "$G" jp || echo "japan history skipped" >&2
python3 -I "$HERE/history.py" "$W/snap.json" "$HERE/log-ca" "$G" ca || echo "california history skipped" >&2
python3 -I "$HERE/history.py" "$W/snap.json" "$HERE/log-hi" "$G" hi || echo "hawaii history skipped" >&2
python3 -I "$HERE/history.py" "$W/snap.json" "$HERE/log-au" "$G" au || echo "australia history skipped" >&2
python3 -I "$HERE/history.py" "$W/snap.json" "$HERE/log-nw" "$G" nw || echo "pacific northwest history skipped" >&2
python3 -I "$HERE/history.py" "$W/snap.json" "$HERE/log-kr" "$G" kr || echo "korea history skipped" >&2
python3 -I "$HERE/history.py" "$W/snap.json" "$HERE/log-ph" "$G" ph || echo "philippines history skipped" >&2
# Forecast vs buoy log for later corrections, one folder per country (Taiwan log/, Japan log-jp/, California log-ca/, Hawaii log-hi/, Australia log-au/, Pacific Northwest log-nw/, Korea log-kr/, the Philippines log-ph/); never blocks the build.
python3 -I "$HERE/log.py" "$W/snap.json" "$HERE/log" tw || true
python3 -I "$HERE/log.py" "$W/snap.json" "$HERE/log-jp" jp || true
python3 -I "$HERE/log.py" "$W/snap.json" "$HERE/log-ca" ca || true
python3 -I "$HERE/log.py" "$W/snap.json" "$HERE/log-hi" hi || true
python3 -I "$HERE/log.py" "$W/snap.json" "$HERE/log-au" au || true
python3 -I "$HERE/log.py" "$W/snap.json" "$HERE/log-nw" nw || true
python3 -I "$HERE/log.py" "$W/snap.json" "$HERE/log-kr" kr || true
python3 -I "$HERE/log.py" "$W/snap.json" "$HERE/log-ph" ph || true
# Tune each spot's wave heights to its buoy from that log and score the forecast (after log.py, so the log stays raw).
python3 -I "$HERE/correct.py" "$W/snap.json" "$HERE/log" tw || echo "corrections skipped" >&2
python3 -I "$HERE/correct.py" "$W/snap.json" "$HERE/log-jp" jp || echo "japan corrections skipped" >&2
python3 -I "$HERE/correct.py" "$W/snap.json" "$HERE/log-ca" ca || echo "california corrections skipped" >&2
python3 -I "$HERE/correct.py" "$W/snap.json" "$HERE/log-hi" hi || echo "hawaii corrections skipped" >&2
python3 -I "$HERE/correct.py" "$W/snap.json" "$HERE/log-au" au || echo "australia corrections skipped" >&2
python3 -I "$HERE/correct.py" "$W/snap.json" "$HERE/log-nw" nw || echo "pacific northwest corrections skipped" >&2
python3 -I "$HERE/correct.py" "$W/snap.json" "$HERE/log-kr" kr || echo "korea corrections skipped" >&2
python3 -I "$HERE/correct.py" "$W/snap.json" "$HERE/log-ph" ph || echo "philippines corrections skipped" >&2
# Wave of the week photo (wotw.jpg) is embedded inline.
python3 -I -c "import sys,base64;t=open(sys.argv[1]).read();d=open(sys.argv[2]).read();img='data:image/jpeg;base64,'+base64.b64encode(open(sys.argv[4],'rb').read()).decode();open(sys.argv[3],'w').write(t.replace('__DATA__',d).replace('__WOTW__',img).replace('__GRIDCA__',open(sys.argv[6]).read()).replace('__GRIDHI__',open(sys.argv[7]).read()).replace('__GRIDAU__',open(sys.argv[8]).read()).replace('__GRIDPAC__',open(sys.argv[9]).read()).replace('__GRIDNW__',open(sys.argv[10]).read()).replace('__GRID__',open(sys.argv[5]).read()))" "$HERE/template.html" "$W/snap.json" "$W/taitung-surf.html" "$HERE/wotw.jpg" "$GJ" "$GC" "$GH" "$GA" "$GP" "$GN"
echo "built $W/taitung-surf.html"
