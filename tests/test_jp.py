# Tests for jp.py, the Japan sources reader. Run: python3 -m unittest discover -s tests -v
import os, sys, json, copy, unittest, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import jp
FIXDIR = os.path.join(HERE, 'fixtures', 'jp')
def FIX(f):
    with open(os.path.join(FIXDIR, f), encoding='utf-8') as fh: return fh.read()


class Nowphas(unittest.TestCase):
    def test_jst_to_tpe_crosses_midnight(self):
        self.assertEqual(jp.jst_to_tpe('202610170020'), '2026-10-16T23:20')
        self.assertEqual(jp.jst_to_tpe('2026-10-17T20:50:00+09:00'), '2026-10-17T19:50')

    def test_nowphas_drops_missing(self):
        r = jp.nowphas_rows(FIX('nowphas.xml'))
        self.assertEqual(sorted(r), ['222', '609'])
        self.assertEqual(r['609'], ['2026-10-16T23:20', 1.35, 5.7, 112.5, None])  # ESE


class Amedas(unittest.TestCase):
    def setUp(self):
        self.w = jp.amedas_wind(json.loads(FIX('amedas.json')), '2026-10-17T20:50:00+09:00')

    def test_kt_and_direction(self):
        self.assertEqual(self.w['11001'], ['2026-10-17T19:50', round(14.1 * 1.944, 1), 13 * 22.5])

    def test_calm(self):
        self.assertEqual(self.w['45148'][1:], [0.0, None])

    def test_missing_and_flagged_absent(self):
        self.assertNotIn('12066', self.w)  # no wind sensor
        self.assertNotIn('46141', self.w)  # quality flag not 0


class MergeBuoy(unittest.TestCase):
    def test_keeps_24h(self):
        old = [['2026-10-15T10:00', 1, 6, 90, None], ['2026-10-16T22:00', 1, 6, 90, None]]
        new = [['2026-10-16T23:20', 1.2, 7, 90, None]]
        self.assertEqual([r[0] for r in jp.merge_buoy(old, new)], ['2026-10-16T22:00', '2026-10-16T23:20'])

    def test_new_reading_replaces_same_time(self):
        old = [['2026-10-16T23:20', 1.0, 6, 90, None]]
        self.assertEqual(jp.merge_buoy(old, [['2026-10-16T23:20', 1.2, 7, 90, None]]), [['2026-10-16T23:20', 1.2, 7, 90, None]])


class Tides(unittest.TestCase):
    # Tides and sun stay in the spot's own clock (JST), keyed by its own date, like CWA's for Taiwan: the page shows them as local times.
    def setUp(self):
        self.t = jp.tide_table(FIX('tide.txt'), 'TK')

    def test_highs_lows_in_japan_time(self):
        self.assertEqual(self.t['2026-05-11'], [['00:42', 'H', 151], ['07:02', 'L', 107], ['11:47', 'H', 133], ['18:33', 'L', 70]])

    def test_skips_9999(self):
        self.assertTrue(all(cm < 999 for v in self.t.values() for _, _, cm in v))

    def test_other_point_ignored(self):
        self.assertEqual(jp.tide_table(FIX('tide.txt'), 'CS'), {})


class Sun(unittest.TestCase):
    def test_tokyo_midsummer_in_japan_time(self):
        s = jp.sun_times(35.68, 139.77, '2026-06-21')
        self.assertTrue('04:23' <= s['rise'] <= '04:27', s)   # 04:25 JST by NAOJ
        self.assertTrue('18:59' <= s['set'] <= '19:03', s)    # 19:01 JST
        self.assertLess(s['first'], s['rise']); self.assertLess(s['set'], s['last']); self.assertEqual(s['phen'], [])


SPOTS = json.load(open(os.path.join(os.path.dirname(HERE), 'spots.json')))


class JmaWave(unittest.TestCase):
    def test_text(self):
        self.assertEqual(jp.jma_wave_m('１．５メートル　後　２メートル'), 2.0)
        self.assertEqual(jp.jma_wave_m('３メートル　うねりを伴う'), 3.0)
        self.assertEqual(jp.jma_wave_m('０．５メートル'), 0.5)
        self.assertIsNone(jp.jma_wave_m(''))

    def test_rows_every_3h_taipei(self):
        r = jp.jmawave_rows(json.loads(FIX('jmafc-080000.json')), '080020')
        # first period starts 17:00 JST = 16:00 Taipei, so the first 3-hourly Taipei slot is 18:00
        self.assertEqual(r[0], ['2026-10-17T18:00', 1.5, None, None])
        self.assertIn(['2026-10-19T00:00', 2.0, None, None], r)   # third period: from 19th 00:00 JST (18th 23:00 Taipei), max of "1.5 後 2"
        self.assertIn(['2026-10-18T21:00', 1.5, None, None], r)
        self.assertTrue(all(int(x[0][11:13]) % 3 == 0 for x in r))

    def test_rows_unknown_area(self):
        self.assertEqual(jp.jmawave_rows(json.loads(FIX('jmafc-080000.json')), '999999'), [])


class Wind(unittest.TestCase):
    def test_rows(self):
        r = jp.wind_rows(json.loads(FIX('openjma.json'))[0])
        self.assertEqual(r[0], ['2026-10-17T00:00', 8.0, 300, None, None])
        self.assertEqual(r[4], ['2026-10-17T12:00', 14.0, 300, 'Rain', None])
        self.assertEqual(len(r), 8)


class Fill(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.snap = json.loads(FIX('snap_in.json'))

    def test_nothing_downloaded(self):
        tw = copy.deepcopy(self.snap['spots']['donghe'])
        jp.fill(self.snap, SPOTS, '/nonexistent', self.tmp)
        self.assertEqual(self.snap['spots']['donghe'], tw)
        h = self.snap['spots']['hasaki']
        self.assertEqual((h['buoy'], h['dwind'], h['wind'], h['tides'], h['buoyId']), ([], [], [], {}, None))
        self.assertTrue(h['hourly'])
        self.assertEqual(sorted(h['sun']), ['2026-10-17', '2026-10-18', '2026-10-19'])

    def test_fills_from_downloads_and_changes_src(self):
        before = json.dumps(self.snap['src'], sort_keys=True)
        jp.fill(self.snap, SPOTS, FIXDIR, self.tmp)
        h = self.snap['spots']['hasaki']
        self.assertNotEqual(json.dumps(self.snap['src'], sort_keys=True), before)
        self.assertEqual((h['buoyId'], h['buoy'][-1][1], h['buoyAt']), ('222', 0.83, '2026-10-16T23:20'))
        self.assertEqual(h['dwind'], [['2026-10-17T20:10', 0.0, None]])   # Choshi, calm in the fixture (21:10 JST)
        self.assertEqual(h['wind'][0][1], 8.0)
        self.assertEqual(h['jmawave'][0][1], 1.5)
        self.assertEqual(self.snap['src']['spots']['hasaki'], '2026-10-16T23:20/2026-10-17T20:10')

    def test_buoy_history_kept_between_runs(self):
        jp.fill(self.snap, SPOTS, FIXDIR, self.tmp)
        cache = json.load(open(os.path.join(self.tmp, 'jp-buoy.json')))
        self.assertIn('222', cache)

    def test_tides_from_cache(self):
        with open(os.path.join(self.tmp, 'jp-tide-CS-2026.txt'), 'w') as f:
            f.write(FIX('tide.txt').replace('TK', 'CS').replace('26 511', '261018').replace('26 510', '261017'))
        jp.fill(self.snap, SPOTS, '/nonexistent', self.tmp)
        self.assertIn(['11:47', 'H', 133], self.snap['spots']['hasaki']['tides']['2026-10-18'])


if __name__ == '__main__':
    unittest.main()
