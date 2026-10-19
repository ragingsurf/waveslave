# Alaska spots (Yakutat, Sitka, Kodiak, Homer) and ca.py reading them: NOAA NDBC and CDIP buoys, NWS airport and NDBC shore wind,
# NOAA tides, GFS wind via Open-Meteo; and correct.py leaving a far buoy out of the height correction.
# Run: python3 -m unittest discover -s tests -v
import os, sys, json, unittest, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
SPOTS = json.load(open(os.path.join(ROOT, 'spots.json')))
AK_IDS = ['cannonbeach', 'oceancape', 'sandies', 'shelikof', 'sealioncove', 'surfersbeach', 'fossilbeach', 'bishopsbeach']
KEYS = ['zone', 'ndbc', 'buoyKm', 'buoyName', 'windStation', 'stationName', 'tideStation', 'off', 'lat', 'lon', 'blurb', 'cams', 'zh', 'ja']
ZONES = ['America/Yakutat', 'America/Yakutat', 'America/Sitka', 'America/Sitka', 'America/Sitka', 'America/Anchorage', 'America/Anchorage', 'America/Anchorage']
FAR = ['cannonbeach', 'oceancape', 'surfersbeach', 'fossilbeach']  # main buoy 100 km or more away


class Spots(unittest.TestCase):
    def test_ak_spots_complete(self):
        ak = [s for s in SPOTS if s.get('country') == 'ak']
        self.assertEqual([s['id'] for s in ak], AK_IDS)
        self.assertEqual([s['zone'] for s in ak], ZONES)
        for s in ak:
            for k in KEYS: self.assertIn(k, s, s['id'] + ' ' + k)
            self.assertTrue(s['zh']['name'] and s['ja']['name'] and s['zh']['full'] and s['ja']['full'] and s['zh']['region'] and s['ja']['region'])
            self.assertNotIn('tz', s)
            # a buoy's name and distance follow it when a spot falls back to a later buoy
            n = len(s['ndbc'])
            self.assertTrue(n >= 2, s['id'])
            for v in (s['buoyKm'], s['buoyName'], s['zh']['buoyName'], s['ja']['buoyName']): self.assertEqual(len(v), n, s['id'])
            self.assertEqual(s['buoyKm'], sorted(s['buoyKm']), s['id'])  # nearest first
            self.assertEqual(s['buoyKm'][0] >= 100, s['id'] in FAR, s['id'])
            self.assertEqual(len(s['stationName']), len(s['windStation']), s['id'])
            for L in ('zh', 'ja'): self.assertEqual(len(s[L]['stationName']), len(s['windStation']), s['id'] + ' ' + L)
            for w in s['windStation']: self.assertRegex(w, r'^(ndbc|nws):[A-Z0-9]+$')
            self.assertTrue(s['windStation'][0].startswith('nws:PA'), s['id'])  # an airport first: the NOS stations send no wind
            self.assertRegex(s['tideStation'], r'^\d{7}$')
            self.assertTrue(57 < s['lat'] < 60 and -153 < s['lon'] < -135, s['id'])
            self.assertTrue(0 <= s['off'] < 360, s['id'])
            by = s.get('buoyBy')
            self.assertEqual(by, ['cdip', None] if s['id'] == 'bishopsbeach' else None, s['id'])
            self.assertEqual(len(s['zh']['cams']), len(s['cams'])); self.assertEqual(len(s['ja']['cams']), len(s['cams']))
        self.assertEqual(len({s['id'] for s in SPOTS}), len(SPOTS))
        for c in ('tw', 'jp', 'kr', 'ph', 'id', 'ca', 'hi', 'au', 'nz', 'nw', 'pi', 'ak'): self.assertEqual(sum(s.get('country', 'tw') == c for s in SPOTS), 8, c)

    def test_clock_change(self):
        # Yakutat, Sitka and Anchorage time: UTC-8 now, UTC-9 from 02:00 on November 1, the same night as California
        import ca
        U = datetime.timezone.utc
        for z in set(ZONES):
            self.assertEqual(ca.offset('ak', datetime.datetime(2026, 10, 19, tzinfo=U), z), -8, z)
            self.assertEqual(ca.offset('ak', datetime.datetime(2026, 11, 1, 9, 59, tzinfo=U), z), -8, z)
            self.assertEqual(ca.offset('ak', datetime.datetime(2026, 11, 1, 10, 0, tzinfo=U), z), -9, z)
        self.assertEqual(ca.offset('ak', datetime.datetime(2026, 11, 2, tzinfo=U)), -9)  # a spot without its own zone: Anchorage time

    def test_far_only_in_alaska(self):
        # no spot outside Alaska has a main buoy 100 km or more away, so the far rule changes nothing elsewhere
        first = lambda v: v[0] if isinstance(v, list) and v else v if isinstance(v, (int, float)) else 0
        self.assertEqual(sorted(s['id'] for s in SPOTS if first(s.get('buoyKm')) >= 100), sorted(FAR))


FIXDIR = os.path.join(HERE, 'fixtures', 'ak')  # live copies from 2026-10-19 00:26 UTC, less Sitka's buoy 46084 and the Kodiak wind
U = datetime.timezone.utc
NOW = datetime.datetime(2026, 10, 19, 0, 27, tzinfo=U)


class Fill(unittest.TestCase):
    def setUp(self):
        import copy
        with open(os.path.join(FIXDIR, 'snap_in.json')) as f: self.snap = json.load(f)
        self.before = copy.deepcopy(self.snap)

    def test_fill_yakutat(self):
        import ca
        ca.fill(self.snap, SPOTS, FIXDIR, NOW, 'ak')
        c = self.snap['spots']['cannonbeach']
        self.assertEqual((c['buoyId'], c['tz'], c['buoyAt'], c['buoyName'], c['buoyKm'], c['zh']['buoyName'], c['ja']['buoyName']),
                         ('46083', -8, '2026-10-19T08:00', 'Fairweather Ground', 167, '費爾韋瑟淺灘', 'フェアウェザー・グラウンド'))
        self.assertEqual(c['buoy'][-1], ['2026-10-19T08:00', 2.5, 6.9, 246.0, 10.3])
        self.assertTrue(c['buoyFar'])  # 167 km out: shown, but the height correction doesn't learn from it
        self.assertNotIn('buoyBy', c)   # NOAA's own buoy
        self.assertEqual((c['dwind'], c['stationName'], c['ja']['stationName']), ([['2026-10-19T08:00', 5.0, 90]], 'Yakutat Airport', 'ヤクタット空港'))
        self.assertEqual(c['tides']['2026-10-19'], [['02:12', 'L', 72], ['09:27', 'H', 220], ['14:35', 'L', 166], ['20:10', 'H', 236]])
        self.assertEqual(c['wind'][0][:3], ['2026-10-19T00:00', 6.1, 99])
        self.assertEqual(sorted(c['sun']), ['2026-10-18', '2026-10-19'])  # Taipei's 19th, 00-23h, is Yakutat's 18th 08h to 19th 07h
        self.assertEqual(c['sun']['2026-10-19']['rise'], '08:04')
        self.assertEqual(self.snap['src']['spots']['cannonbeach'], '2026-10-19T08:00/2026-10-19T08:00')
        for k in ('donghe', 'blacks', 'coxbay'): self.assertEqual(self.snap['spots'][k], self.before['spots'][k])

    def test_fill_homer(self):
        # Homer's buoy is CDIP's and 16 km out: not far
        import ca
        ca.fill(self.snap, SPOTS, FIXDIR, NOW, 'ak')
        b = self.snap['spots']['bishopsbeach']
        self.assertEqual((b['buoyId'], b['buoyName'], b['buoyKm'], b['buoyBy'], b['buoyMain']), ('46108', 'Lower Cook Inlet', 16, 'cdip', '46108'))
        self.assertNotIn('buoyFar', b)
        self.assertEqual(b['buoy'][-1], ['2026-10-19T08:00', 0.6, 3.8, 222.0, 8.8])
        self.assertEqual((b['dwind'], b['stationName']), ([['2026-10-19T08:00', 4.0, 90]], 'Homer Airport'))
        self.assertEqual(b['tides']['2026-10-19'], [['03:20', 'L', 156], ['10:44', 'H', 400], ['16:03', 'L', 270], ['22:05', 'H', 399]])

    def test_far_by_the_main_buoy(self):
        # Sitka's main buoy (Cape Edgecumbe, 65 km) sent nothing, so Sandy Beach shows Fairweather Ground, 206 km out, by name and
        # distance; the spot isn't far, as its corrections keep learning from Cape Edgecumbe's logged readings
        import ca
        ca.fill(self.snap, SPOTS, FIXDIR, NOW, 'ak')
        s = self.snap['spots']['sandies']
        self.assertEqual((s['buoyId'], s['buoyName'], s['buoyKm'], s['zh']['buoyName'], s['ja']['buoyName'], s['buoyMain']),
                         ('46083', 'Fairweather Ground', 206, '費爾韋瑟淺灘', 'フェアウェザー・グラウンド', '46084'))
        self.assertNotIn('buoyFar', s)
        self.assertEqual((s['dwind'], s['stationName']), ([['2026-10-19T08:00', 4.0, 110]], 'Sitka Airport'))
        k = self.snap['spots']['surfersbeach']
        self.assertEqual((k['buoyId'], k['buoyKm'], k['buoyMain'], k['buoyFar']), ('46080', 145, '46080', True))
        self.assertEqual((k['dwind'], k['stationName']), ([], 'Kodiak Airport'))  # no Kodiak wind in the fixtures: the first station's name

    def test_runs_isolated_like_refresh(self):
        import subprocess, tempfile, shutil
        tmp = tempfile.mkdtemp(); f = os.path.join(tmp, 'snap.json'); shutil.copy(os.path.join(FIXDIR, 'snap_in.json'), f)
        r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'ca.py'), FIXDIR, f, os.path.join(ROOT, 'spots.json'), 'ak'], capture_output=True, text=True, cwd=tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('ak: cannonbeach 46083', r.stdout)
        self.assertNotIn('coxbay', r.stdout)


class Corrections(unittest.TestCase):
    # 20 days of log in which every buoy read twice the forecast and every station 0.8 of it: Homer's height factor goes to the
    # 1.4 cap, Cannon Beach's stays at 1 (its buoy is 167 km out) and isn't scored, and both learn the wind.
    def test_far_buoy_not_learned(self):
        import ca, gzip, subprocess, tempfile
        tmp = tempfile.mkdtemp(); snap = os.path.join(tmp, 'snap.json'); log = os.path.join(tmp, 'log-ak')
        d = json.load(open(os.path.join(FIXDIR, 'snap_in.json'))); ca.fill(d, SPOTS, FIXDIR, NOW, 'ak')
        json.dump(d, open(snap, 'w'))
        tpe = datetime.timezone(datetime.timedelta(hours=8)); today = datetime.datetime.now(tpe).replace(hour=8, minute=0, second=0, microsecond=0)
        os.makedirs(log)
        with gzip.open(os.path.join(log, today.strftime('%Y-%m-%d') + '.jsonl.gz'), 'wt') as fh:
            for i in range(20, 0, -1):
                at = today - datetime.timedelta(days=i); t = lambda h: (at + datetime.timedelta(hours=h)).strftime('%Y-%m-%dT%H:%M')
                spots = {k: {'buoyId': b, 'fc': [[t(24), 1.0, 8.0, 200, 1.0, 8.0, 200, None]], 'windfc': [[t(12), 10.0, 200, None, None]],
                             'buoy': [[t(0), 2.0, 6.0, 200.0, 9.0]], 'station': [[t(12), 8.0, 200]]} for k, b in (('cannonbeach', '46083'), ('bishopsbeach', '46108'))}
                fh.write(json.dumps({'run': (at - datetime.timedelta(hours=8)).strftime('%Y-%m-%dT%H:%M:%SZ'), 'src': {}, 'spots': spots}) + '\n')
        r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'correct.py'), snap, log, 'ak'], capture_output=True, text=True, cwd=tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.load(open(snap))['spots']
        a, b = out['cannonbeach']['adj'], out['bishopsbeach']['adj']
        self.assertEqual((a['f'], a['bands'], a['days'], a['n'], a['acc'], a['wf']), (1.0, {}, 0, 0, None, 0.8))
        self.assertEqual((b['f'], b['bands'], b['days'], b['wf']), (1.4, {'7-9': 1.4}, 20, 0.8))
        self.assertEqual([r[1] for r in out['cannonbeach']['hourly']], [1.8] * 24)  # its heights as forecast
        self.assertEqual([r[1] for r in out['bishopsbeach']['hourly']], [2.5] * 24)  # 1.8 x 1.4


if __name__ == '__main__':
    unittest.main()
