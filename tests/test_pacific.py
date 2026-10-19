# The Pacific layer asks Open-Meteo exactly what the other grids ask: the West Pacific block and regrid() in refresh.sh and pacific.sh repeat the same two curl commands.
# And its points run edge to edge of the map's Pacific box.
# Run: python3 -m unittest discover -s tests -v
import os, re, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
CURL = re.compile(r'curl [^"\n]*-o "[^"\n]*" "https://(?:marine-)?api\.open-meteo\.com/v1/(forecast|marine)\?[^"\n]*"')


def requests(script):
    # Each grid request in a script as (kind, script:line, command). Only the -o target and the lat/lon names ($GLA/$GLO or $LA/$LO) may differ, so those are made alike.
    with open(os.path.join(ROOT, script)) as f: text = f.read()
    out = []
    for m in CURL.finditer(text):
        cmd = re.sub(r'-o "[^"]*"', '-o OUT', m.group(0))
        cmd = re.sub(r'\$G?LA\b', '$LAT', re.sub(r'\$G?LO\b', '$LON', cmd))
        out.append((m.group(1), '%s:%d' % (script, text.count('\n', 0, m.start()) + 1), cmd))
    return out


class Requests(unittest.TestCase):
    def test_three_copies_alike(self):
        found = requests('refresh.sh') + requests('pacific.sh')
        for kind in ('forecast', 'marine'):
            copies = [(where, cmd) for k, where, cmd in found if k == kind]
            self.assertEqual(len(copies), 3, '%s: want the West Pacific block, regrid and pacific.sh, found %s' % (kind, [w for w, c in copies]))
            for where, cmd in copies[1:]: self.assertEqual(cmd, copies[0][1], '%s at %s differs from %s' % (kind, where, copies[0][0]))


class Box(unittest.TestCase):
    def test_layer_fills_the_map_box(self):
        # pacific.sh's first and last rows and columns sit on the edges of the map's box (PBOX in template.html), its chunks ask for every
        # row once, and grid.py packs the same size: moving the box (to 65°N for Alaska) without the layer fails here.
        with open(os.path.join(ROOT, 'pacific.sh'), encoding='utf-8') as f: sh = f.read()
        with open(os.path.join(ROOT, 'template.html'), encoding='utf-8') as f: box = {k: int(v) for k, v in re.findall(r'(\w): (-?\d+)', re.search(r'const PBOX = \{([^}]*)\}', f.read()).group(1))}
        size = re.search(r'grid\.py" coords (-?\d+) (\d+) (\d+) (-?\d+) (\d+) (\d+) \$r', sh).groups()
        lat0, dlat, rows, lon0, dlon, cols = map(int, size)
        self.assertEqual({'s': lat0, 'n': lat0 + (rows-1)*dlat, 'l': lon0, 'r': lon0 + (cols-1)*dlon}, box)
        chunks = re.findall(r'"(\d+) (\d+)"', re.search(r'for r in ([^;]*); do', sh).group(1))
        self.assertEqual([i for a, b in chunks for i in range(int(a), int(b))], list(range(rows)))
        self.assertIn('"$T/grid.json" %s 2' % ' '.join(size), sh)
