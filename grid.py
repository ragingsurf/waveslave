# Pack the West Pacific wind and wave grid (Open-Meteo, 3-hourly) into a small JSON for the Map tab.
# Each time step and grid point is 4 bytes: wind kt, wind-from dir/2, wave height x10, wave-from dir/2 (255 = no data).
# Sea-level pressure, when present, goes in pb64: 1 byte per step and point, hPa - 900 (255 = no data).
# The same pressure at 0.05 hPa goes in pf64: 2 bytes (little-endian) per step and point, (hPa - 850) x 20 (65535 = no data).
# Whole-hPa values make flat tropical areas contour into boxy steps, so the map draws from pf64 when it's there.
# Rain, when present, goes in rb64: 1 byte per step and point, mm over the 3 hours x4 (255 = no data).
# Swell, when present, goes in sb64: 3 bytes per step and point: height x10, from dir/2, period (raw s) x10 (255 = no data).
# A big grid can be fetched in row chunks: give the wind files, and the wave files, as comma-joined lists and they are joined in order.
# [every] keeps every n-th step and writes dt to match, so 2 turns the 3-hourly steps into the Pacific layer's 6-hourly ones. The default, 1, keeps them all.
# Open-Meteo refuses longitudes outside -180 to 180, but the Pacific grid runs east past 180 (lon0 is written as given). So coords prints the
# latitudes, then on a second line the longitudes (185 as -175), comma-joined, of the points of rows row0 up to row1, to put in the request.
# Usage: python3 -I grid.py <wind.json[,more.json...]> <wave.json[,more.json...]> <out.json> <lat0> <dlat> <nlat> <lon0> <dlon> <nlon> [every]
#        python3 -I grid.py coords <lat0> <dlat> <nlat> <lon0> <dlon> <nlon> <row0> <row1>
import sys, json, base64


def b(v, scale=1, cap=254):
    return 255 if v is None else max(0, min(cap, round(v*scale)))


def load(files):
    # The chunks of one request, as comma-joined files, read as one list in order.
    pts = []
    for f in files.split(','):
        with open(f) as fh: pts += json.load(fh)
    return pts


def coords(lat0, dlat, nlat, lon0, dlon, nlon, rows=None):
    # The latitude and longitude of each point to request, as strings, row by row. rows is (first, end); all of them if left out.
    lat0, dlat, nlat, lon0, dlon, nlon = (float(x) for x in (lat0, dlat, nlat, lon0, dlon, nlon)); nlat, nlon = int(nlat), int(nlon)
    rows = range(*(rows or (0, nlat)))
    lons = [str(round(((lon0 + j*dlon + 180) % 360) - 180, 2)) for j in range(nlon)]
    return [str(round(lat0 + i*dlat, 2)) for i in rows for j in range(nlon)], lons*len(rows)


def pack(wind, wave, lat0, dlat, nlat, lon0, dlon, nlon, every=1):
    # wind and wave are the Open-Meteo answers for each point, row by row. The header values go into the result as given.
    assert len(wind) == len(wave) == nlat*nlon
    times = wind[0]['hourly']['time']
    # The wave model can end a few hours before the wind model: drop trailing steps with no wave data anywhere.
    while len(times) > 1 and all(v['hourly']['wave_height'][len(times)-1] is None for v in wave): times = times[:-1]
    steps = range(0, len(times), every)  # then keep every n-th of what is left
    out = bytearray()
    for k in steps:
        for w, v in zip(wind, wave):
            W, V = w['hourly'], v['hourly']
            out += bytes([b(W['wind_speed_10m'][k]), b(W['wind_direction_10m'][k], .5, 180),
                          b(V['wave_height'][k], 10), b(V['wave_direction'][k], .5, 180)])
    pres = bytearray()
    if all('pressure_msl' in w['hourly'] for w in wind):
        for k in steps:
            pres += bytes([b(w['hourly']['pressure_msl'][k] - 900 if w['hourly']['pressure_msl'][k] is not None else None) for w in wind])
    presf = bytearray()
    if pres:
        for k in steps:
            for w in wind:
                v = w['hourly']['pressure_msl'][k]
                presf += (65535 if v is None else max(0, min(65534, round((v - 850)*20)))).to_bytes(2, 'little')
    rain = bytearray()
    if all('precipitation' in w['hourly'] for w in wind):
        for k in steps:
            rain += bytes([b(w['hourly']['precipitation'][k], 4) for w in wind])
    swell = bytearray()
    if all('swell_wave_height' in v['hourly'] for v in wave):
        for k in steps:
            for v in wave:
                V = v['hourly']; swell += bytes([b(V['swell_wave_height'][k], 10), b(V['swell_wave_direction'][k], .5, 180), b(V['swell_wave_period'][k], 10)])
    return {'lat0': lat0, 'dlat': dlat, 'nlat': nlat, 'lon0': lon0, 'dlon': dlon, 'nlon': nlon,
            't0': times[0], 'dt': 3*every, 'nt': len(steps), 'b64': base64.b64encode(out).decode(), 'pb64': base64.b64encode(pres).decode(), 'pf64': base64.b64encode(presf).decode(), 'rb64': base64.b64encode(rain).decode(), 'sb64': base64.b64encode(swell).decode()}


if __name__ == '__main__':
    if sys.argv[1] == 'coords':
        lats, lons = coords(*sys.argv[2:8], rows=(int(sys.argv[8]), int(sys.argv[9])))
        print(','.join(lats)); print(','.join(lons))
    else:
        wind, wave = load(sys.argv[1]), load(sys.argv[2])
        lat0, dlat, nlat, lon0, dlon, nlon = (float(x) for x in sys.argv[4:10]); nlat, nlon = int(nlat), int(nlon)
        d = pack(wind, wave, lat0, dlat, nlat, lon0, dlon, nlon, int(sys.argv[10]) if len(sys.argv) > 10 else 1)
        with open(sys.argv[3], 'w') as f: json.dump(d, f, separators=(',', ':'))
