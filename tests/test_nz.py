# New Zealand spots and nz.py (South Island Waves buoys, Wellington's and Christchurch's airport wind from NOAA's Aviation Weather
# Center, ECMWF wind via Open-Meteo, LINZ's tide tables).
# Run: python3 -m unittest discover -s tests -v
import os, sys, json, unittest, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
SPOTS = json.load(open(os.path.join(ROOT, 'spots.json')))
NZ_IDS = ['raglan', 'mount', 'gisborne', 'newplymouth', 'lyall', 'kaikoura', 'brighton', 'stclair']
KEYS = ['zone', 'siw', 'buoyKm', 'buoyName', 'windStation', 'stationName', 'tidePort', 'off', 'lat', 'lon', 'blurb', 'cams', 'zh', 'ja']
BUOYS = {'brighton': (['31020'], 15, 'Pegasus Bay', '佩加索斯灣', 'ペガサス湾'), 'stclair': (['31327'], 3, 'White Island', '白島', 'ホワイト島')}
WIND = {'lyall': (['metar:NZWN'], ['Wellington Airport'], ['威靈頓機場'], ['ウェリントン空港']),
        'brighton': (['metar:NZCH'], ['Christchurch Airport'], ['基督城機場'], ['クライストチャーチ空港'])}
PORTS = ['Manu Bay', 'Moturiki Island', 'Gisborne', 'Port Taranaki', 'Wellington', 'Kaikōura', 'New Brighton Pier', 'Green Island']


class Spots(unittest.TestCase):
    def test_nz_spots_complete(self):
        nz = [s for s in SPOTS if s.get('country') == 'nz']
        self.assertEqual([s['id'] for s in nz], NZ_IDS)
        self.assertEqual([s['tidePort'] for s in nz], PORTS)
        for s in nz:
            for k in KEYS: self.assertIn(k, s, s['id'] + ' ' + k)
            self.assertTrue(s['zh']['name'] and s['ja']['name'] and s['zh']['full'] and s['ja']['full'] and s['zh']['region'] and s['ja']['region'])
            self.assertNotIn('tz', s)
            self.assertEqual(s['zone'], 'Pacific/Auckland')
            self.assertTrue(-47 < s['lat'] < -34 and 166 < s['lon'] < 179, s['id'])
            self.assertTrue(0 <= s['off'] < 360, s['id'])
            self.assertEqual((s['siw'], s['buoyKm'], s['buoyName'], s['zh']['buoyName'], s['ja']['buoyName']), BUOYS.get(s['id'], ([], None, '', '', '')), s['id'])
            self.assertEqual(s.get('buoyBy'), 'dcc' if s['id'] == 'stclair' else None, s['id'])  # White Island is Dunedin City Council's
            self.assertEqual((s['windStation'], s['stationName'], s['zh']['stationName'], s['ja']['stationName']), WIND.get(s['id'], ([], '', '', '')), s['id'])
            self.assertEqual(len(s['zh']['cams']), len(s['cams'])); self.assertEqual(len(s['ja']['cams']), len(s['cams']))
            for c in s['cams']: self.assertTrue(c[0] and c[1].startswith('https://'), s['id'])
        self.assertEqual(len({s['id'] for s in SPOTS}), len(SPOTS))
        for c in ('tw', 'jp', 'kr', 'ph', 'id', 'ca', 'hi', 'au', 'nw'): self.assertEqual(sum(s.get('country', 'tw') == c for s in SPOTS), 8, c)


FIXDIR = os.path.join(HERE, 'fixtures', 'nz')  # live copies from 2026-10-18 15:44 UTC
CACHE = os.path.join(FIXDIR, 'linz')  # LINZ's 2026 tables for Manu Bay, Wellington, New Brighton Pier and Green Island, 10 to 25 October,
# named as in refresh.sh's cache folder (a folder named cache would be left out of git)
def FIX(n):
    with open(os.path.join(FIXDIR, n), encoding='utf-8') as f: return f.read()
U = datetime.timezone.utc
NOW = datetime.datetime(2026, 10, 18, 15, 44, tzinfo=U)
HEAD = '"Time (UNIX/UTC)","Timestamp (UTC)",Site,BuoyID,"Hsig (m)","Tp (s)","Tm (s)","Dp (deg)","DpSpr (deg)","Dm (deg)","DmSpr (deg)",QF_waves,"SST (degC)",QF_sst'


class Readers(unittest.TestCase):
    def test_siw_hourly_buoy(self):
        import nz
        # Pegasus Bay reads at :40 past each hour, with water temperature: 14:40 UTC is 23:00 on Taipei's clock, on the nearest hour
        r = nz.siw_rows(FIX('siw-31020.csv'), now=NOW)
        self.assertEqual(len(r), 24)
        self.assertEqual(r[-1], ['2026-10-18T23:00', 0.81, 6.74, 123.789, 13.24])
        self.assertEqual(r[0][0], '2026-10-18T00:00')

    def test_siw_three_hourly_buoy(self):
        import nz
        # White Island reads every 3 hours at :30 and has no water temperature
        r = nz.siw_rows(FIX('siw-31327.csv'), now=NOW)
        self.assertEqual([x[0][11:13] for x in r], ['01', '04', '07', '10', '13', '16', '19', '22'])
        self.assertEqual(r[-1], ['2026-10-18T22:00', 2.33, 9.749, 182.034, None])

    def test_siw_silent_buoy(self):
        import nz
        self.assertEqual(nz.siw_rows(FIX('siw-31327.csv'), now=NOW + datetime.timedelta(hours=7)), [])  # over 9 hours since its last reading
        self.assertEqual(nz.siw_rows('', now=NOW), [])
        self.assertEqual(nz.siw_rows(None), [])

    def test_siw_ragged_rows(self):
        import nz
        txt = HEAD + '\r\n' + '\r\n'.join([
            '1792330800,2026-10-18T13:40:00.000Z,S,S,0.84,12.8,6.48,122.788,18.5,109.26,36.7,1,13.28,1',          # whole: water temperature read
            '1792327200,2026-10-18T12:40:00.000Z,S,S,0.90,12.8,6.40,-9999,18.5,109.0,36.7,1,13.30,1,1026.1',      # an extra column: none read
            '1792323600,2026-10-18T11:40:00.000Z,S,S,0.92,12.8,6.30,121.0,18.5,108.0,36.7,1,13.31',               # one short: none read
            '1792320000,2026-10-18T10:40:00.000Z,S,S,-9999,12.8,6.30,121.0,18.5,108.0,36.7,1,13.31,1',            # no height: left out
            '1792316400,2026-10-18T09:40:00.000Z,S,S,0.95,12.8,6.30,121.0,18.5,108.0,36.7,4,13.31,1',             # failed its check: left out
            '1792312800,2026-10-18T08:40:00.000Z,S,S,0.97,12.8,6.30,121.0,18.5,108.0,36.7,1,13.4,3'])             # suspect temperature
        self.assertEqual(nz.siw_rows(txt, now=NOW), [['2026-10-18T17:00', 0.97, 6.3, 121.0, None], ['2026-10-18T20:00', 0.92, 6.3, 121.0, None],
                                                      ['2026-10-18T21:00', 0.9, 6.4, 109.0, None], ['2026-10-18T22:00', 0.84, 6.48, 122.788, 13.28]])

    def test_siw_flags_and_odd_numbers(self):
        import nz
        # a flag written as a decimal is still a flag, and nan or inf is no reading
        txt = HEAD + '\n' + '\n'.join([
            '1792330800,2026-10-18T13:40:00.000Z,S,S,0.84,12.8,nan,122.788,18.5,109.26,36.7,1,inf,1',       # no period or water temperature
            '1792327200,2026-10-18T12:40:00.000Z,S,S,0.90,12.8,6.40,121.0,18.5,109.0,36.7,4.0,13.30,1',      # failed its check: left out
            '1792323600,2026-10-18T11:40:00.000Z,S,S,NaN,12.8,6.30,121.0,18.5,108.0,36.7,1,13.31,1',          # no height: left out
            '1792320000,2026-10-18T10:40:00.000Z,S,S,0.92,12.8,6.30,121.0,18.5,108.0,36.7,1,13.31,3.0'])     # suspect temperature
        self.assertEqual(nz.siw_rows(txt, now=NOW), [['2026-10-18T19:00', 0.92, 6.3, 121.0, None], ['2026-10-18T22:00', 0.84, None, 122.788, None]])

    def test_siw_columns_by_name(self):
        import nz
        # Bluff's buoy puts Hmax and Tz ahead of the periods; the columns are found by name. -9999 is no data.
        txt = ('"Time (UNIX/UTC)","Timestamp (UTC)",Site,BuoyID,"Hsig (m)","Hmax (m)","Tz (s)","Tp (s)","Tm (s)","Dp (deg)","DpSpr (deg)","Dm (deg)",'
               '"DmSpr (deg)",QF_waves,"SST (degC)",QF_sst\n1792332600,2026-10-18T14:10:00Z,SPOT-7000001,SPOT-7000001,2.22,2.22,-9999,7.69,6.00,265.28,-9999,267.46,-9999,1,-9999,1\n')
        self.assertEqual(nz.siw_rows(txt), [['2026-10-18T22:00', 2.22, 6.0, 265.28, None]])

    def test_linz_tables(self):
        import nz
        t = nz.linz_tides([FIX('linz/nz-tide-Wellington-2026.csv')])
        self.assertEqual(sorted(t)[0], '2026-10-10'); self.assertEqual(sorted(t)[-1], '2026-10-25')
        self.assertEqual(t['2026-10-18'], [['05:14', 'L', 80], ['11:31', 'H', 160], ['17:54', 'L', 70], ['23:48', 'H', 150]])
        self.assertEqual(t['2026-10-19'], [['05:54', 'L', 80], ['12:13', 'H', 160], ['18:33', 'L', 70]])  # the next high is after midnight
        self.assertEqual(sorted(nz.linz_tides([FIX('linz/nz-tide-Wellington-2026.csv')], '2026-10-17', '2026-10-20')), ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20'])

    def test_linz_daylight_saving_ends(self):
        import nz
        # Port Taranaki on 5 April 2026, the 25-hour day daylight saving ends, has five tides
        txt = ('\ufeff076,Port Taranaki,39°03\'S,174°02\'E\r\nBased on constituent set with reference date:,01-Jul-2016\r\n'
               'Local Std or Daylight Time,Tidal heights in metres.\r\n4,Sa,4,2026,05:57,0.6,12:00,3.4,18:15,0.5,,\r\n'
               '5,Su,4,2026,00:18,3.4,05:29,0.7,11:32,3.3,17:48,0.7,23:50,3.3\r\n6,Mo,4,2026,06:03,0.8,12:05,3.1,18:21,0.8,,\r\n')
        self.assertEqual(nz.linz_tides([txt])['2026-04-05'], [['00:18', 'H', 340], ['05:29', 'L', 70], ['11:32', 'H', 330], ['17:48', 'L', 70], ['23:50', 'H', 330]])

    def test_linz_across_years(self):
        import nz
        # the last tide of a year is told from the first of the next; a tie takes the other kind from the one before
        y1 = '﻿1,Wellington,41°17\'S,174°47\'E\r\nBased on constituent set with reference date:,01-Jan-2015\r\nLocal Std or Daylight Time,Tidal heights in metres.\r\n' \
             '31,Th,12,2026,04:01,1.5,10:12,0.6,16:30,1.5,22:41,0.6\r\n'
        y2 = '1,Wellington,41°17\'S,174°47\'E\r\nx,y\r\nLocal Std or Daylight Time,Tidal heights in metres.\r\n1,Fr,1,2027,4:40,0.6,10:51,0.5,17:09,1.4,,\r\n'
        self.assertEqual(nz.linz_tides([y1, y2]), {'2026-12-31': [['04:01', 'H', 150], ['10:12', 'L', 60], ['16:30', 'H', 150], ['22:41', 'L', 60]],
                                                    '2027-01-01': [['04:40', 'H', 60], ['10:51', 'L', 50], ['17:09', 'H', 140]]})
        self.assertEqual(nz.linz_tides([y1]), {'2026-12-31': [['04:01', 'H', 150], ['10:12', 'L', 60], ['16:30', 'H', 150], ['22:41', 'L', 60]]})
        self.assertEqual(nz.linz_tides([]), {}); self.assertEqual(nz.linz_tides([None]), {})

    def test_metar_newest_report(self):
        import kr
        m = json.loads(FIX('metar-nz.json'))
        # 03013KT at Wellington and 30004KT at Christchurch, both at 15:30 UTC, 23:30 on Taipei's clock, on the nearest hour
        self.assertEqual(kr.metar_wind(m, 'NZWN', NOW), [['2026-10-19T00:00', 13.0, 30.0]])
        self.assertEqual(kr.metar_wind(m, 'NZCH', NOW), [['2026-10-19T00:00', 4.0, 300.0]])


class Fill(unittest.TestCase):
    def setUp(self):
        import copy
        with open(os.path.join(FIXDIR, 'snap_in.json')) as f: self.snap = json.load(f)
        self.before = copy.deepcopy(self.snap)

    def fill(self, now=NOW, dl=FIXDIR, cache=CACHE):
        import nz
        nz.fill(self.snap, SPOTS, dl, now, cache); return self.snap['spots']

    def test_fill_brighton(self):
        s = self.fill()['brighton']
        self.assertEqual(s['tz'], 13)  # New Zealand daylight time
        self.assertEqual((s['buoyId'], len(s['buoy']), s['buoy'][-1], s['buoyAt'], s['buoyQuiet']), ('31020', 24, ['2026-10-18T23:00', 0.81, 6.74, 123.789, 13.24], '2026-10-18T23:00', False))
        self.assertNotIn('buoyBy', s)  # the University of Canterbury's
        self.assertEqual(s['dwind'], [['2026-10-19T00:00', 4.0, 300.0]])
        self.assertEqual((s['stationName'], s['zh']['stationName'], s['ja']['stationName']), ('Christchurch Airport', '基督城機場', 'クライストチャーチ空港'))
        self.assertEqual(s['wind'][0], ['2026-10-18T00:00', 1.3, 283, None, None])
        self.assertEqual([r[0][11:13] for r in s['wind']], ['00', '03', '06', '09', '12', '15', '18', '21'])
        # New Brighton Pier's own table, on New Zealand's clock; Taipei's 18th runs into New Zealand's 19th, and a day either side
        self.assertEqual(s['tides']['2026-10-18'], [['04:39', 'L', 80], ['11:03', 'H', 210], ['17:25', 'L', 80], ['23:28', 'H', 200]])
        self.assertEqual(sorted(s['tides']), ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20'])
        self.assertEqual(sorted(s['sun']), ['2026-10-18', '2026-10-19'])
        self.assertEqual((s['sun']['2026-10-18']['rise'], s['sun']['2026-10-18']['set']), ('06:33', '19:55'))
        self.assertEqual(self.snap['src']['spots']['brighton'], '2026-10-18T23:00/2026-10-19T00:00')

    def test_fill_stclair_and_lyall(self):
        sp = self.fill(); c, l = sp['stclair'], sp['lyall']
        self.assertEqual((c['buoyId'], len(c['buoy']), c['buoy'][-1], c['dwind'], c['stationName'], c['buoyBy']), ('31327', 8, ['2026-10-18T22:00', 2.33, 9.749, 182.034, None], [], '', 'dcc'))
        self.assertEqual(c['tides']['2026-10-18'], [['03:11', 'L', 60], ['09:30', 'H', 170], ['15:49', 'L', 70], ['21:58', 'H', 160]])  # Green Island's
        self.assertEqual(self.snap['src']['spots']['stclair'], '2026-10-18T22:00/')
        self.assertEqual((l['buoyId'], l['buoy'], l['buoyAt'], l['buoyQuiet'], l['dwind']), (None, [], '', False, [['2026-10-19T00:00', 13.0, 30.0]]))
        self.assertEqual((l['stationName'], l['zh']['stationName'], l['ja']['stationName']), ('Wellington Airport', '威靈頓機場', 'ウェリントン空港'))
        self.assertEqual(l['tides']['2026-10-18'][1], ['11:31', 'H', 160])  # Wellington's

    def test_tables_named_as_refresh_saves_them(self):
        # refresh.sh saves each port's table as nz-tide-<port>-<year>.csv, the port url-encoded by its nzids function, and fill must look
        # for the same name, Kaikōura's macron included. Wellington's table stands in for Kaikōura's, which isn't in the fixtures.
        import re, shutil, subprocess, tempfile, urllib.parse
        with open(os.path.join(ROOT, 'refresh.sh'), encoding='utf-8') as f: sh = f.read()
        self.assertIn('f="$G/nz-tide-$p-$y.csv"', sh)
        nzids = re.search(r'^nzids\(\)\{.*?; \}$', sh, re.S | re.M).group(0)
        r = subprocess.run(['sh', '-c', 'HERE=$1\n' + nzids + '\nnzids tidePort', 'sh', ROOT], capture_output=True, text=True)
        self.assertEqual(r.stdout.split(), [','.join(urllib.parse.quote(p) for p in PORTS)], r.stderr)
        self.assertIn(',Kaik%C5%8Dura,', r.stdout)
        tmp = tempfile.mkdtemp(); shutil.copy(os.path.join(CACHE, 'nz-tide-Wellington-2026.csv'), os.path.join(tmp, 'nz-tide-Kaik%C5%8Dura-2026.csv'))
        self.snap['spots']['kaikoura'] = json.loads(json.dumps(self.snap['spots']['lyall']))
        sp = self.fill(cache=tmp)
        self.assertEqual(sp['kaikoura']['tides']['2026-10-18'], [['05:14', 'L', 80], ['11:31', 'H', 160], ['17:54', 'L', 70], ['23:48', 'H', 150]])
        self.assertEqual(sp['lyall']['tides'], {})  # Wellington's own table isn't in that folder

    def test_tides_cover_past_days(self):
        # Raglan's snap also has the 16th and 17th (hist.wave): its tides start the day before them
        r = self.fill()['raglan']
        self.assertEqual(sorted(r['tides']), ['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20'])
        self.assertEqual(r['tides']['2026-10-18'], [['03:19', 'H', 270], ['09:37', 'L', 130], ['15:52', 'H', 270], ['22:19', 'L', 140]])
        self.assertEqual((r['buoyId'], r['buoyQuiet'], r['dwind'], r['stationName']), (None, False, [], ''))

    def test_downloads_follow_the_spot_list(self):
        # the Open-Meteo reply holds every New Zealand spot of spots.json in its order, so Lyall Bay (5th) takes the 5th though Mount
        # Maunganui, Gisborne and New Plymouth are missing from the snap, and St Clair the 8th
        sp = self.fill(); om = json.loads(FIX('opennz.json'))
        self.assertEqual(sp['lyall']['wind'][0][:3], ['2026-10-18T00:00', om[4]['hourly']['wind_speed_10m'][0], om[4]['hourly']['wind_direction_10m'][0]])
        self.assertEqual(sp['lyall']['wind'][0][:3], ['2026-10-18T00:00', 7.3, 182])
        self.assertEqual(sp['stclair']['wind'][0][:3], ['2026-10-18T00:00', 3.5, 304])
        for n, i in enumerate(NZ_IDS):
            s = next(x for x in SPOTS if x['id'] == i)
            self.assertTrue(abs(om[n]['latitude'] - s['lat']) < 0.11 and abs(om[n]['longitude'] - s['lon']) < 0.11, i)  # ECMWF's nearest point

    def test_silent_buoy(self):
        # 7 hours on, White Island and Pegasus Bay have both gone quiet, and the airports' reports are stale
        sp = self.fill(NOW + datetime.timedelta(hours=7))
        for k in ('brighton', 'stclair'): self.assertEqual((sp[k]['buoyId'], sp[k]['buoy'], sp[k]['buoyAt'], sp[k]['buoyQuiet']), (None, [], '', True), k)
        self.assertEqual((sp['lyall']['buoyQuiet'], sp['lyall']['dwind'], sp['brighton']['dwind']), (False, [], []))
        self.assertEqual(sp['brighton']['stationName'], 'Christchurch Airport')

    def test_winter_offset(self):
        self.assertEqual(self.fill(datetime.datetime(2027, 7, 1, tzinfo=U))['raglan']['tz'], 12)

    def test_countries_kept_apart(self):
        # Korea's, the Philippines' and Indonesia's runs leave the New Zealand spots alone, and New Zealand's run theirs
        import kr, copy
        for c in ('kr', 'ph', 'id'): kr.fill(self.snap, SPOTS, os.path.join(HERE, 'fixtures', c), NOW, c)
        for k in ('raglan', 'lyall', 'brighton', 'stclair'): self.assertEqual(self.snap['spots'][k], self.before['spots'][k], k)
        o = {k: copy.deepcopy(self.snap['spots'][k]) for k in ('donghe', 'blacks', 'jukdo', 'cloud9', 'uluwatu')}
        self.fill()
        for k, v in o.items(): self.assertEqual(self.snap['spots'][k], v, k)

    def test_nothing_downloaded(self):
        import tempfile
        e = tempfile.mkdtemp(); sp = self.fill(dl=e, cache=e)
        for k in ('raglan', 'lyall', 'brighton', 'stclair'):
            s = sp[k]
            self.assertEqual((s['tz'], s['buoy'], s['dwind'], s['wind'], s['tides']), (13, [], [], [], {}), k)
            self.assertTrue(s['sun'])
        self.assertEqual((sp['brighton']['buoyQuiet'], sp['raglan']['buoyQuiet']), (True, False))
        self.assertEqual(sp['lyall']['stationName'], 'Wellington Airport')  # the airport it would name, when none answered

    def test_runs_isolated_like_refresh(self):
        import subprocess, tempfile, shutil
        tmp = tempfile.mkdtemp(); f = os.path.join(tmp, 'snap.json'); shutil.copy(os.path.join(FIXDIR, 'snap_in.json'), f)
        r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'nz.py'), FIXDIR, f, os.path.join(ROOT, 'spots.json'), CACHE], capture_output=True, text=True, cwd=tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        # the buoys and airports go quiet as the clock runs on, so how much is used depends on it; the offset and the forecast don't
        self.assertRegex(r.stdout, r'nz: raglan 1[23] None 0 0 8 ')
        self.assertIn('nz: brighton 1', r.stdout)
        self.assertNotIn('uluwatu', r.stdout)
        with open(f) as fh: d = json.load(fh)
        self.assertEqual(d['spots']['uluwatu'], json.loads(FIX('snap_in.json'))['spots']['uluwatu'])
        self.assertEqual(d['spots']['stclair']['tides']['2026-10-18'][0], ['03:11', 'L', 60])


if __name__ == '__main__':
    unittest.main()
