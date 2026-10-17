# grid.py packs Open-Meteo wind and wave JSON into the Map tab's grid, and works out the points to request for it.
# Run: python3 -m unittest discover -s tests -v
import os, sys, json, base64, shutil, subprocess, tempfile, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import grid
FIXDIR = os.path.join(HERE, 'fixtures', 'grid')
WIND, WAVE, GOLDEN = (os.path.join(FIXDIR, f) for f in ('wind.json', 'wave.json', 'out.json'))
STEP = {'b64': 24, 'pb64': 6, 'pf64': 12, 'rb64': 6, 'sb64': 18}  # bytes per time step in each field, for the fixtures' 6 points


def run(args):
    return subprocess.run([sys.executable, '-I'] + [os.path.join(ROOT, args[0])] + args[1:], check=True, capture_output=True, text=True).stdout


def load(path):
    with open(path) as f: return json.load(f)


def read(path):
    with open(path, 'rb') as f: return f.read()


def raw(d, field):
    return base64.b64decode(d[field])


class Coords(unittest.TestCase):
    def test_coords_wrap_dateline(self):
        lats, lons = grid.coords(-50, 5, 23, 100, 5, 31, (0, 1))
        self.assertEqual(lats, ['-50.0']*31)
        self.assertEqual(len(lons), 31)
        self.assertEqual([lons[i] for i in (0, 15, 16, 17, 30)], ['100.0', '175.0', '-180.0', '-175.0', '-110.0'])

    def test_coords_rows(self):
        lats, lons = grid.coords(-50, 5, 23, 100, 5, 31, (12, 23))
        self.assertEqual((len(lats), len(lons)), (341, 341))
        self.assertEqual((lats[0], lats[-1]), ('10.0', '60.0'))
        lats, lons = grid.coords(30, 1, 13, -128, 1, 13)
        self.assertEqual((len(lats), len(lons)), (169, 169))
        self.assertEqual(lons[0], '-128.0')
        # row by row: the second row starts again at the first longitude
        self.assertEqual((lats[12], lats[13], lons[13], lats[-1], lons[-1]), ('30.0', '31.0', '-128.0', '42.0', '-116.0'))
        # the Pacific layer asks for rows 0-11 and then 12-22, which together are every point once, in order
        a, b = (grid.coords(-50, 5, 23, 100, 5, 31, r) for r in ((0, 12), (12, 23)))
        self.assertEqual((len(a[0]), len(b[0])), (372, 341))
        self.assertEqual((a[0] + b[0], a[1] + b[1]), grid.coords(-50, 5, 23, 100, 5, 31))

    def test_coords_rounded(self):
        # fractional spacing: float noise (0.1 + 3*0.2 is 0.7000000000000001) goes at 2 places, and 2 places stay
        lats, lons = grid.coords(-0.5, 0.25, 3, 0.1, 0.2, 5)
        self.assertEqual(lats, ['-0.5']*5 + ['-0.25']*5 + ['0.0']*5)
        self.assertEqual(lons, ['0.1', '0.3', '0.5', '0.7', '0.9']*3)

    def test_coords_command(self):
        lines = run(['grid.py', 'coords', '-50', '5', '23', '100', '5', '31', '12', '13']).splitlines()
        self.assertEqual(len(lines), 2)
        lats, lons = (l.split(',') for l in lines)
        self.assertEqual(lats, ['10.0']*31)
        self.assertEqual((len(lons), lons[0], lons[15], lons[16], lons[17], lons[30]), (31, '100.0', '175.0', '-180.0', '-175.0', '-110.0'))


class Pack(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(); self.addCleanup(shutil.rmtree, self.tmp)
        self.out = os.path.join(self.tmp, 'out.json')
        self.wind, self.wave = load(WIND), load(WAVE)

    def chunks(self):
        # wind and wave cut into rows (points 0-2, then 3-5), as the comma-joined lists the command takes
        lists = []
        for name, pts in (('wind', self.wind), ('wave', self.wave)):
            files = []
            for i, part in enumerate((pts[:3], pts[3:])):
                files.append(os.path.join(self.tmp, '%s%d.json' % (name, i)))
                with open(files[-1], 'w') as f: json.dump(part, f)
            lists.append(','.join(files))
        return lists

    def test_unchanged_without_every(self):
        run(['grid.py', WIND, WAVE, self.out, '30', '1', '2', '-128', '1', '3'])
        self.assertEqual(read(self.out), read(GOLDEN))

    def test_every_two(self):
        one = grid.pack(self.wind, self.wave, 30, 1, 2, -128, 1, 3)
        two = grid.pack(self.wind, self.wave, 30, 1, 2, -128, 1, 3, every=2)
        self.assertEqual((one['dt'], one['nt']), (3, 5))  # step 5 has no wave data, so it goes
        self.assertEqual((two['dt'], two['nt'], two['t0']), (6, 3, '2026-10-17T00:00'))
        self.assertEqual(raw(two, 'b64')[24:48], raw(one, 'b64')[48:72])
        for f, n in STEP.items():  # steps 0, 2 and 4 of the 3-hourly run, in every field
            a, c = raw(one, f), raw(two, f)
            self.assertEqual(len(c), 3*n, f)
            self.assertEqual(c, a[:n] + a[2*n:3*n] + a[4*n:5*n], f)

    def test_trimmed_before_thinning(self):
        # wave data ending after step 2 leaves steps 0-2, so every=2 keeps 0 and 2; thinning first would count 0, 2 and 4 and keep a step with no waves
        for v in self.wave:
            for key, vals in v['hourly'].items():
                if key != 'time': vals[3:] = [None]*len(vals[3:])
        one = grid.pack(self.wind, self.wave, 30, 1, 2, -128, 1, 3)
        two = grid.pack(self.wind, self.wave, 30, 1, 2, -128, 1, 3, every=2)
        self.assertEqual((one['nt'], two['nt']), (3, 2))
        for f, n in STEP.items():
            a = raw(one, f)
            self.assertEqual(raw(two, f), a[:n] + a[2*n:3*n], f)

    def test_chunks_join(self):
        wind, wave = self.chunks()
        run(['grid.py', wind, wave, self.out, '30', '1', '2', '-128', '1', '3'])
        self.assertEqual(read(self.out), read(GOLDEN))

    def test_chunks_with_every(self):
        # the Pacific layer's call: chunks joined, then every second step kept
        wind, wave = self.chunks()
        run(['grid.py', wind, wave, self.out, '30', '1', '2', '-128', '1', '3', '2'])
        d = load(self.out)
        self.assertEqual((d['dt'], d['nt']), (6, 3))
        self.assertEqual(d, grid.pack(self.wind, self.wave, 30, 1, 2, -128, 1, 3, every=2))

    def test_lon0_kept(self):
        d = grid.pack(self.wind, self.wave, -50, 5, 2, 175, 5, 3)
        self.assertEqual(d['lon0'], 175)
        self.assertEqual(d['lon0'] + 2*d['dlon'], 185)
        self.assertEqual(grid.pack(self.wind, self.wave, -50, 5, 2, 185, 5, 3)['lon0'], 185)  # not wrapped to -175 either


if __name__ == '__main__':
    unittest.main()
