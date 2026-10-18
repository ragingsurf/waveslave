# Pacific Northwest spots (Tofino, Washington, Oregon) and ca.py reading them: NOAA NDBC, CDIP and Environment Canada buoys,
# NDBC, NWS and ECCC wind, NOAA and CHS tides, HRRR/GFS wind via Open-Meteo.
# Run: python3 -m unittest discover -s tests -v
import os, sys, json, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
SPOTS = json.load(open(os.path.join(ROOT, 'spots.json')))
NW_IDS = ['coxbay', 'longbeach', 'lapush', 'westport', 'seaside', 'shortsands', 'otterrock', 'bastendorff']
KEYS = ['zone', 'ndbc', 'buoyKm', 'buoyName', 'windStation', 'stationName', 'tideStation', 'off', 'lat', 'lon', 'blurb', 'cams', 'zh', 'ja']


class Spots(unittest.TestCase):
    def test_nw_spots_complete(self):
        nw = [s for s in SPOTS if s.get('country') == 'nw']
        self.assertEqual([s['id'] for s in nw], NW_IDS)
        for s in nw:
            for k in KEYS: self.assertIn(k, s, s['id'] + ' ' + k)
            self.assertTrue(s['zh']['name'] and s['ja']['name'])
            self.assertNotIn('tz', s)
            self.assertIn(s['zone'], ('America/Los_Angeles', 'America/Vancouver'))
            # a buoy's name and distance follow it when a spot falls back to its second buoy
            n = len(s['ndbc'])
            self.assertTrue(n >= 1)
            for v in (s['buoyKm'], s['buoyName'], s['zh']['buoyName'], s['ja']['buoyName']): self.assertEqual(len(v), n, s['id'])
            self.assertEqual(len(s['stationName']), len(s['windStation']), s['id'])
            for L in ('zh', 'ja'): self.assertEqual(len(s[L]['stationName']), len(s['windStation']), s['id'] + ' ' + L)
            for w in s['windStation']: self.assertRegex(w, r'^(ndbc|nws|eccc):[A-Z0-9]+$')
            self.assertRegex(s['tideStation'], r'^(\d{7}|chs:\d{5})$')
            self.assertTrue(43 < s['lat'] < 49.5 and -126 < s['lon'] < -123.5)
            bc = s['zone'] == 'America/Vancouver'
            self.assertEqual(s.get('buoyBy'), 'eccc' if bc else None, s['id'])
            self.assertEqual(s['tideStation'].startswith('chs:'), bc, s['id'])
        for c in ('tw', 'jp', 'ca', 'hi', 'au'): self.assertEqual(sum(s.get('country', 'tw') == c for s in SPOTS), 8)


FIXDIR = os.path.join(HERE, 'fixtures', 'nw')  # live copies from 2026-10-18 02:03 UTC
def FIX(n):
    with open(os.path.join(FIXDIR, n), encoding='utf-8') as f: return f.read()


class Readers(unittest.TestCase):
    def setUp(self):
        import datetime
        self.now = datetime.datetime(2026, 10, 18, 2, 30, tzinfo=datetime.timezone.utc)

    def test_canadian_buoy_peak_period(self):
        # Environment Canada buoys send height and peak period only: the period is stored as peak / 1.3 (the page shows
        # average period x 1.3), and the direction stays empty rather than 0
        import ca
        r = ca.ndbc_rows(FIX('ndbc-46206.txt'), now=self.now)
        self.assertEqual(r[-1], ['2026-10-18T09:00', 2.7, 6.9, None, 11.3])
        self.assertEqual(len(r), 24)

    def test_average_period_kept(self):
        # a buoy with an average period keeps it, peak period or not
        import ca
        self.assertEqual(ca.ndbc_rows(FIX('ndbc-46029.txt'), now=self.now)[-1], ['2026-10-18T09:00', 2.5, 7.3, 281.0, 14.6])

    def test_eccc_wind(self):
        import ca, datetime
        js = json.loads(FIX('eccc-1038210.json'))
        self.assertEqual(ca.eccc_wind(js, self.now), [['2026-10-18T10:00', 1.6, 10]])   # 2.9 km/h at 02:00 UTC
        self.assertEqual(ca.eccc_wind(js, self.now + datetime.timedelta(hours=3)), [])  # over 3 hours old
        self.assertEqual(ca.eccc_wind({'features': []}), [])
        self.assertEqual(ca.eccc_wind(None), [])

    def test_eccc_wind_units_and_backup_average(self):
        import ca
        f = lambda p: {'features': [{'properties': dict({'date_tm-value': '2026-10-18T02:00:00.000Z'}, **p)}]}
        self.assertEqual(ca.eccc_wind(f({'avg_wnd_spd_10m_pst2mts': 5.0, 'avg_wnd_spd_10m_pst2mts-uom': 'm/s', 'avg_wnd_dir_10m_pst2mts': 200})),
                         [['2026-10-18T10:00', 9.7, 200]])
        self.assertEqual(ca.eccc_wind(f({'avg_wnd_spd_10m_pst10mts': None, 'avg_wnd_dir_10m_pst10mts': None})), [])

    def test_chs_tides_local_dates(self):
        # CHS sends UTC times and no high/low label; 03:08 UTC on the 12th is 20:08 on the 11th in Tofino
        import ca
        from zoneinfo import ZoneInfo
        t = ca.chs_tides(json.loads(FIX('chs-08615.json')), ZoneInfo('America/Vancouver'))
        self.assertEqual(t['2026-10-11'], [['20:08', 'L', 49]])
        self.assertEqual(t['2026-10-12'][0], ['02:24', 'H', 326])
        rows = [r for d in sorted(t) for r in t[d]]
        self.assertEqual(len(rows), 62)
        self.assertTrue(all(a[1] != b[1] for a, b in zip(rows, rows[1:])))  # highs and lows take turns
        self.assertEqual(ca.chs_tides(None, ZoneInfo('America/Vancouver')), {})

    def test_offset_by_zone(self):
        # British Columbia moved to permanent UTC-7 in March 2026 (tz database 2026b): from November 1 Tofino stays on
        # UTC-7 while Washington and Oregon fall back to UTC-8, so each spot's own zone gives its offset
        import ca, datetime
        U = datetime.timezone.utc
        nov = datetime.datetime(2026, 11, 2, 12, tzinfo=U)
        self.assertEqual(ca.offset('nw', datetime.datetime(2026, 10, 18, tzinfo=U)), -7)
        self.assertEqual(ca.offset('nw', nov), -8)
        self.assertEqual(ca.offset('nw', nov, 'America/Los_Angeles'), -8)
        self.assertEqual(ca.offset('nw', nov, 'America/Vancouver'), -7)


class Fill(unittest.TestCase):
    def setUp(self):
        import datetime, copy
        self.now = datetime.datetime(2026, 10, 18, 2, 30, tzinfo=datetime.timezone.utc)
        with open(os.path.join(FIXDIR, 'snap_in.json')) as f: self.snap = json.load(f)
        self.before = copy.deepcopy(self.snap)

    def test_fill_tofino(self):
        import ca
        ca.fill(self.snap, SPOTS, FIXDIR, self.now, 'nw')
        c = self.snap['spots']['coxbay']
        self.assertEqual((c['buoyId'], c['tz'], c['buoyAt'], c['buoyBy']), ('46206', -7, '2026-10-18T09:00', 'eccc'))
        self.assertEqual((c['buoyName'], c['buoyKm'], c['zh']['buoyName'], c['ja']['buoyName']), ('La Perouse Bank', 30, '拉佩魯斯淺灘', 'ラペルーズバンク'))
        self.assertEqual((c['dwind'], c['stationName']), ([['2026-10-18T10:00', 1.6, 10]], 'Tofino Airport'))
        self.assertEqual(sorted(c['tides'])[0], '2026-10-11')
        self.assertEqual(c['wind'][0][:3], ['2026-10-18T00:00', 7.5, 335])
        self.assertEqual(sorted(c['sun']), ['2026-10-17', '2026-10-18'])  # Taipei 18th 00-23h is PDT 17th 09h to 18th 08h
        self.assertEqual(self.snap['src']['spots']['coxbay'], '2026-10-18T09:00/2026-10-18T10:00')
        for k in ('donghe', 'blacks'): self.assertEqual(self.snap['spots'][k], self.before['spots'][k])

    def test_backup_buoy_named(self):
        # Seaside's Clatsop Spit buoy sent nothing (no file), so the Columbia River Bar buoy, its name and its distance are used
        import ca
        ca.fill(self.snap, SPOTS, FIXDIR, self.now, 'nw')
        s = self.snap['spots']['seaside']
        self.assertEqual((s['buoyId'], s['buoyKm'], s['buoyName'], s['zh']['buoyName'], s['ja']['buoyName']),
                         ('46029', 48, 'Columbia River Bar', '哥倫比亞河口沙洲', 'コロンビア川河口'))
        self.assertEqual(s['buoy'][-1], ['2026-10-18T09:00', 2.5, 7.3, 281.0, 14.6])
        self.assertEqual((s['dwind'], s['stationName']), ([['2026-10-18T10:00', 10.0, 330]], 'Astoria Airport'))
        self.assertIn(['02:49', 'H', 220], s['tides']['2026-10-12'])
        self.assertNotIn('buoyBy', s)

    def test_far_buoy_and_shore_wind(self):
        import ca
        ca.fill(self.snap, SPOTS, FIXDIR, self.now, 'nw')
        p = self.snap['spots']['lapush']
        self.assertEqual((p['buoyId'], p['buoyKm'], p['buoyName']), ('46041', 62, 'Cape Elizabeth'))
        self.assertEqual(p['buoy'][-1], ['2026-10-18T09:00', 2.3, 7.1, 273.0, 14.0])
        self.assertEqual((p['dwind'], p['stationName'], p['ja']['stationName']), ([['2026-10-18T10:00', 1.0, 50.0]], 'La Push', 'ラプッシュ'))
        self.assertEqual(p['tides'], {})  # no La Push tide file in the fixtures

    def test_silent_buoy_keeps_first_name(self):
        # every buoy silent: no reading, and the page names the first buoy
        import ca, datetime
        ca.fill(self.snap, SPOTS, FIXDIR, self.now + datetime.timedelta(hours=8), 'nw')
        s = self.snap['spots']['seaside']
        self.assertEqual((s['buoyId'], s['buoy'], s['buoyQuiet'], s['buoyName'], s['buoyKm']), (None, [], True, 'Clatsop Spit', 29))

    def test_runs_isolated_like_refresh(self):
        import subprocess, tempfile, shutil
        tmp = tempfile.mkdtemp(); f = os.path.join(tmp, 'snap.json'); shutil.copy(os.path.join(FIXDIR, 'snap_in.json'), f)
        r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'ca.py'), FIXDIR, f, os.path.join(ROOT, 'spots.json'), 'nw'], capture_output=True, text=True, cwd=tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('nw: coxbay', r.stdout)
        self.assertNotIn('blacks', r.stdout)


if __name__ == '__main__':
    unittest.main()
