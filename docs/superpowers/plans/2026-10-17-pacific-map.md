# One Pacific Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Map tab's four regional maps into one Mercator map of the Pacific (50°S–60°N, 100°E–110°W). It gets a 5° six-hourly Open-Meteo layer under the existing country grids, no page reloads between countries, and outlines for the rest of the Pacific.

**Architecture:**
- **Data:** a new `pacific.sh` fetches the Pacific layer through `grid.py` into `cache/grid-pac.json`. `grid.py` gains coordinate wrapping, chunk joining and step thinning. The build fills the grid into the page as `__GRIDPAC__`.
- **Page:** in `template.html`, a new `MAPM` block of plain functions sits just before the map's `WS` closure. It covers longitudes 0–360, Mercator, grid objects and layering, view boxes and coast cut lines. `WS` moves onto it in four steps: longitudes, grid layering, one map, coastlines.
- **Tests:** Node's built-in test runner checks `MAPM`, and a Playwright script checks built pages.

**Tech Stack:** POSIX sh, Python 3 stdlib (unittest), vanilla JS in `template.html`, Node 22 `node:test`, Playwright 1.56 (global, `/opt/node22/lib/node_modules/playwright`), Pillow (installed) for screenshot diffs.

**Spec:** `docs/superpowers/specs/2026-10-17-pacific-map-design.md`. One change, made in the spec with this plan: the two requests per API split by rows, not at the dateline. The sizes are the same and the joining is a plain concatenation. The reason is unchanged: Open-Meteo refuses longitudes outside −180 to 180 (checked 2026-10-17: `Longitude must be in range of -180 to 180°`).

## Global Constraints

- All work on `claude/project-thread-uza022` in `ragingsurf/waveslave`.
- No change to `.github/workflows/refresh.yml`, `logstore.sh`, `seed-log/` or anything under `log*/`. Never run `sh logstore.sh save`, and never push the `data` branch.
- Pacific layer: 50°S to 60°N, 100°E to 110°W, 5° spacing, 23 rows × 31 columns = 713 points. Kept 6-hourly (every second 3-hourly step, `dt` 6). File `cache/grid-pac.json`, placeholder `__GRIDPAC__`.
- Refresh: when `grid-pac.json` is older than 350 minutes, and never in the same run that freshly fetched the West Pacific grid. A failed fetch keeps the last good file.
- Existing grids' `grid.py` output stays byte-identical. Their requests, spacing and refresh are unchanged.
- Open-Meteo requests carry longitudes in −180..180. Inside the map every longitude runs east from 0 to 360 (California 241.5).
- Mercator projection; `z` is pixels per degree of longitude. Each country's home view keeps today's framing.
- Zoom-out stops when the whole Pacific box fits the screen. The map's own layers (colours, swell arrows, land, pressure lines, typhoon tracks) are drawn only inside the box; the spot markers, tags, towns, the open spot's dial and the pin may cross its edge.
- Saved-view keys unchanged: `waveslave-mapview` (Taiwan, Japan), `-ca`, `-hi`, `-au-w`, `-au-e`.
- A finer grid fades into the next coarser one within two of its own steps of its edge.
- Pressure lines come from the finest grid whose box contains the view (½° slack), else the Pacific grid.
- Home button: one tap zooms out to the whole Pacific, the next goes back to the country. Each move is a 700 ms glide, or a jump with reduced motion.
- Rest-of-Pacific outline data stays under 80,000 bytes. Cut edges are never stroked as coast.
- New user-facing text only where a pin's longitude reads °W.
- Code reads like the surrounding code: terse names, one-line comments in the existing voice, Taiwan and Japan behaviour untouched.
- `python3 -m unittest discover -s tests -v` passes after every task.

## Review Focus

1. **An old saved California or Hawaii map view** (stored with a negative longitude) should open on that coast, not in empty dark sea. Covered by Task 3 `savedViewConverted`.
2. **Panning across 180°** should show no seam in colours, streaks or swell lines. Covered by Task 4 `datelineSeam` and Task 5 `dateline.png`.
3. **A page with no Pacific grid** (first run or lost cache) should open the map and zoom out to the Pacific with no errors. Covered by Task 5's checks on the no-Pacific page.
4. **Tapping a spot in another country on the map** should switch to that spot and open its table with no reload. Covered by Task 5 `tapOtherCountrySpot`.
5. **A pin dropped east of 180°** should ask Open-Meteo for a −180..180 longitude and read °W. Covered by Task 3's `W180`/`lonLabel` tests and Task 5 `pinRequestWraps`.

## Test harness (made in Task 3, used by Tasks 3–7)

`$S` is a scratch folder outside the repo (your session scratchpad).

- **Live data:**
  - `mkdir -p "$S/live" && curl -fsSL -o "$S/live/index.html" https://ragingsurf.github.io/waveslave/`
  - The live page carries today's data and the four country grids.
- **Main's template:**
  - `git fetch origin main && git show origin/main:template.html > "$S/main-template.html"`
- **Pages:**
  - `python3 -I tests/map/tool.py page "$S/live/index.html" <template.html> <pac.json|null> <out.html>`
  - It writes `web/head.html` followed by the template, with the live page's data and grids filled in.
- **Screenshots and checks:** `node tests/map/check.js <page.html> <outdir> shots|checks [land]`
  - **Context:** each run uses a fresh browser context at a 390×844 phone size, or 844×390 with `land`. It uses dpr 2, touch and reduced motion, so there are no streaks and moves jump.
  - **Opening state:** it opens the map on load with intro done, view `ws`, a chosen spot, and optionally a saved view.
  - **Output:** each check prints `ok`/`FAIL`/`skip <name>`. The run exits 1 on any FAIL or page error.
- **Home views** (`shots`): saved view `{cx, cy, k: 1}`, which works on main and on the branch:

  | Name | Spot | Key | Saved view |
  |---|---|---|---|
  | `tw` | donghe | `waveslave-mapview` | 120.9, 23.75 |
  | `jp` | ichinomiya | `waveslave-mapview` | 135.6, 33.4 |
  | `ca` | trestles | `-ca` | −119.5, 35.3 |
  | `hi` | pipeline | `-hi` | −157.3, 20.6 |
  | `au-e` | snapper | `-au-e` | 152, −32.5 |
  | `au-w` | margaret | `-au-w` | 115.5, −32.5 |

  Each is saved as `<outdir>/<name>.png`, an element shot of `#wsBox`.
- **Diff:** `python3 -I tests/map/tool.py diff a.png b.png` prints `diff <fraction>`, the share of pixels with any channel off by more than 16.

---

### Task 1: grid.py: request coordinates, chunks, 6-hourly steps

**Files:**
- Modify: `grid.py` (functions plus `main`; usage comment updated)
- Create: `tests/test_grid.py`, `tests/fixtures/grid/wind.json`, `tests/fixtures/grid/wave.json`, `tests/fixtures/grid/out.json`

**Interfaces:**
- Produces:
  - **`coords`:** `coords(lat0, dlat, nlat, lon0, dlon, nlon, rows=None) -> (list[str], list[str])`
    - Row-major lists for `range(*rows)` rows, all rows by default.
    - lat is `str(round(lat0 + i*dlat, 2))`.
    - lon is `str(round(((lon0 + j*dlon + 180) % 360) - 180, 2))`, so 180 becomes `-180.0` and 185 becomes `-175.0`.
  - **`pack`:** `pack(wind, wave, lat0, dlat, nlat, lon0, dlon, nlon, every=1) -> dict`
    - Today's output dict.
    - Trailing steps with no wave data are trimmed first, then every `every`-th step is kept.
    - `dt = 3*every`, `nt` = steps kept, and header `lon0` is exactly as given.
  - **Main command:** `python3 -I grid.py <wind[,wind…]> <wave[,wave…]> <out.json> <lat0> <dlat> <nlat> <lon0> <dlon> <nlon> [every]`. Comma-separated files are concatenated in order.
  - **`coords` command:** `python3 -I grid.py coords <lat0> <dlat> <nlat> <lon0> <dlon> <nlon> <row0> <row1>` prints the comma-joined lats, then on a second line the lons.

- [ ] **Step 1: Make the fixtures with today's grid.py, before any edit**
  - **Shape:** 2 rows × 3 columns, 6 times every 3 h from `2026-10-17T00:00`.
  - **Wind, point n at step k:** `wind_speed_10m` n+k, `wind_direction_10m` 30n+10k, `pressure_msl` 1000+n+0.05k, `precipitation` 0.25k.
  - **Wave, point n at step k:** `wave_height` 0.5+0.1n, `wave_direction` 45n, `swell_wave_height` 0.3n, `swell_wave_direction` 20k, `swell_wave_period` 8+n.
  - **Gaps:** point 4 step 2 wind speed is `null`, and every wave value at step 5 is `null`.
  - **Golden file:** `python3 -I grid.py tests/fixtures/grid/wind.json tests/fixtures/grid/wave.json tests/fixtures/grid/out.json 30 1 2 -128 1 3`

- [ ] **Step 2: Write the failing tests** in `tests/test_grid.py`, in the style of `tests/test_logsplit.py`:
  - **`test_unchanged_without_every`:** the step-1 command now writes bytes identical to `out.json`.
  - **`test_coords_wrap_dateline`:** for `coords(-50, 5, 23, 100, 5, 31, (0, 1))`:
    - lats are `['-50.0']*31`;
    - `lons[0] == '100.0'`, `lons[15] == '175.0'`, `lons[16] == '-180.0'`, `lons[17] == '-175.0'` and `lons[30] == '-110.0'`.
  - **`test_coords_rows`:**
    - `coords(-50, 5, 23, 100, 5, 31, (12, 23))` has 341 entries, with `lats[0] == '10.0'` and `lats[-1] == '60.0'`;
    - `coords(30, 1, 13, -128, 1, 13)` has 169 entries, with `lons[0] == '-128.0'`.
  - **`test_every_two`:** `pack(<fixtures>, 30, 1, 2, -128, 1, 3, every=2)` gives:
    - `dt == 6`, `nt == 3` and `t0 == '2026-10-17T00:00'`;
    - b64 bytes 24–47 equal to bytes 48–71 of `every=1`;
    - the other fields thinned the same way: decoded `sb64` 54 bytes, `pf64` 36, `pb64` 18 and `rb64` 18.
  - **`test_chunks_join`:** wind and wave split into rows `[0:3]` and `[3:6]` in temp files, then run with `a.json,b.json`, give output identical to `out.json`.
  - **`test_lon0_kept`:** `pack(<fixtures>, -50, 5, 2, 175, 5, 3)` gives header `lon0 == 175` and `lon0 + 2*dlon == 185`.

- [ ] **Step 3: Run them.**
  - Run: `python3 -m unittest tests.test_grid -v`
  - Expected: ERROR. `import grid` runs today's script on import, so it has no `coords` or `pack`.

- [ ] **Step 4: Implement** `coords`, `pack` and `main` (dispatching on `argv[1] == 'coords'`) under `if __name__ == '__main__':`. Leave the packing code byte-for-byte equivalent for `every=1`.

- [ ] **Step 5: Run the tests.**
  - Run: `python3 -m unittest discover -s tests -v`
  - Expected: all OK.

- [ ] **Step 6: Commit:** "grid.py: wrap request longitudes, join chunks, keep every n-th step"

### Task 2: pacific.sh and the build

**Files:**
- Create: `pacific.sh`
- Modify, all in `refresh.sh`:
  - the West Pacific grid block (~L96–103);
  - after `regrid au …` (~L116);
  - the null fallbacks (~L117–120);
  - the template-fill line (~L140).

**Interfaces:**
- Consumes: the Task 1 commands.
- Produces: `cache/grid-pac.json`, a `grid.py` JSON with lat0 −50, dlat 5, nlat 23, lon0 100, dlon 5, nlon 31, dt 6. Also produces the `__GRIDPAC__` fill (the JSON, or `null`).

- [ ] **Step 1: Write `pacific.sh`.**
  - **Usage:** `sh pacific.sh <cachedir>`. Header comment in the style of `refresh.sh`. `set -e`.
  - **Temp folder:** `T=<cachedir>/pac.tmp`, removed at start and on exit (`trap 'rm -rf "$T"' EXIT`).
  - **Requests:** for each row chunk `0 12` and `12 23`:
    - get lats and lons from `grid.py coords -50 5 23 100 5 31 <r0> <r1>`;
    - make one forecast and one marine request with exactly the West Pacific block's curl options and query strings.
  - **Packing:** `grid.py "$T/w0.json,$T/w1.json" "$T/v0.json,$T/v1.json" "$T/grid.json" -50 5 23 100 5 31 2`.
  - **Install:** `mv` the result to `<cachedir>/grid-pac.json`. Any failure exits non-zero and leaves the old file in place.

- [ ] **Step 2: Wire it into `refresh.sh`.**
  - **Flag:** `WPNEW=` before the West Pacific block, and `&& WPNEW=1` after its `mv`.
  - **Call:** after `regrid au …`, a comment line and then:
    `[ -n "$WPNEW" ] || [ -n "$(find "$G/grid-pac.json" -mmin -350 2>/dev/null)" ] || sh "$HERE/pacific.sh" "$G" || echo "pacific grid fetch failed, keeping last grid" >&2`
  - **Null fallback:** `GP` falls back to null like `GA`.
  - **Fill:** the fill line gains `.replace('__GRIDPAC__',open(sys.argv[9]).read())`, with `"$GP"` as its 9th argument.
  - **Syntax check:** `sh -n pacific.sh && sh -n refresh.sh` prints nothing.

- [ ] **Step 3: Fetch it live once.**
  - Run: `mkdir -p "$S/cache" && sh pacific.sh "$S/cache"`
  - Then check it with a Python one-liner. Expected:
    - `nlat` 23, `nlon` 31, `lon0` 100.0, `dt` 6, and 38 ≤ `nt` ≤ 40;
    - decoded `b64` length is `nt*713*4`;
    - at least 60% of wave-height bytes are not 255.
  - Keep `$S/cache/grid-pac.json` for later tasks.

- [ ] **Step 4: Check the failure path.**
  - Make a fake `curl` that exits 22 in `$S/fakebin`.
  - Run: `cp "$S/cache/grid-pac.json" "$S/keep.json"; PATH="$S/fakebin:$PATH" sh pacific.sh "$S/cache"; echo $?`
  - Expected:
    - the exit code is not 0;
    - `cmp "$S/keep.json" "$S/cache/grid-pac.json"` reports no difference;
    - no `pac.tmp` is left behind.

- [ ] **Step 5: Commit:** "Pacific map layer: pacific.sh, refreshed every ~6 h into the page"

### Task 3: Longitudes 0–360 in the map, MAPM block, test harness

**Files:**
- Modify: `template.html`
  - **New block:** `MAPM`, between `switchCountry` and `const WS`, opening with `// ---- Map maths` and ending with `// ---- end map maths`.
  - **Inside `WS`:**
    - `HOMES`;
    - the coast conversion right after `COAST.push(...TWGEO.coast)`;
    - `spots()`, `openSheet`, `tracks`, `lastView`, `pinLive`, the pin sheet label and the `clampView` fallback boxes;
    - a test hook.
- Create: `tests/map/mapmath.test.js`, `tests/test_mapjs.py`, `tests/map/tool.py`, `tests/map/check.js`

**Interfaces:**
- Produces:
  - **Longitudes:** `MAPM.E(lon)` (`lon < 0 ? lon + 360 : lon`) and `MAPM.W180(lon)` (`lon > 180 ? lon - 360 : lon`).
  - **Pin label:** `MAPM.lonLabel(lon)`, for example `"118.50°W"` or `"121.31°E"`.
  - **Test hook:** `window.__ws = {px, ll, view}`, with `view() -> {cx, cy, z, z0, zmin, W, H}`.
  - **Harness:** `tests/map/tool.py` (`page`, `diff`, `grids <live.html> <dir>`) and `tests/map/check.js`, as described under Test harness.
- **Node test loading:** `mapmath.test.js` reads `template.html` and slices out the text from `// ---- Map maths` to `// ---- end map maths`. It loads `MAPM` with `new Function(code + "\nreturn MAPM;")()`.
- **Python wrapper:** `tests/test_mapjs.py` runs `node --test tests/map/mapmath.test.js` and asserts exit 0, skipping when `node` is missing.

- [ ] **Step 1: Write the failing tests.**
  - **`E and W180`:** `E(-118.5) === 241.5`, `E(120) === 120`, `W180(241.5) === -118.5`, `W180(180) === 180`.
  - **`lonLabel`:** `lonLabel(241.5) === "118.50°W"` and `lonLabel(121.31) === "121.31°E"`.
  - Add the Python wrapper.
  - Run: `python3 -m unittest tests.test_mapjs -v`. Expected: FAIL (no Map maths block).

- [ ] **Step 2: Add the MAPM block** with `E`, `W180` and `lonLabel`. Run the same command. Expected: PASS.

- [ ] **Step 3: Move the map onto longitudes 0–360.**
  - **Homes:** `HOMES.ca.cx` becomes 240.5 and `HOMES.hi.cx` becomes 202.7.
  - **Converted points:** every coast point, spot (`spots()` `lon`), `openSheet` centre, and typhoon track point and storm position go through `MAPM.E`.
  - **Old saved views:** `lastView()` adds 360 to a saved `cx < 0`.
  - **Pin:** `pinLive` sends `MAPM.W180(lon).toFixed(3)`, and the pin label uses `MAPM.lonLabel`.
  - **Fallback boxes:** the `clampView` fallbacks become ca `[232, 244, 30, 42]` and hi `[198, 208, 15, 26]`.
  - **Temporary,** until Task 4 replaces it: `if (GRID) GRID.lon0 = MAPM.E(GRID.lon0);`.
  - **Hook:** set `window.__ws` after `ll`.

- [ ] **Step 4: Build the harness** (`tool.py`, `check.js`) with two checks:
  - **`savedViewConverted`:** spot trestles with `-ca` saved as `{cx: -119.5, cy: 35.3, k: 1}` opens with `|view().cx - 240.5| < 1e-9`.
  - **`roundTrip`:** on that page, `ll(px(241.5, 33.4))` comes back within 1e-9.

- [ ] **Step 5: Run the checks against main.**
  - Build `branch.html` (this template, `null`) and `main.html` (main's template, `null`).
  - Run `node tests/map/check.js "$S/branch.html" "$S/t3" checks`. Expected: `ok` for both checks.
  - Run `shots` for both pages, then `tool.py diff` on each of the 6 home views. Expected: every `diff ≤ 0.005`.

- [ ] **Step 6: Commit:** "Map: longitudes run east 0–360 inside the map; map test harness"

### Task 4: Grid objects and layering

**Files:**
- Modify: `template.html`
  - **MAPM:** add `pt`, `mkGrid`, `fade`, `layered`, `isoPick`.
  - **WS data:** `const RAW = {wp: __GRID__, ca: __GRIDCA__, hi: __GRIDHI__, au: __GRIDAU__, pac: __GRIDPAC__};` and `GRIDS` replace `GRID`, `GB`, `GRB`, `GSB`, `GPB`, `GPF`, `gk`, `GU…GWD`, `ISO` and `ISOC`.
  - **WS functions that change:** `gridAt`, `gridVal`, `swellAt`, `waveAt`, `presAt`, `isoField`, `isoSegs`, `warm`, `isobars`, `pinFromGrid`, `pinCols`, `build`.
  - **Region view:** the view code reads the region's grid object `VG`.
- Modify: `tests/map/mapmath.test.js`, `tests/map/check.js`

**Interfaces:**
- Consumes: `MAPM.E`.
- Produces:
  - **`MAPM.pt(s) -> ms`:** today's `pt` (Taipei wall clock). `WS` uses it.
  - **`MAPM.mkGrid(name, G) -> Grid | null`:** `null` when `G` is null. Fields:
    `{name, lat0, dlat, nlat, lon0 (E), dlon, nlon, dt, nt, t0 (ms), end (ms), box: {l, r, s, n}, hasP, k}`
  - **Grid methods:**
    - `at(t)`: nearest step, `clamp(round((t - t0)/(dt*36e5)), 0, nt-1)`, unpacked only when `k` changes.
    - `val(lon, lat, key)`: today's `gridVal` maths; `"wind"` gives `{u, v}`, `"waves"`/`"swell"`/`"rain"` give `{h}`, null below weight 0.15.
    - `dir(lon, lat, kind)`: today's grid part of `swellAt`/`waveAt`, divided by the weight. `"swell"` gives `{x, y, p, h}` and `"waves"` gives `{x, y, h}`; null below weight 0.3.
    - `pres(lon, lat)`: today's `presAt`, giving `{p}` or null.
    - `iso(k = this.k)` and `segs(step, f)`: today's `isoField`/`isoSegs`, cached per step on the grid, with `HL` placed on the grid's own `lon0`.
  - **`MAPM.fade(g, lon, lat)`:** `clamp01(min(lon - l, r - lon)/(2*dlon)) * clamp01(min(lat - s, n - lat)/(2*dlat))`.
  - **`MAPM.layered(grids, lon, lat, pick, i0 = 0)`:** walks grids from `i0`.
    - Grids with fade 0 are skipped.
    - The first covering grid with fade 1 returns its own `pick` result, and a null stays null.
    - With fade w between 0 and 1, each field is `w*own + (1-w)*coarser`, where `coarser = layered(…, i + 1)`. When one side is null, the other is used.
  - **`MAPM.isoPick(grids, vl, vr, vb, vt)`:** the first grid other than `pac` that has `hasP` and whose box holds the view with 0.5° slack. Otherwise `pac` if it `hasP`, otherwise null.
  - **`GRIDS`:** in WS, `["hi", "ca", "au", "wp", "pac"].map(n => MAPM.mkGrid(n, RAW[n])).filter(Boolean)`, finest first.
  - **Hook additions:** `iso()` (name of the grid the last pressure lines came from, or null), `val(lon, lat, key)` (`gridVal` now) and `grids()` (names).

- [ ] **Step 1: Write the failing Node tests.** A `packGrid({lat0, dlat, nlat, lon0, dlon, nlon, nt, dt, wind, wave, pres})` helper in the test file builds grid.py-shaped JSON.
  - **`mkGrid converts and reads`:**
    - `lon0 -128` gives `box.l === 232`;
    - between four equal points, `val` is that value;
    - outside the box it is null;
    - a 255 point is skipped.
  - **`at picks the nearest step`** with dt 6: t0+2 h gives k 0, t0+4 h gives k 1, and past the end gives nt−1.
  - **`fade`** on a fine grid with box 0–10 and step 1: (5,5) gives 1, (9.5,5) gives 0.25, (10,5) gives 0 and (11,5) gives 0.
  - **`layered`**, with that fine grid (value 1) over a coarse grid on −20..30 with step 5 (value 3):
    - (5,5) gives 1, (9.5,5) gives 2.5 and (12,5) gives 3;
    - fine null at (5,5) gives null;
    - fine null at (9.5,5) gives 3;
    - with no coarse grid, (9.5,5) gives 1.
  - **`isoPick`** with real boxes:
    - a view inside wp gives wp;
    - a view wider than wp gives pac;
    - a view inside hi gives hi;
    - no pac and a wide view gives null.
  - **`mkGrid null`** gives null.
  - Run: `node --test tests/map/mapmath.test.js`. Expected: FAIL.

- [ ] **Step 2: Implement the MAPM parts.** Run the same command. Expected: PASS.

- [ ] **Step 3: Move WS onto `GRIDS`.**
  - **Readers:** `gridAt(t)` calls `at(t)` on every grid. `gridVal`, the grid parts of `swellAt`/`waveAt`, and `presAt` go through `MAPM.layered`, and directions come back from `atan2(x, y)`.
  - **Pressure lines:** `isobars()` takes its grid from `MAPM.isoPick` with `ll(0,0)`/`ll(W,H)` and remembers it for the hook. `warm()` works through that grid's steps.
  - **Time span:** `build()` and `pinCols()` end at the latest of the spots' wind and every grid's `end`.
  - **Pressure button:** the button and `iso` default use `GRIDS.some(g => g.hasP)`.
  - **Region view:** `size`, `clampView` and the home button use `VG = GRIDS.find(g => g.name === REGION)` and `VG.box`, with Task 3's fallback boxes when it is missing.

- [ ] **Step 4: Add the browser checks.**
  - **`gridsLoaded`:** `grids()` is `["hi","ca","au","wp","pac"]`, or the four without `pac` on a null page.
  - **`isoSource`:** the Taiwan home view gives `"wp"`.
  - **`datelineSeam`:** with pac loaded, `val(179.5, 30, "wind")` and `val(180.5, 30, "wind")` are both non-null, with `|Δu|` and `|Δv|` under 10. It skips without pac.

- [ ] **Step 5: Run the checks and compare views.**
  - Run `checks` on `branch.html` built with `$S/cache/grid-pac.json`, and on one built with `null`. Expected: `ok` for each check, or `skip` for `datelineSeam` without pac.
  - Run `shots` against main.
    - Expected for `tw`: `diff ≤ 0.005`.
    - For the other views, differences sit only within two grid steps of their old map edges. Confirm by looking at the pairs side by side, and note the numbers in the commit body.

- [ ] **Step 6: Commit:** "Map: five grids layered finest first, Pacific layer underneath; pressure lines pick their grid"

### Task 5: One map: Mercator, the Pacific box, no reloads

**Files:**
- Modify: `template.html`
  - **MAPM:** add `my`, `iy`, `PBOX`, `OLDBOX`, `contain`, `cover`, `clampTo`.
  - **Outside WS:**
    - drop `mapRegion` and the `cross`/`location.reload()` path in `switchSpot`;
    - update the region and reload comments at ~L471–488 and the home-button comment.
  - **Inside WS:** see Step 2.
- Modify: `tests/map/mapmath.test.js`, `tests/map/check.js`

**Interfaces:**
- Consumes: `MAPM.E`, `GRIDS`, `MAPM.isoPick`.
- Produces:
  - **Mercator:** `MAPM.my(lat)` is Mercator y in degrees of longitude, `ln(tan(π/4 + lat·π/360))·180/π`. `MAPM.iy(Y)` is its inverse.
  - **Boxes:**
    - `MAPM.PBOX = {l: 100, r: 250, s: -50, n: 60}`;
    - `MAPM.OLDBOX`, with tw and jp at `{l: 100, r: 160, s: 0, n: 45}`, ca at `{l: 232, r: 244, s: 30, n: 42}`, hi at `{l: 198, r: 208, s: 15, n: 26}` and au at `{l: 110, r: 156, s: -44, n: -20}`.
  - **Fits:** `MAPM.contain(box, W, H)` and `MAPM.cover(box, W, H)` are the min and max of `W/(r - l)` and `H/(my(n) - my(s))`.
  - **`MAPM.clampTo(box, W, H, z, cx, cy) -> [cx, cy]`:** on each axis, the y axis in Mercator y:
    - it keeps the view inside the box when the box is the larger;
    - it centres on the box when the box is smaller.
  - **WS view maths:**
    - `px(lon, lat) = [W/2 + (lon - cx)*z, H/2 - (my(lat) - my(cy))*z]` and `ll` is its inverse;
    - `homeZ(h) = H*cos(h.cy°)/h.span`, and `z0 = homeZ(HOME)`;
    - `zmin = contain(PBOX, W, H)` and the most zoom is `z0*10`;
    - `let MC` is the map's country.
  - **Hook additions:** `zoom(f)` (zoomAt about the centre) and `view().MC`.

- [ ] **Step 1: Write the failing Node tests.**
  - **`my and iy`:**
    - a round trip within 1e-9 for −60, −50, −32.5, 0, 23.75, 45 and 60;
    - `my(0) === 0`, and `|my(60) - 75.4561| < 1e-3`.
  - **`contain and cover`:**
    - `contain(PBOX, 390, 844)` is 2.6;
    - `contain(PBOX, 844, 390)` is `390/(my(60) - my(-50))`, about 2.924;
    - `cover(OLDBOX.ca, 390, 844)` is `844/(my(42) - my(30))`.
  - **`clampTo`:**
    - at `z = contain(PBOX, 390, 844)`, (120, 23.75) gives (175, `iy((my(60)+my(-50))/2)`);
    - at z 20, (95, 0) gives cx `100 + 390/2/20`.
  - Run: `node --test tests/map/mapmath.test.js`. Expected: FAIL. Implement, then run again. Expected: PASS.

- [ ] **Step 2: Move WS onto Mercator and the one Pacific box.**
  - **Region state:** remove `REGION`, `KX` and `VG`. Set `MC = spotCountry(SPOT0)`, and `home(c)` sets `MC = c` and `z0 = homeZ(HOME)`.
  - **Pan, pinch and zoom:**
    - one-finger pan and pinch pan: `cx -= dx/z; cy = iy(my(cy) + dy/z)`;
    - `zoomAt`: `cx += (nx - x)/z; cy = iy(my(cy) - (ny - y)/z)`;
    - the streak shift in `frame()`: `dx = (lastV.cx - cx)*z`, `dy = (my(cy) - my(lastV.cy))*z`.
  - **`size()`:**
    - with a saved view, it opens as today;
    - without one, `OLD = OLDBOX[MC]`, `z = MC === "au" ? max(cover(OLD), z0) : cover(OLD)` and `[cx, cy] = clampTo(OLD, W, H, z, HOME.cx, HOME.cy)`;
    - then `clampView()`, which is `z = max(zmin, min(z0*10, z)); [cx, cy] = clampTo(PBOX, …)`.
  - **`heat()`:** the cached colour canvas is laid out in longitude and Mercator y. `l`, `r` are lon and `t`, `b` are y, and a cell centre is `lat = iy(t - (j+.5)*cell/z)`. It is drawn at `(W/2 + (l - cx)*z, H/2 - (t - my(cy))*z)`.
  - **Taiwan relief:** `drawRelief` draws between the `px` of the image's NW and SE corners. `relief()` shading uses `cos(23.7°)`.
  - **Spot distances:** `blend`, `swellAt` and `waveAt` use `dx = (lon - spot lon)*cos(lat)`.
  - **Saved-view key:** `viewKey()` is `"waveslave-mapview" + (MC === "tw" || MC === "jp" ? "" : "-" + MC) + (MC === "au" ? (HOME.cx < 130 ? "-w" : "-e") : "")`.
  - **Home button:**
    - when `z > zmin*1.01`, `glide(175, iy((my(60)+my(-50))/2), zmin)`; otherwise `glide(HOME.cx, HOME.cy, z0)`;
    - `glide(tx, ty, tz)` runs 700 ms, ease-in-out cubic, cx linear, Mercator y linear, z log-linear;
    - with reduced motion it jumps;
    - a pointerdown, a wheel or a new glide cancels it.
  - **Clip:** `drawBase()` clips the map's own layers (colours, swell arrows, land, pressure lines, typhoon tracks) to the rectangle `px(100, 60)`–`px(250, -50)`; the overlays (spot markers, tags, towns, the open spot's dial, the pin) draw after it, unclipped.

- [ ] **Step 3: Add the browser checks.**
  - **`roundTripDateline`:** zoomed out, `ll(px(lon, lat))` comes back within 1e-6 for lon 175, 180, 185 and 241.5, each at lat −40, 0, 21 and 35.
  - **`zoomOutFitsPacific`:** after `zoom(1e-6)`, `z === zmin`, and `ll(0,0)`/`ll(W,H)` span at least [100, 250] × [−50, 60].
  - **`firstOpenOldBox`:**
    - for donghe with no saved view, the view sits inside `OLDBOX.tw` (±0.05) and meets it on one axis;
    - for margaret, `z === max(cover(OLDBOX.au), z0)`.
  - **`noReloadCountry`:** after `window.__mark = 1; switchCountry("hi")`:
    - `__mark === 1`;
    - `view().MC === "hi"`;
    - `|cx - 202.7| < 0.01`.
  - **`tapOtherCountrySpot`:** zoom out from donghe, then `page.mouse.click` on pipeline's `px` over `#wsFx`. Expected:
    - `CUR === "pipeline"`;
    - `__mark` survives;
    - `#wsSheet` is not hidden.
  - **`homeButton`:** from the Taiwan home view, clicking `#wsHome` gives `z === zmin`, and clicking again gives `z === z0` and `cx ≈ 120.9`.
  - **`isoSource`:** also expects `"pac"` when zoomed out.
  - **`pinRequestWraps`:** zoom out and route `**/api.open-meteo.com/**` to capture and abort. Clicking at the `px(200, 40)` sends `longitude=` in −180..180, about −160.

- [ ] **Step 4: Run the checks and take the shots.**
  - Run `checks` on the pac page. Expected: all `ok`.
  - Run `checks` on the null page. Expected: `ok` for each check, `skip` for `datelineSeam`, and `isoSource` expecting null when zoomed out.
  - Extend `shots`, only when the hook has `zoom`, with:
    - `out-wind`, `out-waves`, `out-swell`, `out-rain` (zoomed fully out, after clicking `#wsLayers button[data-o=<layer>]`);
    - `dateline.png` (swell, from the saved view `{cx: 180, cy: 35, k: 0.3}` under `waveslave-mapview`).
  - Take the shots upright and with `land`. Look at the six home views beside main's:
    - same framing and colours;
    - Japan now in its true shape, narrower east to west;
    - no seam at 180°.

- [ ] **Step 5: Commit:** "Map: one Mercator map of the Pacific, no reload between countries, home button glides"

### Task 6: Coastlines for the rest of the Pacific

**Files:**
- Create: `tools/pacific_coast.py`, `tests/test_pacific_coast.py`
- Modify: `template.html`
  - **MAPM:** add `CUTX`, `CUTY`, `cut`.
  - **WS coast:** the coast is stored as one array per outline of lon and Mercator y with its bounding box. `path(g)` fills with off-screen outlines skipped. A new `edges(g)` strokes, leaving out cut segments, and `landLayer` strokes with `edges`.
  - **Data:** the generated two lines go after the Australian coastline push.
- Modify: `tests/map/mapmath.test.js`

**Interfaces:**
- Consumes: `MAPM.E`, `MAPM.my`.
- Produces:
  - **Cut lines:** `MAPM.CUTX = [100, 163, 180, 232, 246, 250]` and `MAPM.CUTY = [-50, -5, 30, 43, 50, 60]`.
  - **`MAPM.cut(ax, ay, bx, by)`:** true when both ends share one `CUTX` x, or one `CUTY` y, within 1e-6.
  - **`tools/pacific_coast.py`:**
    - **`RECTS`:** the six areas in 0–360 east as `(l, r, s, n)`: (100,163,−50,−5), (100,163,50,60), (163,250,−50,30), (163,232,30,43), (246,250,30,43), (163,250,43,60). Together they are the Pacific box minus the West Pacific and California coast boxes.
    - **Geometry helpers:**
      - `split180(rect) -> list[rect]` gives the −180..180 pieces.
      - `clip(ring, rect) -> ring` is Sutherland–Hodgman.
      - `east(ring)` adds 360 to negative longitudes.
      - `simplify(ring, eps)` is Douglas–Peucker that never drops a vertex lying on a cut line, so each cut segment stays exactly on its line.
    - **`skipped(bbox, au_bboxes) -> bool`:** true when the bbox matches an Australian-coast polygon's bbox within 0.05° on all sides, or lies wholly inside the Hawaii box 199–206 E, 18.5–22.5 N.
    - **Command:** `python3 -I tools/pacific_coast.py <ne_50m_land.geojson> <template.html> [--eps 0.03]`.
      - It uses outer rings only.
      - It rounds to 0.01, drops repeats, and drops rings under 4 points.
      - It writes the comment `  // Rest of the Pacific: Natural Earth 50 m land, cut around the detailed coasts above, simplified (tools/pacific_coast.py).` and a `  COAST.push(...[…]);` line.
      - It replaces the pair in place, or inserts it after the Australian push line.
      - It exits 1 if the push line is over 80,000 bytes.

- [ ] **Step 1: Write the failing tests.**
  - **Python:**
    - **`test_split180`:** (163,250,−50,30) gives `[(163,180,−50,30), (−180,−110,−50,30)]`.
    - **`test_clip_keeps_edge_points`:** a square on 160–166 clipped to the first piece has every lon ≥ 163, and some equal to 163.
    - **`test_antimeridian_pieces_meet_at_180`:** rings on 179..180 and −180..−179.5, clipped and run through `east`, both have vertices at 180.
    - **`test_simplify_keeps_cut_vertices`:** a ring with a straight edge on 163 and a jagged coast keeps both ends of that edge at lon 163.
    - **`test_skip_australia_and_hawaii`:** an AU bbox match is skipped, a PNG-like bbox is kept, and a polygon inside the Hawaii box is skipped.
  - **Node `cut`:**
    - (163,10)–(163,12) is true;
    - (163,10)–(163.01,12) is false;
    - (120,−5)–(121,−5) is true;
    - (120,31)–(121,31) is false.
  - Run: `python3 -m unittest tests.test_pacific_coast -v` and `node --test tests/map/mapmath.test.js`. Expected: FAIL.

- [ ] **Step 2: Implement and generate.**
  - Implement until both pass.
  - Download Natural Earth into its own folder: `mkdir -p "$S/ne" && curl -fsSL -o "$S/ne/ne_50m_land.geojson" https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson`.
  - Run: `python3 -I tools/pacific_coast.py "$S/ne/ne_50m_land.geojson" template.html`
  - Expected: it prints the bytes (under 80,000) and the ring count. If it is over budget, rerun with `--eps 0.05`.

- [ ] **Step 3: Store and draw the coast.**
  - **Storage:** after the E conversion, each outline becomes one array of `[lon, my(lat), …]` with its box. `path` and `edges` draw from it.
  - **Culling:** outlines whose box lies wholly outside the view plus 1° are skipped.
  - **Edges:** `edges` moves rather than draws across a segment where `MAPM.cut` is true.

- [ ] **Step 4: Run the checks and take the shots.**
  - Run `checks` on the pac page. Expected: all `ok`.
  - Run `shots`: the six home views against Task 5's. Expected: each `diff ≤ 0.005`.
  - Take three more shots with saved views:
    - Sakhalin `{cx: 143, cy: 50, k: 1}`;
    - Java `{cx: 110, cy: -5, k: 1}`;
    - Baja `{cx: 245, cy: 30, k: 1}`.
  - Expected: land and coast run on across each cut, with no straight false coastline.

- [ ] **Step 5: Commit:** "Map: outlines for the rest of the Pacific, cut edges never drawn as coast"

### Task 7: Full build, logs, phone screenshots, pull request

**Files:**
- Modify: the spec's and plan's status lines only, if needed.

- [ ] **Step 1: Check tests and protected files.**
  - Run: `python3 -m unittest discover -s tests -v` and `git diff origin/main --stat -- .github logstore.sh seed-log`
  - Expected: all OK, and an empty diff.

- [ ] **Step 2: Seed a build that fetches only the Pacific layer.**
  - `cp /mnt/project-files/surf-app/cwa_key.txt cwa_key.txt` (gitignored)
  - `python3 -I tests/map/tool.py grids "$S/live/index.html" cache && touch cache/grid*.json`
  - `for d in log log-jp log-ca log-hi log-au; do sh logstore.sh restore $d; done` (read-only)
  - `ls log log-* > "$S/logs-before.txt"`

- [ ] **Step 3: Run the full build.**
  - Run: `sh build-site.sh "$S/site"`
  - Expected:
    - `site ready`;
    - `cache/grid-pac.json` exists;
    - `grep -c '"lat0":-50.0' "$S/site/index.html"` prints 1;
    - `ls log log-*` against `$S/logs-before.txt` shows only additions or changed files, none missing.

- [ ] **Step 4: Check and photograph the built page.**
  - Run: `node tests/map/check.js "$S/site/index.html" "$S/shots/final" checks`. Expected: all `ok`.
  - Run `shots`, upright and `land`.
  - Copy the final shots and the main/branch home-view pairs to `/mnt/project-files/surf-app/pacific/`.

- [ ] **Step 5: Open the pull request.**
  - Push the branch and open a PR, with:
    - the attribution block first;
    - Before/After paragraphs;
    - the shots referenced from the thread.
  - Assign `ragingsurf` and request their review. Subscribe to PR activity.
