# Hainan's spots and kr.py's Hainan run (ECMWF wind from the sea cells and model tides via Open-Meteo; no buoy and no wind now).
# Run: python3 -m unittest discover -s tests -v
import os, sys, json, unittest, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
SPOTS = json.load(open(os.path.join(ROOT, 'spots.json')))
HN_IDS = ['dadonghai', 'houhai', 'qingshui', 'xiangshui', 'riyue', 'shimei', 'shenzhou']
KEYS = ['zone', 'buoyKm', 'buoyName', 'windStation', 'stationName', 'off', 'lat', 'lon', 'blurb', 'cams', 'zh', 'ja']


class Spots(unittest.TestCase):
    def test_hn_spots_complete(self):
        hn = [s for s in SPOTS if s.get('country') == 'hn']
        self.assertEqual([s['id'] for s in hn], HN_IDS)  # south-west to north-east, Sanya to Wanning
        for s in hn:
            for k in KEYS: self.assertIn(k, s, s['id'] + ' ' + k)
            self.assertTrue(s['zh']['name'] and s['ja']['name'] and s['zh']['full'] and s['ja']['full'] and s['zh']['region'] and s['ja']['region'])
            self.assertNotIn('tz', s)
            self.assertEqual(s['zone'], 'Asia/Shanghai')
            self.assertTrue(18.1 < s['lat'] < 18.8 and 109.4 < s['lon'] < 110.5, s['id'])
            self.assertTrue(0 <= s['off'] < 360, s['id'])
            # no buoy and no airport that tracks the spots: no station names either
            self.assertEqual((s['buoyKm'], s['buoyName'], s['zh']['buoyName'], s['ja']['buoyName']), (None, '', '', ''))
            self.assertEqual((s['windStation'], s['stationName'], s['zh']['stationName'], s['ja']['stationName']), ([], '', '', ''))
        self.assertEqual(len({s['id'] for s in SPOTS}), len(SPOTS))
        # last in spots.json, so the shared Open-Meteo calls, which list every spot in its order, keep each other spot's place
        self.assertEqual([s['id'] for s in SPOTS[-7:]], HN_IDS)


FIXDIR = os.path.join(HERE, 'fixtures', 'hn')  # live copies from 2026-10-19 10:31 UTC (ECMWF wind from the sea cells, tide model)
def FIX(n):
    with open(os.path.join(FIXDIR, n), encoding='utf-8') as f: return f.read()
U = datetime.timezone.utc
NOW = datetime.datetime(2026, 10, 19, 10, 30, tzinfo=U)


class Fill(unittest.TestCase):
    def setUp(self):
        import copy
        with open(os.path.join(FIXDIR, 'snap_in.json')) as f: self.snap = json.load(f)
        self.before = copy.deepcopy(self.snap)

    def test_fill_dadonghai(self):
        import kr
        kr.fill(self.snap, SPOTS, FIXDIR, NOW, 'hn')
        s = self.snap['spots']['dadonghai']
        self.assertEqual(s['tz'], 8)  # Hainan keeps Taipei's clock
        self.assertEqual((s['buoyId'], s['buoy'], s['buoyAt'], s['buoyQuiet']), (None, [], '', False))  # no buoy at all
        self.assertEqual((s['dwind'], s['stationName'], s['zh']['stationName'], s['ja']['stationName']), ([], '', '', ''))
        self.assertEqual(s['wind'][0], ['2026-10-19T00:00', 9.0, 64, None, None])
        self.assertEqual([r[0][11:13] for r in s['wind']], ['00', '03', '06', '09', '12', '15', '18', '21'])
        # one high and one low a day here, about a metre apart
        self.assertEqual(s['tides']['2026-10-19'], [['02:45', 'H', 138], ['12:30', 'L', 33]])
        self.assertEqual(sorted(s['sun']), ['2026-10-19'])  # local dates are Taipei's
        self.assertEqual((s['sun']['2026-10-19']['rise'], s['sun']['2026-10-19']['set']), ('06:36', '18:17'))
        self.assertEqual(self.snap['src']['spots']['dadonghai'], '/')
        for k in ('donghe', 'jukdo', 'cloud9', 'cheungsha'): self.assertEqual(self.snap['spots'][k], self.before['spots'][k])

    def test_downloads_follow_the_spot_list(self):
        # the Open-Meteo replies hold every Hainan spot of spots.json in its order, so Xiangshui (4th) takes the 4th though Qingshui (3rd)
        # is missing from the snap
        import kr
        del self.snap['spots']['qingshui']
        kr.fill(self.snap, SPOTS, FIXDIR, NOW, 'hn')
        om, tide = json.loads(FIX('openhn.json')), json.loads(FIX('tidehn.json'))
        x = self.snap['spots']['xiangshui']
        self.assertEqual(x['wind'][0][:3], ['2026-10-19T00:00', om[3]['hourly']['wind_speed_10m'][0], om[3]['hourly']['wind_direction_10m'][0]])
        self.assertEqual(x['wind'][0][:3], ['2026-10-19T00:00', 7.8, 37])
        self.assertEqual(x['tides']['2026-10-19'], [['01:45', 'H', 135], ['11:54', 'L', 30]])
        # Shimei and Shenzhou share their sea cell, so their wind forecasts are the same
        self.assertEqual(self.snap['spots']['shimei']['wind'], self.snap['spots']['shenzhou']['wind'])
        for n, k in enumerate(HN_IDS):
            s = next(x for x in SPOTS if x['id'] == k)
            # the sea cells lie 2.4 to 8.2 km from the spots, the wave and tide cells 1.5 to 11.3 km
            self.assertLess(abs(om[n]['latitude'] - s['lat']) + abs(om[n]['longitude'] - s['lon']), 0.15, k)
            self.assertLess(abs(tide[n]['latitude'] - s['lat']) + abs(tide[n]['longitude'] - s['lon']), 0.15, k)

    def test_no_airport_download(self):
        # no Hainan spot names an airport, so refresh.sh sends no METAR request and nothing is missed
        import kr, io, contextlib
        self.assertFalse(os.path.exists(os.path.join(FIXDIR, 'metar-hn.json')))
        err = io.StringIO()
        with contextlib.redirect_stderr(err): kr.fill(self.snap, SPOTS, FIXDIR, NOW, 'hn')
        self.assertEqual(err.getvalue(), '')
        for k in HN_IDS: self.assertEqual(self.snap['spots'][k]['dwind'], [], k)

    def test_countries_kept_apart(self):
        # the Philippine run leaves the Hainan spots alone, and the Hainan run the Philippines'
        import kr, copy
        kr.fill(self.snap, SPOTS, os.path.join(HERE, 'fixtures', 'ph'), NOW, 'ph')
        for k in HN_IDS: self.assertEqual(self.snap['spots'][k], self.before['spots'][k], k)
        c = copy.deepcopy(self.snap['spots']['cloud9'])
        kr.fill(self.snap, SPOTS, FIXDIR, NOW, 'hn')
        self.assertEqual(self.snap['spots']['cloud9'], c)

    def test_nothing_downloaded(self):
        import kr, tempfile
        kr.fill(self.snap, SPOTS, tempfile.mkdtemp(), NOW, 'hn')
        s = self.snap['spots']['riyue']
        self.assertEqual((s['tz'], s['buoy'], s['dwind'], s['wind'], s['tides']), (8, [], [], [], {}))
        self.assertTrue(s['sun'])

    def test_runs_isolated_like_refresh(self):
        import subprocess, tempfile, shutil
        tmp = tempfile.mkdtemp(); f = os.path.join(tmp, 'snap.json'); shutil.copy(os.path.join(FIXDIR, 'snap_in.json'), f)
        r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'kr.py'), FIXDIR, f, os.path.join(ROOT, 'spots.json'), 'hn'], capture_output=True, text=True, cwd=tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('hn: riyue 8 None 0 0 8 4', r.stdout)   # no buoy, no wind now
        self.assertNotIn('cloud9', r.stdout)
        with open(f) as fh: d = json.load(fh)
        self.assertEqual(d['spots']['shenzhou']['tz'], 8)
        self.assertEqual(d['spots']['cloud9'], json.loads(FIX('snap_in.json'))['spots']['cloud9'])


class Refresh(unittest.TestCase):
    def test_wind_forecast_from_the_sea_cells(self):
        # refresh.sh's loop for Korea, the Philippines, Indonesia and Hainan, run with a stand-in curl that only notes each request: Hainan's
        # wind forecast asks for the sea cell nearest each spot, ECMWF's first; the others ask as before; Hainan sends no METAR request
        import re, subprocess, tempfile
        with open(os.path.join(ROOT, 'refresh.sh'), encoding='utf-8') as f: sh = f.read()
        get = re.search(r'^get\(\)\{.*?; \}$', sh, re.M).group(0)
        krids = re.search(r'^krids\(\)\{.*?; \}$', sh, re.S | re.M).group(0)
        loop = re.search(r'^for C in kr ph id hn; do$.*?^done$', sh, re.S | re.M).group(0)
        tmp = tempfile.mkdtemp(); bin_ = os.path.join(tmp, 'bin'); os.makedirs(bin_); os.makedirs(os.path.join(tmp, 'w', 'dl'))
        with open(os.path.join(bin_, 'curl'), 'w') as f: f.write('#!/bin/sh\nfor a; do url=$a; done\necho "$url" >> "$T/calls"\n')
        os.chmod(os.path.join(bin_, 'curl'), 0o755)
        env = dict(os.environ, PATH=bin_ + os.pathsep + os.environ['PATH'], T=tmp)
        r = subprocess.run(['sh', '-c', 'HERE=$1; W=$2\n%s\n%s\n%s' % (get, krids, loop), 'sh', ROOT, os.path.join(tmp, 'w')], capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(os.path.join(tmp, 'calls')) as f: calls = f.read().split()
        hn = [s for s in SPOTS if s.get('country') == 'hn']
        q = 'latitude=%s&longitude=%s' % (','.join(str(s['lat']) for s in hn), ','.join(str(s['lon']) for s in hn))
        self.assertIn('https://api.open-meteo.com/v1/forecast?%s&hourly=wind_speed_10m,wind_direction_10m,precipitation&wind_speed_unit=kn'
                      '&timezone=Asia%%2FTaipei&forecast_days=4&cell_selection=sea&models=ecmwf_ifs' % q, calls)
        self.assertIn('https://marine-api.open-meteo.com/v1/marine?%s&hourly=sea_level_height_msl&timezone=GMT&past_days=5&forecast_days=10' % q, calls)
        sea = [u for u in calls if 'cell_selection' in u]
        self.assertEqual(len(sea), 1)  # the stand-in answers, so the default model isn't asked for
        self.assertIn(q, sea[0])
        self.assertFalse([u for u in calls if 'metar' in u and 'ZJ' in u])
        for c in ('kr', 'ph', 'id'):
            self.assertTrue([u for u in calls if u.startswith('https://api.open-meteo.com/v1/forecast?latitude=%s' % next(str(s['lat']) for s in SPOTS if s.get('country') == c))], c)


if __name__ == '__main__':
    unittest.main()
