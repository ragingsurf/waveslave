# Baja's spots and pi.py's fifth group (CDIP's Point Loma South buoy via NOAA NDBC for K-38, ECMWF wind from the sea cells via Open-Meteo,
# NOAA's tide predictions in UTC for the three northern spots, Open-Meteo's tide model for the other five; no airport report).
# Run: python3 -m unittest discover -s tests -v
import os, sys, json, unittest, datetime
from zoneinfo import ZoneInfo
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
SPOTS = json.load(open(os.path.join(ROOT, 'spots.json')))
BJ_IDS = ['kthirtyeight', 'sanmiguel', 'killers', 'puntabaja', 'abreojos', 'scorpion', 'sanpedrito', 'cerritos']
KEYS = ['name', 'full', 'region', 'zone', 'ndbc', 'buoyKm', 'buoyName', 'windStation', 'stationName', 'tideStation', 'off', 'lat', 'lon', 'blurb', 'cams', 'zh', 'ja']
# Baja California keeps the United States' clock changes (Tijuana's time), Baja California Sur stays on UTC-7 (Mazatlán's)
ZONES = ['America/Tijuana'] * 4 + ['America/Mazatlan'] * 4
TIDES = ['9410120', 'TWC0403', 'TWC0403', None, None, None, None, None]  # NOAA's station (Imperial Beach, Ensenada), or None for the tide model
U = datetime.timezone.utc


class Spots(unittest.TestCase):
    def test_bj_spots_complete(self):
        bj = [s for s in SPOTS if s.get('country') == 'bj']
        self.assertEqual([s['id'] for s in bj], BJ_IDS)  # north to south
        self.assertEqual([s['zone'] for s in bj], ZONES)
        self.assertEqual([s['tideStation'] for s in bj], TIDES)
        for s in bj:
            for k in KEYS: self.assertIn(k, s, s['id'] + ' ' + k)
            self.assertTrue(s['zh']['name'] and s['ja']['name'] and s['zh']['full'] and s['ja']['full'] and s['zh']['region'] and s['ja']['region'])
            self.assertNotIn('tz', s)
            self.assertTrue(23 < s['lat'] < 32.6 and -117.1 < s['lon'] < -110, s['id'])
            self.assertTrue(0 <= s['off'] < 360, s['id'])
            # no airport or station that tracks a spot's wind
            self.assertEqual((s['windStation'], s['stationName'], s['zh']['stationName'], s['ja']['stationName']), ([], '', '', ''), s['id'])
            self.assertEqual(len(s['zh']['cams']), len(s['cams'])); self.assertEqual(len(s['ja']['cams']), len(s['cams']))
        # K-38 takes CDIP's Point Loma South, 50 km up the coast, near enough for correct.py to learn from (ca.FAR_KM); the rest have no buoy
        import ca
        k = bj[0]
        self.assertEqual((k['ndbc'], k['buoyKm'], k['buoyName'], k['zh']['buoyName'], k['ja']['buoyName'], k['buoyBy']),
                         (['46232'], [50], ['Point Loma South'], ['洛馬角南'], ['ポイント・ロマ南'], 'cdip'))
        self.assertLess(k['buoyKm'][0], ca.FAR_KM)
        for s in bj[1:]:
            self.assertEqual((s['ndbc'], s['buoyKm'], s['buoyName'], s['zh']['buoyName'], s['ja']['buoyName']), ([], None, '', '', ''), s['id'])
            self.assertNotIn('buoyBy', s)
        # K-38 to Scorpion Bay west of 111.5°W, where the map splits Baja's two home views, San Pedrito and Cerritos east of it
        self.assertEqual([s['lon'] < -111.5 for s in bj], [True] * 6 + [False] * 2)
        # the offshore wind of each, the landward normal checked against the guides' best wind (the spec's table): a range check alone would
        # let a south-facing point's 180 pass as 0
        self.assertEqual({s['id']: s['off'] for s in bj}, {'kthirtyeight': 45, 'sanmiguel': 70, 'killers': 100, 'puntabaja': 0, 'abreojos': 340,
                                                            'scorpion': 340, 'sanpedrito': 50, 'cerritos': 50})
        self.assertEqual(len({s['id'] for s in SPOTS}), len(SPOTS))
        # last in spots.json, so the shared Open-Meteo calls, which list every spot in its order, keep each other spot's place
        self.assertEqual([s['id'] for s in SPOTS[-8:]], BJ_IDS)

    def test_clock_changes(self):
        # Tijuana's clock goes back at 02:00 on November 1 (09:00 UTC) and forward on March 14, as California's; Mazatlán's never changes
        import au
        for at, north in ((datetime.datetime(2026, 10, 20, tzinfo=U), -7), (datetime.datetime(2026, 11, 1, 8, 59, tzinfo=U), -7),
                          (datetime.datetime(2026, 11, 1, 9, tzinfo=U), -8), (datetime.datetime(2027, 1, 15, tzinfo=U), -8),
                          (datetime.datetime(2027, 3, 14, 10, tzinfo=U), -7), (datetime.datetime(2027, 7, 1, tzinfo=U), -7)):
            self.assertEqual(au.offset('America/Tijuana', at), north, at)
            self.assertEqual(au.offset('America/Mazatlan', at), -7, at)


FIXDIR = os.path.join(HERE, 'fixtures', 'bj')  # live copies from 2026-10-20 20:13 UTC
def FIX(n):
    with open(os.path.join(FIXDIR, n), encoding='utf-8') as f: return f.read()
NOW = datetime.datetime(2026, 10, 20, 20, 13, tzinfo=U)
NOV = datetime.datetime(2026, 11, 2, 20, 13, tzinfo=U)  # a build after the north's clock has gone back


class Readers(unittest.TestCase):
    def test_noaa_tides_on_each_clock(self):
        import pi
        # Imperial Beach's tides, asked for in UTC, on Tijuana's clock (UTC-7): the 07:40 UTC low on the 21st is 00:40 there
        t = pi.noaa_tides(json.loads(FIX('tidebj-9410120.json')), ZoneInfo('America/Tijuana'))
        self.assertEqual(t['2026-10-21'], [['00:40', 'L', 21], ['07:16', 'H', 138], ['12:57', 'L', 62], ['18:46', 'H', 141]])
        # Ensenada's, 19 minutes earlier
        t = pi.noaa_tides(json.loads(FIX('tidebj-TWC0403.json')), ZoneInfo('America/Tijuana'))
        self.assertEqual(t['2026-10-21'], [['00:32', 'L', 19], ['06:57', 'H', 137], ['12:49', 'L', 58], ['18:27', 'H', 140]])
        # each event takes the offset of its own moment: on the night the clock goes back, 08:30 and 09:30 UTC both read 01:30
        t = pi.noaa_tides({'predictions': [{'t': '2026-11-01 08:30', 'v': '1.0', 'type': 'H'}, {'t': '2026-11-01 09:30', 'v': '0.5', 'type': 'L'}]},
                          ZoneInfo('America/Tijuana'))
        self.assertEqual(t, {'2026-11-01': [['01:30', 'H', 100], ['01:30', 'L', 50]]})

    def test_buoy(self):
        import ca
        # Point Loma South reads at :26 and :56, so each hour takes the :56 reading before it; 20:00 UTC is 04:00 on Taipei's clock
        r = ca.ndbc_rows(FIX('ndbc-46232.txt'), now=NOW)
        self.assertEqual(len(r), 24)
        self.assertEqual(r[-2:], [['2026-10-21T03:00', 1.6, 10.3, 198.0, 24.2], ['2026-10-21T04:00', 1.6, 10.0, 197.0, 24.3]])


class Fill(unittest.TestCase):
    def setUp(self):
        import copy
        with open(os.path.join(FIXDIR, 'snap_in.json')) as f: self.snap = json.load(f)
        self.before = copy.deepcopy(self.snap)

    def fill(self, now=NOW, dl=FIXDIR):
        import pi
        pi.fill(self.snap, SPOTS, dl, now, 'bj'); return self.snap['spots']

    def test_fill_k38(self):
        s = self.fill()['kthirtyeight']
        self.assertEqual(s['tz'], -7)  # fifteen hours behind Taipei
        self.assertEqual((s['buoyId'], len(s['buoy']), s['buoy'][-1], s['buoyAt'], s['buoyQuiet']), ('46232', 24, ['2026-10-21T04:00', 1.6, 10.0, 197.0, 24.3], '2026-10-21T04:00', False))
        self.assertEqual((s['buoyName'], s['buoyKm'], s['zh']['buoyName'], s['ja']['buoyName'], s['buoyBy']), ('Point Loma South', 50, '洛馬角南', 'ポイント・ロマ南', 'cdip'))
        self.assertNotIn('buoyMain', s)  # its one buoy
        self.assertEqual((s['dwind'], s['stationName'], s['zh']['stationName'], s['ja']['stationName']), ([], '', '', ''))
        self.assertEqual(s['wind'][0], ['2026-10-21T00:00', 2.9, 204, None, None])
        self.assertEqual([r[0][11:13] for r in s['wind']], ['00', '03', '06', '09', '12', '15', '18', '21'])
        # Imperial Beach's highs and lows, not the model's
        self.assertEqual(s['tides']['2026-10-21'], [['00:40', 'L', 21], ['07:16', 'H', 138], ['12:57', 'L', 62], ['18:46', 'H', 141]])
        self.assertNotIn('tideModel', s)
        # local dates are Baja's: Taipei's 21 October, 00:00 to 23:00, is 09:00 on the 20th to 08:00 on the 21st there
        self.assertEqual(sorted(s['sun']), ['2026-10-20', '2026-10-21'])
        self.assertEqual((s['sun']['2026-10-20']['rise'], s['sun']['2026-10-20']['set']), ('06:54', '18:11'))
        self.assertEqual(self.snap['src']['spots']['kthirtyeight'], '2026-10-21T04:00/')

    def test_fill_ensenada(self):
        # San Miguel and Killers: Ensenada's tides, no buoy (so none to call silent) and no wind now
        sp = self.fill()
        for k in ('sanmiguel', 'killers'):
            s = sp[k]
            self.assertEqual((s['tz'], s['buoyId'], s['buoy'], s['buoyAt'], s['buoyQuiet'], s['buoyName'], s['buoyKm']), (-7, None, [], '', False, '', None), k)
            self.assertNotIn('buoyBy', s)
            self.assertEqual(s['tides']['2026-10-21'], [['00:32', 'L', 19], ['06:57', 'H', 137], ['12:49', 'L', 58], ['18:27', 'H', 140]], k)
            self.assertNotIn('tideModel', s)
            self.assertEqual(self.snap['src']['spots'][k], '/')
        # the sea cells nearest San Miguel and Killers differ, and so does their wind
        self.assertEqual((sp['sanmiguel']['wind'][0], sp['killers']['wind'][0]), (['2026-10-21T00:00', 1.9, 143, None, None], ['2026-10-21T00:00', 0.3, 72, None, None]))

    def test_every_spot_alike(self):
        sp = self.fill()
        for k in BJ_IDS:
            s = sp[k]
            self.assertEqual((s['tz'], s['dwind'], len(s['wind'])), (-7, [], 8), k)
            self.assertEqual(sorted(s['sun']), ['2026-10-20', '2026-10-21'], k)
        self.assertEqual((sp['cerritos']['sun']['2026-10-20']['rise'], sp['cerritos']['sun']['2026-10-20']['set']), ('06:19', '17:52'))

    def test_model_tides(self):
        # Punta Baja to Cerritos take the tide model, in the order the reply lists them, and say so
        import au
        sp = self.fill(); m = json.loads(FIX('tidebj.json'))
        for i, k in enumerate(BJ_IDS[3:]):
            self.assertTrue(sp[k]['tideModel'], k)
            self.assertEqual(sp[k]['tides'], au.tide_days(m[i]['hourly']['time'], m[i]['hourly']['sea_level_height_msl'], -7), k)
        self.assertEqual(sp['puntabaja']['tides']['2026-10-21'], [['06:30', 'H', 97], ['12:06', 'L', 25], ['17:50', 'H', 100]])
        self.assertEqual(sp['cerritos']['tides']['2026-10-21'], [['05:37', 'H', 114], ['11:36', 'L', 42], ['17:18', 'H', 110], ['23:35', 'L', 18]])

    def test_after_the_clock_change(self):
        # A build after November 1 puts the north on UTC-8 and leaves Baja California Sur on UTC-7. NOAA's tides keep each event's own
        # offset, while the tide model's highs and lows and the sun, like California's hours, take the offset the build ran with.
        # Thirteen days on, Point Loma South's readings are long stale.
        sp = self.fill(NOV)
        self.assertEqual([sp[k]['tz'] for k in BJ_IDS], [-8] * 4 + [-7] * 4)
        self.assertEqual(sp['kthirtyeight']['tides']['2026-10-21'][0], ['00:40', 'L', 21])
        self.assertEqual(sp['puntabaja']['tides']['2026-10-21'][0], ['05:30', 'H', 97])
        self.assertEqual(sp['cerritos']['tides']['2026-10-21'][0], ['05:37', 'H', 114])
        self.assertEqual(sp['kthirtyeight']['sun']['2026-10-20']['rise'], '05:54')
        k = sp['kthirtyeight']
        self.assertEqual((k['buoyId'], k['buoy'], k['buoyAt'], k['buoyQuiet'], k['buoyName']), (None, [], '', True, 'Point Loma South'))

    def test_downloads_follow_the_spot_list(self):
        # the ECMWF reply holds every Baja spot of spots.json in its order, and the tide model's the five without a station, so with San Miguel
        # and Scorpion Bay missing from the snap, Killers still takes the 3rd forecast and Cerritos the 8th and the 5th tide model
        import au
        for k in ('sanmiguel', 'scorpion'): del self.snap['spots'][k]
        sp = self.fill(); om, m = json.loads(FIX('openbj.json')), json.loads(FIX('tidebj.json'))
        for k, i in (('killers', 2), ('cerritos', 7)):
            self.assertEqual(sp[k]['wind'][0][:3], ['2026-10-21T00:00', om[i]['hourly']['wind_speed_10m'][0], om[i]['hourly']['wind_direction_10m'][0]], k)
        self.assertEqual(sp['cerritos']['wind'][0][:3], ['2026-10-21T00:00', 1.8, 338])
        self.assertEqual(sp['cerritos']['tides'], au.tide_days(m[4]['hourly']['time'], m[4]['hourly']['sea_level_height_msl'], -7))
        import math
        km = lambda c, s: math.hypot((c['latitude'] - s['lat']) * 111.2, (c['longitude'] - s['lon']) * 111.2 * math.cos(math.radians(s['lat'])))
        bj = [s for s in SPOTS if s.get('country') == 'bj']
        # the sea cells lie 1.6 to 6.5 km from the spots, the tide model's 1.4 to 8.4 km
        for c, s in zip(om, bj): self.assertLess(km(c, s), 7, s['id'])
        for c, s in zip(m, [s for s in bj if not s['tideStation']]): self.assertLess(km(c, s), 9, s['id'])

    def test_groups_kept_apart(self):
        # Vanuatu's run leaves Baja's spots alone, and Baja's run Vanuatu's, California's and the other countries'
        import pi, copy
        pi.fill(self.snap, SPOTS, os.path.join(HERE, 'fixtures', 'vu'), NOW, 'vu')
        for k in BJ_IDS: self.assertEqual(self.snap['spots'][k], self.before['spots'][k], k)
        self.assertNotEqual(self.snap['spots']['devils'], self.before['spots']['devils'])
        o = {k: copy.deepcopy(self.snap['spots'][k]) for k in ('donghe', 'ppass', 'devils', 'blacks')}
        self.fill()
        for k, v in o.items(): self.assertEqual(self.snap['spots'][k], v, k)

    def test_nothing_downloaded(self):
        import tempfile
        sp = self.fill(dl=tempfile.mkdtemp())
        for k in BJ_IDS:
            s = sp[k]
            self.assertEqual((s['tz'], s['buoy'], s['buoyQuiet'], s['dwind'], s['wind'], s['tides']), (-7, [], k == 'kthirtyeight', [], [], {}), k)
            self.assertTrue(s['sun'], k)
            self.assertEqual(s.get('tideModel'), True if k in BJ_IDS[3:] else None, k)  # the page still says the model's tides, when it has some, are the model's

    def test_runs_isolated_like_refresh(self):
        import subprocess, tempfile, shutil
        tmp = tempfile.mkdtemp(); f = os.path.join(tmp, 'snap.json'); shutil.copy(os.path.join(FIXDIR, 'snap_in.json'), f)
        r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'pi.py'), FIXDIR, f, os.path.join(ROOT, 'spots.json'), 'bj'], capture_output=True, text=True, cwd=tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        # the buoy goes quiet and the north's clock goes back as the clock runs on, so those depend on it; the forecast and the tides don't
        self.assertRegex(r.stdout, r'bj: kthirtyeight -[78] \S+ \d+ 0 8 18\n')  # 18 days of Imperial Beach's tides
        self.assertIn('bj: cerritos -7 None 0 0 8 4\n', r.stdout)  # no buoy, no wind now, 8 forecast hours, 4 days of the model's tides
        self.assertNotIn('vu:', r.stdout)
        with open(f) as fh: d = json.load(fh)
        self.assertEqual(d['spots']['cerritos']['tides']['2026-10-21'][0], ['05:37', 'H', 114])
        self.assertEqual(d['spots']['devils'], json.loads(FIX('snap_in.json'))['spots']['devils'])


class Refresh(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(ROOT, 'refresh.sh'), encoding='utf-8') as f: self.sh = f.read()
        bj = [s for s in SPOTS if s.get('country') == 'bj']
        self.lat, self.lon = ','.join(str(s['lat']) for s in bj), ','.join(str(s['lon']) for s in bj)
        m = [s for s in bj if not s['tideStation']]
        self.mlat, self.mlon = ','.join(str(s['lat']) for s in m), ','.join(str(s['lon']) for s in m)

    def test_refresh_lists_match(self):
        # refresh.sh's piids lists what pi.py reads for Baja: every spot in order, Point Loma South, no airport, NOAA's two stations, and the
        # tide model's five in order
        import re, subprocess
        piids = re.search(r'^piids\(\)\{.*?; \}$', self.sh, re.S | re.M).group(0)
        got = {f: subprocess.run(['sh', '-c', 'HERE=$1\n' + piids + '\npiids bj $2', 'sh', ROOT, f], capture_output=True, text=True).stdout.strip()
               for f in ('lat', 'lon', 'ndbc', 'metar', 'tideStation', 'mlat', 'mlon')}
        self.assertEqual(got, {'lat': self.lat, 'lon': self.lon, 'ndbc': '46232', 'metar': '', 'tideStation': '9410120,TWC0403', 'mlat': self.mlat, 'mlon': self.mlon})

    def loop(self, fail=''):
        # refresh.sh's island loop for Baja alone, run under set -e as refresh.sh runs, with a stand-in curl that notes each request and
        # fails one holding fail the way curl -f fails on an HTTP error (exit 22); gives the requests in order
        import re, subprocess, tempfile
        get = re.search(r'^get\(\)\{.*?; \}$', self.sh, re.M).group(0)
        piids = re.search(r'^piids\(\)\{.*?; \}$', self.sh, re.S | re.M).group(0)
        loop = re.search(r'^for C in pi mi pg vu bj; do$.*?^done$', self.sh, re.S | re.M).group(0)
        tmp = tempfile.mkdtemp(); bin_ = os.path.join(tmp, 'bin'); os.makedirs(bin_); os.makedirs(os.path.join(tmp, 'w', 'dl'))
        with open(os.path.join(bin_, 'curl'), 'w') as f:
            f.write('#!/bin/sh\nfor a; do url=$a; done\necho "$url" >> "$T/calls"\nif [ -n "$F" ]; then case "$url" in *"$F"*) exit 22;; esac; fi\nexit 0\n')
        os.chmod(os.path.join(bin_, 'curl'), 0o755)
        env = dict(os.environ, PATH=bin_ + os.pathsep + os.environ['PATH'], T=tmp, F=fail)
        r = subprocess.run(['sh', '-c', 'set -e\nHERE=$1; W=$2\n%s\n%s\n%s' % (get, piids, loop.replace('for C in pi mi pg vu bj; do', 'for C in bj; do', 1)), 'sh', ROOT, os.path.join(tmp, 'w')],
                           capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(os.path.join(tmp, 'calls')) as f: return f.read().split()

    def test_buoy_wind_from_the_sea_cells_and_tides(self):
        # Baja asks NDBC for Point Loma South, ECMWF for the wind from the sea cell nearest each spot, NOAA for Imperial Beach's and
        # Ensenada's tides and Open-Meteo for the tide model at the other five, and nothing of the Aviation Weather Center
        import re
        calls = self.loop()
        self.assertEqual(calls[:2], ['https://www.ndbc.noaa.gov/data/realtime2/46232.txt',
                                     'https://api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s&hourly=wind_speed_10m,wind_direction_10m,precipitation'
                                     '&wind_speed_unit=kn&timezone=Asia%%2FTaipei&forecast_days=4&cell_selection=sea&models=ecmwf_ifs' % (self.lat, self.lon)])
        self.assertEqual([re.sub(r'begin_date=\d{8}', 'begin_date=D', u) for u in calls[2:4]],
                         ['https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&station=%s&begin_date=D&range=408&datum=MLLW'
                          '&interval=hilo&units=metric&time_zone=gmt&format=json&application=waveslave.tw' % t for t in ('9410120', 'TWC0403')])
        self.assertEqual(calls[4:], ['https://marine-api.open-meteo.com/v1/marine?latitude=%s&longitude=%s&hourly=sea_level_height_msl&timezone=GMT'
                                     '&past_days=6&forecast_days=10' % (self.mlat, self.mlon)])
        self.assertFalse([u for u in calls if 'aviationweather' in u])

    def test_fallback_from_the_sea_cells_too(self):
        # When ECMWF's reply fails, Open-Meteo's default model is asked for, still from the sea cells
        u = 'https://api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s&hourly=wind_speed_10m,wind_direction_10m,precipitation&wind_speed_unit=kn' \
            '&timezone=Asia%%2FTaipei&forecast_days=4&cell_selection=sea' % (self.lat, self.lon)
        self.assertEqual([x for x in self.loop('cell_selection=sea&models=ecmwf_ifs') if x.startswith(u)], [u + '&models=ecmwf_ifs', u])

    def test_grid_and_page(self):
        # the map's grid for Baja, 1° apart over 21–35°N, 119–108°W, refetched every ~6 h, and its place in the page
        self.assertIn('regrid bj 350 21 1 15 -119 1 12\n', self.sh)
        self.assertIn('GBJ="$G/grid-bj.json"; [ -f "$GBJ" ] || { echo null > "$W/gridnull.json"; GBJ="$W/gridnull.json"; }\n', self.sh)
        page = [l for l in self.sh.split('\n') if "replace('__GRIDBJ__'" in l]
        self.assertEqual(len(page), 1)
        self.assertIn(".replace('__GRIDBJ__',open(sys.argv[19]).read())", page[0])
        self.assertEqual(page[0].split('.read()))" ', 1)[1].split(' ')[18], '"$GBJ"')  # sys.argv[19]


if __name__ == '__main__':
    unittest.main()
