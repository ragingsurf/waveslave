# The map's own maths (the MAPM block in template.html) is tested in Node, in tests/map/mapmath.test.js; this runs it with the rest. Skipped when node isn't installed.
# Run: python3 -m unittest discover -s tests -v
import os, shutil, subprocess, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)


class MapMaths(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'node is not installed')
    def test_mapmath(self):
        r = subprocess.run(['node', '--test', os.path.join('tests', 'map', 'mapmath.test.js')], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
