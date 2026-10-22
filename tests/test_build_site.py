# build-site.sh puts chat.js's version in the page's address for it, so a reload never pairs a new page with the chat.js before it from the
# browser's cache (GitHub Pages lets the browser keep both files 10 minutes, and a reload fetches only the page again). refresh.sh is stood
# in for, writing template.html as the built page, so this runs with no network and no CWA key.
# Run: python3 -m unittest discover -s tests -v
import os, re, shutil, subprocess, tempfile, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)


def read(path):
    with open(path, encoding='utf-8') as f: return f.read()


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

    def address(self, page):
        found = re.findall(r'<script src="(chat\.js[^"]*)" defer></script>', page)
        self.assertEqual(len(found), 1, found); return found[0]

    def test_chat_js_address_carries_its_version(self):
        page = self.build('site'); addr = self.address(page)
        self.assertRegex(addr, r'^chat\.js\?v=\w+$')
        # the page is web/head.html and the built page as they were but for that address, and chat.js goes next to it as it is
        self.assertEqual(page, read(os.path.join(ROOT, 'web', 'head.html')) + read(os.path.join(ROOT, 'template.html')).replace('src="chat.js"', 'src="%s"' % addr))
        self.assertEqual(read(os.path.join(self.tmp, 'site', 'chat.js')), read(os.path.join(ROOT, 'web', 'chat.js')))

    def test_address_changes_with_chat_js(self):
        # the half-hourly rebuilds keep the address while chat.js stays the same, so the browser keeps its copy; a changed chat.js gets a new one
        a = self.address(self.build('a')); self.assertEqual(self.address(self.build('b')), a)
        with open(os.path.join(self.tmp, 'web', 'chat.js'), 'a', encoding='utf-8') as f: f.write('\n// changed\n')
        self.assertNotEqual(self.address(self.build('c')), a)


if __name__ == '__main__':
    unittest.main()
