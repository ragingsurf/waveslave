# South Korean spots and kr.py (the Korea Meteorological Administration's buoys as NOAA NDBC copies them, airport wind from NOAA's
# Aviation Weather Center, JMA MSM wind and model tides via Open-Meteo).
# Run: python3 -m unittest discover -s tests -v
import os, sys, json, math, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
SPOTS = json.load(open(os.path.join(ROOT, 'spots.json')))
KR_IDS = ['jukdo', 'surfyy', 'geumjin', 'wolpo', 'songjeong', 'jungmun', 'iho', 'manlipo']
KEYS = ['zone', 'buoyKm', 'buoyName', 'windStation', 'stationName', 'off', 'lat', 'lon', 'blurb', 'cams', 'zh', 'ja']
# Each spot's KMA buoys, the one off its own coast first: Manlipo's Oeyeondo, out in the open sea, before Deokjeokdo, which sits among
# the Gyeonggi Bay islands and read 0.0 m in two hours of three that autumn. Iho faces north, and Marado, the one buoy near it, lies
# off the island's south side
BUOYS = [['22105'], ['22105'], ['22105'], ['22106'], ['22104'], ['22107'], None, ['22108', '22101']]
WHERE = {'22101': (37.24, 126.02), '22104': (34.77, 128.90), '22105': (37.54, 130.00), '22106': (36.35, 129.78), '22107': (33.08, 126.03),
         '22108': (36.25, 125.75)}  # each buoy's position in NOAA's file


def km(la1, lo1, la2, lo2):
    la1, lo1, la2, lo2 = map(math.radians, (la1, lo1, la2, lo2))
    return 12742 * math.asin(math.sqrt(math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2))


class Spots(unittest.TestCase):
    def test_kr_spots_complete(self):
        import ca
        kr = [s for s in SPOTS if s.get('country') == 'kr']
        self.assertEqual([s['id'] for s in kr], KR_IDS)
        self.assertEqual([s.get('ndbc') for s in kr], BUOYS)
        for s in kr:
            for k in KEYS: self.assertIn(k, s, s['id'] + ' ' + k)
            self.assertTrue(s['zh']['name'] and s['ja']['name'] and s['zh']['full'] and s['ja']['full'])
            self.assertNotIn('tz', s)
            self.assertEqual(s['zone'], 'Asia/Seoul')
            self.assertTrue(33 < s['lat'] < 39 and 125.5 < s['lon'] < 130, s['id'])
            # a buoy's name and distance follow it when a spot has more than one, the distance to NOAA's position for it
            if s.get('ndbc'):
                n = len(s['ndbc']); self.assertEqual(s['buoyBy'], 'kma')
                for v in (s['buoyKm'], s['buoyName'], s['zh']['buoyName'], s['ja']['buoyName']):
                    self.assertEqual(len(v) if isinstance(v, list) else 1, n, s['id'])
                for i, b in enumerate(s['ndbc']):
                    self.assertAlmostEqual(km(s['lat'], s['lon'], *WHERE[b]), ca._pick(s['buoyKm'], i), delta=1, msg=s['id'])
            else: self.assertEqual((s['buoyKm'], s['buoyName'], s['zh']['buoyName'], s['ja']['buoyName']), (None, '', '', ''))
            # an airport's name follows it likewise (none has a station name without one)
            for w in s['windStation']: self.assertRegex(w, r'^metar:RK[A-Z]{2}$')
            n = len(s['windStation'])
            for v in (s['stationName'], s['zh']['stationName'], s['ja']['stationName']):
                self.assertEqual(len(v), n, s['id']) if n else self.assertEqual(v, '', s['id'])
        for c in ('tw', 'jp', 'ca', 'hi', 'au', 'nw'): self.assertEqual(sum(s.get('country', 'tw') == c for s in SPOTS), 8)


FIXDIR = os.path.join(HERE, 'fixtures', 'kr')  # live copies from 2026-10-18 05:10 UTC
def FIX(n):
    with open(os.path.join(FIXDIR, n), encoding='utf-8') as f: return f.read()
import datetime
U = datetime.timezone.utc
NOW = datetime.datetime(2026, 10, 18, 5, 30, tzinfo=U)


def DRIFT(rows):
    # a .drift file as NOAA writes one for a KMA buoy, from [(UTC datetime, wave height text)], newest first
    return ('#YY  MM DD hhmm     LAT      LON WDIR WSPD GST   PRES  PTDY  ATMP  WTMP  DEWP  WVHT  DPD\n'
            '#yr  mo dy hrmn     deg      deg degT m/s  m/s    hPa   hPa  degC  degC  degC     m  sec\n' +
            ''.join('%s   33.08   126.03 330  7.0   MM     MM    MM  21.9  25.1    MM  %4s    0\n' % (t.strftime('%Y %m %d %H%M'), h) for t, h in rows))


class Readers(unittest.TestCase):
    def test_metar_newest_report(self):
        # three hourly reports per airport, newest first or not: the 05:00 UTC one is 13:00 in Taipei
        import kr
        m = json.loads(FIX('metar-kr.json'))
        self.assertEqual(kr.metar_wind(m, 'RKNY', NOW), [['2026-10-18T13:00', 6.0, 170.0]])
        self.assertEqual(kr.metar_wind(list(reversed(m)), 'RKPC', NOW), [['2026-10-18T13:00', 18.0, 220.0]])  # 22018G34KT: the mean wind, not the gust
        self.assertEqual(kr.metar_wind(m, 'RKSS', NOW), [])   # an airport that sent nothing
        self.assertEqual(kr.metar_wind(None, 'RKNY', NOW), [])

    def test_kma_buoy(self):
        # Donghae's buoy, hourly in 0.5 m steps: 05:00 UTC is 13:00 on Taipei's clock (the .drift's time of day is one hhmm column).
        # Its period (0 or 1 s) isn't a real one and it sends no direction, so both are None; the water temperature comes through
        import kr, ca
        self.assertEqual(ca._ndbc(FIX('ndbc-22105.drift'))[0][0], datetime.datetime(2026, 10, 18, 5, 0, tzinfo=U))
        r = kr.kma_rows(FIX('ndbc-22105.drift'), NOW)
        self.assertEqual((len(r), r[0], r[-1]), (23, ['2026-10-17T14:00', 0.5, None, None, 22.7], ['2026-10-18T13:00', 1.5, None, None, 23.3]))
        self.assertNotIn('2026-10-18T03:00', [x[0] for x in r])   # an hour NOAA has from none of the buoys
        self.assertEqual(kr.kma_rows(FIX('ndbc-22105.drift'), NOW + datetime.timedelta(hours=7)), [])   # silent since
        self.assertEqual(kr.kma_rows(None, NOW), [])

    def test_kma_calm_and_lost_sensor(self):
        # a calm's 0.0 m stays: Deokjeokdo, up the bay, read 0.0 on the afternoon of the 17th
        import kr
        self.assertEqual(kr.kma_rows(FIX('ndbc-22101.drift'), NOW)[0], ['2026-10-17T14:00', 0.0, None, None, 21.9])
        # a buoy that has sent only 0.0 m for ZERO_HOURS has lost its wave sensor, as Marado's did for three weeks in September 2026;
        # one wave inside that time and the calm counts
        end = datetime.datetime(2026, 10, 18, 5, tzinfo=U); H = lambda n: end - datetime.timedelta(hours=n)
        flat = [(H(n), '0.0') for n in range(kr.ZERO_HOURS)]
        self.assertEqual(kr.kma_rows(DRIFT(flat + [(H(kr.ZERO_HOURS), '0.5')]), NOW), [])
        r = kr.kma_rows(DRIFT(flat[:-1] + [(H(kr.ZERO_HOURS - 1), '0.5')]), NOW)
        self.assertEqual((len(r), r[-1]), (24, ['2026-10-18T13:00', 0.0, None, None, 25.1]))
        # rows with no height are passed over
        self.assertEqual(kr.kma_rows(DRIFT([(H(0), 'MM'), (H(1), '1.0')]), NOW), [['2026-10-18T12:00', 1.0, None, None, 25.1]])

    def test_metar_stale(self):
        import kr
        m = json.loads(FIX('metar-kr.json'))
        self.assertEqual(kr.metar_wind(m, 'RKPK', NOW + datetime.timedelta(hours=3)), [])  # newest 05:00 UTC, 3.5 hours before
        self.assertEqual(kr.metar_wind(m, 'RKPK', NOW + datetime.timedelta(hours=2)), [['2026-10-18T13:00', 11.0, 200.0]])

    def test_metar_calm_variable_and_odd_rows(self):
        # calm (00000KT) and variable wind (VRB03KT) have no direction; a report without a wind speed is passed over; reportTime
        # stands in for a missing obsTime; a report at :30 lands on the nearest hour
        import kr
        r = lambda t, d, k, **x: dict({'icaoId': 'RKNY', 'reportTime': t + ':00.000Z', 'wdir': d, 'wspd': k}, **x)
        self.assertEqual(kr.metar_wind([r('2026-10-18T05:00', 0, 0)], 'RKNY', NOW), [['2026-10-18T13:00', 0.0, None]])
        self.assertEqual(kr.metar_wind([r('2026-10-18T05:00', 'VRB', 3)], 'RKNY', NOW), [['2026-10-18T13:00', 3.0, None]])
        self.assertEqual(kr.metar_wind([r('2026-10-18T04:00', 90, 5), r('2026-10-18T05:00', None, None)], 'RKNY', NOW), [['2026-10-18T12:00', 5.0, 90.0]])
        self.assertEqual(kr.metar_wind([r('2026-10-18T04:30', 90, 5)], 'RKNY', NOW), [['2026-10-18T13:00', 5.0, 90.0]])
        self.assertEqual(kr.metar_wind([r('2026-10-18T05:00', 90, 5, obsTime=None, reportTime='?')], 'RKNY', NOW), [])


class Fill(unittest.TestCase):
    def setUp(self):
        import copy
        with open(os.path.join(FIXDIR, 'snap_in.json')) as f: self.snap = json.load(f)
        self.before = copy.deepcopy(self.snap)

    def test_fill_jukdo(self):
        import kr
        kr.fill(self.snap, SPOTS, FIXDIR, NOW)
        s = self.snap['spots']['jukdo']
        self.assertEqual(s['tz'], 9)
        self.assertEqual((s['buoyId'], len(s['buoy']), s['buoy'][-1], s['buoyAt'], s['buoyQuiet']), ('22105', 23, ['2026-10-18T13:00', 1.5, None, None, 23.3], '2026-10-18T13:00', False))
        # Donghae's buoy, 119 km out to sea: shown with its distance, but no height correction from it
        self.assertEqual((s['buoyName'], s['buoyKm'], s['zh']['buoyName'], s['ja']['buoyName'], s['buoyBy'], s['buoyFar']), ('Donghae', 119, '韓國東海', 'トンヘ', 'kma', True))
        self.assertNotIn('buoyMain', s)  # its one buoy
        self.assertEqual(s['dwind'], [['2026-10-18T13:00', 6.0, 170.0]])
        self.assertEqual((s['stationName'], s['zh']['stationName'], s['ja']['stationName']), ('Yangyang Airport', '襄陽機場', '襄陽空港'))
        self.assertEqual(s['wind'][0], ['2026-10-18T00:00', 17.2, 157, None, None])
        self.assertEqual([r[0][11:13] for r in s['wind']], ['00', '03', '06', '09', '12', '15', '18', '21'])
        self.assertEqual(s['tides']['2026-10-18'], [['06:30', 'H', 14], ['13:00', 'L', 6]])  # the East Sea's tides are a few cm
        self.assertEqual(sorted(s['sun']), ['2026-10-18', '2026-10-19'])  # Taipei 18th 00-23h is Korea 18th 01h to 19th 00h
        self.assertEqual(s['sun']['2026-10-18']['rise'], '06:35')
        self.assertEqual(self.snap['src']['spots']['jukdo'], '2026-10-18T13:00/2026-10-18T13:00')
        for k in ('donghe', 'blacks'): self.assertEqual(self.snap['spots'][k], self.before['spots'][k])

    def test_manlipo_backup_buoy(self):
        # Manlipo's main buoy is Oeyeondo; with it silent Deokjeokdo stands in, under its own name and distance, while the past days and
        # corrections keep to Oeyeondo; with both silent the spot says so, naming Oeyeondo
        import kr, copy, tempfile, shutil
        def fill(drop):
            tmp = tempfile.mkdtemp(); self.snap = copy.deepcopy(self.before)
            for f in os.listdir(FIXDIR):
                if f not in drop: shutil.copy(os.path.join(FIXDIR, f), tmp)
            kr.fill(self.snap, SPOTS, tmp, NOW); return self.snap['spots']['manlipo']
        m = fill(())
        self.assertEqual((m['buoyId'], len(m['buoy']), m['buoy'][-1], m['buoyQuiet'], m['buoyMain']), ('22108', 23, ['2026-10-18T13:00', 2.0, None, None, 20.8], False, '22108'))
        self.assertEqual((m['buoyName'], m['buoyKm'], m['zh']['buoyName'], m['ja']['buoyName'], m['buoyBy']), ('Oeyeondo', 69, '外煙島', 'ウェヨンド', 'kma'))
        self.assertNotIn('buoyFar', m)
        m = fill(('ndbc-22108.drift',))
        self.assertEqual((m['buoyId'], m['buoy'][-1], m['buoyQuiet'], m['buoyMain']), ('22101', ['2026-10-18T13:00', 1.5, None, None, 21.8], False, '22108'))
        self.assertEqual((m['buoyName'], m['buoyKm'], m['zh']['buoyName'], m['ja']['buoyName']), ('Deokjeokdo', 51, '德積島', 'トクチョクト'))
        self.assertEqual(self.snap['src']['spots']['manlipo'], '2026-10-18T13:00/')
        m = fill(('ndbc-22108.drift', 'ndbc-22101.drift'))
        self.assertEqual((m['buoyId'], m['buoy'], m['buoyAt'], m['buoyQuiet'], m['buoyName'], m['buoyKm']), (None, [], '', True, 'Oeyeondo', 69))
        self.assertEqual(self.snap['src']['spots']['manlipo'], '/')

    def test_iho_has_no_buoy(self):
        # no buoy at all, rather than a silent one
        import kr
        kr.fill(self.snap, SPOTS, FIXDIR, NOW)
        i = self.snap['spots']['iho']
        self.assertEqual((i['buoyId'], i['buoy'], i['buoyAt'], i['buoyQuiet'], i['buoyName']), (None, [], '', False, ''))
        self.assertNotIn('buoyFar', i)
        self.assertEqual(self.snap['src']['spots']['iho'], '/2026-10-18T13:00')

    def test_downloads_follow_the_spot_list(self):
        # the Open-Meteo replies hold every Korean spot of spots.json in its order, so Iho (7th) takes the 7th even with spots missing
        import kr
        kr.fill(self.snap, SPOTS, FIXDIR, NOW)
        om, tide = json.loads(FIX('openkr.json')), json.loads(FIX('tidekr.json'))
        i = self.snap['spots']['iho']
        self.assertEqual(i['wind'][0][:3], ['2026-10-18T00:00', 4.5, 353])
        self.assertEqual((om[6]['hourly']['wind_speed_10m'][0], om[6]['latitude']), (4.5, 33.5))
        self.assertEqual(i['dwind'], [['2026-10-18T13:00', 18.0, 220.0]])
        self.assertIn(['16:38', 'H', 87], i['tides']['2026-10-18'])
        for n, k in enumerate(KR_IDS):
            s = next(x for x in SPOTS if x['id'] == k)
            self.assertLess(abs(om[n]['latitude'] - s['lat']) + abs(om[n]['longitude'] - s['lon']), 0.1, k)
            self.assertLess(abs(tide[n]['latitude'] - s['lat']) + abs(tide[n]['longitude'] - s['lon']), 0.25, k)

    def test_big_west_coast_tides(self):
        import kr
        kr.fill(self.snap, SPOTS, FIXDIR, NOW)
        t = self.snap['spots']['manlipo']['tides']['2026-10-18']
        self.assertEqual([x[1] for x in t], ['L', 'H', 'L', 'H'])
        self.assertGreater(max(x[2] for x in t) - min(x[2] for x in t), 250)

    def test_no_airport(self):
        # Geumjin has no airport near enough: no wind now and no station name, the forecast still comes
        import kr
        kr.fill(self.snap, SPOTS, FIXDIR, NOW)
        g = self.snap['spots']['geumjin']
        self.assertEqual((g['dwind'], g['stationName'], g['zh']['stationName'], g['ja']['stationName']), ([], '', '', ''))
        self.assertTrue(g['wind'] and g['tides'] and g['sun'])
        # Jukdo's buoy, 85 km off here: near enough to correct the heights
        self.assertEqual((g['buoyId'], g['buoy'], g['buoyKm']), ('22105', self.snap['spots']['jukdo']['buoy'], 85))
        self.assertNotIn('buoyFar', g)
        self.assertEqual(self.snap['src']['spots']['geumjin'], '2026-10-18T13:00/')

    def test_nothing_downloaded(self):
        import kr, tempfile
        kr.fill(self.snap, SPOTS, tempfile.mkdtemp(), NOW)
        s = self.snap['spots']['jukdo']
        self.assertEqual((s['tz'], s['buoy'], s['dwind'], s['wind'], s['tides']), (9, [], [], [], {}))
        self.assertEqual((s['stationName'], s['buoyName'], s['buoyQuiet']), ('Yangyang Airport', 'Donghae', True))
        self.assertFalse(self.snap['spots']['iho']['buoyQuiet'])
        self.assertTrue(s['sun'])

    def test_one_airport_as_text(self):
        # a spot with one airport may name it without a list, as the NOAA countries' spots with one station do
        import kr, copy
        spots = copy.deepcopy(SPOTS)
        j = next(s for s in spots if s['id'] == 'jukdo')
        j['windStation'], j['stationName'], j['zh']['stationName'], j['ja']['stationName'] = 'metar:RKNY', 'Yangyang Airport', '襄陽機場', '襄陽空港'
        kr.fill(self.snap, spots, FIXDIR, NOW)
        s = self.snap['spots']['jukdo']
        self.assertEqual(s['dwind'], [['2026-10-18T13:00', 6.0, 170.0]])
        self.assertEqual((s['stationName'], s['zh']['stationName'], s['ja']['stationName']), ('Yangyang Airport', '襄陽機場', '襄陽空港'))

    def test_one_spot_reply(self):
        # Open-Meteo answers a single place with one object rather than a list of one
        import kr, tempfile, shutil
        tmp = tempfile.mkdtemp(); shutil.copy(os.path.join(FIXDIR, 'metar-kr.json'), tmp)
        for n in ('openkr.json', 'tidekr.json'):
            with open(os.path.join(tmp, n), 'w') as f: json.dump(json.loads(FIX(n))[0], f)
        kr.fill(self.snap, [s for s in SPOTS if s.get('country') != 'kr' or s['id'] == 'jukdo'], tmp, NOW)
        s = self.snap['spots']['jukdo']
        self.assertEqual(s['wind'][0], ['2026-10-18T00:00', 17.2, 157, None, None])
        self.assertEqual(s['tides']['2026-10-18'], [['06:30', 'H', 14], ['13:00', 'L', 6]])
        self.assertEqual(self.snap['spots']['iho'], self.before['spots']['iho'])  # not in that spot list, so left alone

    def test_bad_downloads(self):
        # an error reply, a page that isn't JSON and a reply of the wrong shape only blank their own fields
        import kr, tempfile, io, contextlib
        tmp = tempfile.mkdtemp()
        for n, v in (('openkr.json', '{"error":true,"reason":"Too many requests"}'), ('tidekr.json', '<html>busy</html>'), ('metar-kr.json', '{"error":"bad ids"}'),
                     ('ndbc-22105.drift', '<html>busy</html>'), ('ndbc-22108.drift', FIX('ndbc-22108.drift').replace('2026 10 18 0500', '2026 10 18 05h0'))):
            with open(os.path.join(tmp, n), 'w') as f: f.write(v)
        err = io.StringIO()
        with contextlib.redirect_stderr(err): kr.fill(self.snap, SPOTS, tmp, NOW)
        self.assertIn('kr: forecast jukdo skipped', err.getvalue())
        self.assertIn('kr: buoy 22108 skipped', err.getvalue())   # a row it can't read
        for k in ('jukdo', 'geumjin', 'iho', 'manlipo'):
            s = self.snap['spots'][k]
            self.assertEqual((s['tz'], s['buoy'], s['dwind'], s['wind'], s['tides']), (9, [], [], [], {}), k)
            self.assertEqual(s['buoyQuiet'], k != 'iho', k)
            self.assertTrue(s['sun'], k)

    def test_runs_isolated_like_refresh(self):
        import subprocess, tempfile, shutil
        tmp = tempfile.mkdtemp(); f = os.path.join(tmp, 'snap.json'); shutil.copy(os.path.join(FIXDIR, 'snap_in.json'), f)
        r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'kr.py'), FIXDIR, f, os.path.join(ROOT, 'spots.json')], capture_output=True, text=True, cwd=tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('kr: jukdo', r.stdout)
        self.assertNotIn('blacks', r.stdout)
        with open(f) as fh: self.assertEqual(json.load(fh)['spots']['manlipo']['tz'], 9)


if __name__ == '__main__':
    unittest.main()
