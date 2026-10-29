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
        self.assertEqual(page, read(os.path.join(ROOT, 'web', 'head.html')) + read(os.path.join(ROOT, 'template.html')).replace('src="chat.js"', 'src="%s"' % addr).replace('src="dreamwave.js"', 'src="%s"' % self.dw_address(page)))
        self.assertEqual(read(os.path.join(self.tmp, 'site', 'chat.js')), read(os.path.join(ROOT, 'web', 'chat.js')))

    def test_address_changes_with_chat_js(self):
        # the half-hourly rebuilds keep the address while chat.js stays the same, so the browser keeps its copy; a changed chat.js gets a new one
        a = self.address(self.build('a')); self.assertEqual(self.address(self.build('b')), a)
        with open(os.path.join(self.tmp, 'web', 'chat.js'), 'a', encoding='utf-8') as f: f.write('\n// changed\n')
        self.assertNotEqual(self.address(self.build('c')), a)

    def test_link_preview_card_is_near_the_top(self):
        # iMessage, LINE and the rest read only the start of a page this big to build the link card, so its tags sit in the first 4 KB,
        # and the image they point at goes out with the site at 1200x630
        page = self.build('site'); top = page.encode('utf-8')[:4096].decode('utf-8', 'ignore')
        for tag in ('og:title', 'og:description', 'og:url', 'og:image', 'og:image:width', 'twitter:card'):
            self.assertIn('property="%s"' % tag if tag.startswith('og') else 'name="%s"' % tag, top)
        img = re.search(r'property="og:image" content="https://waveslave\.tw/([^"?]+)', top).group(1)
        with open(os.path.join(self.tmp, 'site', img), 'rb') as f: head = f.read(24)
        self.assertEqual(head[:8], b'\x89PNG\r\n\x1a\n'); self.assertEqual((int.from_bytes(head[16:20], 'big'), int.from_bytes(head[20:24], 'big')), (1200, 630))

    def dw_address(self, page):
        found = re.findall(r'<script src="(dreamwave\.js[^"]*)" defer></script>', page)
        self.assertEqual(len(found), 1, found); return found[0]

    def test_dreamwave_address_carries_its_version(self):
        self.assertRegex(self.dw_address(self.build('site')), r'^dreamwave\.js\?v=\w+$')

    def test_dreamwave_files_copied(self):
        # the Dream Wave tab's loader, its parts and three.js go out next to the page as they are, so the tab loads from the site itself
        self.build('site')
        for rel in ('dreamwave.js', 'dreamwave/shell.js', 'dreamwave/flow.js', 'vendor/three.min.js'):
            with open(os.path.join(self.tmp, 'site', rel), 'rb') as a, open(os.path.join(ROOT, 'web', rel), 'rb') as b: self.assertEqual(a.read(), b.read(), rel)

    def test_address_changes_with_a_dreamwave_part(self):
        # the loader asks for its parts with its own version, so a changed part changes the loader's address too
        a = self.dw_address(self.build('a')); self.assertEqual(self.dw_address(self.build('b')), a)
        with open(os.path.join(self.tmp, 'web', 'dreamwave', 'shell.js'), 'a', encoding='utf-8') as f: f.write('\n// changed\n')
        self.assertNotEqual(self.dw_address(self.build('c')), a)


if __name__ == '__main__':
    unittest.main()
