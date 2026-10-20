# The map's coast up close where the coarse outlines are too rough for the spots (Hong Kong, Hainan, Papua New Guinea, Vanuatu, the Cape
# of Baja California): Natural Earth 10 m land cut to each of the map's DETAIL boxes (MAPM.DETAIL in template.html), simplified, and
# written into template.html as the COAST.push line after the boxes' clip-out.
# A one-off, not part of the build:
#   python3 -I tools/detail_coast.py <ne_10m_land.geojson> <template.html> [--eps 0.0005]
import argparse, json, sys

BOXES = '  const DETAIL = '  # the boxes' line in MAPM: [[l, r, s, n], ...], east
CLIPOUT = '  for (const [l, r, s, n] of MAPM.DETAIL)'  # the page's clip-out loop, which the push follows
COMMENT = '  // Up close: Natural Earth 10 m land cut to the DETAIL boxes, simplified (tools/detail_coast.py).'
BUDGET = 45000  # bytes in the push line


def clip(ring, box):
    # Sutherland-Hodgman, as tools/pacific_coast.py's: the ring cut to the box one edge at a time, and closed again (empty when nothing is left).
    # A point made on an edge takes the edge's own value, so it lies exactly on the cut line.
    l, r, s, n = box; pts = ring[:-1] if ring[0] == ring[-1] else list(ring)
    for k, v, d in ((0, l, 1), (0, r, -1), (1, s, 1), (1, n, -1)):  # axis (0 lon, 1 lat), edge, the side inside
        out = []
        for i, b in enumerate(pts):
            a = pts[i - 1]; ina, inb = (a[k] - v)*d >= 0, (b[k] - v)*d >= 0
            if ina != inb:
                q = [0, 0]; q[k] = v; q[1 - k] = a[1 - k] + (v - a[k])/(b[k] - a[k])*(b[1 - k] - a[1 - k]); out.append(q)
            if inb: out.append(b)
        pts = out
        if not pts: return []
    return pts + pts[:1]


def onedge(p, box):
    l, r, s, n = box
    return abs(p[0] - l) < 1e-9 or abs(p[0] - r) < 1e-9 or abs(p[1] - s) < 1e-9 or abs(p[1] - n) < 1e-9


def dist(p, a, b):
    # How far p is from the segment a-b (from a, when a and b are one point).
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0, min(1, ((p[0] - a[0])*dx + (p[1] - a[1])*dy)/(dx*dx + dy*dy))) if dx or dy else 0
    return ((p[0] - a[0] - t*dx)**2 + (p[1] - a[1] - t*dy)**2)**.5


def dp(line, eps):
    # Douglas-Peucker on an open line, both ends kept; a stack rather than recursion.
    keep, todo = {0, len(line) - 1}, [(0, len(line) - 1)]
    while todo:
        i, j = todo.pop()
        if j - i < 2: continue
        d, m = max((dist(line[k], line[i], line[j]), k) for k in range(i + 1, j))
        if d > eps: keep.add(m); todo += [(i, m), (m, j)]
    return [line[k] for k in sorted(keep)]


def simplify(ring, box, eps):
    # Douglas-Peucker between the ring's vertices on the box's edges, which all stay, so each cut keeps exactly to its edge.
    # A ring with none (an island inside the box) is taken from its first point round to itself.
    pts = ring[:-1]; at = [i for i, p in enumerate(pts) if onedge(p, box)] or [0]; out = []
    for i, j in zip(at, at[1:] + [at[0] + len(pts)]): out += dp([pts[k % len(pts)] for k in range(i, j + 1)], eps)[:-1]
    return out + out[:1]


def num(v, box):
    # To 0.001, except a box edge's own value, which stays as it is so the point keeps to the cut line.
    for e in box:
        if abs(v - e) < 1e-9: return e
    v = round(v, 3); return int(v) if v == int(v) else v


def tidy(ring, box):
    # Rounded, with repeated points dropped.
    out = []
    for x, y in ring:
        p = [num(x, box), num(y, box)]
        if not out or p != out[-1]: out.append(p)
    return out


def rings(land):
    # Natural Earth's outer rings, -180..180 (holes left out; none lies in a box).
    with open(land, encoding='utf-8') as f: features = json.load(f)['features']
    for f in features:
        g = f['geometry']
        for p in [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']: yield p[0]


def reaches(ring, box):
    l, r, s, n = box
    return min(x for x, y in ring) < r and max(x for x, y in ring) > l and min(y for x, y in ring) < n and max(y for x, y in ring) > s


def main(land, template, eps):
    with open(template, encoding='utf-8') as f: lines = f.read().split('\n')
    b = [i for i, l in enumerate(lines) if l.startswith(BOXES)]
    c = [i for i, l in enumerate(lines) if l.startswith(CLIPOUT)]
    if len(b) != 1 or len(c) != 1: sys.exit('%s: needs one DETAIL line and one clip-out loop' % template)
    boxes = json.loads(lines[b[0]][len(BOXES):].rstrip(';'))
    out = []
    for ring in rings(land):
        for box in boxes:  # east longitudes, as the page's outlines are by then; a box past 180° cuts Natural Earth's land on its west
            west = box[0] > 180  # longitudes (250 is -110) and moves what it keeps back east
            b = [box[0] - 360, box[1] - 360] + box[2:] if west else box
            if not reaches(ring, b): continue
            p = clip(ring, b)
            if not p: continue
            if west: p = [[x + 360, y] for x, y in p]
            r = tidy(simplify(p, box, eps), box)
            if len(r) >= 4: out.append(r)
    push = '  COAST.push(...%s);' % json.dumps(out, separators=(',', ':'))
    size = len(push.encode('utf-8'))
    print('%d bytes, %d rings in %d boxes (eps %g)' % (size, len(out), len(boxes), eps))
    if size > BUDGET: sys.exit('the push line is over %d bytes: try a bigger --eps' % BUDGET)
    at = c[0] + 2  # the loop is two lines long
    if COMMENT in lines: k = lines.index(COMMENT); lines[k:k + 2] = [COMMENT, push]  # replaced in place
    else: lines[at:at] = [COMMENT, push]
    with open(template, 'w', encoding='utf-8') as f: f.write('\n'.join(lines))
    print('wrote', template)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description='Natural Earth 10 m land for the map\'s DETAIL boxes, into template.html')
    p.add_argument('land', help='ne_10m_land.geojson'); p.add_argument('template', help='template.html')
    p.add_argument('--eps', type=float, default=0.0005, help='Douglas-Peucker tolerance in degrees (default 0.0005)')
    a = p.parse_args(); main(a.land, a.template, a.eps)
