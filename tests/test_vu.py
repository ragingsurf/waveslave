# Vanuatu's spots and pi.py's fourth island group (ECMWF wind from the sea cells and the tide model via Open-Meteo; no buoy, no airport
# report, no NOAA station).
# Run: python3 -m unittest discover -s tests -v
import os, sys, json, unittest, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
SPOTS = json.load(open(os.path.join(ROOT, 'spots.json')))
VU_IDS = ['devils', 'pango', 'breakas', 'tapi', 'lenakel', 'portres']
KEYS = ['name', 'full', 'region', 'zone', 'ndbc', 'buoyKm', 'buoyName', 'windStation', 'stationName', 'tideStation', 'off', 'lat', 'lon', 'blurb', 'cams', 'zh', 'ja']
U = datetime.timezone.utc


class Spots(unittest.TestCase):
    def test_vu_spots_complete(self):
        vu = [s for s in SPOTS if s.get('country') == 'vu']
        self.assertEqual([s['id'] for s in vu], VU_IDS)  # Efate's four west to east, then Tanna's two
        for s in vu:
            for k in KEYS: self.assertIn(k, s, s['id'] + ' ' + k)
            self.assertTrue(s['zh']['name'] and s['ja']['name'] and s['zh']['full'] and s['ja']['full'] and s['zh']['region'] and s['ja']['region'])
            self.assertNotIn('tz', s)
            self.assertEqual(s['zone'], 'Pacific/Efate')
            self.assertTrue(-19.6 < s['lat'] < -17.7 and 168.1 < s['lon'] < 169.6, s['id'])
            self.assertTrue(0 <= s['off'] < 360, s['id'])
            # no buoy, no airport or station that tracks a spot's wind and no NOAA tide station: every spot takes the tide model
            self.assertEqual((s['ndbc'], s['buoyKm'], s['buoyName'], s['zh']['buoyName'], s['ja']['buoyName']), ([], None, '', '', ''), s['id'])
            self.assertEqual((s['windStation'], s['stationName'], s['zh']['stationName'], s['ja']['stationName']), ([], '', '', ''), s['id'])
            self.assertIsNone(s['tideStation'], s['id'])
            self.assertEqual((s['cams'], s['zh']['cams'], s['ja']['cams']), ([], [], []), s['id'])
        # Efate's four west of 169°E, where the map splits Vanuatu's two home views, Tanna's two east of it
        self.assertEqual([s['lon'] < 169 for s in vu], [True] * 4 + [False] * 2)
        # the offshore wind of each, the landward normal checked against the guides' best wind (the spec's table): a range check alone would
        # let an east coast's 270 pass as 90
        self.assertEqual({s['id']: s['off'] for s in vu}, {'devils': 100, 'pango': 45, 'breakas': 0, 'tapi': 45, 'lenakel': 50, 'portres': 270})
        self.assertEqual(len({s['id'] for s in SPOTS}), len(SPOTS))
        # last in spots.json, so the shared Open-Meteo calls, which list every spot in its order, keep each other spot's place
        self.assertEqual([s['id'] for s in SPOTS[-6:]], VU_IDS)

    def test_no_clock_changes(self):
        import au
        for at in (datetime.datetime(2026, 10, 19, tzinfo=U), datetime.datetime(2027, 1, 15, tzinfo=U), datetime.datetime(2027, 7, 1, tzinfo=U)):
            self.assertEqual(au.offset('Pacific/Efate', at), 11, at)


FIXDIR = os.path.join(HERE, 'fixtures', 'vu')  # live copies from 2026-10-20 00:02 UTC (ECMWF wind from the sea cells, the tide model)
def FIX(n):
    with open(os.path.join(FIXDIR, n), encoding='utf-8') as f: return f.read()
NOW = datetime.datetime(2026, 10, 20, 0, 2, tzinfo=U)


class Fill(unittest.TestCase):
    def setUp(self):
        import copy
        with open(os.path.join(FIXDIR, 'snap_in.json')) as f: self.snap = json.load(f)
        self.before = copy.deepcopy(self.snap)

    def fill(self, now=NOW, dl=FIXDIR):
        import pi
        pi.fill(self.snap, SPOTS, dl, now, 'vu'); return self.snap['spots']

    def test_fill_devils(self):
        s = self.fill()['devils']
        self.assertEqual(s['tz'], 11)  # three hours ahead of Taipei
        # no buoy at all, so none to call silent, and no wind now
        self.assertEqual((s['buoyId'], s['buoy'], s['buoyAt'], s['buoyQuiet'], s['buoyName'], s['buoyKm']), (None, [], '', False, '', None))
        self.assertNotIn('buoyBy', s); self.assertNotIn('buoyMain', s)
        self.assertEqual((s['dwind'], s['stationName'], s['zh']['stationName'], s['ja']['stationName']), ([], '', '', ''))
        self.assertEqual(s['wind'][0], ['2026-10-20T00:00', 21.8, 114, None, None])
        self.assertEqual([r[0][11:13] for r in s['wind']], ['00', '03', '06', '09', '12', '15', '18', '21'])
        # the tide model's highs and lows, and the page says they are the model's
        self.assertTrue(s['tideModel'])
        self.assertEqual(s['tides']['2026-10-20'], [['06:45', 'L', 30], ['13:50', 'H', 98], ['19:30', 'L', 62]])
        # local dates are Vanuatu's: Taipei's 20 October, 00:00 to 23:00, is 03:00 on the 20th to 02:00 on the 21st there
        self.assertEqual(sorted(s['sun']), ['2026-10-20', '2026-10-21'])
        self.assertEqual((s['sun']['2026-10-20']['rise'], s['sun']['2026-10-20']['set']), ('05:15', '17:49'))
        self.assertEqual(self.snap['src']['spots']['devils'], '/')

    def test_every_spot_alike(self):
        sp = self.fill()
        for k in VU_IDS:
            s = sp[k]
            self.assertEqual((s['tz'], s['buoy'], s['buoyQuiet'], s['dwind'], len(s['wind']), s['tideModel']), (11, [], False, [], 8, True), k)
            self.assertEqual(sorted(s['sun']), ['2026-10-20', '2026-10-21'], k)
        # Pango Point and Breakas share every model cell, so their wind forecast and tides too
        self.assertEqual(sp['pango']['wind'], sp['breakas']['wind'])
        self.assertEqual(sp['pango']['tides'], sp['breakas']['tides'])

    def test_model_tides(self):
        # every spot takes the tide model, in the order the reply lists them
        import au
        sp = self.fill(); m = json.loads(FIX('tidevu.json'))
        for i, k in enumerate(VU_IDS):
            self.assertEqual(sp[k]['tides'], au.tide_days(m[i]['hourly']['time'], m[i]['hourly']['sea_level_height_msl'], 11), k)
        self.assertEqual(sp['portres']['tides']['2026-10-21'], [['00:53', 'H', 88], ['07:18', 'L', 16], ['14:00', 'H', 101], ['19:57', 'L', 37]])

    def test_downloads_follow_the_spot_list(self):
        # the ECMWF reply and the tide model's hold every Vanuatu spot of spots.json in its order, so with Breakas and Lenakel missing from
        # the snap, Tapi Point still takes the 4th of each and Port Resolution the 6th
        import au
        for k in ('breakas', 'lenakel'): del self.snap['spots'][k]
        sp = self.fill(); om, m = json.loads(FIX('openvu.json')), json.loads(FIX('tidevu.json'))
        for k, i in (('tapi', 3), ('portres', 5)):
            self.assertEqual(sp[k]['wind'][0][:3], ['2026-10-20T00:00', om[i]['hourly']['wind_speed_10m'][0], om[i]['hourly']['wind_direction_10m'][0]], k)
            self.assertEqual(sp[k]['tides'], au.tide_days(m[i]['hourly']['time'], m[i]['hourly']['sea_level_height_msl'], 11), k)
        self.assertEqual(sp['portres']['wind'][0][:3], ['2026-10-20T00:00', 16.6, 114])
        for n, k in enumerate(VU_IDS):
            s = next(x for x in SPOTS if x['id'] == k)
            # the sea cells lie 4.0 to 4.6 km from the spots, the tide cells 1.2 to 11.9 km (MFWAM counts a wide strip of Tanna's east coast
            # as land)
            self.assertLess(abs(om[n]['latitude'] - s['lat']) + abs(om[n]['longitude'] - s['lon']), 0.06, k)
            self.assertLess(abs(m[n]['latitude'] - s['lat']) + abs(m[n]['longitude'] - s['lon']), 0.15, k)

    def test_groups_kept_apart(self):
        # Papua New Guinea's run leaves Vanuatu's spots alone, and Vanuatu's run Papua New Guinea's and the other countries'
        import pi, copy
        pi.fill(self.snap, SPOTS, os.path.join(HERE, 'fixtures', 'pg'), NOW, 'pg')
        for k in VU_IDS: self.assertEqual(self.snap['spots'][k], self.before['spots'][k], k)
        self.assertNotEqual(self.snap['spots']['nusa'], self.before['spots']['nusa'])
        o = {k: copy.deepcopy(self.snap['spots'][k]) for k in ('donghe', 'jukdo', 'cloud9', 'ppass', 'baidai', 'nusa')}
        self.fill()
        for k, v in o.items(): self.assertEqual(self.snap['spots'][k], v, k)

    def test_nothing_downloaded(self):
        import tempfile
        sp = self.fill(dl=tempfile.mkdtemp())
        for k in VU_IDS:
            s = sp[k]
            self.assertEqual((s['tz'], s['buoy'], s['buoyQuiet'], s['dwind'], s['wind'], s['tides']), (11, [], False, [], [], {}), k)
            self.assertTrue(s['sun'] and s['tideModel'], k)  # the page still says its tides, when it has some, come from the model

    def test_runs_isolated_like_refresh(self):
        import subprocess, tempfile, shutil
        tmp = tempfile.mkdtemp(); f = os.path.join(tmp, 'snap.json'); shutil.copy(os.path.join(FIXDIR, 'snap_in.json'), f)
        r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'pi.py'), FIXDIR, f, os.path.join(ROOT, 'spots.json'), 'vu'], capture_output=True, text=True, cwd=tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('vu: devils 11 None 0 0 8 4\n', r.stdout)  # no buoy, no wind now, 8 forecast hours, 4 days of tides
        self.assertNotIn('nusa', r.stdout)
        with open(f) as fh: d = json.load(fh)
        self.assertEqual(d['spots']['portres']['tides']['2026-10-21'][0], ['00:53', 'H', 88])
        self.assertEqual(d['spots']['nusa'], json.loads(FIX('snap_in.json'))['spots']['nusa'])


class Refresh(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(ROOT, 'refresh.sh'), encoding='utf-8') as f: self.sh = f.read()
        vu = [s for s in SPOTS if s.get('country') == 'vu']
        self.lat, self.lon = ','.join(str(s['lat']) for s in vu), ','.join(str(s['lon']) for s in vu)

    def test_refresh_lists_match(self):
        # refresh.sh's piids lists what pi.py reads for Vanuatu: every spot, in order, on the tide model, and no buoy, airport or NOAA
        # station
        import re, subprocess
        piids = re.search(r'^piids\(\)\{.*?; \}$', self.sh, re.S | re.M).group(0)
        got = {f: subprocess.run(['sh', '-c', 'HERE=$1\n' + piids + '\npiids vu $2', 'sh', ROOT, f], capture_output=True, text=True).stdout.strip()
               for f in ('lat', 'lon', 'ndbc', 'metar', 'tideStation', 'mlat', 'mlon')}
        self.assertEqual(got, {'lat': self.lat, 'lon': self.lon, 'ndbc': '', 'metar': '', 'tideStation': '', 'mlat': self.lat, 'mlon': self.lon})

    def loop(self, fail=''):
        # refresh.sh's island loop for Vanuatu alone, run under set -e as refresh.sh runs, with a stand-in curl that notes each request and
        # fails one holding fail the way curl -f fails on an HTTP error (exit 22); gives the requests in order
        import re, subprocess, tempfile
        get = re.search(r'^get\(\)\{.*?; \}$', self.sh, re.M).group(0)
        piids = re.search(r'^piids\(\)\{.*?; \}$', self.sh, re.S | re.M).group(0)
        loop = re.search(r'^for C in pi mi pg vu; do$.*?^done$', self.sh, re.S | re.M).group(0)
        tmp = tempfile.mkdtemp(); bin_ = os.path.join(tmp, 'bin'); os.makedirs(bin_); os.makedirs(os.path.join(tmp, 'w', 'dl'))
        with open(os.path.join(bin_, 'curl'), 'w') as f:
            f.write('#!/bin/sh\nfor a; do url=$a; done\necho "$url" >> "$T/calls"\nif [ -n "$F" ]; then case "$url" in *"$F"*) exit 22;; esac; fi\nexit 0\n')
        os.chmod(os.path.join(bin_, 'curl'), 0o755)
        env = dict(os.environ, PATH=bin_ + os.pathsep + os.environ['PATH'], T=tmp, F=fail)
        r = subprocess.run(['sh', '-c', 'set -e\nHERE=$1; W=$2\n%s\n%s\n%s' % (get, piids, loop.replace('for C in pi mi pg vu; do', 'for C in vu; do', 1)), 'sh', ROOT, os.path.join(tmp, 'w')],
                           capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(os.path.join(tmp, 'calls')) as f: return f.read().split()

    def test_wind_from_the_sea_cells_and_the_tide_model(self):
        # Vanuatu asks for ECMWF's wind from the sea cell nearest each spot and for the tide model, and for nothing from NDBC, the Aviation
        # Weather Center or NOAA's tides
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
        # the map's grid for Vanuatu, 2° apart over 24–12°S, 164–174°E, refetched every ~6 h, and its place in the page
        self.assertIn('regrid vu 350 -24 2 7 164 2 6\n', self.sh)
        self.assertIn('GVU="$G/grid-vu.json"; [ -f "$GVU" ] || { echo null > "$W/gridnull.json"; GVU="$W/gridnull.json"; }\n', self.sh)
        page = [l for l in self.sh.split('\n') if "replace('__GRIDVU__'" in l]
        self.assertEqual(len(page), 1)
        self.assertIn(".replace('__GRIDVU__',open(sys.argv[18]).read())", page[0])
        self.assertEqual(page[0].split('.read()))" ', 1)[1].split(' ')[17], '"$GVU"')  # sys.argv[18]


if __name__ == '__main__':
    unittest.main()
