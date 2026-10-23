# build-site.sh puts chat.js's and coach.js's versions in the page's addresses for them, so a reload never pairs a new page with a script
# before it from the browser's cache (GitHub Pages lets the browser keep every file 10 minutes, and a reload fetches only the page again).
# refresh.sh is stood in for, writing template.html as the built page, so this runs with no network and no CWA key.
# Run: python3 -m unittest discover -s tests -v
import os, re, shutil, subprocess, tempfile, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
SCRIPTS = ('chat', 'coach')  # the page's versioned scripts, web/<name>.js


def read(path, mode='r'):
    with open(path, mode, **({} if 'b' in mode else {'encoding': 'utf-8'})) as f: return f.read()


class BuildSite(unittest.TestCase):
    def setUp(self):
        # build-site.sh with a copy of web/ beside it, and a refresh.sh that writes template.html as the built page
        self.tmp = tempfile.mkdtemp(); self.addCleanup(shutil.rmtree, self.tmp)
        shutil.copy(os.path.join(ROOT, 'build-site.sh'), self.tmp); shutil.copytree(os.path.join(ROOT, 'web'), os.path.join(self.tmp, 'web'))
        with open(os.path.join(self.tmp, 'refresh.sh'), 'w') as f: f.write('mkdir -p "$1" && cp "%s" "$1/taitung-surf.html"\n' % os.path.join(ROOT, 'template.html'))

    def build(self, out):
        subprocess.run(['sh', os.path.join(self.tmp, 'build-site.sh'), os.path.join(self.tmp, out)], check=True, capture_output=True,
                       env=dict(os.environ, RUNNER_TEMP=self.tmp))
        return read(os.path.join(self.tmp, out, 'index.html'))

    def address(self, page, name='chat'):
        found = re.findall(r'<script src="(%s\.js[^"]*)" defer></script>' % name, page)
        self.assertEqual(len(found), 1, found); return found[0]

    def test_script_addresses_carry_their_versions(self):
        page = self.build('site'); addr = {n: self.address(page, n) for n in SCRIPTS}
        for n in SCRIPTS: self.assertRegex(addr[n], r'^%s\.js\?v=\w+$' % n)
        # the page is web/head.html and the built page as they were but for those two addresses, coach.js's tag before chat.js's
        want = read(os.path.join(ROOT, 'web', 'head.html')) + read(os.path.join(ROOT, 'template.html'))
        for n in SCRIPTS: want = want.replace('src="%s.js"' % n, 'src="%s"' % addr[n])
        self.assertEqual(page, want)
        self.assertLess(page.index('src="%s"' % addr['coach']), page.index('src="%s"' % addr['chat']))
        # and each script goes next to it as it is
        for n in SCRIPTS: self.assertEqual(read(os.path.join(self.tmp, 'site', n + '.js')), read(os.path.join(ROOT, 'web', n + '.js')))

    def test_coach_example_is_copied(self):
        # the signed-out example's key frames (web/coach-example/1.jpg ...), byte for byte, and nothing else
        self.build('site'); src, out = os.path.join(ROOT, 'web', 'coach-example'), os.path.join(self.tmp, 'site', 'coach-example')
        names = sorted(os.listdir(src))
        self.assertTrue(2 <= len(names) <= 4 and all(re.fullmatch(r'[1-4]\.jpg', n) for n in names), names)
        self.assertEqual(sorted(os.listdir(out)), names)
        for n in names: self.assertEqual(read(os.path.join(out, n), 'rb'), read(os.path.join(src, n), 'rb'))

    def test_address_changes_with_its_script(self):
        # the half-hourly rebuilds keep the addresses while the scripts stay the same, so the browser keeps its copies; a changed script
        # gets a new address, and the other keeps its own
        a = self.build('a'); self.assertEqual(self.build('b'), a)
        last = {n: self.address(a, n) for n in SCRIPTS}
        for i, n in enumerate(SCRIPTS):
            with open(os.path.join(self.tmp, 'web', n + '.js'), 'a', encoding='utf-8') as f: f.write('\n// changed\n')
            page = self.build('c%d' % i)
            self.assertNotEqual(self.address(page, n), last[n])
            for m in SCRIPTS:
                if m != n: self.assertEqual(self.address(page, m), last[m])
            last = {m: self.address(page, m) for m in SCRIPTS}


if __name__ == '__main__':
    unittest.main()
