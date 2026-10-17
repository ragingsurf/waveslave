# The Pacific layer asks Open-Meteo exactly what the other grids ask: the West Pacific block and regrid() in refresh.sh and pacific.sh repeat the same two curl commands.
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
