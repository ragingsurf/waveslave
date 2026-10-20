# The map's own maths (the MAPM block in template.html) is tested in Node, in tests/map/mapmath.test.js; this runs it with the rest. Skipped when node isn't installed.
# Also: every placeholder in template.html is filled, by refresh.sh and by tests/map/tool.py.
# Run: python3 -m unittest discover -s tests -v
import contextlib, importlib.util, io, os, re, shutil, subprocess, tempfile, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
def read(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as f: return f.read()


class MapMaths(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'node is not installed')
    def test_mapmath(self):
        r = subprocess.run(['node', '--test', os.path.join('tests', 'map', 'mapmath.test.js')], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


class Placeholders(unittest.TestCase):
    # A new country grid needs its __NAME__ filled in refresh.sh's page step and in tool.py, which builds test pages from an earlier build's data.
    def test_refresh_fills_every_placeholder(self):
        names = sorted(set(re.findall(r'__([A-Z]+)__', read('template.html'))))
        self.assertIn('GRIDID', names); self.assertIn('GRIDNZ', names); self.assertIn('GRIDPI', names); self.assertIn('GRIDAK', names); self.assertIn('GRIDMI', names); self.assertIn('GRIDHK', names); self.assertIn('GRIDPG', names); self.assertIn('GRIDVU', names); self.assertIn('GRIDBJ', names)
        for n in names: self.assertIn("replace('__%s__'" % n, read('refresh.sh'), n)

    def test_tool_fills_every_placeholder(self):
        spec = importlib.util.spec_from_file_location('maptool', os.path.join(ROOT, 'tests', 'map', 'tool.py'))
        tool = importlib.util.module_from_spec(spec); spec.loader.exec_module(tool)
        tmp = tempfile.mkdtemp(); src, out = os.path.join(tmp, 'built.html'), os.path.join(tmp, 'out.html')
        # a page as refresh.sh builds it now, one from before Baja's grid, one from before Vanuatu's, one from before Papua New Guinea's, one from before Hong Kong's, one from before Micronesia's, one from before Alaska's, one from before the South Pacific's,
        # one from before New Zealand's and one from before Indonesia's, whose Pacific Northwest grid must still be found
        for keys in (('wp', 'ca', 'hi', 'au', 'id', 'nw', 'nz', 'pi', 'ak', 'mi', 'hk', 'pg', 'vu', 'bj'), ('wp', 'ca', 'hi', 'au', 'id', 'nw', 'nz', 'pi', 'ak', 'mi', 'hk', 'pg', 'vu'), ('wp', 'ca', 'hi', 'au', 'id', 'nw', 'nz', 'pi', 'ak', 'mi', 'hk', 'pg'), ('wp', 'ca', 'hi', 'au', 'id', 'nw', 'nz', 'pi', 'ak', 'mi', 'hk'), ('wp', 'ca', 'hi', 'au', 'id', 'nw', 'nz', 'pi', 'ak', 'mi'), ('wp', 'ca', 'hi', 'au', 'id', 'nw', 'nz', 'pi', 'ak'), ('wp', 'ca', 'hi', 'au', 'id', 'nw', 'nz', 'pi'), ('wp', 'ca', 'hi', 'au', 'id', 'nw', 'nz'), ('wp', 'ca', 'hi', 'au', 'id', 'nw'), ('wp', 'ca', 'hi', 'au', 'nw')):
            with open(src, 'w', encoding='utf-8') as f:
                f.write('<img src="data:image/jpeg;base64,AA==" alt="Wave of the week">\n<script>const ALL = {"spots": {}};\n'
                        'const RAW = {%s, pac: null};</script>' % ', '.join('%s: {"g": "%s"}' % (k, k) for k in keys))
            with contextlib.redirect_stdout(io.StringIO()): tool.page(src, os.path.join(ROOT, 'template.html'), 'null', out)
            html = read(out)
            self.assertEqual(re.findall(r'__[A-Z]+__', html), [], keys)
            self.assertIn('nw: {"g": "nw"}', html)
            self.assertIn('id: {"g": "id"}' if 'id' in keys else 'id: null', html)
            self.assertIn('nz: {"g": "nz"}' if 'nz' in keys else 'nz: null', html)
            self.assertIn('pi: {"g": "pi"}' if 'pi' in keys else 'pi: null', html)
            self.assertIn('ak: {"g": "ak"}' if 'ak' in keys else 'ak: null', html)
            self.assertIn('mi: {"g": "mi"}' if 'mi' in keys else 'mi: null', html)
            self.assertIn('hk: {"g": "hk"}' if 'hk' in keys else 'hk: null', html)
            self.assertIn('pg: {"g": "pg"}' if 'pg' in keys else 'pg: null', html)
            self.assertIn('vu: {"g": "vu"}' if 'vu' in keys else 'vu: null', html)
            self.assertIn('bj: {"g": "bj"}' if 'bj' in keys else 'bj: null', html)

    def test_tool_reads_past_a_missing_grid(self):
        # refresh.sh fills a grid it has no file for as "null" and a newline, so the next grid follows "null\n, " in the page
        spec = importlib.util.spec_from_file_location('maptool', os.path.join(ROOT, 'tests', 'map', 'tool.py'))
        tool = importlib.util.module_from_spec(spec); spec.loader.exec_module(tool)
        found = tool.live('<img src="data:image/jpeg;base64,AA==" alt="Wave of the week">\n<script>const ALL = {"spots": {}};\nconst RAW = {wp: {"g": "wp"}, '
                          'ca: null\n, hi: {"g": "hi"}, au: {"g": "au"}, id: {"g": "id"}, nw: {"g": "nw"}, nz: {"g": "nz"}, pi: null\n, ak: {"g": "ak"}, mi: null\n, hk: {"g": "hk"}, pg: {"g": "pg"}, vu: null\n, bj: {"g": "bj"}, pac: null};</script>')
        self.assertEqual([found[n] for n in ('GRIDCA', 'GRIDHI', 'GRIDPI', 'GRIDAK', 'GRIDMI', 'GRIDHK', 'GRIDPG', 'GRIDVU', 'GRIDBJ')], ['null', '{"g": "hi"}', 'null', '{"g": "ak"}', 'null', '{"g": "hk"}', '{"g": "pg"}', 'null', '{"g": "bj"}'])
