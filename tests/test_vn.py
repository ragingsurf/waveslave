# Vietnam's spots and kr.py's Vietnam run (ECMWF wind from the sea cells and model tides via Open-Meteo, Cam Ranh's airport reports for
# Bai Dai; no buoy).
# Run: python3 -m unittest discover -s tests -v
import os, sys, json, unittest, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
SPOTS = json.load(open(os.path.join(ROOT, 'spots.json')))
VN_IDS = ['mykhe', 'nonnuoc', 'anbang', 'quynhon', 'honchong', 'baidai', 'muine', 'vungtau']
KEYS = ['name', 'full', 'region', 'zone', 'buoyKm', 'buoyName', 'windStation', 'stationName', 'off', 'lat', 'lon', 'blurb', 'cams', 'zh', 'ja']


class Spots(unittest.TestCase):
    def test_vn_spots_complete(self):
        vn = [s for s in SPOTS if s.get('country') == 'vn']
        self.assertEqual([s['id'] for s in vn], VN_IDS)  # north to south, Da Nang to Vung Tau
        for s in vn:
            for k in KEYS: self.assertIn(k, s, s['id'] + ' ' + k)
            self.assertTrue(s['zh']['name'] and s['ja']['name'] and s['zh']['full'] and s['ja']['full'] and s['zh']['region'] and s['ja']['region'])
            self.assertNotIn('tz', s); self.assertNotIn('ndbc', s)
            self.assertEqual(s['zone'], 'Asia/Ho_Chi_Minh')
            self.assertTrue(10.2 < s['lat'] < 16.2 and 107 < s['lon'] < 109.3, s['id'])
            self.assertTrue(0 <= s['off'] < 360, s['id'])
            # no open buoy, as in the Philippines
            self.assertEqual((s['buoyKm'], s['buoyName'], s['zh']['buoyName'], s['ja']['buoyName']), (None, '', '', ''), s['id'])
            # only Bai Dai has an airport that tracks it: Cam Ranh's, on the same beach
            st = (s['windStation'], s['stationName'], s['zh']['stationName'], s['ja']['stationName'])
            if s['id'] == 'baidai': self.assertEqual(st, (['metar:VVCR'], ['Cam Ranh Airport'], ['金蘭機場'], ['カムラン空港']))
            else: self.assertEqual(st, ([], '', '', ''), s['id'])
            self.assertEqual((len(s['zh']['cams']), len(s['ja']['cams'])), (len(s['cams']), len(s['cams'])), s['id'])
        self.assertEqual({s['id']: [c[1] for c in s['cams']] for s in vn if s['cams']}, {'mykhe': ['https://danangsurfcam.com/']})
        self.assertEqual(len({s['id'] for s in SPOTS}), len(SPOTS))
        # after Hainan's and before Papua New Guinea's and Vanuatu's, the last added, so the shared Open-Meteo calls, which list every spot
        # in its order, keep each other spot's place
        self.assertEqual([s['id'] for s in SPOTS[-21:-13]], VN_IDS)

    def test_no_clock_changes(self):
        import au
        for at in (datetime.datetime(2026, 10, 19, tzinfo=U), datetime.datetime(2027, 1, 15, tzinfo=U), datetime.datetime(2027, 7, 1, tzinfo=U)):
            self.assertEqual(au.offset('Asia/Ho_Chi_Minh', at), 7, at)


FIXDIR = os.path.join(HERE, 'fixtures', 'vn')  # live copies from 2026-10-19 13:20 UTC (ECMWF wind from the sea cells, tide model, Cam Ranh's METAR)
def FIX(n):
    with open(os.path.join(FIXDIR, n), encoding='utf-8') as f: return f.read()
U = datetime.timezone.utc
NOW = datetime.datetime(2026, 10, 19, 13, 20, tzinfo=U)


class Readers(unittest.TestCase):
    def test_metar_newest_report(self):
        import kr
        m = json.loads(FIX('metar-vn.json'))
        # 02004KT at 13:00 UTC, 21:00 on Taipei's clock
        self.assertEqual(kr.metar_wind(m, 'VVCR', NOW), [['2026-10-19T21:00', 4.0, 20.0]])
        self.assertEqual(kr.metar_wind(list(reversed(m)), 'VVCR', NOW), [['2026-10-19T21:00', 4.0, 20.0]])
        self.assertEqual(kr.metar_wind(m, 'VVCR', NOW + datetime.timedelta(hours=3)), [])  # 3 h 20 min old by then


class Fill(unittest.TestCase):
    def setUp(self):
        import copy
        with open(os.path.join(FIXDIR, 'snap_in.json')) as f: self.snap = json.load(f)
        self.before = copy.deepcopy(self.snap)

    def test_fill_baidai(self):
        import kr
        kr.fill(self.snap, SPOTS, FIXDIR, NOW, 'vn')
        s = self.snap['spots']['baidai']
        self.assertEqual(s['tz'], 7)  # Vietnam is an hour behind Taipei
        self.assertEqual((s['buoyId'], s['buoy'], s['buoyAt'], s['buoyQuiet']), (None, [], '', False))  # no buoy at all
        self.assertEqual((s['dwind'], s['stationName'], s['zh']['stationName'], s['ja']['stationName']), ([['2026-10-19T21:00', 4.0, 20.0]], 'Cam Ranh Airport', '金蘭機場', 'カムラン空港'))
        self.assertEqual(s['wind'][0], ['2026-10-19T00:00', 6.3, 350, None, None])
        self.assertEqual([r[0][11:13] for r in s['wind']], ['00', '03', '06', '09', '12', '15', '18', '21'])
        # one high and one low a day here, about a metre apart
        self.assertEqual(s['tides']['2026-10-19'], [['00:30', 'H', 133], ['11:00', 'L', 26]])
        # local dates are Vietnam's: Taipei's 19 October, 00:00 to 23:00, is 23:00 on the 18th to 22:00 on the 19th there
        self.assertEqual(sorted(s['sun']), ['2026-10-18', '2026-10-19'])
        self.assertEqual((s['sun']['2026-10-19']['rise'], s['sun']['2026-10-19']['set']), ('05:33', '17:23'))
        self.assertEqual(self.snap['src']['spots']['baidai'], '/2026-10-19T21:00')
        for k in ('donghe', 'jukdo', 'cloud9', 'cheungsha', 'dadonghai'): self.assertEqual(self.snap['spots'][k], self.before['spots'][k])

    def test_only_bai_dai_has_wind_now(self):
        # Hon Chong, 31 km up the coast from Cam Ranh's airport, and the rest have none
        import kr
        kr.fill(self.snap, SPOTS, FIXDIR, NOW, 'vn')
        for k in VN_IDS:
            s = self.snap['spots'][k]
            if k != 'baidai': self.assertEqual((s['dwind'], s['stationName'], self.snap['src']['spots'][k]), ([], '', '/'), k)
        # once Cam Ranh's newest report is over 3 hours old, Bai Dai has none either
        kr.fill(self.snap, SPOTS, FIXDIR, NOW + datetime.timedelta(hours=3), 'vn')
        self.assertEqual((self.snap['spots']['baidai']['dwind'], self.snap['spots']['baidai']['stationName']), ([], 'Cam Ranh Airport'))

    def test_downloads_follow_the_spot_list(self):
        # the Open-Meteo replies hold every Vietnam spot of spots.json in its order, so Quy Nhon (4th) takes the 4th though An Bang (3rd)
        # is missing from the snap
        import kr
        del self.snap['spots']['anbang']
        kr.fill(self.snap, SPOTS, FIXDIR, NOW, 'vn')
        om, tide = json.loads(FIX('openvn.json')), json.loads(FIX('tidevn.json'))
        q = self.snap['spots']['quynhon']
        self.assertEqual(q['wind'][0][:3], ['2026-10-19T00:00', om[3]['hourly']['wind_speed_10m'][0], om[3]['hourly']['wind_direction_10m'][0]])
        self.assertEqual(q['wind'][0][:3], ['2026-10-19T00:00', 5.9, 297])
        self.assertEqual(q['tides']['2026-10-19'], [['00:30', 'H', 133], ['10:50', 'L', 28]])
        # Vung Tau's tide is the biggest of the eight, near 2 m, and runs twice a day
        self.assertEqual(self.snap['spots']['vungtau']['tides']['2026-10-19'], [['03:20', 'H', 160], ['12:53', 'L', -10], ['22:08', 'H', 162]])
        for n, k in enumerate(VN_IDS):
            s = next(x for x in SPOTS if x['id'] == k)
            # the sea cells lie 1.3 to 7.6 km from the spots, the tide cells 4.8 to 20.2 km (MFWAM counts a wide strip of the coast as land)
            self.assertLess(abs(om[n]['latitude'] - s['lat']) + abs(om[n]['longitude'] - s['lon']), 0.1, k)
            self.assertLess(abs(tide[n]['latitude'] - s['lat']) + abs(tide[n]['longitude'] - s['lon']), 0.25, k)

    def test_countries_kept_apart(self):
        # the Hainan run leaves the Vietnam spots alone, and the Vietnam run Hainan's
        import kr, copy
        kr.fill(self.snap, SPOTS, os.path.join(HERE, 'fixtures', 'hn'), NOW, 'hn')
        for k in VN_IDS: self.assertEqual(self.snap['spots'][k], self.before['spots'][k], k)
        c = copy.deepcopy(self.snap['spots']['dadonghai'])
        kr.fill(self.snap, SPOTS, FIXDIR, NOW, 'vn')
        self.assertEqual(self.snap['spots']['dadonghai'], c)

    def test_nothing_downloaded(self):
        import kr, tempfile
        kr.fill(self.snap, SPOTS, tempfile.mkdtemp(), NOW, 'vn')
        s = self.snap['spots']['baidai']
        self.assertEqual((s['tz'], s['buoy'], s['dwind'], s['wind'], s['tides']), (7, [], [], [], {}))
        self.assertTrue(s['sun'])

    def test_runs_isolated_like_refresh(self):
        import subprocess, tempfile, shutil
        tmp = tempfile.mkdtemp(); f = os.path.join(tmp, 'snap.json'); shutil.copy(os.path.join(FIXDIR, 'snap_in.json'), f)
        r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'kr.py'), FIXDIR, f, os.path.join(ROOT, 'spots.json'), 'vn'], capture_output=True, text=True, cwd=tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('vn: mykhe 7 None 0 0 8 4', r.stdout)   # no buoy, no wind now
        self.assertNotIn('dadonghai', r.stdout)
        with open(f) as fh: d = json.load(fh)
        self.assertEqual(d['spots']['vungtau']['tz'], 7)
        self.assertEqual(d['spots']['dadonghai'], json.loads(FIX('snap_in.json'))['spots']['dadonghai'])


class Refresh(unittest.TestCase):
    def loop(self, fail=''):
        # refresh.sh's loop for Korea, the Philippines, Indonesia, Hainan and Vietnam, run under set -e as refresh.sh runs, with a stand-in
        # curl that notes each request and fails one holding fail the way curl -f fails on an HTTP error (exit 22); gives the requests in
        # order and Vietnam's query
        import re, subprocess, tempfile
        with open(os.path.join(ROOT, 'refresh.sh'), encoding='utf-8') as f: sh = f.read()
        get = re.search(r'^get\(\)\{.*?; \}$', sh, re.M).group(0)
        krids = re.search(r'^krids\(\)\{.*?; \}$', sh, re.S | re.M).group(0)
        loop = re.search(r'^for C in kr ph id hn vn; do$.*?^done$', sh, re.S | re.M).group(0)
        tmp = tempfile.mkdtemp(); bin_ = os.path.join(tmp, 'bin'); os.makedirs(bin_); os.makedirs(os.path.join(tmp, 'w', 'dl'))
        with open(os.path.join(bin_, 'curl'), 'w') as f:
            f.write('#!/bin/sh\nfor a; do url=$a; done\necho "$url" >> "$T/calls"\nif [ -n "$F" ]; then case "$url" in *"$F"*) exit 22;; esac; fi\nexit 0\n')
        os.chmod(os.path.join(bin_, 'curl'), 0o755)
        env = dict(os.environ, PATH=bin_ + os.pathsep + os.environ['PATH'], T=tmp, F=fail)
        r = subprocess.run(['sh', '-c', 'set -e\nHERE=$1; W=$2\n%s\n%s\n%s' % (get, krids, loop), 'sh', ROOT, os.path.join(tmp, 'w')], capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(os.path.join(tmp, 'calls')) as f: calls = f.read().split()
        vn = [s for s in SPOTS if s.get('country') == 'vn']
        return calls, 'latitude=%s&longitude=%s' % (','.join(str(s['lat']) for s in vn), ','.join(str(s['lon']) for s in vn))

    def test_wind_forecast_from_the_sea_cells(self):
        # Vietnam's wind forecast asks for the sea cell nearest each spot, ECMWF's first, and Cam Ranh's reports come from the Aviation
        # Weather Center; Hainan asks for its sea cells as before
        calls, q = self.loop()
        self.assertIn('https://api.open-meteo.com/v1/forecast?%s&hourly=wind_speed_10m,wind_direction_10m,precipitation&wind_speed_unit=kn'
                      '&timezone=Asia%%2FTaipei&forecast_days=4&cell_selection=sea&models=ecmwf_ifs' % q, calls)
        self.assertIn('https://marine-api.open-meteo.com/v1/marine?%s&hourly=sea_level_height_msl&timezone=GMT&past_days=5&forecast_days=10' % q, calls)
        self.assertEqual(len([u for u in calls if 'cell_selection' in u and q in u]), 1)  # the stand-in answers, so the default model isn't asked for
        self.assertIn('https://aviationweather.gov/api/data/metar?ids=VVCR&format=json&hours=3', calls)
        hn = [s for s in SPOTS if s.get('country') == 'hn']
        self.assertEqual(len([u for u in calls if 'cell_selection=sea&models=ecmwf_ifs' in u and 'latitude=%s,' % hn[0]['lat'] in u]), 1)
        # Korea, the Philippines and Indonesia ask for their default cells as before: only Hainan's and Vietnam's of the five ask for the sea
        hq = 'latitude=%s&longitude=%s' % (','.join(str(s['lat']) for s in hn), ','.join(str(s['lon']) for s in hn))
        wind = [u for u in calls if u.startswith('https://api.open-meteo.com/v1/forecast?')]
        self.assertEqual(len(wind), 5)
        self.assertEqual([u for u in wind if 'cell_selection' in u], [u for u in wind if q in u or hq in u])

    def test_fallback_from_the_sea_cells_too(self):
        # When ECMWF's reply fails, the default model is asked for, still from the sea cells
        calls, q = self.loop('cell_selection=sea&models=ecmwf_ifs')
        u = 'https://api.open-meteo.com/v1/forecast?%s&hourly=wind_speed_10m,wind_direction_10m,precipitation&wind_speed_unit=kn&timezone=Asia%%2FTaipei&forecast_days=4' % q
        self.assertEqual([x for x in calls if x.startswith(u)], [u + '&cell_selection=sea&models=ecmwf_ifs', u + '&cell_selection=sea&models=best_match'])


if __name__ == '__main__':
    unittest.main()
