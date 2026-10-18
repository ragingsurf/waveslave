# One Pacific map for WaveSlave: design

Date: 2026-10-17. Status: approved by Bryan (2026-10-17). Plan: `docs/superpowers/plans/2026-10-17-pacific-map.md`.

## Goal

Today the Map tab is four separate maps: Taiwan and Japan share the West Pacific map, and California, Hawaii and
Australia each have their own. Changing between them reloads the page, and you can't zoom out past your own region
(`template.html` `mapRegion`, `switchSpot`). The goal is one map of the whole Pacific with all five countries on it,
and live wind, waves, swell, rain and pressure across the open ocean between them, so a swell can be watched crossing
from one coast to another.

Decisions so far (Bryan, in the project thread):

- Live weather across the whole ocean, not just country markers on a blank sea.
- A coarse Pacific-wide layer with the existing detailed country grids kept on top, not one fine grid everywhere and
  not detail loaded on zoom.
- The look and behaviour (part 1) and the data and refresh (part 2) below, as presented.

Defaults I picked (say if you want otherwise):

- Web-map (Mercator) projection, so every country keeps its shape at any zoom.
- Zooming out stops when the whole Pacific box fits on the screen. On a phone held upright that leaves plain dark sea
  above and below the box. Changed on 2026-10-18 at Bryan's request: zooming out now stops when the box fills the
  screen, so no dark sea shows. Upright that is the box's whole height, with the rest a swipe sideways; sideways it is
  the box's whole width.
- Change from part 2: inland points are not left out after all. Skipping them would save only a few percent of
  Open-Meteo calls, and it would leave holes in the wind and pressure over land, which would break the pressure lines
  at the coast.

## What you see

- **Opening the map** still shows your current country. With a saved view it opens where you left it, as today. With
  no saved view it opens on the area your country's old map covered (West Pacific for Taiwan and Japan, the
  California, Hawaii and Australia boxes for those), so first opens look as they do now.
- **Zooming out** goes all the way to the whole Pacific: Taiwan, Japan, Hawaii, California and Australia, plus
  everything between them (the Philippines, Indonesia, PNG, New Zealand, the Pacific islands, Alaska and the
  Aleutians).
- **Colours, streaks, swell lines and pressure lines** run across the open ocean from the Pacific layer. Near each
  country they switch smoothly to that country's detailed grid, and near each spot to the spot's own data, exactly as
  today. Zoomed in on a country, the map looks the same as it does now.
- **Spots from every country** show on the one map. Tapping a spot in another country opens its table and switches
  the page to that spot without a reload.
- **The country buttons** never reload the page. The map opens centred on the new country.
- **The home button** works as today, now at Pacific scale. One tap zooms out to the whole Pacific, and a second tap
  goes back to the current country. Since 2026-10-18 the first tap zooms all the way out around where you are, as far
  as the screen-filling limit above allows. Both moves glide there in under a second instead of jumping. With reduced motion
  turned on, they jump.
- **The dateline is seamless.** Panning east from Japan carries on past 180° to Hawaii and California. A dropped
  pin's label reads °E or °W correctly.
- **Pressure lines** come from one grid at a time. If the view sits inside a country's detailed grid and isn't wider
  than it (any view you could see today), the lines come from that grid. Otherwise they come from the Pacific layer.
  Highs and lows are marked the same way.
- **Coastlines.** The detailed coasts stay as they are: Taiwan's own outline, the West Pacific, California, Hawaii and
  Australia. Simpler Natural Earth outlines are added for the rest of the Pacific rim and the islands, cut away where
  a detailed coast already covers the area. Where an outline was cut at a box edge, that straight edge is not drawn
  as coast, so no false coastline appears across Siberia, Borneo or Mexico when zoomed out.

## Data

| What | Value |
|---|---|
| Pacific layer area | 50°S to 60°N, 100°E to 110°W (crossing the dateline) |
| Spacing | 5°: 23 rows × 31 columns = 713 points |
| Source | Open-Meteo wind, pressure and rain (`api.open-meteo.com/v1/forecast`) and waves and swell (`marine-api`, `meteofrance_wave`), the same requests as the current grids |
| Time steps | every 6 hours for 10 days (fetched 3-hourly, every second step kept) |
| Size on the page | about 420 KB (713 points × 40 steps × 11 bytes, base64), worked out from today's West Pacific grid (`cache/grid.json`: 336 points, 80 steps, 394 KB) |
| Refresh | when the saved grid is older than about 6 hours, and never in the same run that refetches the West Pacific grid, so the two biggest requests don't land together |
| Open-Meteo calls | about 5,700 location-calls a day (713 points × 2 APIs × 4 a day), on top of about 12,700 a day for the four existing grids |

The country grids are unchanged: West Pacific 3°, California and Hawaii 1°, Australia 2°, all with 3-hour steps.

## Architecture

1. **pacific.sh** (new), called from refresh.sh next to the existing `regrid` calls, writes `cache/grid-pac.json`.
   Each API is requested in two chunks of rows (rows 0–11 and 12–22: 372 and 341 points, close to today's 336-point
   West Pacific request). Longitudes past 180 go out as negative, because Open-Meteo refuses anything outside −180
   to 180 (checked 2026-10-17). The two chunks are joined back in order. The page gets the grid through a new
   `__GRIDPAC__` placeholder in the existing template-filling step.
2. **grid.py**: an optional `every` argument that keeps every n-th time step and writes `dt` to match (6 for the
   Pacific layer). Grid longitudes run east from `lon0 = 100` past 180 to 250, so the grid has no break at the
   dateline. Called without the argument, it gives byte-identical output for the existing grids.
3. **template.html, map**:
   - **Longitudes**: inside the map, every longitude runs east from 0 to 360, so California is at 241.5 rather than
     −118.5. Spots, coastlines, grid origins, typhoon tracks and saved views are converted on load. The pin's live
     Open-Meteo request and its label convert back.
   - **Projection**: Mercator. `z` becomes pixels per degree of longitude. Every screen-to-map conversion goes
     through `px`/`ll`, including the places that do their own maths today: pan, pinch, `zoomAt`, `clampView`, the
     colour-field cells, the Taiwan relief image and the streak shift on pan. The region-wide `KX` goes; distances
     for spot blending use the cosine of the point's own latitude. Each country's home zoom is set so the home view
     matches today's.
   - **Grids**: the code that today serves one `GRID` (unpacking a time step, reading wind, waves, swell, rain and
     pressure at a point) is turned into a small per-grid object, made once for each of the five grids. A lookup
     uses the finest grid covering the point. Within two of that grid's own steps of its edge, it fades into the
     next coarser grid, so there is no seam. Each grid uses its own nearest time step. Between the ocean layer's
     6-hour steps it shows the nearest one, while the country grids keep their 3-hour steps. The existing spot blending sits on top
     unchanged.
   - **View**: `REGION`, `mapRegion` and the cross-region reload in `switchSpot` go. The zoom-out limit becomes "the
     whole Pacific box fits" ("the box fills the screen" since 2026-10-18). Saved-view keys stay the same per country (`waveslave-mapview`, `-ca`, `-hi`,
     `-au-w`, `-au-e`), so the views people have saved carry over, with old negative longitudes converted.
   - **Coast drawing**: the map keeps the list of lines the outlines were cut along (box edges, and 180° where
     Natural Earth splits islands). Segments lying exactly on one of those lines are left out of the stroke but kept
     in the land fill. Outlines entirely off screen are skipped while drawing.
4. **Coastline data**: a one-off script, not part of the build, cuts Natural Earth 50 m land to the Pacific box
   minus the detailed areas and simplifies it to stay under about 80 KB. The result goes into `template.html` next
   to the other coasts, the same way they were added.
5. **No change** to `.github/workflows/refresh.yml`, `logstore.sh` or anything under `log*/`. The new grid file lives
   in `cache/`, which the Action already carries between runs under the same path list. The forecast-vs-buoy logs
   carry across exactly as now.

## Error handling

- Pacific fetch fails: the last good `grid-pac.json` is kept, as for every grid, and the build never fails on it.
- No Pacific grid at all (first run, or a lost cache): the page gets `null`. The map still zooms out to the Pacific
  box, the country grids and spots show as today, and the open ocean is blank.
- A country grid missing: the Pacific layer covers that country at 5° instead of leaving a hole.
- One Pacific chunk fails: the whole Pacific grid keeps its last good copy rather than half a new one.

## Testing

- `tests/test_grid.py` (unittest, like the others):
  - the request coordinates for the two chunks, with longitudes past 180 written as negative;
  - joining the chunks back in order;
  - `every=2` keeping every second step with `dt = 6`;
  - the output header's `lon0` running past 180;
  - the existing grids' output unchanged without `every`.
- Map checks in a headless browser:
  - `px`/`ll` round trips across the dateline;
  - the finest-grid choice and the edge fade at a few chosen points;
  - no reload when switching country.
- Phone screenshots, upright and sideways:
  - zoomed all the way out in each layer;
  - a swell crossing the dateline;
  - each country's home view on `main` and on this branch side by side, which should match apart from tiny
    projection differences.
- After one build, every `log*/` folder holds the same files it did before, and `cache/grid-pac.json` exists.

## Out of scope

No new spots, countries or data sources. The Forecast tab, the typhoon and hurricane panels, and the country grids'
detail and refresh stay as they are. No country switch inside the map itself.
