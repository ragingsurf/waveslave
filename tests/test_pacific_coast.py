# tools/pacific_coast.py cuts Natural Earth land to the parts of the Pacific box the detailed coasts leave uncovered, for the map's COAST.
# Run: python3 -m unittest discover -s tests -v
import os, sys, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import pacific_coast as pc


class Geometry(unittest.TestCase):
    def test_split180(self):
        self.assertEqual(pc.split180((163, 250, -50, 30)), [(163, 180, -50, 30), (-180, -110, -50, 30)])
        self.assertEqual(pc.split180((100, 163, -50, -5)), [(100, 163, -50, -5)])
        self.assertEqual(pc.split180((246, 250, 30, 43)), [(-114, -110, 30, 43)])

    def test_clip_keeps_edge_points(self):
        r = pc.clip([[160, 0], [166, 0], [166, 6], [160, 6], [160, 0]], pc.split180((163, 250, -50, 30))[0])
        lons = [x for x, y in r]
        self.assertTrue(all(x >= 163 for x in lons), lons)
        self.assertIn(163, lons)
        self.assertEqual(r[0], r[-1])  # closed again

    def test_antimeridian_pieces_meet_at_180(self):
        w, e = pc.split180((163, 250, -50, 30))
        a = pc.east(pc.clip([[179, 10], [180, 10], [180, 11], [179, 11], [179, 10]], w))
        b = pc.east(pc.clip([[-180, 10], [-179.5, 10], [-179.5, 11], [-180, 11], [-180, 10]], e))
        for r in (a, b): self.assertIn(180, [x for x, y in r], r)
        self.assertTrue(all(180 <= x <= 180.5 for x, y in b), b)

    def test_simplify_keeps_cut_vertices(self):
        # A thin spit cut off at 163°E: a 0.02° edge on the cut line, and a coast jagged by less than eps. The ring starts at the tip, so plain
        # Douglas–Peucker keeps only one end of that edge, and the coast runs slanted onto it: a false coast across the cut.
        top = [[163 + k/4, 10.02 + (0.01 if k % 2 else -0.005)] for k in range(1, 20)]
        bottom = [[163 + k/4, 10 + (-0.01 if k % 2 else 0.005)] for k in range(19, 0, -1)]
        ring = [[168, 10.01]] + bottom + [[163, 10], [163, 10.02]] + top + [[168, 10.01]]
        out = pc.simplify(ring, 0.05)
        self.assertLess(len(out), len(ring) // 4)  # the jagged coast is gone
        self.assertEqual(out[0], out[-1])
        segs = [(tuple(a), tuple(b)) for a, b in zip(out, out[1:])]
        self.assertTrue(((163, 10), (163, 10.02)) in segs or ((163, 10.02), (163, 10)) in segs, out)

    def test_skip_australia_and_hawaii(self):
        au = [(113.16, 153.62, -39.13, -10.69), (144.63, 148.31, -43.61, -40.71)]  # the mainland, Tasmania
        self.assertTrue(pc.skipped((113.2, 153.6, -39.1, -10.7), au))
        self.assertTrue(pc.skipped((144.6, 148.35, -43.65, -40.75), au))
        self.assertFalse(pc.skipped((130.9, 150.9, -10.7, -0.9), au))  # New Guinea, its south edge level with Cape York
        self.assertFalse(pc.skipped((113.16, 153.62, -39.13, -10.6), au))  # one side out by 0.09
        self.assertTrue(pc.skipped((201.7, 202.3, 21.25, 21.71), au))  # Oahu, inside the Hawaii box
        self.assertFalse(pc.skipped((198.2, 199.3, 21.8, 22.3), au))  # reaching past its west edge


if __name__ == '__main__':
    unittest.main()
