# tools/detail_coast.py cuts Natural Earth 10 m land to the map's DETAIL boxes (Hong Kong, Hainan, Papua New Guinea, Vanuatu, the Cape
# of Baja California) for the map's COAST.
# Run: python3 -m unittest discover -s tests -v
import contextlib, io, json, os, sys, tempfile, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import detail_coast as dc

BOX = (113.4371, 114.6629, 21.9517, 22.7483)


class Geometry(unittest.TestCase):
    def test_clip_keeps_edge_points(self):
        r = dc.clip([[113, 22], [114, 22], [114, 22.5], [113, 22.5], [113, 22]], BOX)
        self.assertEqual(sorted({x for x, y in r}), [113.4371, 114])
        self.assertEqual(r[0], r[-1])  # closed again
        self.assertEqual(dc.clip([[110, 20], [111, 20], [111, 21], [110, 20]], BOX), [])

    def test_simplify_keeps_edge_vertices(self):
        # A coast jagged by less than eps between two cuts on the west edge: the jags go, the cut points stay.
        coast = [[113.5 + k/1000, 22.3 + (0.0002 if k % 2 else -0.0002)] for k in range(1, 40)]
        ring = [[113.4371, 22.3]] + coast + [[113.6, 22.31], [113.4371, 22.31], [113.4371, 22.3]]
        out = dc.simplify(ring, BOX, 0.0005)
        self.assertLess(len(out), 8)
        self.assertIn([113.4371, 22.3], out); self.assertIn([113.4371, 22.31], out)
        self.assertEqual(out[0], out[-1])

    def test_rounding_keeps_the_edges(self):
        self.assertEqual(dc.num(113.4371, BOX), 113.4371)  # not 113.437, off the cut line
        self.assertEqual(dc.num(114.12345, BOX), 114.123)
        self.assertEqual(dc.num(22.0000004, BOX), 22)
        self.assertEqual(dc.tidy([[114.12345, 22.2], [114.12349, 22.2001], [114.2, 22.3]], BOX), [[114.123, 22.2], [114.2, 22.3]])


class Template(unittest.TestCase):
    def test_push_goes_after_the_clip_out_and_is_replaced_in_place(self):
        tmp = tempfile.mkdtemp(); land, page = os.path.join(tmp, 'land.geojson'), os.path.join(tmp, 'page.html')
        sq = lambda x, y, d: [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]
        with open(land, 'w', encoding='utf-8') as f:  # an island inside the box, a coast across its west edge, one far off
            json.dump({'features': [{'geometry': {'type': 'Polygon', 'coordinates': [sq(114, 22.2, 0.1)]}},
                                    {'geometry': {'type': 'MultiPolygon', 'coordinates': [[sq(113, 22.3, 1)], [sq(100, 10, 1)]]}}]}, f)
        lines = ['  const DETAIL = [[113.4371, 114.6629, 21.9517, 22.7483]];', 'x', '  for (const [l, r, s, n] of MAPM.DETAIL) for (...) {',
                 '    ... }', '  const LAND = ...;']
        with open(page, 'w', encoding='utf-8') as f: f.write('\n'.join(lines))
        for _ in range(2):
            with contextlib.redirect_stdout(io.StringIO()): dc.main(land, page, 0.0005)
        with open(page, encoding='utf-8') as f: out = f.read().split('\n')
        self.assertEqual(out[:4], lines[:4]); self.assertEqual(out[4], dc.COMMENT); self.assertEqual(out[6:], lines[4:])
        rings = json.loads(out[5][len('  COAST.push(...'):-len(');')])
        self.assertEqual(rings[0], sq(114, 22.2, 0.1))
        self.assertEqual(sorted({x for x, y in rings[1]}), [113.4371, 114])
        self.assertEqual(len(rings), 2)

    def test_a_box_past_180_cuts_west_longitudes(self):
        # By the push the page's outlines run east (California's -120.3 is 239.7), so a box past 180° (the Cape of Baja California's) takes
        # Natural Earth's land west of 180° moved on by 360°, and its rings come out on east longitudes as well.
        tmp = tempfile.mkdtemp(); land, page = os.path.join(tmp, 'land.geojson'), os.path.join(tmp, 'page.html')
        sq = lambda x, y, d: [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]
        # A coast across the box's east edge at 110°W; an island at 110°E and land across 0° from 20°W to 170°E, both of which stay out (moved
        # east by 360° where west of 0°, the second would stretch from 170°E to 340°E, over the box)
        with open(land, 'w', encoding='utf-8') as f:
            json.dump({'features': [{'geometry': {'type': 'Polygon', 'coordinates': [sq(-110.5, 23, 1)]}},
                                    {'geometry': {'type': 'Polygon', 'coordinates': [sq(109.5, 23.2, 1)]}},
                                    {'geometry': {'type': 'Polygon', 'coordinates': [[[-20, 10], [170, 10], [170, 40], [-20, 40], [-20, 10]]]}}]}, f)
        with open(page, 'w', encoding='utf-8') as f:
            f.write('\n'.join(['  const DETAIL = [[248.9371, 250.0629, 22.7517, 24.2483]];', '  for (const [l, r, s, n] of MAPM.DETAIL) for (...) {', '    ... }']))
        with contextlib.redirect_stdout(io.StringIO()): dc.main(land, page, 0.0005)
        with open(page, encoding='utf-8') as f: rings = json.loads(f.read().split('\n')[4][len('  COAST.push(...'):-len(');')])
        self.assertEqual(len(rings), 1)
        self.assertEqual(sorted({x for x, y in rings[0]}), [249.5, 250.0629])
        self.assertEqual(sorted({y for x, y in rings[0]}), [23, 24])

    def test_the_page_keeps_what_the_tool_reads(self):
        # template.html's own DETAIL boxes stay on one line the tool can parse, with one clip-out loop and the push in place after it.
        with open(os.path.join(ROOT, 'template.html'), encoding='utf-8') as f: lines = f.read().split('\n')
        b = [l for l in lines if l.startswith(dc.BOXES)]; c = [i for i, l in enumerate(lines) if l.startswith(dc.CLIPOUT)]
        self.assertEqual((len(b), len(c)), (1, 1))
        boxes = json.loads(b[0][len(dc.BOXES):].rstrip(';'))
        self.assertTrue(boxes and all(len(x) == 4 and x[0] < x[1] and x[2] < x[3] for x in boxes), boxes)
        self.assertEqual(lines[c[0] + 2], dc.COMMENT)
        push = lines[c[0] + 3]
        self.assertTrue(push.startswith('  COAST.push(...[[') and push.endswith(');'), push[:40])
        self.assertLessEqual(len(push.encode('utf-8')), dc.BUDGET)


if __name__ == '__main__':
    unittest.main()
