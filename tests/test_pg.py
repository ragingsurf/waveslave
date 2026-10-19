# Papua New Guinea's spots and pi.py's third island group (ECMWF wind from the sea cells and the tide model via Open-Meteo; no buoy, no
# airport report, no NOAA station).
# Run: python3 -m unittest discover -s tests -v
import os, sys, json, unittest, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
SPOTS = json.load(open(os.path.join(ROOT, 'spots.json')))
PG_IDS = ['lido', 'wewak', 'tupira', 'nusa', 'nago', 'ral', 'rubio']
KEYS = ['name', 'full', 'region', 'zone', 'ndbc', 'buoyKm', 'buoyName', 'windStation', 'stationName', 'tideStation', 'off', 'lat', 'lon', 'blurb', 'cams', 'zh', 'ja']
U = datetime.timezone.utc


class Spots(unittest.TestCase):
    def test_pg_spots_complete(self):
        pg = [s for s in SPOTS if s.get('country') == 'pg']
        self.assertEqual([s['id'] for s in pg], PG_IDS)  # west to east, Vanimo to New Ireland's east coast
        for s in pg:
            for k in KEYS: self.assertIn(k, s, s['id'] + ' ' + k)
            self.assertTrue(s['zh']['name'] and s['ja']['name'] and s['zh']['full'] and s['ja']['full'] and s['zh']['region'] and s['ja']['region'])
            self.assertNotIn('tz', s)
            self.assertEqual(s['zone'], 'Pacific/Port_Moresby')
            self.assertTrue(-4.6 < s['lat'] < -2.5 and 141 < s['lon'] < 152.3, s['id'])
            self.assertTrue(0 <= s['off'] < 360, s['id'])
            # no buoy, no airport or station that tracks a spot's wind and no NOAA tide station: every spot takes the tide model
            self.assertEqual((s['ndbc'], s['buoyKm'], s['buoyName'], s['zh']['buoyName'], s['ja']['buoyName']), ([], None, '', '', ''), s['id'])
            self.assertEqual((s['windStation'], s['stationName'], s['zh']['stationName'], s['ja']['stationName']), ([], '', '', ''), s['id'])
            self.assertIsNone(s['tideStation'], s['id'])
            self.assertEqual((s['cams'], s['zh']['cams'], s['ja']['cams']), ([], [], []), s['id'])
        self.assertEqual(len({s['id'] for s in SPOTS}), len(SPOTS))
        # last in spots.json, so the shared Open-Meteo calls, which list every spot in its order, keep each other spot's place
        self.assertEqual([s['id'] for s in SPOTS[-7:]], PG_IDS)

    def test_no_clock_changes(self):
        import au
        for at in (datetime.datetime(2026, 10, 19, tzinfo=U), datetime.datetime(2027, 1, 15, tzinfo=U), datetime.datetime(2027, 7, 1, tzinfo=U)):
            self.assertEqual(au.offset('Pacific/Port_Moresby', at), 10, at)


FIXDIR = os.path.join(HERE, 'fixtures', 'pg')  # live copies from 2026-10-19 14:51 UTC (ECMWF wind from the sea cells, the tide model)
def FIX(n):
    with open(os.path.join(FIXDIR, n), encoding='utf-8') as f: return f.read()
NOW = datetime.datetime(2026, 10, 19, 14, 51, tzinfo=U)


class Fill(unittest.TestCase):
    def setUp(self):
        import copy
        with open(os.path.join(FIXDIR, 'snap_in.json')) as f: self.snap = json.load(f)
        self.before = copy.deepcopy(self.snap)

    def fill(self, now=NOW, dl=FIXDIR):
        import pi
        pi.fill(self.snap, SPOTS, dl, now, 'pg'); return self.snap['spots']

    def test_fill_lido(self):
        s = self.fill()['lido']
        self.assertEqual(s['tz'], 10)  # two hours ahead of Taipei
        # no buoy at all, so none to call silent, and no wind now
        self.assertEqual((s['buoyId'], s['buoy'], s['buoyAt'], s['buoyQuiet'], s['buoyName'], s['buoyKm']), (None, [], '', False, '', None))
        self.assertNotIn('buoyBy', s); self.assertNotIn('buoyMain', s)
        self.assertEqual((s['dwind'], s['stationName'], s['zh']['stationName'], s['ja']['stationName']), ([], '', '', ''))
        self.assertEqual(s['wind'][0], ['2026-10-19T00:00', 7.1, 133, None, None])
        self.assertEqual([r[0][11:13] for r in s['wind']], ['00', '03', '06', '09', '12', '15', '18', '21'])
        # the tide model's highs and lows, and the page says they are the model's
        self.assertTrue(s['tideModel'])
        self.assertEqual(s['tides']['2026-10-19'], [['07:20', 'L', 14], ['15:18', 'H', 88], ['21:00', 'L', 66]])
        # local dates are Papua New Guinea's: Taipei's 19 October, 00:00 to 23:00, is 02:00 on the 19th to 01:00 on the 20th there
        self.assertEqual(sorted(s['sun']), ['2026-10-19', '2026-10-20'])
        self.assertEqual((s['sun']['2026-10-19']['rise'], s['sun']['2026-10-19']['set']), ('06:15', '18:25'))
        self.assertEqual(self.snap['src']['spots']['lido'], '/')

    def test_every_spot_alike(self):
        sp = self.fill()
        for k in PG_IDS:
            s = sp[k]
            self.assertEqual((s['tz'], s['buoy'], s['buoyQuiet'], s['dwind'], len(s['wind']), s['tideModel']), (10, [], False, [], 8, True), k)
            self.assertEqual(sorted(s['sun']), ['2026-10-19', '2026-10-20'], k)
        # Nusa and Nago share their sea cell, so their wind forecast too
        self.assertEqual(sp['nusa']['wind'], sp['nago']['wind'])

    def test_model_tides(self):
        # every spot takes the tide model, in the order the reply lists them
        import au
        sp = self.fill(); m = json.loads(FIX('tidepg.json'))
        for i, k in enumerate(PG_IDS):
            self.assertEqual(sp[k]['tides'], au.tide_days(m[i]['hourly']['time'], m[i]['hourly']['sea_level_height_msl'], 10), k)
        self.assertEqual(sp['rubio']['tides']['2026-10-20'], [['07:47', 'L', 8], ['15:45', 'H', 79], ['21:30', 'L', 57]])

    def test_downloads_follow_the_spot_list(self):
        # the ECMWF reply and the tide model's hold every Papua New Guinea spot of spots.json in its order, so with Wewak and Nusa missing
        # from the snap, Tupira still takes the 3rd of each and Rubio the 7th
        import au
        for k in ('wewak', 'nusa'): del self.snap['spots'][k]
        sp = self.fill(); om, m = json.loads(FIX('openpg.json')), json.loads(FIX('tidepg.json'))
        for k, i in (('tupira', 2), ('rubio', 6)):
            self.assertEqual(sp[k]['wind'][0][:3], ['2026-10-19T00:00', om[i]['hourly']['wind_speed_10m'][0], om[i]['hourly']['wind_direction_10m'][0]], k)
            self.assertEqual(sp[k]['tides'], au.tide_days(m[i]['hourly']['time'], m[i]['hourly']['sea_level_height_msl'], 10), k)
        self.assertEqual(sp['rubio']['wind'][0][:3], ['2026-10-19T00:00', 4.9, 213])
        for n, k in enumerate(PG_IDS):
            s = next(x for x in SPOTS if x['id'] == k)
            # the sea cells lie 1.1 to 4.9 km from the spots, the tide cells 1.8 to 22 km (MFWAM counts a wide strip of the coast as land)
            self.assertLess(abs(om[n]['latitude'] - s['lat']) + abs(om[n]['longitude'] - s['lon']), 0.06, k)
            self.assertLess(abs(m[n]['latitude'] - s['lat']) + abs(m[n]['longitude'] - s['lon']), 0.25, k)

    def test_groups_kept_apart(self):
        # Micronesia's run leaves Papua New Guinea's spots alone, and Papua New Guinea's run Micronesia's and the other countries'
        import pi, copy
        pi.fill(self.snap, SPOTS, os.path.join(HERE, 'fixtures', 'mi'), NOW, 'mi')
        for k in PG_IDS: self.assertEqual(self.snap['spots'][k], self.before['spots'][k], k)
        o = {k: copy.deepcopy(self.snap['spots'][k]) for k in ('donghe', 'jukdo', 'cloud9', 'ppass', 'baidai')}
        self.fill()
        for k, v in o.items(): self.assertEqual(self.snap['spots'][k], v, k)

    def test_nothing_downloaded(self):
        import tempfile
        sp = self.fill(dl=tempfile.mkdtemp())
        for k in PG_IDS:
            s = sp[k]
            self.assertEqual((s['tz'], s['buoy'], s['buoyQuiet'], s['dwind'], s['wind'], s['tides']), (10, [], False, [], [], {}), k)
            self.assertTrue(s['sun'] and s['tideModel'], k)  # the page still says its tides, when it has some, come from the model

    def test_runs_isolated_like_refresh(self):
        import subprocess, tempfile, shutil
        tmp = tempfile.mkdtemp(); f = os.path.join(tmp, 'snap.json'); shutil.copy(os.path.join(FIXDIR, 'snap_in.json'), f)
        r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'pi.py'), FIXDIR, f, os.path.join(ROOT, 'spots.json'), 'pg'], capture_output=True, text=True, cwd=tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('pg: lido 10 None 0 0 8 4\n', r.stdout)  # no buoy, no wind now, 8 forecast hours, 4 days of tides
        self.assertNotIn('ppass', r.stdout)
        with open(f) as fh: d = json.load(fh)
        self.assertEqual(d['spots']['rubio']['tides']['2026-10-20'][0], ['07:47', 'L', 8])
        self.assertEqual(d['spots']['ppass'], json.loads(FIX('snap_in.json'))['spots']['ppass'])


class Refresh(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(ROOT, 'refresh.sh'), encoding='utf-8') as f: self.sh = f.read()
        pg = [s for s in SPOTS if s.get('country') == 'pg']
        self.lat, self.lon = ','.join(str(s['lat']) for s in pg), ','.join(str(s['lon']) for s in pg)

    def test_refresh_lists_match(self):
        # refresh.sh's piids lists what pi.py reads for Papua New Guinea: every spot, in order, on the tide model, and no buoy, airport or
        # NOAA station
        import re, subprocess
        piids = re.search(r'^piids\(\)\{.*?; \}$', self.sh, re.S | re.M).group(0)
        got = {f: subprocess.run(['sh', '-c', 'HERE=$1\n' + piids + '\npiids pg $2', 'sh', ROOT, f], capture_output=True, text=True).stdout.strip()
               for f in ('lat', 'lon', 'ndbc', 'metar', 'tideStation', 'mlat', 'mlon')}
        self.assertEqual(got, {'lat': self.lat, 'lon': self.lon, 'ndbc': '', 'metar': '', 'tideStation': '', 'mlat': self.lat, 'mlon': self.lon})

    def loop(self, fail=''):
        # refresh.sh's island loop for Papua New Guinea alone, run under set -e as refresh.sh runs, with a stand-in curl that notes each
        # request and fails one holding fail the way curl -f fails on an HTTP error (exit 22); gives the requests in order
        import re, subprocess, tempfile
        get = re.search(r'^get\(\)\{.*?; \}$', self.sh, re.M).group(0)
        piids = re.search(r'^piids\(\)\{.*?; \}$', self.sh, re.S | re.M).group(0)
        loop = re.search(r'^for C in pi mi pg; do$.*?^done$', self.sh, re.S | re.M).group(0)
        tmp = tempfile.mkdtemp(); bin_ = os.path.join(tmp, 'bin'); os.makedirs(bin_); os.makedirs(os.path.join(tmp, 'w', 'dl'))
        with open(os.path.join(bin_, 'curl'), 'w') as f:
            f.write('#!/bin/sh\nfor a; do url=$a; done\necho "$url" >> "$T/calls"\nif [ -n "$F" ]; then case "$url" in *"$F"*) exit 22;; esac; fi\nexit 0\n')
        os.chmod(os.path.join(bin_, 'curl'), 0o755)
        env = dict(os.environ, PATH=bin_ + os.pathsep + os.environ['PATH'], T=tmp, F=fail)
        r = subprocess.run(['sh', '-c', 'set -e\nHERE=$1; W=$2\n%s\n%s\n%s' % (get, piids, loop.replace('for C in pi mi pg; do', 'for C in pg; do', 1)), 'sh', ROOT, os.path.join(tmp, 'w')],
                           capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(os.path.join(tmp, 'calls')) as f: return f.read().split()

    def test_wind_from_the_sea_cells_and_the_tide_model(self):
        # Papua New Guinea asks for ECMWF's wind from the sea cell nearest each spot and for the tide model, and for nothing from NDBC,
        # the Aviation Weather Center or NOAA's tides
        q = 'latitude=%s&longitude=%s' % (self.lat, self.lon)
        self.assertEqual(self.loop(), ['https://api.open-meteo.com/v1/forecast?%s&hourly=wind_speed_10m,wind_direction_10m,precipitation&wind_speed_unit=kn'
                                       '&timezone=Asia%%2FTaipei&forecast_days=4&cell_selection=sea&models=ecmwf_ifs' % q,
                                       'https://marine-api.open-meteo.com/v1/marine?%s&hourly=sea_level_height_msl&timezone=GMT&past_days=6&forecast_days=10' % q])

    def test_fallback_from_the_sea_cells_too(self):
        # When ECMWF's reply fails, Open-Meteo's default model is asked for, still from the sea cells
        u = 'https://api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s&hourly=wind_speed_10m,wind_direction_10m,precipitation&wind_speed_unit=kn' \
            '&timezone=Asia%%2FTaipei&forecast_days=4&cell_selection=sea' % (self.lat, self.lon)
        self.assertEqual([x for x in self.loop('cell_selection=sea&models=ecmwf_ifs') if x.startswith(u)], [u + '&models=ecmwf_ifs', u])

    def test_grid_and_page(self):
        # the map's grid for Papua New Guinea, 2° apart over 10°S–2°N, 136–156°E, refetched every ~6 h, and its place in the page
        self.assertIn('regrid pg 350 -10 2 7 136 2 11\n', self.sh)
        self.assertIn('GPG="$G/grid-pg.json"; [ -f "$GPG" ] || { echo null > "$W/gridnull.json"; GPG="$W/gridnull.json"; }\n', self.sh)
        page = [l for l in self.sh.split('\n') if "replace('__GRIDPG__'" in l]
        self.assertEqual(len(page), 1)
        self.assertIn(".replace('__GRIDPG__',open(sys.argv[17]).read())", page[0])
        self.assertTrue(page[0].endswith(' "$GM" "$GHK" "$GPG"'))


if __name__ == '__main__':
    unittest.main()
