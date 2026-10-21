# South Pacific spots and pi.py (PacIOOS's buoys off Tutuila via NOAA NDBC, Pago Pago's airport wind from NOAA's Aviation Weather
# Center, ECMWF wind via Open-Meteo, NOAA's tide predictions in UTC, Open-Meteo's tide model).
# Run: python3 -m unittest discover -s tests -v
import os, sys, json, unittest, datetime
from zoneinfo import ZoneInfo
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
SPOTS = json.load(open(os.path.join(ROOT, 'spots.json')))
PI_IDS = ['cloudbreak', 'frigates', 'haatafu', 'salani', 'amouli', 'rutaki', 'papara', 'teahupoo']
KEYS = ['zone', 'ndbc', 'buoyKm', 'buoyName', 'windStation', 'stationName', 'tideStation', 'off', 'lat', 'lon', 'blurb', 'cams', 'zh', 'ja']
ZONES = ['Pacific/Fiji', 'Pacific/Fiji', 'Pacific/Tongatapu', 'Pacific/Apia', 'Pacific/Pago_Pago', 'Pacific/Rarotonga', 'Pacific/Tahiti', 'Pacific/Tahiti']
TIDES = ['TPT2871', '1910000', None, None, '1770000', None, '1732417', '1732417']  # NOAA's station, or None for the tide model
OFFSETS = [12, 12, 13, 13, -11, -10, -10, -10]


class Spots(unittest.TestCase):
    def test_pi_spots_complete(self):
        pi = [s for s in SPOTS if s.get('country') == 'pi']
        self.assertEqual([s['id'] for s in pi], PI_IDS)
        self.assertEqual([s['zone'] for s in pi], ZONES)
        self.assertEqual([s['tideStation'] for s in pi], TIDES)
        for s in pi:
            for k in KEYS: self.assertIn(k, s, s['id'] + ' ' + k)
            self.assertTrue(s['zh']['name'] and s['ja']['name'] and s['zh']['full'] and s['ja']['full'] and s['zh']['region'] and s['ja']['region'])
            self.assertNotIn('tz', s)
            self.assertTrue(-22 < s['lat'] < -13 and (177 < s['lon'] < 179 or -176 < s['lon'] < -149), s['id'])
            self.assertTrue(0 <= s['off'] < 360, s['id'])
            if s['id'] == 'amouli':
                self.assertEqual((s['ndbc'], s['buoyKm'], s['buoyName'], s['zh']['buoyName'], s['ja']['buoyName'], s['buoyBy']),
                                 (['51209', '51214'], [12, 29], ["Aunu'u", 'King-Poloa'], ['奧努烏', '波洛阿'], ['アウヌウ', 'ポロア'], 'pacioos'))
                self.assertEqual((s['windStation'], s['stationName'], s['zh']['stationName'], s['ja']['stationName']),
                                 (['metar:NSTU'], ['Pago Pago Airport'], ['帕果帕果機場'], ['パゴパゴ空港']))
            else:
                self.assertEqual((s['ndbc'], s['buoyKm'], s['buoyName'], s['windStation'], s['stationName']), ([], None, '', [], ''), s['id'])
                self.assertNotIn('buoyBy', s)
            self.assertEqual(len(s['zh']['cams']), len(s['cams'])); self.assertEqual(len(s['ja']['cams']), len(s['cams']))
        self.assertEqual(len({s['id'] for s in SPOTS}), len(SPOTS))
        for c in ('tw', 'jp', 'kr', 'ph', 'id', 'ca', 'hi', 'au', 'nz', 'nw', 'pi'): self.assertEqual(sum(s.get('country', 'tw') == c for s in SPOTS), 8, c)

    def test_no_clock_changes(self):
        # none of the eight zones changes its clock, so the one offset the page draws with holds all year
        import au
        for z, o in zip(ZONES, OFFSETS):
            for at in (datetime.datetime(2026, 10, 18, tzinfo=datetime.timezone.utc), datetime.datetime(2027, 1, 15, tzinfo=datetime.timezone.utc),
                       datetime.datetime(2027, 7, 1, tzinfo=datetime.timezone.utc)):
                self.assertEqual(au.offset(z, at), o, (z, at))


FIXDIR = os.path.join(HERE, 'fixtures', 'pi')  # live copies from 2026-10-18 17:38 UTC
def FIX(n):
    with open(os.path.join(FIXDIR, n), encoding='utf-8') as f: return f.read()
U = datetime.timezone.utc
NOW = datetime.datetime(2026, 10, 18, 17, 38, tzinfo=U)


class Readers(unittest.TestCase):
    def test_noaa_tides_on_each_clock(self):
        import pi
        # Nandi Waters' tides, asked for in UTC, on Fiji's clock (UTC+12): the 12:16 UTC high on the 18th is 00:16 on the 19th
        t = pi.noaa_tides(json.loads(FIX('tidepi-TPT2871.json')), ZoneInfo('Pacific/Fiji'))
        self.assertEqual(t['2026-10-19'], [['00:16', 'H', 144], ['06:47', 'L', 52], ['13:20', 'H', 137], ['19:07', 'L', 70]])
        self.assertEqual(t['2026-10-18'], [['05:50', 'L', 50], ['12:22', 'H', 135], ['18:06', 'L', 70]])
        # Pago Pago's on American Samoa's (UTC-11)
        t = pi.noaa_tides(json.loads(FIX('tidepi-1770000.json')), ZoneInfo('Pacific/Pago_Pago'))
        self.assertEqual(t['2026-10-19'], [['01:49', 'H', 71], ['08:16', 'L', 14], ['14:30', 'H', 65], ['20:22', 'L', 17]])

    def test_date_line(self):
        import pi
        # one tide either side of the date line: the same moment, 24 hours apart on the clocks of Samoa and American Samoa
        js = {'predictions': [{'t': '2026-10-18 11:30', 'v': '0.512', 'type': 'H'}]}
        self.assertEqual(pi.noaa_tides(js, ZoneInfo('Pacific/Apia')), {'2026-10-19': [['00:30', 'H', 51]]})
        self.assertEqual(pi.noaa_tides(js, ZoneInfo('Pacific/Pago_Pago')), {'2026-10-18': [['00:30', 'H', 51]]})

    def test_noaa_error_reply(self):
        import pi
        self.assertEqual(pi.noaa_tides({'error': {'message': 'No Predictions data was found. Please make sure the Datum input is valid.'}}, ZoneInfo('Pacific/Fiji')), {})
        self.assertEqual(pi.noaa_tides(None, ZoneInfo('Pacific/Fiji')), {})

    def test_buoy_rows(self):
        import ca
        # Aunu'u reads at :26 and :56 past each hour; the reading nearest each hour: 16:56 UTC is 01:00 on Taipei's clock
        r = ca.ndbc_rows(FIX('ndbc-51209.txt'), now=NOW)
        self.assertEqual(len(r), 24)
        self.assertEqual(r[-1], ['2026-10-19T01:00', 3.0, 7.5, 113.0, 27.3])
        self.assertEqual(ca.ndbc_rows(FIX('ndbc-51214.txt'), now=NOW)[-1], ['2026-10-19T01:00', 1.9, 5.8, 182.0, 27.5])

    def test_metar(self):
        import kr
        # 17016G22KT at 16:50 UTC, 00:50 on Taipei's clock, on the nearest hour
        self.assertEqual(kr.metar_wind(json.loads(FIX('metar-pi.json')), 'NSTU', NOW), [['2026-10-19T01:00', 16.0, 170.0]])


class Fill(unittest.TestCase):
    def setUp(self):
        import copy
        with open(os.path.join(FIXDIR, 'snap_in.json')) as f: self.snap = json.load(f)
        self.before = copy.deepcopy(self.snap)

    def fill(self, now=NOW, dl=FIXDIR):
        import pi
        pi.fill(self.snap, SPOTS, dl, now); return self.snap['spots']

    def test_offsets(self):
        sp = self.fill()
        self.assertEqual([sp[k]['tz'] for k in PI_IDS], OFFSETS)

    def test_fill_amouli(self):
        s = self.fill()['amouli']
        self.assertEqual((s['buoyId'], len(s['buoy']), s['buoy'][-1], s['buoyAt'], s['buoyQuiet']), ('51209', 24, ['2026-10-19T01:00', 3.0, 7.5, 113.0, 27.3], '2026-10-19T01:00', False))
        self.assertEqual((s['buoyName'], s['buoyKm'], s['zh']['buoyName'], s['ja']['buoyName'], s['buoyBy'], s['buoyMain']), ("Aunu'u", 12, '奧努烏', 'アウヌウ', 'pacioos', '51209'))
        self.assertEqual(s['dwind'], [['2026-10-19T01:00', 16.0, 170.0]])
        self.assertEqual((s['stationName'], s['zh']['stationName'], s['ja']['stationName']), ('Pago Pago Airport', '帕果帕果機場', 'パゴパゴ空港'))
        self.assertEqual(s['wind'][0], ['2026-10-19T00:00', 17.9, 164, None, None])
        self.assertEqual([r[0][11:13] for r in s['wind']], ['00', '03', '06', '09', '12', '15', '18', '21'])
        self.assertEqual(s['tides']['2026-10-19'], [['01:49', 'H', 71], ['08:16', 'L', 14], ['14:30', 'H', 65], ['20:22', 'L', 17]])  # Pago Pago's
        self.assertNotIn('tideModel', s)
        # Taipei's 19th is American Samoa's 18th and 19th
        self.assertEqual(sorted(s['sun']), ['2026-10-18', '2026-10-19'])
        self.assertEqual((s['sun']['2026-10-18']['rise'], s['sun']['2026-10-18']['set']), ('05:54', '18:21'))
        self.assertEqual(self.snap['src']['spots']['amouli'], '2026-10-19T01:00/2026-10-19T01:00')

    def test_backup_buoy(self):
        # with Aunu'u silent, King-Poloa answers, named with its own distance; the past days and corrections still learn from Aunu'u only
        import tempfile, shutil
        tmp = tempfile.mkdtemp()
        for f in os.listdir(FIXDIR):
            if f != 'ndbc-51209.txt': shutil.copy(os.path.join(FIXDIR, f), tmp)
        s = self.fill(dl=tmp)['amouli']
        self.assertEqual((s['buoyId'], s['buoy'][-1], s['buoyQuiet']), ('51214', ['2026-10-19T01:00', 1.9, 5.8, 182.0, 27.5], False))
        self.assertEqual((s['buoyName'], s['buoyKm'], s['zh']['buoyName'], s['ja']['buoyName'], s['buoyMain']), ('King-Poloa', 29, '波洛阿', 'ポロア', '51209'))

    def test_fill_fiji_and_tahiti(self):
        sp = self.fill(); c, t = sp['cloudbreak'], sp['teahupoo']
        self.assertEqual((c['tz'], c['buoyId'], c['buoy'], c['buoyQuiet'], c['dwind'], c['stationName']), (12, None, [], False, [], ''))
        self.assertEqual(c['tides']['2026-10-19'], [['00:16', 'H', 144], ['06:47', 'L', 52], ['13:20', 'H', 137], ['19:07', 'L', 70]])  # Nandi Waters'
        self.assertEqual(sp['frigates']['tides']['2026-10-19'][0], ['00:19', 'H', 104])  # Suva's
        # Papara and Teahupo'o both take Papeete's, on Tahiti's clock (UTC-10)
        self.assertEqual(t['tides']['2026-10-19'], [['04:28', 'L', 2], ['10:25', 'H', 12], ['16:51', 'L', 0], ['22:35', 'H', 12]])
        self.assertEqual(sp['papara']['tides'], t['tides'])
        for s in (c, t): self.assertNotIn('tideModel', s)
        self.assertEqual(sorted(c['sun']), ['2026-10-19', '2026-10-20'])
        self.assertEqual(self.snap['src']['spots']['cloudbreak'], '/')

    def test_model_tides(self):
        # Ha'atafu, Salani and Rutaki take the tide model, in the order the reply lists them, and say so
        import au
        sp = self.fill(); m = json.loads(FIX('tidepi.json'))
        for i, (k, tz) in enumerate((('haatafu', 13), ('salani', 13), ('rutaki', -10))):
            self.assertTrue(sp[k]['tideModel'], k)
            self.assertEqual(sp[k]['tides'], au.tide_days(m[i]['hourly']['time'], m[i]['hourly']['sea_level_height_msl'], tz), k)
        self.assertEqual(sp['salani']['tides']['2026-10-19'], [['00:20', 'H', 99], ['06:54', 'L', 46], ['13:10', 'H', 93], ['19:00', 'L', 51]])

    def test_downloads_follow_the_spot_list(self):
        # the ECMWF reply holds every South Pacific spot of spots.json in its order, and the tide model's the three without a station, so
        # with Ha'atafu and Amouli missing from the snap, Salani still takes the 4th forecast and the 2nd tide model, and Rutaki the 6th and 3rd
        import au
        for k in ('haatafu', 'amouli'): del self.snap['spots'][k]
        sp = self.fill(); om, m = json.loads(FIX('openpi.json')), json.loads(FIX('tidepi.json'))
        self.assertEqual(sp['salani']['wind'][0][:3], ['2026-10-19T00:00', om[3]['hourly']['wind_speed_10m'][0], om[3]['hourly']['wind_direction_10m'][0]])
        self.assertEqual(sp['rutaki']['wind'][0][:3], ['2026-10-19T00:00', 14.2, 111])
        self.assertEqual(sp['salani']['tides'], au.tide_days(m[1]['hourly']['time'], m[1]['hourly']['sea_level_height_msl'], 13))
        self.assertEqual(sp['rutaki']['tides'], au.tide_days(m[2]['hourly']['time'], m[2]['hourly']['sea_level_height_msl'], -10))
        for n, i in enumerate(PI_IDS):
            s = next(x for x in SPOTS if x['id'] == i)
            self.assertTrue(abs(om[n]['latitude'] - s['lat']) < 0.11 and abs(om[n]['longitude'] - s['lon']) < 0.11, i)  # ECMWF's nearest point

    def test_silent_buoy(self):
        # 7 hours on, both buoys have gone quiet and Pago Pago's reports are stale
        s = self.fill(NOW + datetime.timedelta(hours=7))['amouli']
        self.assertEqual((s['buoyId'], s['buoy'], s['buoyAt'], s['buoyQuiet'], s['dwind']), (None, [], '', True, []))
        self.assertEqual((s['buoyName'], s['buoyKm'], s['stationName']), ("Aunu'u", 12, 'Pago Pago Airport'))  # the first ones, when none answered

    def test_countries_kept_apart(self):
        # Korea's, the Philippines', Indonesia's and New Zealand's runs leave the South Pacific spots alone, and the South Pacific's run theirs
        import kr, nz, copy
        for c in ('kr', 'ph', 'id'): kr.fill(self.snap, SPOTS, os.path.join(HERE, 'fixtures', c), NOW, c)
        nz.fill(self.snap, SPOTS, os.path.join(HERE, 'fixtures', 'nz'), NOW, os.path.join(HERE, 'fixtures', 'nz', 'linz'))
        for k in PI_IDS: self.assertEqual(self.snap['spots'][k], self.before['spots'][k], k)
        o = {k: copy.deepcopy(self.snap['spots'][k]) for k in ('donghe', 'blacks', 'jukdo', 'cloud9', 'uluwatu', 'raglan')}
        self.fill()
        for k, v in o.items(): self.assertEqual(self.snap['spots'][k], v, k)

    def test_nothing_downloaded(self):
        import tempfile
        sp = self.fill(dl=tempfile.mkdtemp())
        for k, tz in zip(PI_IDS, OFFSETS):
            s = sp[k]
            self.assertEqual((s['tz'], s['buoy'], s['dwind'], s['wind'], s['tides']), (tz, [], [], [], {}), k)
            self.assertTrue(s['sun'])
        self.assertEqual((sp['amouli']['buoyQuiet'], sp['teahupoo']['buoyQuiet']), (True, False))
        self.assertTrue(sp['haatafu']['tideModel'])  # the page still says its tides, when it has some, come from the model

    def test_runs_isolated_like_refresh(self):
        import subprocess, tempfile, shutil
        tmp = tempfile.mkdtemp(); f = os.path.join(tmp, 'snap.json'); shutil.copy(os.path.join(FIXDIR, 'snap_in.json'), f)
        r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'pi.py'), FIXDIR, f, os.path.join(ROOT, 'spots.json')], capture_output=True, text=True, cwd=tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        # the buoys and the airport go quiet as the clock runs on, so how much is used depends on it; the offsets and the forecast don't
        self.assertRegex(r.stdout, r'pi: cloudbreak 12 None 0 0 8 ')
        self.assertIn('pi: amouli -11 ', r.stdout)
        self.assertNotIn('raglan', r.stdout)
        with open(f) as fh: d = json.load(fh)
        self.assertEqual(d['spots']['raglan'], json.loads(FIX('snap_in.json'))['spots']['raglan'])
        self.assertEqual(d['spots']['teahupoo']['tides']['2026-10-19'][1], ['10:25', 'H', 12])

    def test_refresh_lists_match(self):
        # refresh.sh's piids lists what pi.py reads: Amouli's buoys and airport, NOAA's stations, and the tide model's spots in order
        import re, subprocess
        with open(os.path.join(ROOT, 'refresh.sh'), encoding='utf-8') as f: sh = f.read()
        piids = re.search(r'^piids\(\)\{.*?; \}$', sh, re.S | re.M).group(0)
        got = {f: subprocess.run(['sh', '-c', 'HERE=$1\n' + piids + '\npiids pi $2', 'sh', ROOT, f], capture_output=True, text=True).stdout.strip()
               for f in ('lat', 'ndbc', 'metar', 'tideStation', 'mlat', 'mlon')}
        self.assertEqual(got, {'lat': '-17.887,-18.47,-21.072,-14.04,-14.285,-21.265,-17.78,-17.868', 'ndbc': '51209,51214', 'metar': 'NSTU',
                               'tideStation': 'TPT2871,1910000,1770000,1732417', 'mlat': '-21.072,-14.04,-21.265', 'mlon': '-175.336,-171.62,-159.81'})
        for name in ('for C in pi mi pg vu bj; do', 'ndbc-$b.txt', 'metar-$C.json', 'get open$C', 'get "tide$C-$t"', 'get tide$C '): self.assertIn(name, sh)
        self.assertIn('"$HERE/pi.py" "$W/dl" "$W/snap.json" "$HERE/spots.json" $C', sh)

    def test_refresh_asks_for_whole_days(self):
        # pi.py reads NOAA's times and the tide model's as UTC, so refresh.sh asks for both in UTC. From there they reach back far enough
        # that the oldest past day the page keeps (Taipei's today-5) is whole on every island's clock, UTC+13 to UTC-11 (Micronesia's,
        # +10 to +12, Papua New Guinea's, +10, Vanuatu's, +11, and Baja's, -7 and -8, read in the same loop), and run on past the last
        # day tab (the spot's today+4), at any hour of the day
        import re
        with open(os.path.join(ROOT, 'refresh.sh'), encoding='utf-8') as f: sh = f.read()
        block = re.search(r'^for C in pi mi pg vu bj; do$.*?^done$', sh, re.S | re.M).group(0)
        back, hours = map(int, re.search(r"&begin_date=\$\(date -u -d '-(\d+) days' \+%Y%m%d\)&range=(\d+)&", block).groups())
        self.assertIn('&time_zone=gmt&', block)
        past, ahead = map(int, re.search(r'&timezone=GMT&past_days=(\d+)&forecast_days=(\d+)"', block).groups())
        D, U = datetime.timedelta, datetime.timezone.utc
        at = lambda d, tz: datetime.datetime.combine(d, datetime.time(), U) - D(hours=tz)   # midnight of date d on a UTC+tz clock, in UTC
        for h in range(48):
            now = datetime.datetime(2026, 10, 18, tzinfo=U) + D(hours=h); day = at(now.date(), 0)
            asked = {'NOAA': (day - D(days=back), day - D(days=back) + D(hours=hours)), 'model': (day - D(days=past), day + D(days=ahead))}
            kept = (now + D(hours=8)).date() - D(days=5)
            for tz in set(OFFSETS) | {10, 11, 12, -7, -8}:
                need = (at(kept, tz), at((now + D(hours=tz)).date() + D(days=5), tz))
                for k, (a, b) in asked.items(): self.assertTrue(a <= need[0] and b >= need[1], (k, now, tz))


if __name__ == '__main__':
    unittest.main()
