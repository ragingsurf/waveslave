# California spots and ca.py (NOAA NDBC/CDIP buoys, NDBC and NWS wind, NOAA tides, HRRR wind via Open-Meteo).
# Run: python3 -m unittest discover -s tests -v
import os, sys, json, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
SPOTS = json.load(open(os.path.join(ROOT, 'spots.json')))
CA_IDS = ['oceanbeach', 'steamerlane', 'rincon', 'malibu', 'huntington', 'trestles', 'swamis', 'blacks']
KEYS = ['ndbc', 'buoyKm', 'buoyName', 'windStation', 'stationName', 'tideStation', 'off', 'lat', 'lon', 'blurb', 'cams', 'zh', 'ja']


class Spots(unittest.TestCase):
    def test_ca_spots_complete(self):
        ca = [s for s in SPOTS if s.get('country') == 'ca']
        self.assertEqual([s['id'] for s in ca], CA_IDS)
        for s in ca:
            for k in KEYS: self.assertIn(k, s, s['id'] + ' ' + k)
            self.assertTrue(s['zh']['name'] and s['ja']['name'])
            self.assertNotIn('tz', s)
            self.assertRegex(s['windStation'], r'^(ndbc|nws):[A-Z0-9]+$')
        self.assertEqual(sum(s.get('country', 'tw') == 'tw' for s in SPOTS), 8)
        self.assertEqual(sum(s.get('country') == 'jp' for s in SPOTS), 8)


FIXDIR = os.path.join(HERE, 'fixtures', 'ca')
def FIX(n):
    with open(os.path.join(FIXDIR, n), encoding='utf-8') as f: return f.read()
HDR = '#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE\n#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft\n'
ROW = '2026 10 17 %s %s  MM   MM   MM   %s    13   %s 285     MM    MM  %s    MM   MM   MM    MM\n'


class Readers(unittest.TestCase):
    def test_ndbc_one_row_per_hour(self):
        import ca
        txt = HDR + ROW % ('12', '26', '0.4', '7.6', '22.5') + ROW % ('11', '56', '0.3', '7.0', '22.6') + ROW % ('11', '30', '0.5', '7.2', '22.4') + ROW % ('11', '00', '0.6', '7.1', '22.3')
        r = ca.ndbc_rows(txt)
        self.assertEqual([x[0] for x in r], ['2026-10-17T19:00', '2026-10-17T20:00'])
        self.assertEqual(r[-1], ['2026-10-17T20:00', 0.3, 7.0, 285.0, 22.6])  # 11:56 is nearer 12:00 UTC than 12:26
        self.assertEqual(r[0][1], 0.6)  # 11:00 beats 11:30 for the 11:00 UTC hour

    def test_ndbc_drops_mm(self):
        import ca
        txt = HDR + ROW % ('12', '00', 'MM', '7.6', '22.5') + ROW % ('11', '00', '0.6', '7.1', 'MM')
        self.assertEqual(ca.ndbc_rows(txt), [['2026-10-17T19:00', 0.6, 7.1, 285.0, None]])

    def test_ndbc_fixture(self):
        import ca
        r = ca.ndbc_rows(FIX('ndbc-46254.txt'))
        self.assertEqual(len({x[0] for x in r}), len(r))
        self.assertLessEqual(len(r), 24)
        self.assertEqual(r[-1][0], '2026-10-17T20:00')

    def test_ndbc_wind_kt(self):
        import ca
        self.assertEqual(ca.ndbc_wind(FIX('ndbc-FTPC1.txt')), [['2026-10-17T21:00', 1.9, 150.0]])
        self.assertEqual(ca.ndbc_wind(HDR), [])

    def test_nws_wind(self):
        import ca
        self.assertEqual(ca.nws_wind(json.loads(FIX('nws-KSNA.json'))), [['2026-10-17T21:00', 3.0, 110]])
        self.assertEqual(ca.nws_wind({'properties': {'timestamp': '2026-10-17T12:45:00+00:00', 'windSpeed': {'value': None}, 'windDirection': {'value': None}}}), [])

    def test_tide_days(self):
        import ca
        t = ca.tide_days(json.loads(FIX('tide-9410230.json')))
        self.assertIn(['13:15', 'H', 133], t['2026-10-17'])
        self.assertEqual(sorted(t), sorted(set(t)))

    def test_pacific_offset(self):
        import ca, datetime
        U = datetime.timezone.utc
        self.assertEqual(ca.pacific_offset(datetime.datetime(2026, 10, 17, 12, tzinfo=U)), -7)
        self.assertEqual(ca.pacific_offset(datetime.datetime(2026, 11, 2, 12, tzinfo=U)), -8)


class Fill(unittest.TestCase):
    NOW = None

    def setUp(self):
        import datetime, copy
        self.now = datetime.datetime(2026, 10, 17, 12, tzinfo=datetime.timezone.utc)
        with open(os.path.join(FIXDIR, 'snap_in.json')) as f: self.snap = json.load(f)
        self.before = copy.deepcopy(self.snap)

    def test_fill_from_downloads(self):
        import ca
        ca.fill(self.snap, SPOTS, FIXDIR, self.now)
        b = self.snap['spots']['blacks']
        self.assertEqual((b['buoyId'], b['tz']), ('46254', -7))
        self.assertEqual(b['buoy'][-1][0], '2026-10-17T20:00')
        self.assertEqual(b['buoyAt'], '2026-10-17T20:00')
        self.assertEqual(b['dwind'], [['2026-10-17T21:00', 1.9, 40.0]])
        self.assertEqual(b['wind'][0][:3], ['2026-10-18T00:00', 8.0, 300])
        self.assertIn(['13:15', 'H', 133], b['tides']['2026-10-17'])
        self.assertEqual(self.snap['src']['spots']['blacks'], '2026-10-17T20:00/2026-10-17T21:00')

    def test_rincon_no_buoy(self):
        import ca
        ca.fill(self.snap, SPOTS, FIXDIR, self.now)
        r = self.snap['spots']['rincon']
        self.assertEqual((r['buoyId'], r['buoy'], r['buoyAt']), (None, [], ''))
        self.assertEqual(r['wind'][0][1], 5.0)
        self.assertTrue(r['tides'] and r['dwind'])

    def test_sun_uses_local_date(self):
        import ca
        ca.fill(self.snap, SPOTS, FIXDIR, self.now)
        self.assertEqual(sorted(self.snap['spots']['blacks']['sun']), ['2026-10-17', '2026-10-18'])

    def test_nothing_downloaded(self):
        import ca, tempfile
        ca.fill(self.snap, SPOTS, tempfile.mkdtemp(), self.now)
        b = self.snap['spots']['blacks']
        self.assertEqual((b['buoy'], b['dwind'], b['tides'], b['wind']), ([], [], {}, []))
        for k in ('donghe', 'hasaki'): self.assertEqual(self.snap['spots'][k], self.before['spots'][k])


    def test_runs_isolated_like_refresh(self):
        # refresh.sh runs python3 -I, which leaves the script's folder off sys.path; ca.py must still find jp.py
        import subprocess, tempfile, shutil
        tmp = tempfile.mkdtemp(); f = os.path.join(tmp, 'snap.json'); shutil.copy(os.path.join(FIXDIR, 'snap_in.json'), f)
        r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'ca.py'), FIXDIR, f, os.path.join(ROOT, 'spots.json')], capture_output=True, text=True, cwd=tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('ca: blacks 46254', r.stdout)


if __name__ == '__main__':
    unittest.main()
