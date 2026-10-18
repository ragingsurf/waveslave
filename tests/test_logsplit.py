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
    # Korean spots have no buoy yet: their log holds the forecast and the airport wind
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.snap = os.path.join(self.tmp, 'snap.json'); shutil.copy(os.path.join(HERE, 'fixtures', 'kr', 'snap_in.json'), self.snap)
        d = json.load(open(self.snap))
        d['spots']['jukdo']['dwind'] = [['2026-10-18T13:00', 6.0, 170.0]]
        d['src']['spots']['jukdo'] = '/2026-10-18T13:00'
        with open(self.snap, 'w') as f: json.dump(d, f)

    def test_log_kr_only(self):
        run(['log.py', self.snap, self.tmp + '/log-kr', 'kr'])
        rec = records(self.tmp + '/log-kr')[-1]
        self.assertEqual(sorted(rec['spots']), ['geumjin', 'iho', 'jukdo', 'manlipo'])
        j = rec['spots']['jukdo']
        self.assertEqual((j['buoyId'], j['buoy'], j['station'], len(j['fc'])), (None, [], [['2026-10-18T13:00', 6.0, 170.0]], 24))

    def test_other_logs_hold_no_korea(self):
        run(['log.py', self.snap, self.tmp + '/log', 'tw'])
        run(['log.py', self.snap, self.tmp + '/log-ca', 'ca'])
        self.assertEqual(sorted(records(self.tmp + '/log')[-1]['spots']), ['donghe'])
        self.assertEqual(sorted(records(self.tmp + '/log-ca')[-1]['spots']), ['blacks'])

    def test_correct_and_history_kr(self):
        before = json.load(open(self.snap))['spots']
        run(['log.py', self.snap, self.tmp + '/log-kr', 'kr'])
        run(['correct.py', self.snap, self.tmp + '/log-kr', 'kr'])
        run(['history.py', self.snap, self.tmp + '/log-kr', self.tmp + '/cache', 'kr'])
        d = json.load(open(self.snap))
        for k in ('donghe', 'blacks'): self.assertEqual(d['spots'][k], before[k])
        self.assertEqual(sorted(json.load(open(self.tmp + '/cache/tides-kr.json'))), ['geumjin', 'iho', 'jukdo', 'manlipo'])
        # with no buoy readings the wave heights stay as forecast
        self.assertEqual((d['spots']['jukdo']['adj']['f'], d['spots']['jukdo']['adj']['days']), (1.0, 0))
        self.assertEqual(d['spots']['jukdo']['hourly'], before['jukdo']['hourly'])


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

if __name__ == '__main__':
    unittest.main()
