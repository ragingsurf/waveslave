# The map's outlines for the rest of the Pacific: Natural Earth 50 m land cut to the Pacific box less the detailed West Pacific and
# California coasts, run east (0-360), simplified, and written into template.html as one COAST.push line after the Australian coastline.
# Polygons the template already draws are left out: Australia's (matched by their boxes) and Hawaii's. A one-off, not part of the build:
#   python3 -I tools/pacific_coast.py <ne_50m_land.geojson> <template.html> [--eps 0.03]
import argparse, json, sys

# The six areas, east, as (l, r, s, n): the Pacific box (100°E-110°W, 50°S-60°N) less the West Pacific (100-163°E, 5°S-50°N) and California (128-114°W, 30-43°N) coast boxes.
RECTS = ((100, 163, -50, -5), (100, 163, 50, 60), (163, 250, -50, 30), (163, 232, 30, 43), (246, 250, 30, 43), (163, 250, 43, 60))
# The lines the outlines are cut along, as the map's MAPM.CUTX and CUTY: the areas' edges, and 180° where Natural Earth splits islands.
CUTX, CUTY = (100, 163, 180, 232, 246, 250), (-50, -5, 30, 43, 50, 60)
HI = (199, 206, 18.5, 22.5)  # the Hawaii coast's box, east
AU = '  // Australian coastline:'  # the comment above the Australian push
COMMENT = '  // Rest of the Pacific: Natural Earth 50 m land, cut around the detailed coasts above, simplified (tools/pacific_coast.py).'
BUDGET = 80000  # bytes in the push line


def split180(rect):
    # The area's pieces in Natural Earth's -180..180: one either side of 180 when it crosses it.
    l, r, s, n = rect
    if r <= 180: return [rect]
    if l >= 180: return [(l - 360, r - 360, s, n)]
    return [(l, 180, s, n), (-180, r - 360, s, n)]


def clip(ring, rect):
    # Sutherland-Hodgman: the ring cut to the rect one edge at a time, and closed again (empty when nothing is left).
    # A point made on an edge takes the edge's own value, so it lies exactly on the cut line.
    l, r, s, n = rect; pts = ring[:-1] if ring[0] == ring[-1] else list(ring)
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


def east(ring):
    # Longitudes east, 0-360: -179.5 is 180.5 and -180 is 180, so an area's two pieces either side of 180 meet there again.
    return [[x + 360 if x < 0 else x, y] for x, y in ring]


def oncut(p):
    return any(abs(p[0] - x) < 1e-6 for x in CUTX) or any(abs(p[1] - y) < 1e-6 for y in CUTY)


def dist(p, a, b):
    # How far p is from the segment a-b (from a, when a and b are one point).
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0, min(1, ((p[0] - a[0])*dx + (p[1] - a[1])*dy)/(dx*dx + dy*dy))) if dx or dy else 0
    return ((p[0] - a[0] - t*dx)**2 + (p[1] - a[1] - t*dy)**2)**.5


def dp(line, eps):
    # Douglas-Peucker on an open line, both ends kept; a stack rather than recursion, for the long coasts.
    keep, todo = {0, len(line) - 1}, [(0, len(line) - 1)]
    while todo:
        i, j = todo.pop()
        if j - i < 2: continue
        d, m = max((dist(line[k], line[i], line[j]), k) for k in range(i + 1, j))
        if d > eps: keep.add(m); todo += [(i, m), (m, j)]
    return [line[k] for k in sorted(keep)]


def simplify(ring, eps):
    # Douglas-Peucker between the ring's vertices on a cut line, which all stay, so each cut segment keeps exactly to its line.
    # A ring with none is taken from its first point round to itself.
    pts = ring[:-1]; at = [i for i, p in enumerate(pts) if oncut(p)] or [0]; out = []
    for i, j in zip(at, at[1:] + [at[0] + len(pts)]): out += dp([pts[k % len(pts)] for k in range(i, j + 1)], eps)[:-1]
    return out + out[:1]


def num(v):
    v = round(v, 2); return int(v) if v == int(v) else v  # 163, not 163.0


def tidy(ring):
    # To 0.01, with repeated points dropped.
    out = []
    for x, y in ring:
        p = [num(x), num(y)]
        if not out or p != out[-1]: out.append(p)
    return out


def box(ring):
    xs, ys = [x for x, y in ring], [y for x, y in ring]
    return min(xs), max(xs), min(ys), max(ys)


def skipped(bbox, au_bboxes):
    # A polygon the detailed coasts already draw: one of the Australian push's own (its box within 0.05° on every side), or one inside the Hawaii box.
    l, r, s, n = bbox
    return any(all(abs(a - b) <= 0.05 for a, b in zip(bbox, q)) for q in au_bboxes) or (HI[0] <= l and r <= HI[1] and HI[2] <= s and n <= HI[3])


def rings(land):
    # Natural Earth's outer rings, -180..180 (holes left out).
    with open(land, encoding='utf-8') as f: features = json.load(f)['features']
    for f in features:
        g = f['geometry']
        for p in [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']: yield p[0]


def main(land, template, eps):
    with open(template, encoding='utf-8') as f: lines = f.read().split('\n')
    a = next((i for i, l in enumerate(lines) if l.startswith(AU)), None)
    if a is None or not lines[a + 1].startswith('  COAST.push(...['): sys.exit('%s: no Australian coastline push found' % template)
    au = [box(r) for r in json.loads(lines[a + 1][len('  COAST.push(...'):-len(');')])]
    out, skip = [], {'Australian': 0, 'Hawaiian': 0}
    for ring in rings(land):
        b = box(east(ring))
        if skipped(b, au): skip['Hawaiian' if skipped(b, []) else 'Australian'] += 1; continue
        for piece in (p for rect in RECTS for p in split180(rect)):
            c = clip(ring, piece)
            if not c: continue
            r = tidy(simplify(east(c), eps))
            if len(r) >= 4: out.append(r)
    push = '  COAST.push(...%s);' % json.dumps(out, separators=(',', ':'))
    size = len(push.encode('utf-8'))
    print('%d bytes, %d rings (eps %g); skipped %d Australian and %d Hawaiian polygons' % (size, len(out), eps, skip['Australian'], skip['Hawaiian']))
    if size > BUDGET: sys.exit('the push line is over %d bytes: try a bigger --eps' % BUDGET)
    if COMMENT in lines: c = lines.index(COMMENT); lines[c:c + 2] = [COMMENT, push]  # replaced in place
    else: lines[a + 2:a + 2] = [COMMENT, push]  # after the Australian push
    with open(template, 'w', encoding='utf-8') as f: f.write('\n'.join(lines))
    print('wrote', template)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description='Natural Earth outlines for the rest of the Pacific, into template.html')
    p.add_argument('land', help='ne_50m_land.geojson'); p.add_argument('template', help='template.html')
    p.add_argument('--eps', type=float, default=0.03, help='Douglas-Peucker tolerance in degrees (default 0.03)')
    a = p.parse_args(); main(a.land, a.template, a.eps)
