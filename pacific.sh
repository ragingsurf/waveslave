#!/bin/sh
# Fetch the Pacific wind + wave grid for the Map tab (Open-Meteo, 50°S–65°N, 100°E–110°W, 5° apart, 6-hourly) and pack it with grid.py.
# Each API is asked in two chunks of rows (372 points each, close to the West Pacific grid's 336); any failure exits non-zero and keeps the last grid.
# Usage: sh pacific.sh <cachedir>   -> writes <cachedir>/grid-pac.json
set -e
HERE=$(cd "$(dirname "$0")" && pwd); G=${1:?usage: sh pacific.sh <cachedir>}; T="$G/pac.tmp"
trap 'rm -rf "$T"' EXIT; rm -rf "$T"; mkdir -p "$T"
# The West Pacific grid's two requests (refresh.sh), for rows 0–11 and then rows 12–23; grid.py coords writes longitudes past 180 as negative, which Open-Meteo requires.
n=0
for r in "0 12" "12 24"; do
  python3 -I "$HERE/grid.py" coords -50 5 24 100 5 31 $r > "$T/ll"; { read -r LA; read -r LO; } < "$T/ll"
  curl -fsSL --retry 3 --retry-max-time 180 --retry-all-errors --retry-delay 5 -m 120 -o "$T/w$n.json" "https://api.open-meteo.com/v1/forecast?latitude=$LA&longitude=$LO&hourly=wind_speed_10m,wind_direction_10m,pressure_msl,precipitation&wind_speed_unit=kn&timezone=Asia%2FTaipei&forecast_days=10&temporal_resolution=hourly_3"
  curl -fsSL --retry 3 --retry-max-time 180 --retry-all-errors --retry-delay 5 -m 120 -o "$T/v$n.json" "https://marine-api.open-meteo.com/v1/marine?latitude=$LA&longitude=$LO&hourly=wave_height,wave_direction,swell_wave_height,swell_wave_direction,swell_wave_period&models=meteofrance_wave&timezone=Asia%2FTaipei&forecast_days=10&temporal_resolution=hourly_3"
  n=$((n+1))
done
# Join the chunks, keep every second 3-hourly step (dt 6), and swap the finished file in last.
python3 -I "$HERE/grid.py" "$T/w0.json,$T/w1.json" "$T/v0.json,$T/v1.json" "$T/grid.json" -50 5 24 100 5 31 2
mv "$T/grid.json" "$G/grid-pac.json"
