# Each country keeps its own forecast-vs-buoy log: log.py, correct.py and history.py take an optional country code.
# Run: python3 -m unittest discover -s tests -v
import os, sys, json, gzip, glob, copy, shutil, subprocess, tempfile, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
SNAP_IN = os.path.join(HERE, 'fixtures', 'jp', 'snap_in.json')
TW_IDS, JP_IDS = ['donghe'], ['hasaki']


def run(args):
    subprocess.run([sys.executable, '-I'] + [os.path.join(ROOT, args[0])] + args[1:], check=True, capture_output=True)


def records(logdir):
    out = []
    for f in sorted(glob.glob(os.path.join(logdir, '20*.jsonl.gz'))):
        with gzip.open(f, 'rt') as fh: out += [json.loads(l) for l in fh]
    return out


class LogSplit(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.snap = os.path.join(self.tmp, 'snap.json'); shutil.copy(SNAP_IN, self.snap)

    def write(self, d):
        with open(self.snap, 'w') as f: json.dump(d, f)

    def test_log_tw_only(self):
        run(['log.py', self.snap, self.tmp + '/log', 'tw']); rec = records(self.tmp + '/log')[-1]
        self.assertEqual(sorted(rec['spots']), TW_IDS)
        self.assertEqual(sorted(rec['src']['spots']), TW_IDS)

    def test_log_jp_only(self):
        run(['log.py', self.snap, self.tmp + '/log-jp', 'jp'])
        self.assertEqual(sorted(records(self.tmp + '/log-jp')[-1]['spots']), JP_IDS)

    def test_tw_record_not_repeated_for_japan_changes(self):
        run(['log.py', self.snap, self.tmp + '/log', 'tw'])
        d = json.load(open(self.snap)); d['src']['spots']['hasaki'] = '2026-10-17T20:00/2026-10-17T20:10'; self.write(d)
        run(['log.py', self.snap, self.tmp + '/log', 'tw'])
        self.assertEqual(len(records(self.tmp + '/log')), 1)

    def test_no_country_logs_all(self):
        run(['log.py', self.snap, self.tmp + '/all'])
        self.assertEqual(sorted(records(self.tmp + '/all')[-1]['spots']), sorted(TW_IDS + JP_IDS))

    def test_correct_jp_leaves_tw(self):
        before = json.load(open(self.snap))['spots']['donghe']
        run(['correct.py', self.snap, self.tmp + '/log-jp', 'jp'])
        d = json.load(open(self.snap))
        self.assertEqual(d['spots']['donghe'], before)
        self.assertIn('adj', d['spots']['hasaki'])

    def test_history_jp_uses_own_tide_cache(self):
        run(['history.py', self.snap, self.tmp + '/log-jp', self.tmp + '/cache', 'jp'])
        self.assertEqual(sorted(json.load(open(self.tmp + '/cache/tides-jp.json'))), JP_IDS)
        self.assertNotIn('buoy', json.load(open(self.snap))['spots']['donghe'].get('hist', {}))


class LogSplitCalifornia(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.snap = os.path.join(self.tmp, 'snap.json'); shutil.copy(os.path.join(HERE, 'fixtures', 'ca', 'snap_in.json'), self.snap)
        d = json.load(open(self.snap))
        d['spots']['blacks']['buoy'] = [['2026-10-17T20:00', 0.3, 7.0, 285, 22.6]]; d['spots']['blacks']['country'] = 'ca'
        d['src']['spots']['blacks'] = '2026-10-17T20:00/'
        with open(self.snap, 'w') as f: json.dump(d, f)

    def test_log_ca_only(self):
        run(['log.py', self.snap, self.tmp + '/log-ca', 'ca'])
        self.assertEqual(sorted(records(self.tmp + '/log-ca')[-1]['spots']), ['blacks', 'rincon'])

    def test_tw_log_unchanged_by_ca(self):
        run(['log.py', self.snap, self.tmp + '/log', 'tw'])
        d = json.load(open(self.snap)); d['src']['spots']['blacks'] = '2026-10-17T21:00/'
        with open(self.snap, 'w') as f: json.dump(d, f)
        run(['log.py', self.snap, self.tmp + '/log', 'tw'])
        self.assertEqual(len(records(self.tmp + '/log')), 1)
        self.assertEqual(sorted(records(self.tmp + '/log')[-1]['spots']), ['donghe'])


class LogSplitHawaii(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.snap = os.path.join(self.tmp, 'snap.json'); shutil.copy(os.path.join(HERE, 'fixtures', 'hi', 'snap_in.json'), self.snap)
        d = json.load(open(self.snap))
        d['spots']['pipeline']['buoy'] = [['2026-10-17T21:00', 2.2, 7.8, 351, 26.6]]
        d['src']['spots']['pipeline'] = '2026-10-17T21:00/'
        with open(self.snap, 'w') as f: json.dump(d, f)

    def test_log_hi_only(self):
        run(['log.py', self.snap, self.tmp + '/log-hi', 'hi'])
        self.assertEqual(sorted(records(self.tmp + '/log-hi')[-1]['spots']), ['hanalei', 'pipeline'])

    def test_ca_log_holds_no_hawaii(self):
        run(['log.py', self.snap, self.tmp + '/log-ca', 'ca'])
        self.assertEqual(sorted(records(self.tmp + '/log-ca')[-1]['spots']), ['blacks'])


class LogSplitAustralia(unittest.TestCase):
    def test_log_au_only(self):
        tmp = tempfile.mkdtemp(); snap = os.path.join(tmp, 'snap.json'); shutil.copy(os.path.join(HERE, 'fixtures', 'au', 'snap_in.json'), snap)
        d = json.load(open(snap)); d['spots']['snapper']['buoy'] = [['2026-10-17T21:00', 1.55, None, None, None]]; d['src']['spots']['snapper'] = '2026-10-17T21:00/'
        with open(snap, 'w') as f: json.dump(d, f)
        run(['log.py', snap, tmp + '/log-au', 'au'])
        self.assertEqual(sorted(records(tmp + '/log-au')[-1]['spots']), ['byron', 'snapper'])


class LogSplitPacificNorthwest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.snap = os.path.join(self.tmp, 'snap.json'); shutil.copy(os.path.join(HERE, 'fixtures', 'nw', 'snap_in.json'), self.snap)
        d = json.load(open(self.snap))
        d['spots']['coxbay']['buoy'] = [['2026-10-18T09:00', 2.7, 6.9, None, 11.3]]  # an Environment Canada buoy: no direction
        d['src']['spots']['coxbay'] = '2026-10-18T09:00/'
        with open(self.snap, 'w') as f: json.dump(d, f)

    def test_log_nw_only(self):
        run(['log.py', self.snap, self.tmp + '/log-nw', 'nw'])
        rec = records(self.tmp + '/log-nw')[-1]
        self.assertEqual(sorted(rec['spots']), ['coxbay', 'lapush', 'seaside'])
        self.assertEqual(rec['spots']['coxbay']['buoy'], [['2026-10-18T09:00', 2.7, 6.9, None, 11.3]])

    def test_ca_log_holds_no_pacific_northwest(self):
        run(['log.py', self.snap, self.tmp + '/log-ca', 'ca'])
        self.assertEqual(sorted(records(self.tmp + '/log-ca')[-1]['spots']), ['blacks'])

    def test_correct_and_history_nw(self):
        before = json.load(open(self.snap))['spots']['blacks']
        run(['log.py', self.snap, self.tmp + '/log-nw', 'nw'])
        run(['correct.py', self.snap, self.tmp + '/log-nw', 'nw'])
        run(['history.py', self.snap, self.tmp + '/log-nw', self.tmp + '/cache', 'nw'])
        d = json.load(open(self.snap))
        self.assertEqual(d['spots']['blacks'], before)
        self.assertEqual(sorted(json.load(open(self.tmp + '/cache/tides-nw.json'))), ['coxbay', 'lapush', 'seaside'])

    def test_backup_buoy_left_out_of_past_days_and_corrections(self):
        # Seaside's readings from its backup buoy (Columbia River Bar, while Clatsop Spit was silent) go into the log, but its past days
        # and its corrections use its main buoy's readings only
        import datetime
        day = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)).date()
        yday, today = (day - datetime.timedelta(days=1)).isoformat(), day.isoformat()
        d = json.load(open(self.snap)); s = d['spots']['seaside']
        for bid, row in (('46029', [yday + 'T08:00', 3.1, 7.3, 281.0, 14.6]), ('46243', [today + 'T08:00', 2.0, 7.2, 280.0, 13.9])):
            s.update(buoyId=bid, buoyMain='46243', buoy=[row]); d['src']['spots']['seaside'] = row[0] + '/'
            with open(self.snap, 'w') as f: json.dump(d, f)
            run(['log.py', self.snap, self.tmp + '/log-nw', 'nw'])
        self.assertEqual([r['spots']['seaside']['buoyId'] for r in records(self.tmp + '/log-nw')], ['46029', '46243'])
        run(['history.py', self.snap, self.tmp + '/log-nw', self.tmp + '/cache', 'nw'])
        run(['correct.py', self.snap, self.tmp + '/log-nw', 'nw'])
        s = json.load(open(self.snap))['spots']['seaside']
        self.assertEqual([b[0] for b in s['hist']['buoy']], [today + 'T08:00'])
        self.assertEqual(s['adj']['days'], 1)


class LogSplitKorea(unittest.TestCase):
    # Korea's log holds each spot's buoy (KMA's, through NOAA) and airport wind with the forecast, filled from kr.py's fixtures
    def setUp(self):
        import datetime; sys.path.insert(0, ROOT); import kr
        self.tmp = tempfile.mkdtemp()
        self.snap = os.path.join(self.tmp, 'snap.json'); fix = os.path.join(HERE, 'fixtures', 'kr')
        d = json.load(open(os.path.join(fix, 'snap_in.json')))
        kr.fill(d, json.load(open(os.path.join(ROOT, 'spots.json'))), fix, datetime.datetime(2026, 10, 18, 5, 30, tzinfo=datetime.timezone.utc))
        with open(self.snap, 'w') as f: json.dump(d, f)

    def test_log_kr_only(self):
        run(['log.py', self.snap, self.tmp + '/log-kr', 'kr'])
        rec = records(self.tmp + '/log-kr')[-1]
        self.assertEqual(sorted(rec['spots']), ['geumjin', 'iho', 'jukdo', 'manlipo'])
        j = rec['spots']['jukdo']
        self.assertEqual((j['buoyId'], len(j['buoy']), j['buoy'][-1], j['station'], len(j['fc'])), ('22105', 3, ['2026-10-18T13:00', 1.5, None, None, 23.3], [['2026-10-18T13:00', 6.0, 170.0]], 24))
        self.assertEqual((rec['spots']['iho']['buoyId'], rec['spots']['iho']['buoy']), (None, []))

    def test_other_logs_hold_no_korea(self):
        run(['log.py', self.snap, self.tmp + '/log', 'tw'])
        run(['log.py', self.snap, self.tmp + '/log-ca', 'ca'])
        self.assertEqual(sorted(records(self.tmp + '/log')[-1]['spots']), ['donghe'])
        self.assertEqual(sorted(records(self.tmp + '/log-ca')[-1]['spots']), ['blacks'])

    def test_correct_and_history_kr(self):
        # the readings moved to today, since the past days keep only the last 5
        import datetime
        today = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)).date().isoformat()
        d = json.load(open(self.snap))
        for k in ('jukdo', 'geumjin'): d['spots'][k]['buoy'] = [[today + 'T13:00', 1.5, None, None, 23.3]]; d['src']['spots'][k] = today + 'T13:00/'
        with open(self.snap, 'w') as f: json.dump(d, f)
        before = d['spots']
        run(['log.py', self.snap, self.tmp + '/log-kr', 'kr'])
        run(['correct.py', self.snap, self.tmp + '/log-kr', 'kr'])
        run(['history.py', self.snap, self.tmp + '/log-kr', self.tmp + '/cache', 'kr'])
        d = json.load(open(self.snap))
        for k in ('donghe', 'blacks'): self.assertEqual(d['spots'][k], before[k])
        self.assertEqual(sorted(json.load(open(self.tmp + '/cache/tides-kr.json'))), ['geumjin', 'iho', 'jukdo', 'manlipo'])
        # Geumjin's day of buoy readings counts toward its height factor; Jukdo's, from the same buoy 119 km out to sea, does not
        g, j = d['spots']['geumjin'], d['spots']['jukdo']
        self.assertEqual((g['adj']['days'], j['adj']['days'], j['adj']['f']), (1, 0, 1.0))
        self.assertEqual(j['hourly'], before['jukdo']['hourly'])  # and one day is too few to change Geumjin's
        self.assertEqual(g['hourly'], before['geumjin']['hourly'])
        # the past days show the buoy either way
        self.assertEqual((j['hist']['buoy'], g['hist']['buoy']), ([[today + 'T13:00', 1.5, None, None]],) * 2)


class LogSplitPhilippines(unittest.TestCase):
    # Philippine spots have no buoy and no wind now: their log holds the forecast only
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.snap = os.path.join(self.tmp, 'snap.json'); shutil.copy(os.path.join(HERE, 'fixtures', 'ph', 'snap_in.json'), self.snap)

    def test_log_ph_only(self):
        run(['log.py', self.snap, self.tmp + '/log-ph', 'ph'])
        rec = records(self.tmp + '/log-ph')[-1]
        self.assertEqual(sorted(rec['spots']), ['baler', 'cloud9', 'pagudpud', 'sanjuan'])
        c = rec['spots']['cloud9']
        self.assertEqual((c['buoyId'], c['buoy'], c['station'], len(c['fc'])), (None, [], [], 24))

    def test_other_logs_hold_no_philippines(self):
        run(['log.py', self.snap, self.tmp + '/log', 'tw'])
        run(['log.py', self.snap, self.tmp + '/log-kr', 'kr'])
        self.assertEqual(sorted(records(self.tmp + '/log')[-1]['spots']), ['donghe'])
        self.assertEqual(sorted(records(self.tmp + '/log-kr')[-1]['spots']), ['jukdo'])

    def test_correct_and_history_ph(self):
        before = json.load(open(self.snap))['spots']
        run(['log.py', self.snap, self.tmp + '/log-ph', 'ph'])
        run(['correct.py', self.snap, self.tmp + '/log-ph', 'ph'])
        run(['history.py', self.snap, self.tmp + '/log-ph', self.tmp + '/cache', 'ph'])
        d = json.load(open(self.snap))
        for k in ('donghe', 'blacks', 'jukdo'): self.assertEqual(d['spots'][k], before[k])
        self.assertEqual(sorted(json.load(open(self.tmp + '/cache/tides-ph.json'))), ['baler', 'cloud9', 'pagudpud', 'sanjuan'])
        # with no buoy and no station the forecast stays as it is
        self.assertEqual((d['spots']['cloud9']['adj']['f'], d['spots']['cloud9']['adj']['days']), (1.0, 0))
        self.assertEqual(d['spots']['cloud9']['hourly'], before['cloud9']['hourly'])


class LogSplitIndonesia(unittest.TestCase):
    # Indonesian spots have no buoy: their log holds the forecast, and Bali's airport wind where a spot has it
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.snap = os.path.join(self.tmp, 'snap.json'); shutil.copy(os.path.join(HERE, 'fixtures', 'id', 'snap_in.json'), self.snap)
        d = json.load(open(self.snap))
        d['spots']['uluwatu']['dwind'] = [['2026-10-18T21:00', 8.0, 140.0]]
        d['src']['spots']['uluwatu'] = '/2026-10-18T21:00'
        with open(self.snap, 'w') as f: json.dump(d, f)

    def test_log_id_only(self):
        run(['log.py', self.snap, self.tmp + '/log-id', 'id'])
        rec = records(self.tmp + '/log-id')[-1]
        self.assertEqual(sorted(rec['spots']), ['gland', 'kuta', 'lakey', 'uluwatu'])
        u, g = rec['spots']['uluwatu'], rec['spots']['gland']
        self.assertEqual((u['buoyId'], u['buoy'], u['station'], len(u['fc'])), (None, [], [['2026-10-18T21:00', 8.0, 140.0]], 24))
        self.assertEqual((g['buoy'], g['station']), ([], []))

    def test_other_logs_hold_no_indonesia(self):
        for c, d, ids in (('tw', 'log', ['donghe']), ('kr', 'log-kr', ['jukdo']), ('ph', 'log-ph', ['cloud9'])):
            run(['log.py', self.snap, self.tmp + '/' + d, c])
            self.assertEqual(sorted(records(self.tmp + '/' + d)[-1]['spots']), ids, c)

    def test_correct_and_history_id(self):
        before = json.load(open(self.snap))['spots']
        run(['log.py', self.snap, self.tmp + '/log-id', 'id'])
        run(['correct.py', self.snap, self.tmp + '/log-id', 'id'])
        run(['history.py', self.snap, self.tmp + '/log-id', self.tmp + '/cache', 'id'])
        d = json.load(open(self.snap))
        for k in ('donghe', 'blacks', 'jukdo', 'cloud9'): self.assertEqual(d['spots'][k], before[k])
        self.assertEqual(sorted(json.load(open(self.tmp + '/cache/tides-id.json'))), ['gland', 'kuta', 'lakey', 'uluwatu'])
        # with no buoy the wave heights stay as forecast
        self.assertEqual((d['spots']['uluwatu']['adj']['f'], d['spots']['uluwatu']['adj']['days']), (1.0, 0))
        self.assertEqual(d['spots']['uluwatu']['hourly'], before['uluwatu']['hourly'])


class LogSplitNewZealand(unittest.TestCase):
    # New Zealand's log holds the forecast, the buoy readings at New Brighton and St Clair and the airport wind at Lyall Bay and New Brighton
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.snap = os.path.join(self.tmp, 'snap.json'); shutil.copy(os.path.join(HERE, 'fixtures', 'nz', 'snap_in.json'), self.snap)
        d = json.load(open(self.snap)); b = d['spots']['brighton']
        b['buoyId'], b['buoyAt'] = '31020', '2026-10-18T23:00'
        b['buoy'] = [['2026-10-18T%02d:00' % h, 0.8, 6.7, 124.0, 13.2] for h in range(20, 24)]
        b['dwind'] = [['2026-10-19T00:00', 4.0, 300.0]]
        d['src']['spots']['brighton'] = '2026-10-18T23:00/2026-10-19T00:00'
        with open(self.snap, 'w') as f: json.dump(d, f)

    def test_log_nz_only(self):
        run(['log.py', self.snap, self.tmp + '/log-nz', 'nz'])
        rec = records(self.tmp + '/log-nz')[-1]
        self.assertEqual(sorted(rec['spots']), ['brighton', 'lyall', 'raglan', 'stclair'])
        b = rec['spots']['brighton']
        self.assertEqual((b['buoyId'], len(b['buoy']), b['buoy'][-1], b['station'], len(b['fc'])), ('31020', 3, ['2026-10-18T23:00', 0.8, 6.7, 124.0, 13.2], [['2026-10-19T00:00', 4.0, 300.0]], 24))

    def test_other_logs_hold_no_new_zealand(self):
        for c, d, ids in (('tw', 'log', ['donghe']), ('id', 'log-id', ['uluwatu']), ('ph', 'log-ph', ['cloud9'])):
            run(['log.py', self.snap, self.tmp + '/' + d, c])
            self.assertEqual(sorted(records(self.tmp + '/' + d)[-1]['spots']), ids, c)

    def test_correct_and_history_nz(self):
        before = json.load(open(self.snap))['spots']
        run(['log.py', self.snap, self.tmp + '/log-nz', 'nz'])
        run(['correct.py', self.snap, self.tmp + '/log-nz', 'nz'])
        run(['history.py', self.snap, self.tmp + '/log-nz', self.tmp + '/cache', 'nz'])
        d = json.load(open(self.snap))
        for k in ('donghe', 'blacks', 'jukdo', 'cloud9', 'uluwatu'): self.assertEqual(d['spots'][k], before[k])
        self.assertEqual(sorted(json.load(open(self.tmp + '/cache/tides-nz.json'))), ['brighton', 'lyall', 'raglan', 'stclair'])
        self.assertIn('adj', d['spots']['brighton'])


class LogSplitSouthPacific(unittest.TestCase):
    # The South Pacific's log holds the forecast, and the buoy readings and airport wind at Amouli
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.snap = os.path.join(self.tmp, 'snap.json'); shutil.copy(os.path.join(HERE, 'fixtures', 'pi', 'snap_in.json'), self.snap)
        d = json.load(open(self.snap)); a = d['spots']['amouli']
        a['buoyId'], a['buoyMain'], a['buoyAt'] = '51209', '51209', '2026-10-19T01:00'
        a['buoy'] = [['2026-10-19T%02d:00' % h, 3.0, 7.5, 113.0, 27.3] for h in range(0, 2)]
        a['dwind'] = [['2026-10-19T01:00', 16.0, 170.0]]
        d['src']['spots']['amouli'] = '2026-10-19T01:00/2026-10-19T01:00'
        with open(self.snap, 'w') as f: json.dump(d, f)

    def test_log_pi_only(self):
        run(['log.py', self.snap, self.tmp + '/log-pi', 'pi'])
        rec = records(self.tmp + '/log-pi')[-1]
        self.assertEqual(sorted(rec['spots']), ['amouli', 'cloudbreak', 'frigates', 'haatafu', 'papara', 'rutaki', 'salani', 'teahupoo'])
        a, c = rec['spots']['amouli'], rec['spots']['cloudbreak']
        self.assertEqual((a['buoyId'], len(a['buoy']), a['buoy'][-1], a['station'], len(a['fc'])), ('51209', 2, ['2026-10-19T01:00', 3.0, 7.5, 113.0, 27.3], [['2026-10-19T01:00', 16.0, 170.0]], 24))
        self.assertEqual((c['buoy'], c['station']), ([], []))

    def test_other_logs_hold_no_south_pacific(self):
        for c, d, ids in (('tw', 'log', ['donghe']), ('nz', 'log-nz', ['raglan']), ('id', 'log-id', ['uluwatu'])):
            run(['log.py', self.snap, self.tmp + '/' + d, c])
            self.assertEqual(sorted(records(self.tmp + '/' + d)[-1]['spots']), ids, c)

    def test_correct_and_history_pi(self):
        before = json.load(open(self.snap))['spots']
        run(['log.py', self.snap, self.tmp + '/log-pi', 'pi'])
        run(['correct.py', self.snap, self.tmp + '/log-pi', 'pi'])
        run(['history.py', self.snap, self.tmp + '/log-pi', self.tmp + '/cache', 'pi'])
        d = json.load(open(self.snap))
        for k in ('donghe', 'blacks', 'jukdo', 'cloud9', 'uluwatu', 'raglan'): self.assertEqual(d['spots'][k], before[k])
        self.assertEqual(sorted(json.load(open(self.tmp + '/cache/tides-pi.json'))), ['amouli', 'cloudbreak', 'frigates', 'haatafu', 'papara', 'rutaki', 'salani', 'teahupoo'])
        self.assertIn('adj', d['spots']['amouli'])


AK_IDS = ['bishopsbeach', 'cannonbeach', 'fossilbeach', 'oceancape', 'sandies', 'sealioncove', 'shelikof', 'surfersbeach']


class LogSplitAlaska(unittest.TestCase):
    # Alaska's log holds the forecast, every spot's buoy readings (far ones too) and the airport wind, from ca.py on the saved downloads
    def setUp(self):
        import datetime
        sys.path.insert(0, ROOT); import ca
        self.tmp = tempfile.mkdtemp(); self.snap = os.path.join(self.tmp, 'snap.json')
        fix = os.path.join(HERE, 'fixtures', 'ak'); d = json.load(open(os.path.join(fix, 'snap_in.json')))
        ca.fill(d, json.load(open(os.path.join(ROOT, 'spots.json'))), fix, datetime.datetime(2026, 10, 19, 0, 27, tzinfo=datetime.timezone.utc), 'ak')
        with open(self.snap, 'w') as f: json.dump(d, f)

    def test_log_ak_only(self):
        run(['log.py', self.snap, self.tmp + '/log-ak', 'ak'])
        rec = records(self.tmp + '/log-ak')[-1]
        self.assertEqual(sorted(rec['spots']), AK_IDS)
        c = rec['spots']['cannonbeach']
        self.assertEqual((c['buoyId'], c['buoy'][-1], c['station'], len(c['fc'])), ('46083', ['2026-10-19T08:00', 2.5, 6.9, 246.0, 10.3], [['2026-10-19T08:00', 5.0, 90]], 24))

    def test_other_logs_hold_no_alaska(self):
        for c, d, ids in (('tw', 'log', ['donghe']), ('ca', 'log-ca', ['blacks']), ('nw', 'log-nw', ['coxbay'])):
            run(['log.py', self.snap, self.tmp + '/' + d, c])
            self.assertEqual(sorted(records(self.tmp + '/' + d)[-1]['spots']), ids, c)

    def test_correct_and_history_ak(self):
        before = json.load(open(self.snap))['spots']
        run(['log.py', self.snap, self.tmp + '/log-ak', 'ak'])
        run(['correct.py', self.snap, self.tmp + '/log-ak', 'ak'])
        run(['history.py', self.snap, self.tmp + '/log-ak', self.tmp + '/cache', 'ak'])
        d = json.load(open(self.snap))
        for k in ('donghe', 'blacks', 'coxbay'): self.assertEqual(d['spots'][k], before[k])
        self.assertEqual(sorted(json.load(open(self.tmp + '/cache/tides-ak.json'))), AK_IDS)
        self.assertEqual((d['spots']['cannonbeach']['adj']['f'], d['spots']['cannonbeach']['adj']['days']), (1.0, 0))  # far: not learned from
        self.assertEqual(d['spots']['bishopsbeach']['adj']['days'], 1)


MI_IDS = ['boatbasin', 'majuro', 'mwand', 'ppass', 'sidedish', 'talofofo', 'tankbeach', 'umatac']


class LogSplitMicronesia(unittest.TestCase):
    # Micronesia's log holds the forecast, the buoy readings (Arno's at Majuro too) and the station wind, from pi.py on the saved downloads
    def setUp(self):
        import datetime
        sys.path.insert(0, ROOT); import pi
        self.tmp = tempfile.mkdtemp(); self.snap = os.path.join(self.tmp, 'snap.json')
        fix = os.path.join(HERE, 'fixtures', 'mi'); d = json.load(open(os.path.join(fix, 'snap_in.json')))
        pi.fill(d, json.load(open(os.path.join(ROOT, 'spots.json'))), fix, datetime.datetime(2026, 10, 19, 2, 45, tzinfo=datetime.timezone.utc), 'mi')
        with open(self.snap, 'w') as f: json.dump(d, f)

    def test_log_mi_only(self):
        run(['log.py', self.snap, self.tmp + '/log-mi', 'mi'])
        rec = records(self.tmp + '/log-mi')[-1]
        self.assertEqual(sorted(rec['spots']), MI_IDS)
        p, m, b = rec['spots']['ppass'], rec['spots']['majuro'], rec['spots']['boatbasin']
        self.assertEqual((p['buoyId'], p['buoy'][-1], p['station'], len(p['fc'])), ('52213', ['2026-10-19T08:00', 1.5, 6.0, 352.0, 29.3], [], 24))
        self.assertEqual((m['buoyId'], m['buoy'][-1]), ('52216', ['2026-10-19T10:00', 1.4, 6.7, 57.0, 29.1]))
        self.assertEqual((b['buoy'], b['station']), ([], [['2026-10-19T10:00', 14.0, 150.0]]))

    def test_other_logs_hold_no_micronesia(self):
        for c, d, ids in (('tw', 'log', ['donghe']), ('pi', 'log-pi', ['amouli', 'cloudbreak', 'frigates', 'haatafu', 'papara', 'rutaki', 'salani', 'teahupoo'])):
            run(['log.py', self.snap, self.tmp + '/' + d, c])
            self.assertEqual(sorted(records(self.tmp + '/' + d)[-1]['spots']), ids, c)

    def test_correct_and_history_mi(self):
        before = json.load(open(self.snap))['spots']
        run(['log.py', self.snap, self.tmp + '/log-mi', 'mi'])
        run(['correct.py', self.snap, self.tmp + '/log-mi', 'mi'])
        run(['history.py', self.snap, self.tmp + '/log-mi', self.tmp + '/cache', 'mi'])
        d = json.load(open(self.snap))
        for k in ('donghe', 'blacks', 'raglan', 'amouli', 'teahupoo'): self.assertEqual(d['spots'][k], before[k])
        self.assertEqual(sorted(json.load(open(self.tmp + '/cache/tides-mi.json'))), MI_IDS)
        self.assertEqual(d['spots']['ppass']['adj']['days'], 1)
        self.assertEqual((d['spots']['majuro']['adj']['f'], d['spots']['majuro']['adj']['days']), (1.0, 0))  # Arno's readings: a backup, not learned from


if __name__ == '__main__':
    unittest.main()
