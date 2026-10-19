# Helpers for the map tests (tests/map/check.js): build a page from the live site's data, compare two screenshots, seed a cache with the live grids.
# The live page is read as data only (text search and JSON parsing); nothing in it is ever run. Run with -I:
#   python3 -I tests/map/tool.py page <live.html> <template.html> <pac.json|null> <out.html>
#       web/head.html + the template, filled the way refresh.sh fills it, with the live page's data and country grids
#   python3 -I tests/map/tool.py diff <a.png> <b.png>
#       prints "diff <share of pixels with any channel off by more than 16>"
#   python3 -I tests/map/tool.py grids <live.html> <dir>
#       writes the country grids under refresh.sh's cache names
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GRIDS = (('wp', 'GRID', 'grid.json'), ('ca', 'GRIDCA', 'grid-ca.json'), ('hi', 'GRIDHI', 'grid-hi.json'), ('au', 'GRIDAU', 'grid-au.json'),
         ('id', 'GRIDID', 'grid-id.json'), ('nw', 'GRIDNW', 'grid-nw.json'), ('nz', 'GRIDNZ', 'grid-nz.json'),
         ('pi', 'GRIDPI', 'grid-pi.json'), ('ak', 'GRIDAK', 'grid-ak.json'))  # key in the page, placeholder, cache file
SEP = re.compile(r'\s*,?\s*')  # what follows a grid in the page: ", ", or "\n, " after a missing one, which refresh.sh fills in as "null" and a newline
USAGE = 'usage: python3 -I tests/map/tool.py page <live.html> <template.html> <pac.json|null> <out.html> | diff <a.png> <b.png> | grids <live.html> <dir>'


def read(path):
    with open(path, encoding='utf-8') as f: return f.read()


def json_at(text, at):
    # The JSON value that starts at text[at], as the text it was written as.
    return text[at:json.JSONDecoder().raw_decode(text, at)[1]]


def live(text):
    # What refresh.sh filled into the live page, by placeholder name: DATA, WOTW (the photo) and the country grids GRID (West Pacific), GRIDCA, GRIDHI, GRIDAU, GRIDID, GRIDNW, GRIDNZ, GRIDPI, GRIDAK ("null" for a missing one).
    # The grids sit in "GRID = {wp: ..., ca: ..., hi: ..., au: ...}" (or "RAW = {...}" in a page that also carries the Pacific grid, and nw: after au
    # once it carries the Pacific Northwest's, with id: between them once it carries Indonesia's, nz: after nw once it carries New Zealand's, pi: after nz once it carries the South Pacific's, and ak: after pi once it carries Alaska's).
    photo, start = re.search(r'<img src="(data:image/jpeg;base64,[^"]*)" alt="Wave of the week', text), re.search(r'\b(?:GRID|RAW) = \{', text)
    if not (photo and start and 'const ALL = ' in text): sys.exit('not a WaveSlave page: no data, photo or country grids found')
    out = {'DATA': json_at(text, text.index('const ALL = ') + len('const ALL = ')), 'WOTW': photo.group(1)}; i = start.end()
    for key, name, _ in GRIDS:  # {wp: <grid>, ca: <grid>, hi: <grid>, au: <grid>, id: <grid>, nw: <grid>, nz: <grid>, pi: <grid>, ak: <grid>}
        if key in ('id', 'nw', 'nz', 'pi', 'ak') and not text.startswith(key + ': ', i): out[name] = 'null'; continue  # a page from before Indonesia, the Pacific Northwest, New Zealand, the South Pacific or Alaska
        if not text.startswith(key + ': ', i): sys.exit('live page: the country grids are not in the order wp, ca, hi, au, id, nw, nz, pi, ak')
        out[name] = json_at(text, i + len(key) + 2); i = SEP.match(text, i + len(key) + 2 + len(out[name])).end()
    return out


def page(live_html, template, pac, out):
    fill = live(read(live_html)); fill['GRIDPAC'] = 'null' if pac == 'null' else read(pac)
    html = read(os.path.join(ROOT, 'web', 'head.html')) + re.sub(r'__(DATA|WOTW|GRIDCA|GRIDHI|GRIDAU|GRIDID|GRIDNW|GRIDNZ|GRIDPI|GRIDAK|GRIDPAC|GRID)__', lambda m: fill[m.group(1)], read(template))
    with open(out, 'w', encoding='utf-8') as f: f.write(html)
    print('wrote %s (%d bytes)' % (out, len(html.encode('utf-8'))))


def diff(a, b):
    from PIL import Image, ImageChops
    x, y = Image.open(a).convert('RGB'), Image.open(b).convert('RGB')
    if x.size != y.size: sys.exit('diff: the pictures differ in size, %dx%d and %dx%d' % (x.size + y.size))
    r, g, c = ImageChops.difference(x, y).split()
    worst = ImageChops.lighter(ImageChops.lighter(r, g), c)  # the biggest channel difference at each pixel
    print('diff %.6f' % (sum(worst.histogram()[17:]) / (x.width * x.height)))  # the share of pixels where it is over 16


def grids(live_html, out):
    found = live(read(live_html)); os.makedirs(out, exist_ok=True)
    for _, name, file in GRIDS:
        if found[name] == 'null': print('the live page has no grid for %s, not written' % file, file=sys.stderr); continue
        with open(os.path.join(out, file), 'w', encoding='utf-8') as f: f.write(found[name])
        print('wrote', os.path.join(out, file))


if __name__ == '__main__':
    run = {'page': (page, 4), 'diff': (diff, 2), 'grids': (grids, 2)}.get(sys.argv[1] if len(sys.argv) > 1 else '')
    if not run or len(sys.argv) - 2 != run[1]: sys.exit(USAGE)
    run[0](*sys.argv[2:])
