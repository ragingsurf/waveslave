# Indonesian spots and kr.py's Indonesian run (Bali's airport wind from NOAA's Aviation Weather Center, ECMWF wind and model tides
# via Open-Meteo; no buoy).
# Run: python3 -m unittest discover -s tests -v
import os, sys, json, unittest, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
SPOTS = json.load(open(os.path.join(ROOT, 'spots.json')))
ID_IDS = ['uluwatu', 'gland', 'canggu', 'kuta', 'keramas', 'desert', 'gerupuk', 'lakey']
BALI_WEST = ['uluwatu', 'canggu', 'kuta']  # on Ngurah Rai Airport's coast, 3 to 12 km from it
KEYS = ['zone', 'buoyKm', 'buoyName', 'windStation', 'stationName', 'off', 'lat', 'lon', 'blurb', 'cams', 'zh', 'ja']


class Spots(unittest.TestCase):
    def test_id_spots_complete(self):
        ind = [s for s in SPOTS if s.get('country') == 'id']
        self.assertEqual([s['id'] for s in ind], ID_IDS)
        for s in ind:
            for k in KEYS: self.assertIn(k, s, s['id'] + ' ' + k)
            self.assertTrue(s['zh']['name'] and s['ja']['name'] and s['zh']['full'] and s['ja']['full'] and s['zh']['region'] and s['ja']['region'])
            self.assertNotIn('tz', s)
            # Bali, Lombok and Sumbawa keep Taipei's clock; G-Land, in East Java, is an hour behind
            self.assertEqual(s['zone'], 'Asia/Jakarta' if s['id'] == 'gland' else 'Asia/Makassar', s['id'])
            self.assertTrue(-9.5 < s['lat'] < -8 and 114 < s['lon'] < 119, s['id'])
            self.assertTrue(0 <= s['off'] < 360, s['id'])
            self.assertEqual((s['buoyKm'], s['buoyName'], s['zh']['buoyName'], s['ja']['buoyName']), (None, '', '', ''))
            st = (s['windStation'], s['stationName'], s['zh']['stationName'], s['ja']['stationName'])
            if s['id'] in BALI_WEST: self.assertEqual(st, (['metar:WADD'], ['Ngurah Rai Airport'], ['伍拉賴機場'], ['ングラ・ライ空港']), s['id'])
            else: self.assertEqual(st, ([], '', '', ''), s['id'])
        self.assertEqual(len({s['id'] for s in SPOTS}), len(SPOTS))
        for c in ('tw', 'jp', 'kr', 'ph', 'ca', 'hi', 'au', 'nw'): self.assertEqual(sum(s.get('country', 'tw') == c for s in SPOTS), 8)


FIXDIR = os.path.join(HERE, 'fixtures', 'id')  # live copies from 2026-10-18 13:05 UTC
def FIX(n):
    with open(os.path.join(FIXDIR, n), encoding='utf-8') as f: return f.read()
U = datetime.timezone.utc
NOW = datetime.datetime(2026, 10, 18, 13, 5, tzinfo=U)


class Readers(unittest.TestCase):
    def test_metar_newest_report(self):
        import kr
        m = json.loads(FIX('metar-id.json'))
        # 14008KT at 12:30 UTC, 20:30 on Taipei's clock, on the nearest hour
        self.assertEqual(kr.metar_wind(m, 'WADD', NOW), [['2026-10-18T21:00', 8.0, 140.0]])
        self.assertEqual(kr.metar_wind(list(reversed(m)), 'WADD', NOW), [['2026-10-18T21:00', 8.0, 140.0]])
        self.assertEqual(kr.metar_wind(m, 'WADD', NOW + datetime.timedelta(hours=3)), [])  # 3.5 hours old by then


class Fill(unittest.TestCase):
    def setUp(self):
        import copy
        with open(os.path.join(FIXDIR, 'snap_in.json')) as f: self.snap = json.load(f)
        self.before = copy.deepcopy(self.snap)

    def test_fill_uluwatu(self):
        import kr
        kr.fill(self.snap, SPOTS, FIXDIR, NOW, 'id')
        s = self.snap['spots']['uluwatu']
        self.assertEqual(s['tz'], 8)  # Bali keeps Taipei's clock
        self.assertEqual((s['buoyId'], s['buoy'], s['buoyAt'], s['buoyQuiet']), (None, [], '', False))  # no buoy at all
        self.assertEqual(s['dwind'], [['2026-10-18T21:00', 8.0, 140.0]])
        self.assertEqual((s['stationName'], s['zh']['stationName'], s['ja']['stationName']), ('Ngurah Rai Airport', '伍拉賴機場', 'ングラ・ライ空港'))
        self.assertEqual(s['wind'][0], ['2026-10-18T00:00', 1.7, 149, None, None])
        self.assertEqual([r[0][11:13] for r in s['wind']], ['00', '03', '06', '09', '12', '15', '18', '21'])
        self.assertEqual(s['tides']['2026-10-18'], [['00:30', 'H', 104], ['07:22', 'L', -46], ['13:30', 'H', 47], ['18:41', 'L', -5]])
        self.assertEqual(sorted(s['sun']), ['2026-10-18'])
        self.assertEqual((s['sun']['2026-10-18']['rise'], s['sun']['2026-10-18']['set']), ('05:55', '18:14'))
        self.assertEqual(self.snap['src']['spots']['uluwatu'], '/2026-10-18T21:00')
        self.assertEqual(self.snap['spots']['kuta']['dwind'], s['dwind'])
        for k in ('donghe', 'blacks', 'jukdo', 'cloud9'): self.assertEqual(self.snap['spots'][k], self.before['spots'][k])

    def test_gland_an_hour_behind(self):
        # G-Land keeps UTC+7: the same low tide as Uluwatu's 07:22 is 06:21 on its clock, and its local dates start an hour later
        import kr
        kr.fill(self.snap, SPOTS, FIXDIR, NOW, 'id')
        s = self.snap['spots']['gland']
        self.assertEqual((s['tz'], s['dwind'], s['stationName']), (7, [], ''))
        self.assertEqual(s['tides']['2026-10-18'], [['06:21', 'L', -49], ['12:30', 'H', 42], ['17:37', 'L', -8], ['23:57', 'H', 79]])
        self.assertEqual(sorted(s['sun']), ['2026-10-17', '2026-10-18'])  # Taipei's 00:00 is 23:00 the day before
        self.assertEqual((s['sun']['2026-10-18']['rise'], s['sun']['2026-10-18']['set']), ('04:58', '17:17'))
        self.assertEqual(self.snap['src']['spots']['gland'], '/')

    def test_downloads_follow_the_spot_list(self):
        # the Open-Meteo replies hold every Indonesian spot of spots.json in its order, so Kuta (4th) takes the 4th though Canggu (3rd) is
        # missing from the snap, and Lakey Peak the 8th
        import kr
        kr.fill(self.snap, SPOTS, FIXDIR, NOW, 'id')
        om, tide = json.loads(FIX('openid.json')), json.loads(FIX('tideid.json'))
        k, l = self.snap['spots']['kuta'], self.snap['spots']['lakey']
        self.assertEqual(k['wind'][0][:3], ['2026-10-18T00:00', om[3]['hourly']['wind_speed_10m'][0], om[3]['hourly']['wind_direction_10m'][0]])
        self.assertEqual(k['wind'][0][:3], ['2026-10-18T00:00', 0.8, 300])
        self.assertEqual(l['wind'][0][:3], ['2026-10-18T00:00', 2.9, 125])
        self.assertEqual(l['tides']['2026-10-19'], [['01:17', 'H', 95], ['08:30', 'L', -23], ['15:06', 'H', 42], ['19:30', 'L', 23]])
        for n, i in enumerate(ID_IDS):
            s = next(x for x in SPOTS if x['id'] == i)
            # ECMWF's nearest point of its 9 km grid
            self.assertTrue(abs(om[n]['latitude'] - s['lat']) < 0.11 and abs(om[n]['longitude'] - s['lon']) < 0.11, i)
            # each spot sits in the open-sea cell of the tide and wave models (1/12°) it was placed for: Kuta, 0.04° west of its cell's
            # centre, would take the cell over the airport's reef if it moved east
            self.assertTrue(abs(tide[n]['latitude'] - s['lat']) < 1/24 and abs(tide[n]['longitude'] - s['lon']) < 1/24, i)

    def test_countries_kept_apart(self):
        # Korea's and the Philippines' runs leave the Indonesian spots alone, and the Indonesian run theirs
        import kr, copy
        kr.fill(self.snap, SPOTS, os.path.join(HERE, 'fixtures', 'kr'), NOW)
        kr.fill(self.snap, SPOTS, os.path.join(HERE, 'fixtures', 'ph'), NOW, 'ph')
        for k in ('uluwatu', 'gland', 'kuta', 'lakey'): self.assertEqual(self.snap['spots'][k], self.before['spots'][k], k)
        j, c = copy.deepcopy(self.snap['spots']['jukdo']), copy.deepcopy(self.snap['spots']['cloud9'])
        self.assertEqual((j['tz'], c['tz']), (9, 8))
        kr.fill(self.snap, SPOTS, FIXDIR, NOW, 'id')
        self.assertEqual((self.snap['spots']['jukdo'], self.snap['spots']['cloud9']), (j, c))

    def test_nothing_downloaded(self):
        import kr, tempfile
        kr.fill(self.snap, SPOTS, tempfile.mkdtemp(), NOW, 'id')
        for k, tz in (('uluwatu', 8), ('gland', 7)):
            s = self.snap['spots'][k]
            self.assertEqual((s['tz'], s['buoy'], s['dwind'], s['wind'], s['tides']), (tz, [], [], [], {}), k)
            self.assertTrue(s['sun'])
        self.assertEqual(self.snap['spots']['uluwatu']['stationName'], 'Ngurah Rai Airport')  # the airport it would name, when none answered

    def test_runs_isolated_like_refresh(self):
        import subprocess, tempfile, shutil
        tmp = tempfile.mkdtemp(); f = os.path.join(tmp, 'snap.json'); shutil.copy(os.path.join(FIXDIR, 'snap_in.json'), f)
        r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'kr.py'), FIXDIR, f, os.path.join(ROOT, 'spots.json'), 'id'], capture_output=True, text=True, cwd=tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        # the airport's reports go stale after 3 hours, so how many are used depends on the clock; the offsets don't
        self.assertIn('id: uluwatu 8 ', r.stdout)
        self.assertIn('id: gland 7 ', r.stdout)
        self.assertNotIn('jukdo', r.stdout)
        self.assertNotIn('cloud9', r.stdout)
        with open(f) as fh: d = json.load(fh)
        self.assertEqual(d['spots']['lakey']['tz'], 8)
        self.assertEqual(d['spots']['cloud9'], json.loads(FIX('snap_in.json'))['spots']['cloud9'])


if __name__ == '__main__':
    unittest.main()
