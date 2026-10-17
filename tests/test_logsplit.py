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


if __name__ == '__main__':
    unittest.main()
