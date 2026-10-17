# Hawaii spots and ca.py reading them (NOAA NDBC/CDIP buoys, NDBC and NWS wind, NOAA tides, GFS wind via Open-Meteo).
# Run: python3 -m unittest discover -s tests -v
import os, sys, json, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
SPOTS = json.load(open(os.path.join(ROOT, 'spots.json')))
HI_IDS = ['pipeline', 'waikiki', 'makaha', 'sandybeach', 'honolua', 'hookipa', 'hanalei', 'honolii']
KEYS = ['ndbc', 'buoyKm', 'buoyName', 'windStation', 'stationName', 'tideStation', 'off', 'lat', 'lon', 'blurb', 'cams', 'zh', 'ja']


class Spots(unittest.TestCase):
    def test_hi_spots_complete(self):
        hi = [s for s in SPOTS if s.get('country') == 'hi']
        self.assertEqual([s['id'] for s in hi], HI_IDS)
        for s in hi:
            for k in KEYS: self.assertIn(k, s, s['id'] + ' ' + k)
            self.assertTrue(s['zh']['name'] and s['ja']['name'])
            self.assertNotIn('tz', s)
            ws = s['windStation'] if isinstance(s['windStation'], list) else [s['windStation']]
            for w in ws: self.assertRegex(w, r'^(ndbc|nws):[A-Z0-9]+$')
            self.assertTrue(18 < s['lat'] < 23 and -161 < s['lon'] < -154)
        for c in ('tw', 'jp', 'ca'): self.assertEqual(sum(s.get('country', 'tw') == c for s in SPOTS), 8)


FIXDIR = os.path.join(HERE, 'fixtures', 'hi')
def FIX(n):
    with open(os.path.join(FIXDIR, n), encoding='utf-8') as f: return f.read()


class Readers(unittest.TestCase):
    def test_offset_hawaii(self):
        import ca, datetime
        U = datetime.timezone.utc
        self.assertEqual(ca.offset('hi', datetime.datetime(2026, 1, 15, tzinfo=U)), -10)
        self.assertEqual(ca.offset('hi', datetime.datetime(2026, 7, 15, tzinfo=U)), -10)
        self.assertEqual(ca.offset('ca', datetime.datetime(2026, 7, 15, tzinfo=U)), -7)

    def test_nws_newest_with_wind(self):
        # airport stations often leave the speed out of a report; the newest report that has one is used
        import ca
        self.assertEqual(ca.nws_wind(json.loads(FIX('nws-PHJR.json'))), [['2026-10-17T20:00', 5.1, 70]])
        self.assertEqual(ca.nws_wind(json.loads(FIX('nws-PHHI.json'))), [])

    def test_stale_wind_dropped(self):
        # a wind reading over 3 hours old is not "wind now"
        import ca, datetime
        U = datetime.timezone.utc
        js = json.loads(FIX('nws-PHJR.json'))
        self.assertEqual(ca.nws_wind(js, now=datetime.datetime(2026, 10, 17, 14, 30, tzinfo=U)), [['2026-10-17T20:00', 5.1, 70]])
        self.assertEqual(ca.nws_wind(js, now=datetime.datetime(2026, 10, 17, 15, 30, tzinfo=U)), [])
        self.assertEqual(ca.ndbc_wind(FIX('ndbc-ILOH1.txt'), now=datetime.datetime(2026, 10, 18, tzinfo=U)), [])
        self.assertTrue(ca.ndbc_wind(FIX('ndbc-ILOH1.txt'), now=datetime.datetime(2026, 10, 17, 13, 30, tzinfo=U)))

    def test_stale_buoy_rows_dropped(self):
        import ca, datetime
        now = datetime.datetime(2026, 10, 17, 13, 30, tzinfo=datetime.timezone.utc)
        self.assertEqual(ca.ndbc_rows(FIX('ndbc-51205.txt'), now=now), [])
        self.assertTrue(ca.ndbc_rows(FIX('ndbc-51201.txt'), now=now))


class Fill(unittest.TestCase):
    def setUp(self):
        import datetime, copy
        self.now = datetime.datetime(2026, 10, 17, 13, 30, tzinfo=datetime.timezone.utc)
        with open(os.path.join(FIXDIR, 'snap_in.json')) as f: self.snap = json.load(f)
        self.before = copy.deepcopy(self.snap)

    def test_fill_hawaii(self):
        import ca
        ca.fill(self.snap, SPOTS, FIXDIR, self.now, 'hi')
        p = self.snap['spots']['pipeline']
        self.assertEqual((p['buoyId'], p['tz'], p['buoyAt']), ('51201', -10, '2026-10-17T21:00'))
        self.assertEqual(p['buoy'][-1][1:4], [2.2, 7.8, 351.0])
        self.assertTrue(p['wind'] and p['wind'][0][1] is not None)
        self.assertEqual(sorted(p['tides'])[0], '2026-10-16')
        self.assertEqual(sorted(p['sun']), ['2026-10-17', '2026-10-18'])  # Taipei 18th 00-23h is HST 17th 06h to 18th 05h
        for k in ('donghe', 'blacks'): self.assertEqual(self.snap['spots'][k], self.before['spots'][k])

    def test_wind_station_fallback(self):
        # Pipeline lists Wheeler then Kalaeloa; Wheeler sent no speed, so Kalaeloa's reading and name are used
        import ca
        ca.fill(self.snap, SPOTS, FIXDIR, self.now, 'hi')
        p = self.snap['spots']['pipeline']
        self.assertEqual(p['dwind'], [['2026-10-17T20:00', 5.1, 70]])
        self.assertEqual((p['stationName'], p['zh']['stationName'], p['ja']['stationName']), ('Kalaeloa', '卡拉埃洛阿', 'カラエロア'))
        self.assertEqual(self.snap['src']['spots']['pipeline'], '2026-10-17T21:00/2026-10-17T20:00')

    def test_wind_station_names_when_none_answers(self):
        import ca, tempfile
        ca.fill(self.snap, SPOTS, tempfile.mkdtemp(), self.now, 'hi')
        p = self.snap['spots']['pipeline']
        self.assertEqual((p['dwind'], p['stationName'], p['zh']['stationName']), ([], 'Wheeler', '惠勒'))

    def test_silent_buoy(self):
        # Hanalei's buoy last reported in September: no "right now" reading
        import ca
        ca.fill(self.snap, SPOTS, FIXDIR, self.now, 'hi')
        h = self.snap['spots']['hanalei']
        self.assertEqual((h['buoyId'], h['buoy'], h['buoyAt']), (None, [], ''))
        self.assertTrue(h['buoyQuiet'])   # the page says the Hanalei buoy has no reading right now, not that there is no buoy
        self.assertTrue(h['tides'])
        self.assertFalse(self.snap['spots']['pipeline'].get('buoyQuiet'))

    def test_runs_isolated_like_refresh(self):
        import subprocess, tempfile, shutil
        tmp = tempfile.mkdtemp(); f = os.path.join(tmp, 'snap.json'); shutil.copy(os.path.join(FIXDIR, 'snap_in.json'), f)
        r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'ca.py'), FIXDIR, f, os.path.join(ROOT, 'spots.json'), 'hi'], capture_output=True, text=True, cwd=tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('hi: pipeline', r.stdout)
        self.assertNotIn('blacks', r.stdout)


if __name__ == '__main__':
    unittest.main()
