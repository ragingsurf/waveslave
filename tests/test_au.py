# Australian spots and au.py (IMOS/AODN wave buoys, BoM wind now, BoM ACCESS wind forecast and model tides via Open-Meteo).
# Run: python3 -m unittest discover -s tests -v
import os, sys, json, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
SPOTS = json.load(open(os.path.join(ROOT, 'spots.json')))
AU_IDS = ['noosa', 'snapper', 'byron', 'manly', 'bells', 'woolamai', 'margaret', 'trigg']
KEYS = ['zone', 'aodn', 'bomStation', 'buoyKm', 'buoyName', 'stationName', 'off', 'lat', 'lon', 'blurb', 'cams', 'zh', 'ja']


class Spots(unittest.TestCase):
    def test_au_spots_complete(self):
        au = [s for s in SPOTS if s.get('country') == 'au']
        self.assertEqual([s['id'] for s in au], AU_IDS)
        for s in au:
            for k in KEYS: self.assertIn(k, s, s['id'] + ' ' + k)
            self.assertTrue(s['zh']['name'] and s['ja']['name'])
            self.assertNotIn('tz', s)
            self.assertRegex(s['bomStation'], r'^ID[NQVW]60801\.\d{5}$')
            self.assertIn(s['zone'], ('Australia/Brisbane', 'Australia/Sydney', 'Australia/Melbourne', 'Australia/Perth'))
        for c in ('tw', 'jp', 'ca', 'hi'): self.assertEqual(sum(s.get('country', 'tw') == c for s in SPOTS), 8)


FIXDIR = os.path.join(HERE, 'fixtures', 'au')
def FIX(n):
    with open(os.path.join(FIXDIR, n), encoding='utf-8') as f: return f.read()
import datetime
U = datetime.timezone.utc
NOW = datetime.datetime(2026, 10, 17, 14, 45, tzinfo=U)


class Readers(unittest.TestCase):
    def test_aodn_whth_fallback(self):
        # NSW (MHL) and Queensland buoys send height as WHTH and mean period as WPMH; IMOS buoys use WSSH and WPFM
        import au
        r = au.aodn_rows(FIX('aodn-Sydney.csv'), now=NOW)
        self.assertEqual(r[-1], ['2026-10-17T20:00', 1.41, 6.4, 132.0, None])
        c = au.aodn_rows(FIX('aodn-Collaroy_Narrabeen.csv'), now=NOW)
        self.assertEqual(c[-1][:4], ['2026-10-17T22:00', 0.887, 5.724, 98.98])

    def test_aodn_one_row_per_hour_prefers_full_rows(self):
        # Queensland's half-hour rows carry height only (period and direction 0): the full on-the-hour row wins
        import au
        r = au.aodn_rows(FIX('aodn-Tweed_Heads.csv'), now=NOW)
        self.assertEqual(len({x[0] for x in r}), len(r))
        self.assertLessEqual(len(r), 24)
        self.assertIn(['2026-10-17T20:00', 1.64, 4.9, 68.0, None], r)
        # 12:30 UTC, nearest 13:00, height only: period and direction carry over from the full reading half an hour before
        self.assertEqual(r[-1], ['2026-10-17T21:00', 1.55, 4.9, 68.0, None])

    def test_aodn_stale(self):
        import au
        self.assertEqual(au.aodn_rows(FIX('aodn-Cape_Naturaliste.csv'), now=NOW + datetime.timedelta(hours=1)), [])  # newest 09:00 UTC
        self.assertTrue(au.aodn_rows(FIX('aodn-Cape_Naturaliste.csv'), now=datetime.datetime(2026, 10, 17, 10, tzinfo=U)))

    def test_bom_wind(self):
        import au
        js = json.loads(FIX('bom-IDQ60801.94592.json'))
        self.assertEqual(au.bom_wind(js, now=NOW), [['2026-10-17T23:00', 7.0, 180.0]])   # 14:30 UTC on the nearest hour, S
        self.assertEqual(au.bom_wind(js, now=NOW + datetime.timedelta(hours=4)), [])
        calm = {'observations': {'data': [{'aifstime_utc': '20261017140000', 'wind_spd_kt': 0, 'wind_dir': 'CALM'}]}}
        self.assertEqual(au.bom_wind(calm, now=NOW), [['2026-10-17T22:00', 0.0, None]])
        self.assertEqual(au.bom_wind({'observations': {'data': [{'aifstime_utc': '20261017140000', 'wind_spd_kt': None, 'wind_dir': '-'}]}}), [])
        self.assertEqual(au.compass('SSE'), 157.5)

    def test_tide_turning_points(self):
        import au, math
        # 12.42 h tide, highs at 03:00 and 15:25 UTC on the 17th; local Brisbane (+10) dates
        t0 = datetime.datetime(2026, 10, 16, 12, tzinfo=U)
        times = [(t0 + datetime.timedelta(hours=i)).strftime('%Y-%m-%dT%H:%M') for i in range(48)]
        lv = [round(0.6 * math.cos(2 * math.pi * ((i - 15) / 12.42)), 3) for i in range(48)]
        d = au.tide_days(times, lv, 10)
        allp = [(k, x) for k, v in d.items() for x in v]
        hi = [(k, x[0]) for k, x in allp if x[1] == 'H']
        self.assertIn(('2026-10-17', '13:00'), hi)   # 03:00 UTC = 13:00 Brisbane
        self.assertEqual(len(allp), len({(k, x[0]) for k, x in allp}))
        self.assertTrue(all(abs(x[2]) <= 61 for _, x in allp))
        flat = au.tide_days(['2026-10-17T00:00', '2026-10-17T01:00', '2026-10-17T02:00', '2026-10-17T03:00'], [0.1, 0.5, 0.5, 0.1], 10)
        self.assertEqual(sum(len(v) for v in flat.values()), 1)

    def test_tide_pause_mid_slope_is_not_a_turn(self):
        # two equal hours on a rising tide (Perth's slow small tides) are not a high; the real high at 05:00 UTC is
        import au
        times = ['2026-10-17T%02d:00' % h for h in range(8)]
        d = au.tide_days(times, [.1, .2, .3, .3, .4, .5, .4, .3], 8)
        self.assertEqual(d, {'2026-10-17': [['13:00', 'H', 50]]})

    def test_tide_flat_top_sits_mid_run(self):
        import au
        times = ['2026-10-17T%02d:00' % h for h in range(5)]
        d = au.tide_days(times, [.1, .5, .5, .5, .1], 8)
        self.assertEqual(d, {'2026-10-17': [['10:00', 'H', 50]]})


class Fill(unittest.TestCase):
    def setUp(self):
        import copy
        with open(os.path.join(FIXDIR, 'snap_in.json')) as f: self.snap = json.load(f)
        self.before = copy.deepcopy(self.snap)

    def test_fill_per_spot_clock(self):
        # Queensland stays on UTC+10; NSW is on daylight time (UTC+11) from the first Sunday in October
        import au
        au.fill(self.snap, SPOTS, FIXDIR, NOW)
        s, b = self.snap['spots']['snapper'], self.snap['spots']['byron']
        self.assertEqual((s['tz'], b['tz']), (10, 11))
        self.assertEqual((s['buoyId'], s['buoyAt']), ('Tweed Heads', '2026-10-17T21:00'))
        self.assertEqual(s['dwind'], [['2026-10-17T23:00', 7.0, 180.0]])
        self.assertTrue(s['wind'] and s['tides'])
        self.assertEqual(sorted(s['sun']), ['2026-10-18', '2026-10-19'])  # Taipei 18th 00-23h is Brisbane 18th 02h to 19th 01h
        for k in ('donghe', 'blacks'): self.assertEqual(self.snap['spots'][k], self.before['spots'][k])
        self.assertEqual(self.snap['src']['spots']['snapper'], '2026-10-17T21:00/2026-10-17T23:00')

    def test_no_buoy_file(self):
        # Byron's buoy file is not in the fixtures: no reading, but the spot has a buoy, so it is quiet rather than absent
        import au
        au.fill(self.snap, SPOTS, FIXDIR, NOW)
        b = self.snap['spots']['byron']
        self.assertEqual((b['buoyId'], b['buoy'], b['buoyQuiet']), (None, [], True))
        self.assertTrue(b['dwind'])

    def test_nothing_downloaded(self):
        import au, tempfile
        au.fill(self.snap, SPOTS, tempfile.mkdtemp(), NOW)
        s = self.snap['spots']['snapper']
        self.assertEqual((s['buoy'], s['dwind'], s['wind'], s['tides']), ([], [], [], {}))
        self.assertTrue(s['sun'])

    def test_runs_isolated_like_refresh(self):
        import subprocess, tempfile, shutil
        tmp = tempfile.mkdtemp(); f = os.path.join(tmp, 'snap.json'); shutil.copy(os.path.join(FIXDIR, 'snap_in.json'), f)
        r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'au.py'), FIXDIR, f, os.path.join(ROOT, 'spots.json')], capture_output=True, text=True, cwd=tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('au: snapper', r.stdout)


if __name__ == '__main__':
    unittest.main()
