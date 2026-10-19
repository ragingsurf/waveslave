# Hong Kong's spots and hk.py (the Hong Kong Observatory's 10-minute wind and tide predictions, the airport's reports from NOAA's Aviation
# Weather Center, ECMWF wind from the sea cell via Open-Meteo).
# Run: python3 -m unittest discover -s tests -v
import os, sys, json, unittest, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
SPOTS = json.load(open(os.path.join(ROOT, 'spots.json')))
HK_IDS = ['cheungsha', 'bigwavebay', 'tailongwan']
KEYS = ['zone', 'buoyKm', 'buoyName', 'windStation', 'stationName', 'tideStation', 'off', 'lat', 'lon', 'blurb', 'cams', 'zh', 'ja']
WIND = [['hko:Cheung Chau', 'metar:VHHH'], ['hko:Waglan Island'], []]
TIDES = ['SPW', 'TMW', 'KLW']  # HKO's stations: Shek Pik, Tai Miu Wan, Ko Lau Wan

FIXDIR = os.path.join(HERE, 'fixtures', 'hk')  # live copies from 2026-10-19 05:58 UTC (13:58 in Hong Kong)
CACHE = os.path.join(FIXDIR, 'hko')  # HKO's 2026 tables for the three stations, cut to October, named as refresh.sh keeps them in cache/
def FIX(n):
    with open(os.path.join(FIXDIR, n), encoding='utf-8') as f: return f.read()
U = datetime.timezone.utc
NOW = datetime.datetime(2026, 10, 19, 6, 0, tzinfo=U)
HEAD = 'Date time,Automatic Weather Station,10-Minute Mean Wind Direction(Compass points),10-Minute Mean Speed(km/hour),10-Minute Maximum Gust(km/hour)\n'


class Spots(unittest.TestCase):
    def test_hk_spots_complete(self):
        hk = [s for s in SPOTS if s.get('country') == 'hk']
        self.assertEqual([s['id'] for s in hk], HK_IDS)
        self.assertEqual([s['windStation'] for s in hk], WIND)
        self.assertEqual([s['tideStation'] for s in hk], TIDES)
        for s in hk:
            for k in KEYS: self.assertIn(k, s, s['id'] + ' ' + k)
            self.assertEqual(s['zone'], 'Asia/Hong_Kong')
            self.assertTrue(s['zh']['name'] and s['ja']['name'] and s['zh']['full'] and s['ja']['full'] and s['zh']['region'] and s['ja']['region'])
            self.assertNotIn('tz', s); self.assertNotIn('ndbc', s)
            self.assertTrue(22.2 < s['lat'] < 22.5 and 113.9 < s['lon'] < 114.4, s['id'])
            self.assertTrue(0 <= s['off'] < 360, s['id'])
            # no open buoy, as in the Philippines
            self.assertEqual((s['buoyKm'], s['buoyName'], s['zh']['buoyName'], s['ja']['buoyName']), (None, '', '', ''), s['id'])
            w = len(s['windStation'])
            for v in (s['stationName'], s['zh']['stationName'], s['ja']['stationName']): self.assertEqual(len(v) if w else v, w or '', s['id'])
            self.assertEqual((s['cams'], s['zh']['cams'], s['ja']['cams']), ([], [], []))
        self.assertEqual(len({s['id'] for s in SPOTS}), len(SPOTS))
        # after Micronesia's and before Hainan's, Vietnam's and Papua New Guinea's, the last added, so the shared Open-Meteo calls, which
        # list every spot in its order, keep each other spot's place
        self.assertEqual([s['id'] for s in SPOTS[-25:-22]], HK_IDS)

    def test_no_clock_changes(self):
        import au
        for at in (datetime.datetime(2026, 10, 19, tzinfo=U), datetime.datetime(2027, 1, 15, tzinfo=U), datetime.datetime(2027, 7, 1, tzinfo=U)):
            self.assertEqual(au.offset('Asia/Hong_Kong', at), 8, at)


class Readers(unittest.TestCase):
    def test_hko_wind(self):
        import hk
        csv = FIX('hko-wind.csv')
        # Cheung Chau's 13:50 reading, 27 km/h from the southeast, on the nearest hour (Hong Kong keeps Taipei's clock)
        self.assertEqual(hk.hko_wind(csv, 'Cheung Chau', NOW), [['2026-10-19T14:00', 14.6, 135.0]])
        self.assertEqual(hk.hko_wind(csv, 'Waglan Island', NOW), [['2026-10-19T14:00', 7.6, 90.0]])
        # Stanley sends a direction but no speed (N/A), and no station has a name it doesn't print
        self.assertIn('Stanley,Southeast,N/A,N/A', csv)
        self.assertEqual(hk.hko_wind(csv, 'Stanley', NOW), [])
        self.assertEqual(hk.hko_wind(csv, 'Cheung Chau Island', NOW), [])
        # 3 hours on, the reading is too old to count as wind now
        self.assertEqual(hk.hko_wind(csv, 'Cheung Chau', NOW + datetime.timedelta(hours=3)), [])
        self.assertEqual(hk.hko_wind(csv, 'Cheung Chau'), [['2026-10-19T14:00', 14.6, 135.0]])
        self.assertEqual(hk.hko_wind('', 'Cheung Chau', NOW), []); self.assertEqual(hk.hko_wind(None, 'Cheung Chau', NOW), [])

    def test_hko_wind_calm_variable_and_no_direction(self):
        # rows as HKO's archive has them: calm reads 0 kt, and neither it nor a variable wind, nor one whose vane sent nothing, has a direction
        import hk
        csv = '﻿' + HEAD + ('202610190900,Wetland Park,Calm,Calm,0\n202610190900,Ngong Ping,Variable,6,12\n'
                                 "202610190900,Tate's Cairn,N/A,21,24\n202610190900,Tap Mun,N/A,N/A,N/A\n2026101909,Sai Kung,East,8,15\n")
        at = datetime.datetime(2026, 10, 19, 1, 30, tzinfo=U)
        self.assertEqual(hk.hko_wind(csv, 'Wetland Park', at), [['2026-10-19T09:00', 0.0, None]])
        self.assertEqual(hk.hko_wind(csv, 'Ngong Ping', at), [['2026-10-19T09:00', 3.2, None]])
        self.assertEqual(hk.hko_wind(csv, "Tate's Cairn", at), [['2026-10-19T09:00', 11.3, None]])
        self.assertEqual(hk.hko_wind(csv, 'Tap Mun', at), [])
        self.assertEqual(hk.hko_wind(csv, 'Sai Kung', at), [])  # a time it can't read

    def test_hko_tide_events(self):
        import hk, nz
        js = json.loads(FIX('hko/hk-tide-SPW-2026.json'))
        ev = hk.hko_events(js, 2026)
        # one row per day of up to four events; the 17th has only its low, and blanks are left out
        self.assertEqual([e for e in ev if '2026-10-16' <= e[0] <= '2026-10-18'],
                         [('2026-10-16', '07:07', 0.84), ('2026-10-16', '23:38', 2.41), ('2026-10-17', '08:09', 0.91), ('2026-10-18', '00:24', 2.32), ('2026-10-18', '09:27', 0.95)])
        t = nz.turns(ev, '2026-10-16', '2026-10-19')
        self.assertEqual(t, {'2026-10-16': [['07:07', 'L', 84], ['23:38', 'H', 241]], '2026-10-17': [['08:09', 'L', 91]],
                             '2026-10-18': [['00:24', 'H', 232], ['09:27', 'L', 95]], '2026-10-19': [['01:33', 'H', 222], ['10:59', 'L', 95]]})
        self.assertEqual(hk.hko_events(None, 2026), []); self.assertEqual(hk.hko_events({}, 2026), [])
        self.assertEqual(hk.hko_events({'data': [['13', '01', '0101', '1.00'], ['10', '01', '2400', '1.00', '0x01', '1.00', '0303', '', '0404', 'N/A']]}, 2026), [])

    def test_each_year_read_on_its_own(self):
        # HKO's 2026 and 2027 tables for Ko Lau Wan, where they meet: the small high near midnight between the 20:52 and 01:43 lows is in
        # neither, so reading the two as one series would take the 20:52 low for a high
        import hk, nz
        y1 = {'data': [['12', '30', '0203', '2.07', '0742', '0.77', '1513', '1.75', '1928', '1.36'], ['12', '31', '0306', '1.80', '0822', '0.93', '1611', '1.85', '2052', '1.38']]}
        y2 = {'data': [['01', '01', '0143', '1.37', '0423', '1.56', '0903', '1.06', '1704', '1.96'], ['01', '02', '0239', '1.15', '0548', '1.41', '0947', '1.17', '1753', '2.05']]}
        both = nz.turns(hk.hko_events(y1, 2026) + hk.hko_events(y2, 2027))
        self.assertEqual(both['2026-12-31'][-1], ['20:52', 'H', 138])
        apart = {**nz.turns(hk.hko_events(y1, 2026)), **nz.turns(hk.hko_events(y2, 2027))}
        self.assertEqual(apart['2026-12-31'], [['03:06', 'H', 180], ['08:22', 'L', 93], ['16:11', 'H', 185], ['20:52', 'L', 138]])
        self.assertEqual(apart['2027-01-01'], [['01:43', 'L', 137], ['04:23', 'H', 156], ['09:03', 'L', 106], ['17:04', 'H', 196]])


class Fill(unittest.TestCase):
    def setUp(self):
        import copy
        with open(os.path.join(FIXDIR, 'snap_in.json')) as f: self.snap = json.load(f)
        self.before = copy.deepcopy(self.snap)

    def fill(self, now=NOW, dl=FIXDIR, cache=CACHE):
        import hk
        hk.fill(self.snap, SPOTS, dl, now, cache); return self.snap['spots']

    def without(self, drop=(), csv=None):
        # a copy of the fixtures without some files, or with HKO's wind file changed
        import tempfile, shutil
        tmp = tempfile.mkdtemp()
        for f in os.listdir(FIXDIR):
            if f not in drop and os.path.isfile(os.path.join(FIXDIR, f)): shutil.copy(os.path.join(FIXDIR, f), tmp)
        if csv is not None:
            with open(os.path.join(tmp, 'hko-wind.csv'), 'w') as f: f.write(csv(FIX('hko-wind.csv')))
        return tmp

    def test_offsets_and_no_buoy(self):
        sp = self.fill()
        for k in HK_IDS:
            s = sp[k]
            self.assertEqual((s['tz'], s['buoyId'], s['buoy'], s['buoyAt'], s['buoyQuiet']), (8, None, [], '', False), k)
            self.assertNotIn('buoyMain', s); self.assertNotIn('buoyFar', s)

    def test_fill_cheung_sha(self):
        s = self.fill()['cheungsha']
        self.assertEqual((s['dwind'], s['stationName'], s['zh']['stationName'], s['ja']['stationName']), ([['2026-10-19T14:00', 14.6, 135.0]], 'Cheung Chau', '長洲', '長洲'))
        # ECMWF's sea cell, 3-hourly
        self.assertEqual(s['wind'][0], ['2026-10-19T00:00', 6.0, 110, None, None])
        self.assertEqual([r[0][11:13] for r in s['wind']][:8], ['00', '03', '06', '09', '12', '15', '18', '21'])
        self.assertEqual(len(s['wind']), 32)
        # Shek Pik's tides, on Hong Kong's clock as HKO gives them
        self.assertEqual(s['tides']['2026-10-19'], [['01:33', 'H', 222], ['10:59', 'L', 95]])
        self.assertEqual(sorted(s['sun']), ['2026-10-19'])
        self.assertEqual((s['sun']['2026-10-19']['rise'], s['sun']['2026-10-19']['set']), ('06:21', '17:57'))
        self.assertEqual(self.snap['src']['spots']['cheungsha'], '/2026-10-19T14:00')

    def test_airport_when_cheung_chau_has_no_speed(self):
        sp = self.fill(dl=self.without(csv=lambda t: t.replace('Cheung Chau,Southeast,27,32', 'Cheung Chau,Southeast,N/A,N/A')))
        s = sp['cheungsha']
        # the airport's 05:30 UTC report, 8 kt from 240, on the nearest hour of Taipei's clock
        self.assertEqual((s['dwind'], s['stationName'], s['zh']['stationName'], s['ja']['stationName']), ([['2026-10-19T14:00', 8.0, 240.0]], 'Hong Kong Airport', '香港機場', '香港空港'))
        self.assertEqual(sp['bigwavebay']['dwind'], [['2026-10-19T14:00', 7.6, 90.0]])
        # and with the airport's reports missing too, nothing, under Cheung Chau's name
        s = self.fill(dl=self.without(drop=('metar-hk.json',), csv=lambda t: t.replace('Cheung Chau,Southeast,27,32', 'Cheung Chau,Southeast,N/A,N/A')))['cheungsha']
        self.assertEqual((s['dwind'], s['stationName'], s['zh']['stationName']), ([], 'Cheung Chau', '長洲'))

    def test_fill_big_wave_bay_and_tai_long_wan(self):
        sp = self.fill(); b, t = sp['bigwavebay'], sp['tailongwan']
        self.assertEqual((b['dwind'], b['stationName'], b['zh']['stationName'], b['ja']['stationName']), ([['2026-10-19T14:00', 7.6, 90.0]], 'Waglan Island', '橫瀾島', '横瀾島'))
        self.assertEqual(b['tides']['2026-10-19'], [['01:37', 'H', 214], ['11:22', 'L', 98]])  # Tai Miu Wan's
        self.assertEqual(b['wind'][0], ['2026-10-19T00:00', 5.5, 95, None, None])
        # Tai Long Wan has no station that tracks its wind
        self.assertEqual((t['dwind'], t['stationName'], t['zh']['stationName'], t['ja']['stationName']), ([], '', '', ''))
        self.assertEqual(t['tides']['2026-10-19'], [['02:05', 'H', 214], ['11:48', 'L', 97]])  # Ko Lau Wan's
        self.assertEqual(self.snap['src']['spots']['tailongwan'], '/')

    def test_tides_cover_past_days(self):
        # the snap has the 17th and 18th too (hist.wave): the tides run from the day before them to the day after the forecast's last
        sp = self.fill()
        for k in HK_IDS: self.assertEqual(sorted(sp[k]['tides']), ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20'], k)
        self.assertEqual(sp['cheungsha']['tides']['2026-10-17'], [['08:09', 'L', 91]])
        # with no forecast hours at all, the days around today on Hong Kong's clock
        for k in HK_IDS: self.snap['spots'][k]['hourly'] = []; self.snap['spots'][k]['hist'] = {}
        t = self.fill()['cheungsha']['tides']
        self.assertEqual((min(t), max(t)), ('2026-10-13', '2026-10-29'))

    def test_tides_across_new_year(self):
        # a forecast on 31 December takes the tides from both years' tables, each read on its own (see test_each_year_read_on_its_own)
        import tempfile
        tmp = tempfile.mkdtemp()
        for y, rows in ((2026, [['12', '30', '0203', '2.07', '0742', '0.77', '1513', '1.75', '1928', '1.36'], ['12', '31', '0306', '1.80', '0822', '0.93', '1611', '1.85', '2052', '1.38']]),
                        (2027, [['01', '01', '0143', '1.37', '0423', '1.56', '0903', '1.06', '1704', '1.96'], ['01', '02', '0239', '1.15', '0548', '1.41', '0947', '1.17', '1753', '2.05']])):
            with open(os.path.join(tmp, 'hk-tide-KLW-%d.json' % y), 'w') as f: json.dump({'fields': [], 'data': rows}, f)
        s = self.snap['spots']['tailongwan']; s['hourly'] = [['2026-12-31' + r[0][10:]] + r[1:] for r in s['hourly']]; s['hist'] = {}
        t = self.fill(cache=tmp)['tailongwan']['tides']
        self.assertEqual(sorted(t), ['2026-12-30', '2026-12-31', '2027-01-01'])
        self.assertEqual((t['2026-12-31'][-1], t['2027-01-01'][0]), (['20:52', 'L', 138], ['01:43', 'L', 137]))

    def test_stale_wind(self):
        sp = self.fill(NOW + datetime.timedelta(hours=3))
        self.assertEqual((sp['cheungsha']['dwind'], sp['cheungsha']['stationName']), ([], 'Cheung Chau'))
        self.assertEqual(sp['bigwavebay']['dwind'], [])

    def test_downloads_follow_the_spot_list(self):
        # the ECMWF reply holds every Hong Kong spot of spots.json in its order, so with Cheung Sha missing from the snap, Big Wave Bay still
        # takes the 2nd forecast
        del self.snap['spots']['cheungsha']
        sp = self.fill(); om = json.loads(FIX('openhk.json'))
        self.assertEqual(sp['bigwavebay']['wind'][0][:3], ['2026-10-19T00:00', om[1]['hourly']['wind_speed_10m'][0], om[1]['hourly']['wind_direction_10m'][0]])
        self.assertEqual(sp['tailongwan']['wind'][0][:3], ['2026-10-19T00:00', 5.1, 113])
        for n, i in enumerate(HK_IDS):
            s = next(x for x in SPOTS if x['id'] == i)
            self.assertTrue(abs(om[n]['latitude'] - s['lat']) < 0.05 and abs(om[n]['longitude'] - s['lon']) < 0.05, i)  # the sea cell beside it

    def test_other_countries_untouched(self):
        self.fill()
        for k in ('donghe', 'jukdo', 'cloud9', 'raglan', 'umatac'): self.assertEqual(self.snap['spots'][k], self.before['spots'][k], k)

    def test_nothing_downloaded(self):
        import tempfile
        e = tempfile.mkdtemp(); sp = self.fill(dl=e, cache=e)
        for k in HK_IDS:
            s = sp[k]
            self.assertEqual((s['tz'], s['buoy'], s['dwind'], s['wind'], s['tides']), (8, [], [], [], {}), k)
            self.assertTrue(s['sun'])
        self.assertEqual(sp['cheungsha']['stationName'], 'Cheung Chau')

    def test_bad_tide_file(self):
        # HKO answers a bad request with an HTML page and status 200; refresh.sh doesn't keep it, and should one be there, it's no tides
        import tempfile, shutil
        tmp = tempfile.mkdtemp()
        for f in os.listdir(CACHE): shutil.copy(os.path.join(CACHE, f), tmp)
        with open(os.path.join(tmp, 'hk-tide-SPW-2026.json'), 'w') as f: f.write('Please include valid parameters in API request.')
        sp = self.fill(cache=tmp)
        self.assertEqual(sp['cheungsha']['tides'], {})
        self.assertEqual(sp['bigwavebay']['tides']['2026-10-19'], [['01:37', 'H', 214], ['11:22', 'L', 98]])

    def test_runs_isolated_like_refresh(self):
        import subprocess, tempfile, shutil
        tmp = tempfile.mkdtemp(); f = os.path.join(tmp, 'snap.json'); shutil.copy(os.path.join(FIXDIR, 'snap_in.json'), f)
        r = subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'hk.py'), FIXDIR, f, os.path.join(ROOT, 'spots.json'), CACHE], capture_output=True, text=True, cwd=tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        # the stations go quiet as the clock runs on, so whether there is wind now depends on it; the offset, forecast and tides don't
        self.assertRegex(r.stdout, r'hk: cheungsha 8 [01] 32 5\n')
        self.assertRegex(r.stdout, r'hk: tailongwan 8 0 32 5\n')
        self.assertNotIn('raglan', r.stdout)
        with open(f) as fh: d = json.load(fh)
        self.assertEqual(d['spots']['raglan'], json.loads(FIX('snap_in.json'))['spots']['raglan'])
        self.assertEqual(d['spots']['bigwavebay']['tides']['2026-10-19'][0], ['01:37', 'H', 214])


class Refresh(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(ROOT, 'refresh.sh'), encoding='utf-8') as f: self.sh = f.read()
        import re
        self.hkids = re.search(r'^hkids\(\)\{.*?; \}$', self.sh, re.S | re.M).group(0)

    def test_refresh_lists_match(self):
        # refresh.sh's hkids lists what hk.py reads: the spots in order, the airports and HKO's tide stations; the wind forecast comes from
        # the sea cells, and the map gets its own grid
        import re, subprocess
        got = {f: subprocess.run(['sh', '-c', 'HERE=$1\n' + self.hkids + '\nhkids $2', 'sh', ROOT, f], capture_output=True, text=True).stdout.strip()
               for f in ('lat', 'lon', 'metar', 'tideStation')}
        self.assertEqual(got, {'lat': '22.2308,22.244,22.413', 'lon': '113.9546,114.252,114.3832', 'metar': 'VHHH', 'tideStation': 'SPW,TMW,KLW'})
        block = re.search(r'^if \[ -n "\$\(hkids lat\)" \]; then$.*?^fi$', self.sh, re.S | re.M).group(0)
        self.assertIn('&cell_selection=sea"', block)
        self.assertIn('-o "$W/dl/hko-wind.csv" "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_10min_wind.csv"', block)
        self.assertIn('python3 -I "$HERE/hk.py" "$W/dl" "$W/snap.json" "$HERE/spots.json" "$G"', block)
        self.assertIn('regrid hk 350 21.5 0.125 14 113.5 0.125 11\n', self.sh)

    def test_tide_years_kept_only_whole(self):
        # refresh.sh's tide loop, run with a stand-in curl: Shek Pik's reply is a whole year and is kept, Tai Miu Wan's is HKO's error page
        # and Ko Lau Wan's only part of a year, so neither is kept and the next run asks again; a kept year isn't asked for again
        import re, subprocess, tempfile
        loop = re.search(r'^  Y0=\$\(TZ=Asia/Hong_Kong .*?^  done; done$', self.sh, re.S | re.M).group(0)
        tmp = tempfile.mkdtemp(); G = os.path.join(tmp, 'cache'); os.makedirs(G); bin_ = os.path.join(tmp, 'bin'); os.makedirs(bin_)
        whole = json.dumps({'fields': [], 'data': [['01', '01', '0100', '1.00']] * 365}); part = json.dumps({'fields': [], 'data': [['01', '01', '0100', '1.00']] * 300})
        for n, v in (('whole.json', whole), ('part.json', part), ('error.html', 'Please include valid parameters in API request.')):
            with open(os.path.join(tmp, n), 'w') as f: f.write(v)
        with open(os.path.join(bin_, 'curl'), 'w') as f:
            f.write('#!/bin/sh\nout=; url=\nwhile [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift 2;; -A|-m|--retry) shift 2;; -*) shift;; *) url=$1; shift;; esac; done\n'
                    'echo "$url" >> "$T/calls"\ncase "$url" in *station=SPW*) cp "$T/whole.json" "$out";; *station=TMW*) cp "$T/error.html" "$out";; *) cp "$T/part.json" "$out";; esac\n')
        os.chmod(os.path.join(bin_, 'curl'), 0o755)
        env = dict(os.environ, PATH=bin_ + os.pathsep + os.environ['PATH'], T=tmp)
        run = lambda: subprocess.run(['sh', '-c', 'set -e\nHERE=$1; G=$2\n' + self.hkids + '\n' + loop, 'sh', ROOT, G], capture_output=True, text=True, env=env)
        r = run(); self.assertEqual(r.returncode, 0, r.stderr)
        # the years of a week back and 12 days ahead on Hong Kong's clock: one, or two around New Year
        hkt = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8)))
        years = sorted({(hkt - datetime.timedelta(days=7)).year, (hkt + datetime.timedelta(days=12)).year})
        self.assertEqual(sorted(os.listdir(G)), ['hk-tide-SPW-%d.json' % y for y in years])  # and no .new left over
        for y in years:
            self.assertIn('hko tide TMW %d fetch failed' % y, r.stderr); self.assertIn('hko tide KLW %d fetch failed' % y, r.stderr)
            with open(os.path.join(G, 'hk-tide-SPW-%d.json' % y)) as f: self.assertEqual(f.read(), whole)
        with open(os.path.join(tmp, 'calls')) as f: first = f.read().split()
        self.assertEqual(len(first), 3 * len(years))
        self.assertIn('https://data.weather.gov.hk/weatherAPI/opendata/opendata.php?dataType=HLT&station=SPW&year=%d&rformat=json' % years[0], first)
        r = run(); self.assertEqual(r.returncode, 0, r.stderr)
        with open(os.path.join(tmp, 'calls')) as f: second = f.read().split()[len(first):]
        self.assertFalse([u for u in second if 'station=SPW' in u])
        self.assertTrue([u for u in second if 'station=TMW' in u] and [u for u in second if 'station=KLW' in u])

    def test_tide_timeout_stops_asking(self):
        # after a timeout (curl's exit 28) the run asks HKO for nothing more, so a slow HKO can't hold up the build; the next run asks again
        import re, subprocess, tempfile
        loop = re.search(r'^  Y0=\$\(TZ=Asia/Hong_Kong .*?^  done; done$', self.sh, re.S | re.M).group(0)
        tmp = tempfile.mkdtemp(); G = os.path.join(tmp, 'cache'); os.makedirs(G); bin_ = os.path.join(tmp, 'bin'); os.makedirs(bin_)
        with open(os.path.join(tmp, 'whole.json'), 'w') as f: f.write(json.dumps({'fields': [], 'data': [['01', '01', '0100', '1.00']] * 365}))
        with open(os.path.join(bin_, 'curl'), 'w') as f:
            f.write('#!/bin/sh\nout=; url=\nwhile [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift 2;; -A|-m|--retry) shift 2;; -*) shift;; *) url=$1; shift;; esac; done\n'
                    'echo "$url" >> "$T/calls"\ncase "$url" in *station=TMW*) exit 28;; *) cp "$T/whole.json" "$out";; esac\n')
        os.chmod(os.path.join(bin_, 'curl'), 0o755)
        env = dict(os.environ, PATH=bin_ + os.pathsep + os.environ['PATH'], T=tmp)
        r = subprocess.run(['sh', '-c', 'set -e\nHERE=$1; G=$2\n' + self.hkids + '\n' + loop, 'sh', ROOT, G], capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        y = (datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))) - datetime.timedelta(days=7)).year
        with open(os.path.join(tmp, 'calls')) as f: calls = f.read().split()
        self.assertEqual([u.split('station=')[1][:3] for u in calls], ['SPW', 'TMW'])  # Ko Lau Wan, and any second year, wait
        self.assertIn('hko tide TMW %d fetch failed' % y, r.stderr)
        self.assertEqual(sorted(os.listdir(G)), ['hk-tide-SPW-%d.json' % y])


if __name__ == '__main__':
    unittest.main()
