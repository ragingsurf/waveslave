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
    def setUp(self):
        self.t = jp.tide_table(FIX('tide.txt'), 'TK')

    def test_highs_lows_shift_to_taipei(self):
        # a 00:42 JST high on 11 May lands on 10 May at 23:42 Taipei
        self.assertIn(['23:42', 'H', 151], self.t['2026-05-10'])
        self.assertEqual(self.t['2026-05-11'], [['06:02', 'L', 107], ['10:47', 'H', 133], ['17:33', 'L', 70]])

    def test_skips_9999(self):
        self.assertTrue(all(cm < 999 for v in self.t.values() for _, _, cm in v))

    def test_other_point_ignored(self):
        self.assertEqual(jp.tide_table(FIX('tide.txt'), 'CS'), {})


class Sun(unittest.TestCase):
    def test_tokyo_midsummer(self):
        s = jp.sun_times(35.68, 139.77, '2026-06-21')
        self.assertTrue('03:23' <= s['rise'] <= '03:27', s)   # 04:25 JST by NAOJ
        self.assertTrue('17:59' <= s['set'] <= '18:03', s)    # 19:01 JST
        self.assertLess(s['first'], s['rise']); self.assertLess(s['set'], s['last']); self.assertEqual(s['phen'], [])


if __name__ == '__main__':
    unittest.main()
