# Philippine spots and kr.py's Philippine run (ECMWF wind and model tides via Open-Meteo; no buoy and no wind now).
# Run: python3 -m unittest discover -s tests -v
import os, sys, json, unittest, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
SPOTS = json.load(open(os.path.join(ROOT, 'spots.json')))
PH_IDS = ['cloud9', 'pagudpud', 'sanjuan', 'liwliwa', 'baler', 'bagasbas', 'puraran', 'borongan']
KEYS = ['zone', 'buoyKm', 'buoyName', 'windStation', 'stationName', 'off', 'lat', 'lon', 'blurb', 'cams', 'zh', 'ja']


class Spots(unittest.TestCase):
    def test_ph_spots_complete(self):
        ph = [s for s in SPOTS if s.get('country') == 'ph']
        self.assertEqual([s['id'] for s in ph], PH_IDS)
        for s in ph:
            for k in KEYS: self.assertIn(k, s, s['id'] + ' ' + k)
            self.assertTrue(s['zh']['name'] and s['ja']['name'] and s['zh']['full'] and s['ja']['full'] and s['zh']['region'] and s['ja']['region'])
            self.assertNotIn('tz', s)
            self.assertEqual(s['zone'], 'Asia/Manila')
            self.assertTrue(5 < s['lat'] < 21 and 116 < s['lon'] < 127, s['id'])
            self.assertTrue(0 <= s['off'] < 360, s['id'])
            # no buoy and no airport near enough: no station names either
            self.assertEqual((s['buoyKm'], s['buoyName'], s['zh']['buoyName'], s['ja']['buoyName']), (None, '', '', ''))
            self.assertEqual((s['windStation'], s['stationName'], s['zh']['stationName'], s['ja']['stationName']), ([], '', '', ''))
        self.assertEqual(len({s['id'] for s in SPOTS}), len(SPOTS))
        for c in ('tw', 'jp', 'kr', 'ca', 'hi', 'au', 'nw'): self.assertEqual(sum(s.get('country', 'tw') == c for s in SPOTS), 8)


FIXDIR = os.path.join(HERE, 'fixtures', 'ph')  # live copies from 2026-10-18 (ECMWF wind 10:02 UTC, tide model 09:55 UTC)
def FIX(n):
    with open(os.path.join(FIXDIR, n), encoding='utf-8') as f: return f.read()
U = datetime.timezone.utc
NOW = datetime.datetime(2026, 10, 18, 10, 0, tzinfo=U)


class Fill(unittest.TestCase):
    def setUp(self):
        import copy
        with open(os.path.join(FIXDIR, 'snap_in.json')) as f: self.snap = json.load(f)
        self.before = copy.deepcopy(self.snap)

    def test_fill_cloud9(self):
        import kr
        kr.fill(self.snap, SPOTS, FIXDIR, NOW, 'ph')
        s = self.snap['spots']['cloud9']
        self.assertEqual(s['tz'], 8)  # Manila keeps Taipei's clock
        self.assertEqual((s['buoyId'], s['buoy'], s['buoyAt'], s['buoyQuiet']), (None, [], '', False))  # no buoy at all
        self.assertEqual((s['dwind'], s['stationName'], s['zh']['stationName'], s['ja']['stationName']), ([], '', '', ''))
        self.assertEqual(s['wind'][0], ['2026-10-18T00:00', 4.3, 49, None, None])
        self.assertEqual([r[0][11:13] for r in s['wind']], ['00', '03', '06', '09', '12', '15', '18', '21'])
        # the Pacific side has two highs and two lows a day, a metre or so apart
        self.assertEqual(s['tides']['2026-10-18'], [['03:38', 'L', 22], ['10:45', 'H', 87], ['15:10', 'L', 71], ['21:15', 'H', 101]])
        self.assertEqual(sorted(s['sun']), ['2026-10-18'])  # local dates are Taipei's
        self.assertEqual((s['sun']['2026-10-18']['rise'], s['sun']['2026-10-18']['set']), ('05:23', '17:17'))
        self.assertEqual(self.snap['src']['spots']['cloud9'], '/')
        for k in ('donghe', 'blacks', 'jukdo'): self.assertEqual(self.snap['spots'][k], self.before['spots'][k])

    def test_downloads_follow_the_spot_list(self):
        # the Open-Meteo replies hold every Philippine spot of spots.json in its order, so Baler (5th) takes the 5th though Liwliwa (4th) is
        # missing from the snap, and Pagudpud the 2nd
        import kr
        kr.fill(self.snap, SPOTS, FIXDIR, NOW, 'ph')
        om, tide = json.loads(FIX('openph.json')), json.loads(FIX('tideph.json'))
        b, p = self.snap['spots']['baler'], self.snap['spots']['pagudpud']
        self.assertEqual(b['wind'][0][:3], ['2026-10-18T00:00', om[4]['hourly']['wind_speed_10m'][0], om[4]['hourly']['wind_direction_10m'][0]])
        self.assertEqual(b['wind'][0][:3], ['2026-10-18T00:00', 3.7, 264])
        self.assertEqual(b['tides']['2026-10-19'], [['05:06', 'L', 40], ['12:30', 'H', 93], ['17:30', 'L', 75], ['23:30', 'H', 99]])
        self.assertEqual(p['wind'][0][:3], ['2026-10-18T00:00', 10.4, 101])
        # the South China Sea side has one high and one low a day
        self.assertEqual(p['tides']['2026-10-19'], [['01:10', 'H', 93], ['12:00', 'L', 45]])
        for n, k in enumerate(PH_IDS):
            s = next(x for x in SPOTS if x['id'] == k)
            self.assertLess(abs(om[n]['latitude'] - s['lat']) + abs(om[n]['longitude'] - s['lon']), 0.15, k)
            # the tide model's nearest sea point can lie 15 to 20 km off a beach in a bay
            self.assertLess(abs(tide[n]['latitude'] - s['lat']) + abs(tide[n]['longitude'] - s['lon']), 0.35, k)

    def test_no_airport_download(self):
        # no Philippine spot names an airport, so refresh.sh sends no METAR request and nothing is missed
        import kr, io, contextlib
        self.assertFalse(os.path.exists(os.path.join(FIXDIR, 'metar-ph.json')))
        err = io.StringIO()
        with contextlib.redirect_stderr(err): kr.fill(self.snap, SPOTS, FIXDIR, NOW, 'ph')
        self.assertEqual(err.getvalue(), '')
        for k in ('cloud9', 'sanjuan', 'baler', 'pagudpud'): self.assertEqual(self.snap['spots'][k]['dwind'], [], k)

    def test_countries_kept_apart(self):
        # Korea's run leaves the Philippine spots alone, and the Philippine run Korea's
        import kr, copy
        kr.fill(self.snap, SPOTS, os.path.join(HERE, 'fixtures', 'kr'), NOW)
        for k in ('cloud9', 'sanjuan', 'baler', 'pagudpud'): self.assertEqual(self.snap['spots'][k], self.before['spots'][k], k)
        j = copy.deepcopy(self.snap['spots']['jukdo'])
        self.assertEqual(j['tz'], 9)
        kr.fill(self.snap, SPOTS, FIXDIR, NOW, 'ph')
        self.assertEqual(self.snap['spots']['jukdo'], j)

    def test_nothing_downloaded(self):
        import kr, tempfile
        kr.fill(self.snap, SPOTS, tempfile.mkdtemp(), NOW, 'ph')
        s = self.snap['spots']['baler']
        self.assertEqual((s['tz'], s['buoy'], s['dwind'], s['wind'], s['tides']), (8, [], [], [], {}))
        self.assertTrue(s['sun'])

    def test_runs_isolated_like_refresh(self):
        import subprocess, tempfile, shutil
        tmp = tempfile.mkdtemp(); f = os.path.join(tmp, 'snap.json'); shutil.copy(os.path.join(FIXDIR, 'snap_in.json'), f)
        r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'kr.py'), FIXDIR, f, os.path.join(ROOT, 'spots.json'), 'ph'], capture_output=True, text=True, cwd=tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('ph: cloud9 8 0 8 3', r.stdout)
        self.assertNotIn('jukdo', r.stdout)
        with open(f) as fh: d = json.load(fh)
        self.assertEqual(d['spots']['pagudpud']['tz'], 8)
        self.assertEqual(d['spots']['jukdo'], json.loads(FIX('snap_in.json'))['spots']['jukdo'])


if __name__ == '__main__':
    unittest.main()
