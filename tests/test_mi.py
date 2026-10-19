# Micronesia's spots and pi.py's second island group (PacIOOS's buoys via NOAA NDBC, airport wind from NOAA's Aviation Weather Center
# and Apra Harbor's NDBC station, ECMWF wind from the sea cell via Open-Meteo, NOAA's tide predictions in UTC, Open-Meteo's tide model).
# Run: python3 -m unittest discover -s tests -v
import os, sys, json, unittest, datetime
from zoneinfo import ZoneInfo
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
SPOTS = json.load(open(os.path.join(ROOT, 'spots.json')))
MI_IDS = ['umatac', 'boatbasin', 'talofofo', 'tankbeach', 'ppass', 'mwand', 'sidedish', 'majuro']
KEYS = ['zone', 'ndbc', 'buoyKm', 'buoyName', 'buoyBy', 'windStation', 'stationName', 'tideStation', 'off', 'lat', 'lon', 'blurb', 'cams', 'zh', 'ja']
ZONES = ['Pacific/Guam', 'Pacific/Guam', 'Pacific/Guam', 'Pacific/Saipan', 'Pacific/Pohnpei', 'Pacific/Pohnpei', 'Pacific/Kosrae', 'Pacific/Majuro']
TIDES = ['1630000', '1630000', '1630000', '1633227', None, None, None, 'TPT2721']  # NOAA's station, or None for the tide model
OFFSETS = [10, 10, 10, 10, 11, 11, 11, 12]
# Each Guam spot's first buoy is the one on its side of the island: Ritidian Point off the north tip, Ipan off the east coast
BUOYS = [['52202', '52200'], ['52202', '52200'], ['52200', '52202'], ['52211'], ['52213'], ['52213'], ['52215'], ['52201', '52216']]
GUAM = ['metar:PGUM', 'ndbc:APRP7']
WIND = [GUAM, GUAM, GUAM, ['metar:PGSN'], [], [], ['metar:PTSA'], []]


class Spots(unittest.TestCase):
    def test_mi_spots_complete(self):
        mi = [s for s in SPOTS if s.get('country') == 'mi']
        self.assertEqual([s['id'] for s in mi], MI_IDS)
        self.assertEqual([s['zone'] for s in mi], ZONES)
        self.assertEqual([s['tideStation'] for s in mi], TIDES)
        self.assertEqual([s['ndbc'] for s in mi], BUOYS)
        self.assertEqual([s['windStation'] for s in mi], WIND)
        for s in mi:
            for k in KEYS: self.assertIn(k, s, s['id'] + ' ' + k)
            self.assertTrue(s['zh']['name'] and s['ja']['name'] and s['zh']['full'] and s['ja']['full'] and s['zh']['region'] and s['ja']['region'])
            self.assertNotIn('tz', s)
            self.assertTrue(5 < s['lat'] < 16 and 144 < s['lon'] < 172, s['id'])
            self.assertTrue(0 <= s['off'] < 360, s['id'])
            self.assertEqual(s['buoyBy'], 'pacioos')
            n = len(s['ndbc'])
            self.assertEqual((len(s['buoyKm']), len(s['buoyName']), len(s['zh']['buoyName']), len(s['ja']['buoyName'])), (n, n, n, n), s['id'])
            self.assertLess(s['buoyKm'][0], 100, s['id'])  # no far main buoy
            w = len(s['windStation'])
            for v in (s['stationName'], s['zh']['stationName'], s['ja']['stationName']): self.assertEqual(len(v) if w else v, w or '', s['id'])
            self.assertEqual(len(s['zh']['cams']), len(s['cams'])); self.assertEqual(len(s['ja']['cams']), len(s['cams']))
        self.assertEqual(len({s['id'] for s in SPOTS}), len(SPOTS))
        for c in ('tw', 'jp', 'kr', 'ph', 'id', 'ca', 'hi', 'au', 'nz', 'nw', 'pi', 'ak', 'mi'): self.assertEqual(sum(s.get('country', 'tw') == c for s in SPOTS), 8, c)
        # after Alaska's and before Hong Kong's, the last added, so the shared Open-Meteo calls, which list every spot in its order, keep
        # each other spot's place
        self.assertEqual([s['id'] for s in SPOTS[-11:-3]], MI_IDS)

    def test_no_clock_changes(self):
        # none of the eight zones changes its clock, so the one offset the page draws with holds all year
        import au
        for z, o in zip(ZONES, OFFSETS):
            for at in (datetime.datetime(2026, 10, 19, tzinfo=datetime.timezone.utc), datetime.datetime(2027, 1, 15, tzinfo=datetime.timezone.utc),
                       datetime.datetime(2027, 7, 1, tzinfo=datetime.timezone.utc)):
                self.assertEqual(au.offset(z, at), o, (z, at))


FIXDIR = os.path.join(HERE, 'fixtures', 'mi')  # live copies from 2026-10-19 02:45 UTC
def FIX(n):
    with open(os.path.join(FIXDIR, n), encoding='utf-8') as f: return f.read()
U = datetime.timezone.utc
NOW = datetime.datetime(2026, 10, 19, 2, 45, tzinfo=U)


class Readers(unittest.TestCase):
    def test_noaa_tides_on_each_clock(self):
        import pi
        # Apra Harbor's tides, asked for in UTC, on Guam's clock (UTC+10): the 21:32 UTC low on the 18th is 07:32 on the 19th
        t = pi.noaa_tides(json.loads(FIX('tidemi-1630000.json')), ZoneInfo('Pacific/Guam'))
        self.assertEqual(t['2026-10-19'], [['07:32', 'L', 6], ['15:48', 'H', 60], ['21:31', 'L', 45]])
        # Majuro Atoll's on the Marshall Islands' (UTC+12)
        t = pi.noaa_tides(json.loads(FIX('tidemi-TPT2721.json')), ZoneInfo('Pacific/Majuro'))
        self.assertEqual(t['2026-10-19'], [['04:22', 'L', 40], ['11:51', 'H', 57], ['14:59', 'L', 49], ['23:02', 'H', 81]])

    def test_buoys(self):
        import ca
        # North Point reads on the hour and half hour; 00:00 UTC is 08:00 on Taipei's clock
        r = ca.ndbc_rows(FIX('ndbc-52213.txt'), now=NOW)
        self.assertEqual(len(r), 24)
        self.assertEqual(r[-1], ['2026-10-19T08:00', 1.5, 6.0, 352.0, 29.3])
        self.assertEqual(ca.ndbc_rows(FIX('ndbc-52216.txt'), now=NOW)[-1], ['2026-10-19T10:00', 1.4, 6.7, 57.0, 29.1])
        # Kalo's rows come in, but with no wave height in any of them
        self.assertTrue(FIX('ndbc-52201.txt').count('\n') > 50)
        self.assertEqual(ca.ndbc_rows(FIX('ndbc-52201.txt'), now=NOW), [])

    def test_station_wind(self):
        import ca, kr
        m = json.loads(FIX('metar-mi.json'))
        # Guam's newest report, 14 kt from 150 at 02:18 UTC, on the nearest hour of Taipei's clock
        self.assertEqual(kr.metar_wind(m, 'PGUM', NOW), [['2026-10-19T10:00', 14.0, 150.0]])
        self.assertEqual(kr.metar_wind(m, 'PGSN', NOW), [['2026-10-19T10:00', 14.0, 120.0]])
        self.assertEqual(kr.metar_wind(m, 'PTSA', NOW), [['2026-10-19T09:00', 5.0, 340.0]])
        # Apra Harbor's NOS station: 6.2 m/s from 150 at 02:00 UTC
        self.assertEqual(ca.ndbc_wind(FIX('ndbc-APRP7.txt'), NOW), [['2026-10-19T10:00', 12.1, 150.0]])


class Fill(unittest.TestCase):
    def setUp(self):
        import copy
        with open(os.path.join(FIXDIR, 'snap_in.json')) as f: self.snap = json.load(f)
        self.before = copy.deepcopy(self.snap)

    def fill(self, now=NOW, dl=FIXDIR):
        import pi
        pi.fill(self.snap, SPOTS, dl, now, 'mi'); return self.snap['spots']

    def without(self, drop=(), metar=None):
        # a copy of the fixtures without some files, or with only some airports' reports
        import tempfile, shutil
        tmp = tempfile.mkdtemp()
        for f in os.listdir(FIXDIR):
            if f not in drop: shutil.copy(os.path.join(FIXDIR, f), tmp)
        if metar is not None:
            with open(os.path.join(tmp, 'metar-mi.json'), 'w') as f: json.dump([r for r in json.loads(FIX('metar-mi.json')) if metar(r)], f)
        return tmp

    def test_offsets(self):
        sp = self.fill()
        self.assertEqual([sp[k]['tz'] for k in MI_IDS], OFFSETS)

    def test_fill_pohnpei(self):
        sp = self.fill(); s, m = sp['ppass'], sp['mwand']
        self.assertEqual((s['buoyId'], len(s['buoy']), s['buoy'][-1], s['buoyAt'], s['buoyQuiet']), ('52213', 24, ['2026-10-19T08:00', 1.5, 6.0, 352.0, 29.3], '2026-10-19T08:00', False))
        self.assertEqual((s['buoyName'], s['buoyKm'], s['zh']['buoyName'], s['ja']['buoyName'], s['buoyBy']), ('North Point', 17, '北角', 'ノースポイント', 'pacioos'))
        self.assertNotIn('buoyMain', s)  # its one buoy
        self.assertEqual((m['buoyId'], m['buoy'], m['buoyKm']), ('52213', s['buoy'], 9))
        self.assertEqual((s['dwind'], s['stationName']), ([], ''))
        # ECMWF's sea cells: the two passes no longer share the inland one
        self.assertEqual((s['wind'][0], m['wind'][0]), (['2026-10-19T00:00', 6.3, 325, None, None], ['2026-10-19T00:00', 6.1, 321, None, None]))
        self.assertEqual([r[0][11:13] for r in s['wind']], ['00', '03', '06', '09', '12', '15', '18', '21'])
        self.assertTrue(s['tideModel'] and m['tideModel'])
        self.assertEqual(s['tides']['2026-10-19'], [['08:00', 'L', 12], ['20:00', 'H', 50]])
        self.assertEqual(sorted(s['sun']), ['2026-10-19', '2026-10-20'])
        self.assertEqual((s['sun']['2026-10-19']['rise'], s['sun']['2026-10-19']['set']), ('06:14', '18:11'))
        self.assertEqual(self.snap['src']['spots']['ppass'], '2026-10-19T08:00/')

    def test_fill_guam_and_saipan(self):
        sp = self.fill()
        # Guam's and Saipan's buoys are silent: the spot says so, naming its first buoy
        for k, name, km, zh in (('umatac', 'Ritidian Point', 46, '里蒂迪安角'), ('boatbasin', 'Ritidian Point', 23, '里蒂迪安角'), ('talofofo', 'Ipan', 2, '伊潘'), ('tankbeach', 'Tanapag', 17, '塔納帕格')):
            s = sp[k]
            self.assertEqual((s['buoyId'], s['buoy'], s['buoyAt'], s['buoyQuiet'], s['buoyName'], s['buoyKm'], s['zh']['buoyName']), (None, [], '', True, name, km, zh), k)
        for k in ('umatac', 'boatbasin', 'talofofo'):
            s = sp[k]
            self.assertEqual((s['dwind'], s['stationName'], s['zh']['stationName'], s['ja']['stationName']), ([['2026-10-19T10:00', 14.0, 150.0]], 'Guam Airport', '關島機場', 'グアム空港'), k)
            self.assertEqual(s['tides']['2026-10-19'], [['07:32', 'L', 6], ['15:48', 'H', 60], ['21:31', 'L', 45]], k)  # Apra Harbor's
            self.assertNotIn('tideModel', s)
            self.assertEqual(self.snap['src']['spots'][k], '/2026-10-19T10:00')
        self.assertEqual(sp['umatac']['buoyMain'], '52202')
        t = sp['tankbeach']
        self.assertEqual((t['dwind'], t['stationName']), ([['2026-10-19T10:00', 14.0, 120.0]], 'Saipan Airport'))
        self.assertEqual(t['tides']['2026-10-19'], [['07:44', 'L', 9], ['16:08', 'H', 58], ['21:56', 'L', 46]])  # Saipan's
        self.assertEqual(sp['talofofo']['wind'][0], ['2026-10-19T00:00', 24.5, 154, None, None])

    def test_apra_harbor_when_guam_airport_is_silent(self):
        sp = self.fill(dl=self.without(metar=lambda r: r.get('icaoId') != 'PGUM'))
        for k in ('umatac', 'boatbasin', 'talofofo'):
            s = sp[k]
            self.assertEqual((s['dwind'], s['stationName'], s['zh']['stationName'], s['ja']['stationName']), ([['2026-10-19T10:00', 12.1, 150.0]], 'Apra Harbor', '阿普拉港', 'アプラ港'), k)
        self.assertEqual(sp['tankbeach']['dwind'], [['2026-10-19T10:00', 14.0, 120.0]])
        # and with Apra Harbor silent too, nothing, under the airport's name
        s = self.fill(dl=self.without(drop=('ndbc-APRP7.txt',), metar=lambda r: r.get('icaoId') != 'PGUM'))['boatbasin']
        self.assertEqual((s['dwind'], s['stationName']), ([], 'Guam Airport'))

    def test_majuro_takes_arno_while_kalo_sends_no_waves(self):
        s = self.fill()['majuro']
        self.assertEqual((s['buoyId'], len(s['buoy']), s['buoy'][-1], s['buoyQuiet']), ('52216', 24, ['2026-10-19T10:00', 1.4, 6.7, 57.0, 29.1], False))
        # named with its own distance; the past days and corrections still keep to Kalo
        self.assertEqual((s['buoyName'], s['buoyKm'], s['zh']['buoyName'], s['ja']['buoyName'], s['buoyMain']), ('Arno', 42, '阿爾諾', 'アルノ', '52201'))
        self.assertEqual(s['tides']['2026-10-19'], [['04:22', 'L', 40], ['11:51', 'H', 57], ['14:59', 'L', 49], ['23:02', 'H', 81]])
        self.assertNotIn('tideModel', s)
        self.assertEqual((s['dwind'], s['stationName']), ([], ''))

    def test_kosrae_overnight(self):
        # Kosrae's airport reports only in its daytime: 2.5 hours on, its 00:56 UTC report is too old to count, while Guam's still counts
        sp = self.fill(); s = sp['sidedish']
        self.assertEqual((s['dwind'], s['stationName'], s['zh']['stationName'], s['ja']['stationName']), ([['2026-10-19T09:00', 5.0, 340.0]], 'Kosrae Airport', '科斯雷機場', 'コスラエ空港'))
        sp = self.fill(NOW + datetime.timedelta(hours=2.5))
        self.assertEqual((sp['sidedish']['dwind'], sp['sidedish']['stationName']), ([], 'Kosrae Airport'))
        self.assertEqual(sp['boatbasin']['dwind'], [['2026-10-19T10:00', 14.0, 150.0]])

    def test_model_tides(self):
        # P-Pass, Mwand and Sidedish take the tide model, in the order the reply lists them, and say so
        import au
        sp = self.fill(); m = json.loads(FIX('tidemi.json'))
        for i, k in enumerate(('ppass', 'mwand', 'sidedish')):
            self.assertTrue(sp[k]['tideModel'], k)
            self.assertEqual(sp[k]['tides'], au.tide_days(m[i]['hourly']['time'], m[i]['hourly']['sea_level_height_msl'], 11), k)
        self.assertEqual(sp['sidedish']['tides']['2026-10-19'], [['04:30', 'L', 19], ['21:50', 'H', 56]])

    def test_downloads_follow_the_spot_list(self):
        # the ECMWF reply holds every Micronesia spot of spots.json in its order, and the tide model's the three without a station, so with
        # Umatac and P-Pass missing from the snap, Tank Beach still takes the 4th forecast and Sidedish the 7th and the 3rd tide model
        import au
        for k in ('umatac', 'ppass'): del self.snap['spots'][k]
        sp = self.fill(); om, m = json.loads(FIX('openmi.json')), json.loads(FIX('tidemi.json'))
        self.assertEqual(sp['tankbeach']['wind'][0][:3], ['2026-10-19T00:00', om[3]['hourly']['wind_speed_10m'][0], om[3]['hourly']['wind_direction_10m'][0]])
        self.assertEqual(sp['sidedish']['wind'][0][:3], ['2026-10-19T00:00', 11.5, 330])
        self.assertEqual(sp['sidedish']['tides'], au.tide_days(m[2]['hourly']['time'], m[2]['hourly']['sea_level_height_msl'], 11))
        for n, i in enumerate(MI_IDS):
            s = next(x for x in SPOTS if x['id'] == i)
            self.assertTrue(abs(om[n]['latitude'] - s['lat']) < 0.06 and abs(om[n]['longitude'] - s['lon']) < 0.06, i)  # the sea cell beside it

    def test_silent_buoys(self):
        # 7 hours on, North Point and Arno have gone quiet: Majuro names Kalo, its first buoy, and every airport's report is stale
        sp = self.fill(NOW + datetime.timedelta(hours=7))
        for k in ('ppass', 'majuro'):
            s = sp[k]
            self.assertEqual((s['buoyId'], s['buoy'], s['buoyAt'], s['buoyQuiet'], s['dwind']), (None, [], '', True, []), k)
        self.assertEqual((sp['majuro']['buoyName'], sp['majuro']['buoyKm']), ('Kalo', 3))
        self.assertEqual((sp['boatbasin']['dwind'], sp['boatbasin']['stationName']), ([], 'Guam Airport'))

    def test_groups_kept_apart(self):
        # the South Pacific's run leaves Micronesia's spots alone, and Micronesia's run the South Pacific's and the others'
        import pi, copy
        pi.fill(self.snap, SPOTS, os.path.join(HERE, 'fixtures', 'pi'), NOW)
        for k in MI_IDS: self.assertEqual(self.snap['spots'][k], self.before['spots'][k], k)
        o = {k: copy.deepcopy(self.snap['spots'][k]) for k in ('donghe', 'blacks', 'jukdo', 'cloud9', 'uluwatu', 'raglan', 'amouli', 'teahupoo')}
        self.fill()
        for k, v in o.items(): self.assertEqual(self.snap['spots'][k], v, k)

    def test_nothing_downloaded(self):
        import tempfile
        sp = self.fill(dl=tempfile.mkdtemp())
        for k, tz in zip(MI_IDS, OFFSETS):
            s = sp[k]
            self.assertEqual((s['tz'], s['buoy'], s['buoyQuiet'], s['dwind'], s['wind'], s['tides']), (tz, [], True, [], [], {}), k)
            self.assertTrue(s['sun'])
        self.assertTrue(sp['ppass']['tideModel'])  # the page still says its tides, when it has some, come from the model

    def test_runs_isolated_like_refresh(self):
        import subprocess, tempfile, shutil
        tmp = tempfile.mkdtemp(); f = os.path.join(tmp, 'snap.json'); shutil.copy(os.path.join(FIXDIR, 'snap_in.json'), f)
        r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'pi.py'), FIXDIR, f, os.path.join(ROOT, 'spots.json'), 'mi'], capture_output=True, text=True, cwd=tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        # the buoys and the airports go quiet as the clock runs on, so how much is used depends on it; the offsets and the forecast don't
        self.assertRegex(r.stdout, r'mi: ppass 11 \S+ \d+ 0 8 8\n')
        self.assertRegex(r.stdout, r'mi: majuro 12 \S+ \d+ 0 8 18\n')
        self.assertNotIn('pi:', r.stdout)
        with open(f) as fh: d = json.load(fh)
        self.assertEqual(d['spots']['amouli'], json.loads(FIX('snap_in.json'))['spots']['amouli'])
        self.assertEqual(d['spots']['talofofo']['tides']['2026-10-19'][1], ['15:48', 'H', 60])

    def test_refresh_lists_match(self):
        # refresh.sh's piids lists what pi.py reads for Micronesia: the buoys and Apra Harbor's station, the airports, NOAA's stations, and
        # the tide model's spots in order; its wind forecast comes from the sea cells
        import re, subprocess
        with open(os.path.join(ROOT, 'refresh.sh'), encoding='utf-8') as f: sh = f.read()
        piids = re.search(r'^piids\(\)\{.*?; \}$', sh, re.S | re.M).group(0)
        got = {f: subprocess.run(['sh', '-c', 'HERE=$1\n' + piids + '\npiids mi $2', 'sh', ROOT, f], capture_output=True, text=True).stdout.strip()
               for f in ('lat', 'lon', 'ndbc', 'metar', 'tideStation', 'mlat', 'mlon')}
        self.assertEqual(got, {'lat': '13.298,13.487,13.337,15.176,6.9845,7.0215,5.3335,7.079', 'lon': '144.656,144.748,144.776,145.789,158.1255,158.2935,162.9355,171.355',
                               'ndbc': '52202,52200,52211,52213,52215,52201,52216,APRP7', 'metar': 'PGUM,PGSN,PTSA', 'tideStation': '1630000,1633227,TPT2721',
                               'mlat': '6.9845,7.0215,5.3335', 'mlon': '158.1255,158.2935,162.9355'})
        block = re.search(r'^for C in pi mi; do$.*?^done$', sh, re.S | re.M).group(0)
        self.assertIn('CS=; [ $C = mi ] && CS="&cell_selection=sea"', block)
        self.assertEqual(re.findall(r'forecast_days=4\$CS"', block), ['forecast_days=4$CS"'])
        self.assertIn('regrid mi 350 -2 2 9 152 2 13\n', sh)


class Coast(unittest.TestCase):
    # The map draws Micronesia's islands with spots from Natural Earth's 10 m land, pushed after a loop that drops the coarser outlines inside
    # the island boxes (MIB in template.html), so no island is drawn twice, nor one in part.
    def setUp(self):
        import re
        with open(os.path.join(ROOT, 'template.html'), encoding='utf-8') as f: L = f.read().split('\n')
        at = [i for i, l in enumerate(L) if l.startswith('  const MIB = ')]
        self.assertEqual(len(at), 1); at = at[0]
        self.boxes = json.loads(L[at][len('  const MIB = '):-1])
        self.assertTrue(L[at + 1].startswith('  for (let i = COAST.length; i--;) if (MIB.some(([l, r, s, n]) => COAST[i].every(([x, y]) => x > l && x < r && y > s && y < n))) COAST.splice(i, 1);'))
        ring = re.compile(r'^  (?:const COAST = |COAST\.push\(\.\.\.)(\[.*\])\)?;$')  # the outline lines, as tests/map/mapmath.test.js reads them
        rings = lambda part: [r for l in part for m in [ring.match(l)] if m for r in json.loads(m.group(1))]
        self.coarse, self.ten, self.later = rings(L[:at]), rings(L[at + 2:at + 3]), rings(L[at + 3:])
        self.assertTrue(self.coarse and self.ten)
        self.inside = lambda r, B: all(B[0] < x < B[1] and B[2] < y < B[3] for x, y in r)
        self.reaches = lambda r, B: min(x for x, y in r) < B[1] and max(x for x, y in r) > B[0] and min(y for x, y in r) < B[3] and max(y for x, y in r) > B[2]

    def test_boxes_hold_the_spots_islands(self):
        # the Marianas from Guam to Saipan, Pohnpei, Kosrae and Majuro, each box near its spots
        self.assertEqual(len(self.boxes), 4)
        for ids, B in zip((['umatac', 'boatbasin', 'talofofo', 'tankbeach'], ['ppass', 'mwand'], ['sidedish'], ['majuro']), self.boxes):
            for s in SPOTS:
                if s['id'] in ids: self.assertTrue(B[0] - 0.1 < s['lon'] < B[1] + 0.1 and B[2] - 0.1 < s['lat'] < B[3] + 0.1, s['id'])

    def test_ten_metre_rings_inside_one_box(self):
        for r in self.ten:
            self.assertEqual(sum(self.inside(r, B) for B in self.boxes), 1, r[:2])
            self.assertEqual(r[0], r[-1])
        for B in self.boxes: self.assertTrue(any(self.inside(r, B) for r in self.ten), B)

    def test_coarse_rings_in_a_box_are_dropped_whole(self):
        # a coarser ring that reaches into a box lies wholly inside it, so the page drops it; each box drops at least one
        for B in self.boxes:
            near = [r for r in self.coarse if self.reaches(r, B)]
            self.assertTrue(near, B)
            for r in near: self.assertTrue(self.inside(r, B), (B, r))
            self.assertFalse([r for r in self.later if self.reaches(r, B)], B)  # nothing pushed after the 10 m land reaches back in


if __name__ == '__main__':
    unittest.main()
