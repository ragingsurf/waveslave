# Dream Wave Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A third tab, Dream Wave (夢幻浪), where people shape a 3D wave, ride it as a cartoon surfer styled like them, pick a scene and a camera, and share a story picture that points to waveslave.tw. Developer mode only until Bryan says go live.

**Architecture:** A small classic loader, `web/dreamwave.js`, wires the tab into `template.html` the way `web/chat.js` does (a `PUBLIC` switch, `window.DREAMWAVE` hooks called from `setView()`, `keepWorld()` and `setLang()`) and holds every label (`DW.t(key)`). On first open it loads three.js r149 from `web/vendor/` and the feature files from `web/dreamwave/`, each a classic script that adds one part to `window.DW`. The tab shows full screen, like the map. The wave model, power and flow are ported unchanged from the Neon Wave artifact; the surfer is ported from the character spike.

**Tech Stack:** Plain JavaScript (classic scripts, no build step), three.js r149 (vendored), Canvas 2D for the share picture, Web Share API, Node `node:test` for pure modules, Playwright browser checks, Python `unittest` for `build-site.sh`.

**Spec:** `docs/superpowers/specs/2026-10-29-dream-wave-design.md` (copy: `/mnt/project-files/surf-app/dream-wave/design.md`).

**Pinned sources** (copy from these, not from the live artifacts, which keep changing):
- `/mnt/project-files/surf-app/dream-wave/source/neon-wave-v17.html`: the Neon Wave, Version 17. Line numbers in this plan refer to this file: 107–272 WaveShell, 275–296 WavePower, 299–384 WaveFlow, 387–661 the renderer and its panel (`SL` sliders 570–582, `applyShape` 591, `fitLoop` 600, `STYLES` 606–613, `pickStyle` 621).
- `/mnt/project-files/surf-app/dream-wave/source/character-spike-v2.js`: the cartoon surfer (`SURFER.make(o)`).
- `/mnt/project-files/surf-app/dream-wave/source/three-0.149.0.min.js`: three.js r149 (MIT; keep its licence header).
- Looks Bryan saw: `/mnt/project-files/surf-app/dream-wave/character-lineup.png`, `character-sample.png`.

## Global Constraints

- Tab: **Dream Wave**, 中文 **夢幻浪**, the third tab after Forecast and Map, `data-v="dw"`.
- Shown only while `PUBLIC` (in `web/dreamwave.js`, `false`) or developer mode (`WORLD`) is on. No sign-in. Nothing is uploaded.
- Full screen like the map: a fixed layer over the page (`position: fixed; inset: 0; z-index: 100`, above the chat button), page scroll locked and page zoom off while it shows (as the map's `setFs` does), without asking the browser for real full screen. An amber ✕ in the top-right corner (styled like the map's full-screen `#wsFs`) and Esc go back to Forecast (Esc is left to the chat room while it is open, as the map does). Opening and leaving are instant, with no slam.
- Every label in English and 中文 from the Strings table, through `DW.t(key)`, following the page language (`LANG`; anything but `zh` shows English). Inside the layer, never use `data-zh` (`applyLang()` rewrites those). The tab button itself sits in the page's nav and uses `data-zh`/`data-ja` like its neighbours.
- Nothing 3D loads before the tab first opens. Rendering stops whenever the tab is hidden.
- Style: WaveSlave 90s metal. Titles and the caption in "Metal Mania" with the logo's fire (stops 0 `#fff7b0`, .28 `#ffd400`, .55 `#ff8a00`, .78 `#ff3d00`, 1 `#b80000`; outline `#200300`; glow `rgba(255,60,0,.7)`). Numbers in "VT323", amber `#ffcf5c` with an orange glow. Panels in the site's dark colours in both themes (panel `#0d232b`, line `#1d3a44`, text `#e3f0f0`). The page already loads both fonts.
- The scene that opens first is Neon, until Bryan picks one at the Task 10 checkpoint.
- Share picture: 1080 × 1920. Wordmark "WaveSlave" and "waveslave.tw" in the top-left corner; the caption ("My dream wave: 3.2 m Slab", "Custom" when no style matches) and the optional name or IG handle at the bottom; nothing drawn above y = 280 or below y = 1640 (Instagram story safe area).
- Shared text: `https://waveslave.tw/#dreamwave`. That address opens the tab when the tab is on.
- localStorage key `waveslave-dreamwave`, read and written inside try/catch. A saved value is used only for a key the defaults have and only when it is valid (a number inside its slider's range, a value from its option list); anything else falls back to the default.
- Phones (shorter side < 600 px): wave station spacing 0.25 m (0.2 m otherwise), pixel ratio ≤ 2, half the flow tracers (360 instead of 650) and half the particles.
- Commit messages end with the session's attribution lines.

## Review Focus

- Developer mode switched off while the tab is showing: the page goes back to Forecast and the render loop stops (Task 3 `devOffLeavesTab`, Task 4 `pausesWhenHidden`).
- Opening and closing the tab many times, or changing the surfer many times: one canvas and one WebGL renderer per visit, geometry count steady (Task 4 `reopenKeepsOneRenderer`, Task 8 `rebuildKeepsMemorySteady`).
- What the phone remembered is missing, broken, or from an older build (missing keys, a value no longer offered): the tab opens and fills the gaps with defaults (Task 5 `brokenStorageUsesDefaults`, `oldSavedStateFillsGaps`; Task 8 `makerIgnoresUnknownSaved`).
- Extreme sliders (Size 6, Lip throw 6, Steepness 115, Hollowness −1, Length 5, Peel 10): the surfer stays on the face with no NaN (Task 7 `spotStaysOnFaceAtExtremes`).
- A browser that can't share files (LINE's in-app browser, desktop Firefox), an iPhone, or a cancelled share: Save still gives the person the picture and no error shows (Task 12 `shareFallsBackToSave`).

## Strings (English / 中文)

Keys for list items are `<group>_<id>` with the ids from Tasks 1, 6, 9 and 10 (for example `style_slab`, `hair_curly`, `cam_nose`, `scene_eastcoast`); lists are in id order.

| key | en | zh |
|---|---|---|
| tab | Dream Wave | 夢幻浪 |
| styles, shape, surfer, look, camera, snap | Styles, Shape, Surfer, Look, Camera, Snapshot | 浪型, 形狀, 衝浪手, 場景, 鏡頭, 拍照 |
| share, save, reset, close, back | Share, Save, Reset, Close, Back to Forecast | 分享, 儲存, 重設, 關閉, 回到預報 |
| play, pause | Play, Pause | 播放, 暫停 |
| loading | Loading… | 載入中… |
| failed | The Dream Wave can't start on this device. | 這台裝置無法開啟夢幻浪。 |
| hold | Press and hold the picture to save it | 長按圖片即可儲存 |
| dragHint | Drag your surfer to your spot in the wave | 拖曳衝浪手到浪上你想要的位置 |
| name | Your name or IG handle | 你的名字或 IG 帳號 |
| caption | My dream wave: {h} m {style} | 我的夢幻浪：{h} 公尺 {style} |
| custom | Custom | 自訂 |
| style_* | A-frame, Slab, Reef barrel, Long wall, Mushy, Closeout | A字浪, 厚板浪, 礁岩管浪, 長牆浪, 軟浪, 關門浪 |
| scene_* | Neon, Tropical, Taiwan east coast, Golden hour, Stormy | 霓虹, 熱帶, 台灣東海岸, 黃金時刻, 暴風雨 |
| cam_* | Free, GoPro nose cam, GoPro head cam | 自由視角, GoPro 板頭, GoPro 頭戴 |
| slider_* (SLIDERS order) | Size, Lip thickness, Length, Bend (U from above), Wall slant, Steepness, Hollowness, Scoop under barrel, Trough (bottom curve), Peel speed, Lip throw | 浪高, 浪唇厚度, 長度, 彎度（俯看 U 形）, 浪壁斜度, 陡度, 空心度, 管浪下方內凹, 浪底弧度, 崩浪速度, 浪唇拋距 |
| ends_* | Small–Big, Feathery–Heavy, Short–Long, Straight–Deep U, Flat–Steep A, Gentle–Overhang, Fat bulge–Barrel, None–Deep, Long ramp–Short & tight, Slow–Fast, Close–Far out | 小–大, 輕薄–厚重, 短–長, 直–深 U, 平緩–陡峭 A 字, 平緩–倒懸, 肥厚鼓起–管浪, 無–深, 長斜坡–短而緊, 慢–快, 近–遠 |
| units | m, cm, {n} m each side, m/s, overhang | 公尺, 公分, 每邊 {n} 公尺, 公尺/秒, 倒懸 |
| row_* (maker rows) | Skin, Build, Hair, Hair colour, Outfit, Main colour, Accent, Board, Board colour, Graphic, Stance, Pose, Face, Extras | 膚色, 體型, 髮型, 髮色, 服裝, 主色, 配色, 衝浪板, 板色, 圖案, 站姿, 姿勢, 表情, 配件 |
| build_* | Slim, Broad | 纖瘦, 壯碩 |
| hair_* | Spiky, Short, Long, Bun, Curly, Cap | 刺蝟頭, 短髮, 長髮, 包包頭, 捲髮, 反戴帽 |
| outfit_* | Full wetsuit, Springsuit, Boardshorts, Rash vest, Bikini, One-piece | 全身防寒衣, 短袖防寒衣, 衝浪褲, 防曬衣, 比基尼, 連身泳裝 |
| board_* | Shortboard, Fish, Longboard, Soft-top | 短板, 魚板, 長板, 軟板 |
| graphic_* | Flames, Stripes, Checker, Plain | 火焰, 條紋, 棋盤格, 素面 |
| stance_* | Regular, Goofy | 正腳, 反腳 |
| pose_* | Tube crouch, Hand drag, Bottom turn, Standing tall, Horns up, Shaka | 管浪蹲姿, 手拖浪壁, 底部轉向, 站直, 金屬手勢, Shaka 手勢 |
| face_* | Grin, Stoked, Focused, Metal scream | 咧嘴笑, 超嗨, 專注, 金屬嘶吼 |
| extra_* | None, Shades, Headband, Helmet | 無, 墨鏡, 頭帶, 頭盔 |

The 中文 names are proposals; Bryan checks them in Task 14.

## File structure

| File | Responsibility |
|---|---|
| `web/dreamwave.js` | Loader and tab hookup: `PUBLIC`, the strings and `DW.t`, `window.DREAMWAVE`, the full-screen layer with its ✕, `#dreamwave`, lazy loading, its own `<style>`. |
| `web/dreamwave/shell.js` | `DW.shell`: the wave model, sliders, styles, `applyShape`, `fitLoop`, `styleOf`. No three.js, no DOM. |
| `web/dreamwave/flow.js` | `DW.power`, `DW.frame`, `DW.flow`: power per surface point, the sampled wave surface, the flow tracers. No three.js, no DOM. |
| `web/dreamwave/surfer.js` | `DW.surfer`: options, the cartoon surfer model, where it rides on the face. |
| `web/dreamwave/scenes.js` | `DW.scenes`: the five looks (water, sky, sun, land, particles). |
| `web/dreamwave/view.js` | `DW.view`: renderer, wave mesh, surfer riding, cameras, loop, snapshot render. |
| `web/dreamwave/snap.js` | `DW.snap`: caption, the 1080 × 1920 picture, share and save. |
| `web/dreamwave/panel.js` | `DW.panel`: the bottom bar and its sheets; remembering. |
| `web/vendor/three.min.js` | three.js r149, unchanged. |
| `template.html` | Third tab button, `<section id="viewDw" hidden>`, `setView()` / `keepWorld()` / `setLang()` hooks, `<script src="dreamwave.js" defer>`. |
| `build-site.sh` | Copy the new files; version `dreamwave.js` by a checksum over it and `web/dreamwave/*.js`. |
| `tests/dreamwave/*.test.js` | `node --test` unit tests for shell, flow, surfer, snap. |
| `tests/dreamwave/check.js` | Playwright browser checks on a built page, like `tests/chat/shell.test.js`. |
| `tests/test_build_site.py` | Build checks for the new files and address. |

Every file in `web/dreamwave/` has the form `(function (DW) { "use strict"; … DW.<part> = …; })(window.DW = window.DW || {});` and uses the global `THREE`, so a unit test can run it with `new Function("window", "THREE", src)(fakeWindow, THREE)`.

---

### Task 1: Wave model module

**Files:**
- Create: `web/dreamwave/shell.js`
- Test: `tests/dreamwave/shell.test.js`

**Interfaces:**
- Produces: `DW.shell = { WAVE, timeState(S, t) → A, stage(S, x, A) → st, section(S, st, g) → [[z, y] × J.M], J, cl, lerp, sm, SLIDERS, STYLES, fresh() → S, applyShape(S, k, v), fitLoop(S) → seconds, styleOf(S) → id | null }`.
  - WaveShell (lines 107–272) unchanged; `A` has `{ t, g, lip, d, Lt, phase, form }`, `st` has `{ u, p, f, Ht, fill, broken, env, … }`.
  - `fresh()`: a deep copy of `WAVE` with `length = wallLength + shoulderLength` (13.4) and `loopTime` from `fitLoop`.
  - `SLIDERS`: `SL` (lines 570–582) in that order as `{ k, min, max, step }`; names, end labels and units come from the strings (`slider_<k>`, `ends_<k>`), number formats as the artifact's `fmt`.
  - `STYLES`: `[{ id, v }]`, ids `aframe, slab, reef, longwall, mushy, closeout`, values from lines 606–613 (A-frame = the `WAVE` defaults for the eleven slider keys).
  - `applyShape` as line 591 with `S` passed in (height also sets `tubeSize = v × 2.3 / 2.6`; length sets `wallLength = v × 3 / 13.4` and `shoulderLength` the rest). `fitLoop` as line 600: sets and returns `S.loopTime`.
  - `styleOf(S)`: the style whose eleven values are each within half a slider step of `S`, else `null`.

- [ ] **Step 1: Write the failing tests** (`node:test`, loading the file with a fake `window`)

```js
const crest = sec => Math.max(...sec.slice(J.back, J.front).map(p => p[1]));
const styled = s => { const S = fresh(); for (const [k, v] of Object.entries(s.v)) applyShape(S, k, v); fitLoop(S); return S; };
test("crest has no bump ahead of the break", () => {   // the pinned model's largest rise is 0.00095 m (Closeout)
  for (const s of STYLES) { const S = styled(s);
    for (let t = 5; t <= S.loopTime - 1.2; t += 0.5) { const A = timeState(S, t); let prev = Infinity;
      for (let ax = Math.max(0, A.d); ax <= 34; ax += 0.2) {
        const c = crest(section(S, stage(S, S.peakX - ax, A), A.g));
        assert.ok(c <= prev + 0.002, `${s.id} t=${t} ax=${ax.toFixed(1)}`); prev = c; } } }
});
test("styles stay inside the slider ranges", () => { for (const s of STYLES) for (const c of SLIDERS) assert.ok(s.v[c.k] >= c.min && s.v[c.k] <= c.max, `${s.id}.${c.k}`); });
test("fitLoop follows length and peel speed", () => {
  const S = fresh(); assert.ok(Math.abs(fitLoop(S) - 9.05) < 0.01);
  applyShape(S, "peelSpeed", 10); assert.ok(Math.abs(fitLoop(S) - 7.04) < 0.01);
  applyShape(S, "peelSpeed", 1); assert.equal(fitLoop(S), 16);
});
test("applyShape keeps the barrel and walls in proportion", () => {
  const S = fresh(); applyShape(S, "height", 5.2); assert.ok(Math.abs(S.tubeSize - 4.6) < 1e-9);
  applyShape(S, "length", 20); assert.ok(Math.abs(S.wallLength + S.shoulderLength - 20) < 1e-9);
});
test("styleOf names a style only when every slider matches", () => {
  assert.equal(styleOf(fresh()), "aframe");
  const S = styled(STYLES.find(s => s.id === "slab")); assert.equal(styleOf(S), "slab");
  applyShape(S, "height", 3.3); assert.equal(styleOf(S), null);
});
```

- [ ] **Step 2: Run** `node --test tests/dreamwave/shell.test.js`. Expected: FAIL (file missing).
- [ ] **Step 3: Implement** `shell.js` as described above.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `web/dreamwave/shell.js tests/dreamwave/shell.test.js`.

### Task 2: Power, surface and flow module

**Files:**
- Create: `web/dreamwave/flow.js`
- Test: `tests/dreamwave/flow.test.js`

**Interfaces:**
- Consumes: `DW.shell`.
- Produces:
  - `DW.power.value(S, st, A, j, y, steep) → 0..1` (WavePower, lines 275–296).
  - `DW.frame.create(S, DX) → F = { pos, pw, st, idx, nrm: null, NX, M, MID, x0, dx, peakX, Lt }`: `NX = 2·round(34 / DX) + 1`, `M = J.M`, `pos` a `Float32Array(NX·M·3)`, `idx` the triangle index of lines 402–403.
  - `DW.frame.build(F, S, t) → A`: the artifact's `build(t)` (lines 420–448) without three.js or `paint`: fills `pos` with `(x, y, z + crestZ + bend·((x − peakX)/15)²)`, `pw`, `st`, `F.Lt`, mirroring when both sides peel.
  - `DW.flow.create(n, K)` and `DW.flow.step(sys, F, dt)` (WaveFlow, lines 299–384). `step` reads `F.nrm`, which the view fills from three's vertex normals.

- [ ] **Step 1: Write the failing tests:** `power stays within 0..1` (every `F.pw` after `build(F, fresh(), 6)` with DX 0.25); `build fills every position` (each style, t from 0 to its `loopTime` in 0.5 s steps: no NaN in `F.pos`); `tracers keep finite positions` (Slab, `F.nrm` filled with (0, 1, 0), 300 steps of 1/60 s with `build` before every second step: every tracer's `hist` finite).
- [ ] **Step 2: Run** `node --test tests/dreamwave/flow.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement:** copy the pinned code unchanged apart from reading `DW.shell` where it reads `WaveShell`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 3: The tab, the loader and the developer-mode switch

**Files:**
- Create: `web/dreamwave.js`, `web/vendor/three.min.js` (copy of the pinned file), `tests/dreamwave/check.js`
- Modify: `template.html` (the tabs `<nav>`, `<section id="viewDw" class="dwview" hidden></section>` after `#viewWs`, `setView()`, `keepWorld()`, `setLang()`, `<script src="dreamwave.js" defer></script>` after the chat.js one), `build-site.sh`, `tests/test_build_site.py`

**Interfaces:**
- Produces:
  - `window.DW` with `DW.lang` (`"zh"` when the page's `LANG` is `zh`, else `"en"`), `DW.STR = { en: {…}, zh: {…} }` (the Strings table) and `DW.t(key, vars = {}, lang = DW.lang)` (falls back to English, then to the key; fills `{h}`, `{style}`, `{n}` from `vars`).
  - `window.DREAMWAVE = { dev(), relang(), show(), hide() }`. `show()` the first time shows `loading`, loads `vendor/three.min.js?v=149` and then each name in `PARTS` as `dreamwave/<name>.js?v=<dreamwave.js's own v>` (dynamic scripts with `async = false`, so they run in order), then calls its own `start(layer)`; later calls resume. A failed load or no WebGL shows `failed` instead. `hide()` pauses.
  - `PARTS` lists only the parts that exist so far, in the final order `shell, flow, surfer, scenes, view, snap, panel` (this task: `shell, flow`). `start()` grows: Task 4 creates the view, Task 5 mounts the panel.
  - With `window.__dwTest` set: `DREAMWAVE._loaded` (URLs loaded, in order), `_frames()` (frames drawn; 0 until Task 4), `_view` (the view).
- The tab button: `<button role="tab" data-v="dw" aria-selected="false" data-zh="夢幻浪" data-ja="ドリームウェーブ" hidden>Dream Wave</button>` after Map.
- `setView("dw")`: if the map is open, close it as leaving the map does (`WS.full(false)`, `WS.hide()`, `#viewWs` hidden); hide `#viewFc`; show `#viewDw` with the page locked (scroll, zoom); call `DREAMWAVE.show()`. Leaving `dw`: hide `#viewDw`, unlock, `DREAMWAVE.hide()`, then the existing Forecast/Map branch with no slam. A reload from the tab opens Forecast (the restore line already reads anything but `"ws"` as Forecast).
- `keepWorld()` and `setLang()` also call `DREAMWAVE.dev()` / `DREAMWAVE.relang()` when present, guarded the way they call `CHAT`.
- `dev()` shows the button only while `PUBLIC || WORLD`; if it hides while the tab shows, it calls `setView("fc")`. At load, `#dreamwave` in the address opens the tab when it is on.
- `build-site.sh`: `VD=$(cat web/dreamwave.js web/dreamwave/*.js | cksum | cut -d' ' -f1)`, the page asks for `dreamwave.js?v=$VD`, and `dreamwave.js`, `dreamwave/` and `vendor/` are copied next to `index.html`. `dreamwave.js` reads its own `?v=` from `document.currentScript`.

- [ ] **Step 1: Write the failing build tests** in `tests/test_build_site.py`: `test_dreamwave_address_carries_its_version` (one `<script src="dreamwave.js?v=\w+" defer>`), `test_dreamwave_files_copied` (`dreamwave.js`, `dreamwave/shell.js`, `vendor/three.min.js` in the output, identical to the sources), `test_address_changes_with_a_dreamwave_part` (appending to `web/dreamwave/shell.js` changes the address).
- [ ] **Step 2: Write the failing browser checks** in `tests/dreamwave/check.js`. Harness as in `tests/chat/shell.test.js`: a page built by `tests/map/tool.py`, offline, phone 390 × 844, routes serving `dreamwave.js`, `dreamwave/*` and `vendor/*` from the repo, developer mode through `waveslave-world` and `setWorld` as the chat checks do, `window.__dwTest = true`; Chromium launched with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` so WebGL works headless.
  - `hiddenInTaiwanMode`: the `dw` button and `#viewDw` hidden.
  - `showsInDeveloperMode`: the button is visible and reads "Dream Wave", and "夢幻浪" after `setLang("zh")`.
  - `noThreeBeforeOpening`: no request for `vendor/` or `dreamwave/` until the tab is tapped; then `three.min.js` and every `PARTS` file load once, in order.
  - `opensAndCloses`: tap Dream Wave → `#viewDw` covers the screen and `#viewFc` is hidden; ✕ → Forecast; the same with Esc.
  - `linkOpensTab`: `#dreamwave` opens the tab in developer mode and leaves Forecast showing in Taiwan mode.
  - `devOffLeavesTab`: with the tab open, `setWorld(false)` → Forecast shows and the button hides.
  - `loadFailureShowsMessage`: with `vendor/three.min.js` aborted, the tab shows `failed`, ✕ still goes back, no page error.
  - `forecastUnchanged`: with `dreamwave.js` aborted, the page shows Forecast with no page error.
- [ ] **Step 3: Run** `python3 -m unittest tests.test_build_site -v` and `node tests/dreamwave/check.js <page.html>`. Expected: the new tests FAIL.
- [ ] **Step 4: Implement** the template hooks, `web/dreamwave.js` (its own `<style>` scoped to `.dwview`; every entry point wrapped so it never throws into the page, as chat.js does), the vendor copy and `build-site.sh`.
- [ ] **Step 5: Run** both. Expected: PASS, and `tests/chat/shell.test.js` and `tests/map/check.js` still pass.
- [ ] **Step 6: Commit.**

### Task 4: The 3D view with the Neon scene

**Files:**
- Create: `web/dreamwave/view.js`
- Modify: `web/dreamwave.js` (`PARTS` + `view`; `start()` creates the view), `tests/dreamwave/check.js`

**Interfaces:**
- Consumes: `DW.shell`, `DW.power`, `DW.frame`, `DW.flow`.
- Produces: `DW.view.create(layer, S) → view` with `view.S`, `view.F`, `view.lastA`, `view.time()`, `view.setTime(t)`, `view.play(on)`, `view.playing()`, `view.shape(k, v)` (`applyShape`, `fitLoop`, rebuild), `view.pause()` / `view.resume()` (stop and start the animation loop), `view.frames` (frames drawn), `view.canvas`, `view.scene`, `view.camera`, `view.renderer`, `view.mesh`, `view.on("frame", fn)`. One view per visit.
- From lines 387–661: the Neon look (dark wave, glowing grid, power colours, flow trails and beads), the free orbit camera (always around the peak; drag, pinch, wheel; starting at the `q34` view), the play/pause button and the time bar. Left out: the speed buttons, camera view buttons, power and flow toggles, `#tag`, the legend, the cut line, and the sliders and styles (Task 5).
- The canvas fills the layer, sized by a `ResizeObserver`.

- [ ] **Step 1: Write the failing checks** (read pixels in the page right after `renderer.render(scene, camera)` with `gl.readPixels`, in the same task): `drawsTheWave` (the middle 20 × 20 block is not one colour), `pausesWhenHidden` (`_frames()` stops rising after ✕ and after `setWorld(false)`, and rises again on reopening), `reopenKeepsOneRenderer` (open and close 5 times: one `<canvas>` in `#viewDw`, `renderer.info.memory.geometries` the same after the 2nd and the 5th opening), `playPause` (pause holds `view.time()`; play moves it).
- [ ] **Step 2: Run** the checks. Expected: FAIL.
- [ ] **Step 3: Implement** `view.js` from the pinned renderer block.
- [ ] **Step 4: Run** the checks. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 5: Styles and Shape sheets, and remembering

**Files:**
- Create: `web/dreamwave/panel.js`
- Modify: `web/dreamwave.js` (`PARTS` + `panel`; `start()` mounts it; style rules), `tests/dreamwave/check.js`

**Interfaces:**
- Consumes: `DW.shell.SLIDERS/STYLES/styleOf`, `view.shape(k, v)`.
- Produces: `DW.panel.mount(layer, view)`, `DW.panel.relang()`, `DW.panel.sheet(name | null)` (`"styles" | "shape" | "surfer" | "look" | "camera" | "snap"`), and `DW.panel.state = { shape: {k: v}, surfer: {…}, spot: {…}, scene, camera, name }`, saved on every change.
- The bar along the bottom: Styles, Shape, Surfer, Look, Camera and a larger Snapshot button. Surfer, Look, Camera and Snapshot open empty sheets until Tasks 8, 11, 9 and 12. One sheet open at a time, from the bottom, at most 55% of the height, the wave still visible above it.
- Styles sheet: six chips and Reset (= A-frame). A tap glides every slider to the style in 700 ms (smoothstep; instant with reduced motion), as `pickStyle` does. The pressed chip is `styleOf(view.S)`, or during a glide the style being glided to.
- Shape sheet: the eleven sliders with their names, end labels and values (VT323 amber, with units).
- On mount, valid saved `shape` values go through `view.shape`.

- [ ] **Step 1: Write the failing checks:** `styleGlides` (tap Slab; after 900 ms the sliders read Size 3.0, Lip throw 4.0, Steepness 105, Peel 5.0), `handMoveTurnsStyleOff`, `resetGoesToAFrame`, `remembersTheWave` (Size 4.2 survives a reload), `brokenStorageUsesDefaults` (`waveslave-dreamwave` = `"{oops"`, and separately localStorage throwing: the tab opens on the A-frame with no page error), `oldSavedStateFillsGaps` (saved `{ shape: { height: 4.2, wobble: 3, lipThrow: "far" } }` → Size 4.2, Lip throw 2.1, no `wobble` on `view.S`), `panelsInChinese` (after `setLang("zh")` the bar reads 浪型 形狀 衝浪手 場景 鏡頭 拍照).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `panel.js`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Show Bryan** phone-size screenshots of the tab with each working sheet open, saved to `/mnt/project-files/surf-app/dream-wave/build/step1-*.png`, in one short message. Carry on; fold in his notes when they come.
- [ ] **Step 6: Commit.**

### Task 6: The cartoon surfer model

**Files:**
- Create: `web/dreamwave/surfer.js`
- Modify: `web/dreamwave.js` (`PARTS` + `surfer`)
- Test: `tests/dreamwave/surfer.test.js`

**Interfaces:**
- Produces: `DW.surfer = { OPTIONS, DEFAULT, make(o) → THREE.Group, POSES }`.
  - `OPTIONS`: `skin` (`#f6d3b3 #eebc8f #e0ac7e #c98d5f #b97a50 #8d5a35 #6b4226 #4a2c18`), `build` (slim, broad), `hair` (spiky, short, long, bun, curly, cap), `hairColor` (`#120c08 #2b1a10 #3b2416 #7a4a26 #e8bf4f #b8471e #d9d9d9 #ff3d7f`), `outfit` (full, spring, shorts, vest, bikini, onepiece), `suit` (`#17171c #e63946 #17b3a6 #2f7de1 #5b2fb0 #b6e600 #ff8a00 #f2f2f2`), `accent` (`#ff4a12 #ffd23f #e63946 #1d2a5c #17b3a6 #ff3d7f #f2f2f2 #17171c`), `board` (short, fish, long, soft), `boardColor` (`#f6f3ea #f2f2f2 #ffd23f #d9a066 #2f7de1 #d7261e #17b3a6 #17171c`), `graphic` (flames, stripes, checker, solid), `stance` (regular, goofy), `pose` (crouch, drag, bottom, tall, claim, shaka), `face` (grin, stoked, focus, scream), `extra` (none, shades, headband, helmet).
  - `DEFAULT`: the lineup's Spiky surfer (skin `#c98d5f`, broad, spiky `#2b1a10`, full `#17171c` with accent `#ff4a12`, short board `#f6f3ea` with flames, crouch, grin, no extra), stance regular.
  - `make(o)`: the spike's `make`: toon shading with the orange edge glow, outlines 0.024, head scale 1.15, the chest W only on full, spring, vest and onepiece; stripes use the accent colour (the spike's `trim`). Parts named `head`, `handFront`, `board`, `chestLogo`. Local frame: x toward the board's nose, y up from the deck. The spike's body is goofy; regular is the same body with every joint's z negated (and the head direction's z), never a negative scale. The face looks along the nose (the spike's default head direction, not `lookCam`).

- [ ] **Step 1: Write the failing tests** (three from `web/vendor/three.min.js` in Node, with a `document` stub whose `createElement("canvas")` returns a canvas with a no-op 2D context): `every option builds` (each value of each option on top of `DEFAULT` gives a group with more than 20 meshes and no NaN in any position), `regular mirrors goofy` (`handFront`'s world z changes sign), `logo only on suits` (no `chestLogo` for shorts or bikini).
- [ ] **Step 2: Run** `node --test tests/dreamwave/surfer.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `surfer.js` from the pinned spike.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 7: Riding the barrel

**Files:**
- Modify: `web/dreamwave/surfer.js`, `web/dreamwave/view.js`, `web/dreamwave/panel.js`
- Test: `tests/dreamwave/surfer.test.js`, `tests/dreamwave/check.js`

**Interfaces:**
- Produces:
  - `DW.surfer.spotOnFace(sec, J, y) → { z, slope } | null`: on a section from `DW.shell.section`, the first face segment between `J.face` and `J.front` that crosses height `y`, interpolated; `slope` is the face angle from level, in radians.
  - `DW.surfer.clampSpot(spot) → spot`: `side` `"left" | "right"`, `u` 0.15–1.6, `h` 0.08–0.6; a missing or broken field takes the default `{ side: "left", u: 0.35, h: 0.2 }`.
  - `DW.surfer.place(S, A, spot) → { x, y, z, dir: [dx, dz], tilt } | null`: `x = peakX ∓ (max(0, A.d) + u·A.Lt)` (minus on the left); `sec = section(S, stage(S, x, A), A.g)`; `y = h ×` the section's highest point; `z` = `spotOnFace(sec, J, y).z + crestZ + bend·((x − peakX)/15)²`; `dir` = `s·(1, b′)` normalised, `s` = −1 on the left and +1 on the right, `b′ = 2·bend·(x − peakX)/225` (the U seen from above); `tilt = min(slope, 0.55)`.
  - `view.setSurfer(o)`, `view.setSpot(spot)`, `view.spot()`, and `view.on("spot", fn)` when a drag ends. The panel restores `state.spot` on mount and saves it on `"spot"`.
- `spot` meaning: `u` is how far ahead of the curl in tube lengths (0 deep inside, 1 at the opening, above 1 out on the wall); `h` is the feet's height as a share of the local wave height.
- Each frame the view puts the surfer at `place(…)`, lifted 0.05 m off the face along its normal, turned by the basis x = `dir`, y = up tilted by `tilt` toward the beach side of `dir` (the way the face looks), z = x × y. It hides the surfer only when `place` returns `null`.
- Dragging: a pointer that goes down on the surfer (a raycast on its group) moves the spot to where the ray meets the wave mesh: `side` from the hit's x, `u = (|x − peakX| − max(0, A.d)) / A.Lt`, `h` = the hit's height over the crest height there, then `clampSpot`. Anywhere else one finger still orbits and two pinch.

- [ ] **Step 1: Write the failing unit tests:** `spotOnFace finds the height` (a section whose points from `J.face` to `J.front` run straight from (0, 2) to (2, 0): `y = 1` gives `z = 1` and `slope = π/4`; `y = 3` gives `null`), `spotStaysOnFaceAtExtremes` (the six styles and Size 6 + Lip throw 6 + Steepness 115 + Hollowness −1 + Length 5 + Peel 10; t from 0 to `loopTime` in 0.1 s steps; `u` in {0.15, 0.35, 1, 1.6}, `h` in {0.08, 0.2, 0.6}, both sides: `place` never returns `null` and has no NaN; the pinned model's face always reaches at least 0.68 of the crest), `clampSpot keeps the surfer in the barrel and wall`.
- [ ] **Step 2: Write the failing checks:** `surferShows` (the pixels around the head's screen position change when the surfer is hidden), `ridesWithTheCurl` (on the left side the surfer's x falls as t goes 5 → 7), `dragMovesTheSpot` (a drag from the surfer toward the opening raises `view.spot().u`), `dragElsewhereOrbits`, `spotRemembered`.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit.**

### Task 8: The surfer maker

**Files:**
- Modify: `web/dreamwave/panel.js`, `web/dreamwave/view.js`, `tests/dreamwave/check.js`

**Interfaces:**
- Consumes: `DW.surfer.OPTIONS/DEFAULT`, `view.setSurfer(o)`.
- The Surfer sheet: the `dragHint` at the top, then rows for skin, build, hair and hair colour, outfit with main colour and accent, board with board colour and graphic, stance, pose, face, extras. Colours are swatches, other choices are chips. Every change rebuilds the surfer at once (the old group's geometries, materials and textures disposed) and saves `state.surfer`.

- [ ] **Step 1: Write the failing checks:** `makerChangesSurfer` (pick curly hair → the surfer's mesh count changes and the saved state has `hair: "curly"`), `makerRemembers` (a reload keeps it), `makerIgnoresUnknownSaved` (saved `{ surfer: { hair: "mohawk", skin: "#8d5a35" } }` → spiky hair, skin `#8d5a35`), `makerInChinese`, `rebuildKeepsMemorySteady` (20 changes leave `renderer.info.memory.geometries` and `.textures` within 5 of where they started).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 9: Cameras

**Files:**
- Modify: `web/dreamwave/view.js`, `web/dreamwave/panel.js`, `tests/dreamwave/check.js`

**Interfaces:**
- Produces: `view.setCamera("free" | "nose" | "head")`, saved in `state.camera`; the Camera sheet lists the three.
  - `free`: the orbit from Task 4.
  - `nose`: at the surfer's local `(1.7, 0.55, ±0.45)` (on the chest side), looking at the head 0.25 m lower, fov 88.
  - `head`: at the head, 0.1 m forward, looking along the board's nose and 10° down, fov 100.
  - The GoPro cameras follow the surfer every frame.

- [ ] **Step 1: Write the failing checks:** `noseCamSeesSurfer` (the head's screen position is inside the middle 60% of the frame at t = 5, 6, 7), `headCamLooksOut` (the camera's direction has the travel direction's x sign), `cameraRemembered`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Show Bryan** screenshots of the maker, the surfer at three spots (deep, the opening, the wall) and the three cameras, saved to `/mnt/project-files/surf-app/dream-wave/build/step2-*.png`, in one short message. Carry on.
- [ ] **Step 6: Commit.**

### Task 10: Scene stills for Bryan's OK (checkpoint)

**Files:**
- Create: `web/dreamwave/scenes.js` (first pass), `tests/dreamwave/stills.js`
- Modify: `web/dreamwave.js` (`PARTS` + `scenes`), `web/dreamwave/view.js`

**Interfaces:**
- Produces: `DW.scenes = { LIST: ["neon", "tropical", "eastcoast", "golden", "stormy"], apply(view, id) }` and `view.setScene(id)` (calls `apply`, keeps `view.sceneId`).
- Starting palettes (water deep / mid / lip / tube / foam; sky top → horizon; sun; land):
  - tropical: `#0b6e8a #19b3c4 #7ff0e6 #0f8aa0 #f6fdff`; `#2f8fe0 → #bfe9fb`; sun `#fff4d6`, high, front-left; white sand `#f1dfb0`, palms (trunks `#8a5a32`, leaves `#2e8b3d`).
  - eastcoast: `#0a3d5c #1d6f8f #4fb7c4 #0e5470 #eef6f8`; `#6d8fae → #d3dde6` with clouds; sun `#fff1e0`, soft; dark pebbles `#3a3a3e`, green mountains `#2f6b3a → #1f4d2a`, mist `#b9c9cf`.
  - golden: `#0b3b4a #1e6c74 #ffb04a #10424c #fff1d6`; `#3a2a6a → #ff7a3d → #ffd38a`; sun `#ffb35a`, low, behind the wave so the lip glows; dark shore `#1a1420`.
  - stormy: `#1d3a3a #3c5f58 #7f9e95 #23443f #e2e8e4`; `#3b4248 → #6b7378` with dark clouds; sun `#c9d1d4`, dim; foam streaks down the face; rain `#c8d3d8`; grey shore `#3d4240`.
- Water colour per vertex: deep → mid by height; the lip (`J.outer`–`J.inner`) toward the lip colour by the pocket share `st.p`; inside the tube toward the tube colour; white foam on the lip tip (within 7 points of `J.inner`) and on whitewater (`st.fill`). The water is a `MeshStandardMaterial({ vertexColors: true, roughness: 0.3 })` lit by the scene's sun, so the face catches sun glints. The sky is a large sphere with a vertical gradient.
- The land wraps around as a bay, so it shows in the pictures: the beach about 60 m toward +z, headlands at both far ends (|x| > 80 m) reaching out to sea past the wave, mountains behind the beach and on the headlands. From the free camera's starting view a headland shows behind the wave; from the GoPro views the shore shows along the wave.

- [ ] **Step 1:** Write `tests/dreamwave/stills.js`: renders each scene with the default surfer from the free, nose and head cameras into `/mnt/project-files/surf-app/dream-wave/scenes/<id>-<camera>.png`, plus one sheet `scenes.png`.
- [ ] **Step 2:** Implement the first pass of the four realistic scenes (Neon stays the Task 4 look).
- [ ] **Step 3:** Run it and look at every still yourself first.
- [ ] **Step 4: STOP.** Send Bryan the sheet (link the file by its path) and ask for his OK or changes, and which scene should open first. Wait for his answer before Task 11.
- [ ] **Step 5: Commit** `web/dreamwave/scenes.js web/dreamwave/view.js web/dreamwave.js tests/dreamwave/stills.js`.

### Task 11: The five scenes, finished, and the Look sheet

**Files:**
- Modify: `web/dreamwave/scenes.js`, `web/dreamwave/surfer.js`, `web/dreamwave/view.js`, `web/dreamwave/panel.js`, `tests/dreamwave/surfer.test.js`, `tests/dreamwave/check.js`

**Interfaces:**
- Consumes: Bryan's notes from Task 10 (and his opening scene, which becomes the default `state.scene`).
- Produces: `DW.surfer.make(o, look = "toon" | "wire")`. The wire look is the same body drawn as glowing lines (each part's wireframe in its own colour, brightened, additive), for the Neon scene.
- The Look sheet lists the five scenes, each with a small swatch of its water and sky. The Neon scene shows the power colours, the flow and the wire surfer; the others hide the power colours and flow and show the toon surfer. Spray off the lip in every realistic scene, rain in Stormy, half the particles on phones.

- [ ] **Step 1: Write the failing tests and checks:** unit `wire surfer has only lines` (`make(DEFAULT, "wire")` holds no `Mesh`, only `LineSegments`); checks `everySceneDraws` (each scene: no page error, the top-centre pixel within 40 per channel of the scene's sky top colour), `neonShowsFlow` and `realHidesFlow`, `neonSurferIsWire`, `phoneHalvesParticles` (the particle count at 390 × 844 is half the 1280 × 800 count), `sceneRemembered`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** Bryan's changes, the wire look and the Look sheet.
- [ ] **Step 4: Run.** Expected: PASS. Re-run `tests/dreamwave/stills.js` and send Bryan the new sheet.
- [ ] **Step 5: Commit.**

### Task 12: Snapshot and share

**Files:**
- Create: `web/dreamwave/snap.js`
- Modify: `web/dreamwave.js` (`PARTS` + `snap`), `web/dreamwave/view.js`, `web/dreamwave/panel.js`
- Test: `tests/dreamwave/snap.test.js`, `tests/dreamwave/check.js`

**Interfaces:**
- Produces:
  - `view.snapshot(w, h) → HTMLCanvasElement`: renders the current camera at `w × h`, pixel ratio 1, with the camera's aspect set to `w / h` for the shot, copies it to a 2D canvas in the same task, then restores size and aspect.
  - `DW.snap.caption(S, lang) → string`: `DW.t("caption", { h, style }, lang)` with `h = S.height.toFixed(1)` and `style` the name of `styleOf(S)`, or `custom`.
  - `DW.snap.LAYOUT` (1080 × 1920): wordmark "WaveSlave", Metal Mania 96 px, baseline starting at (64, 440), tilted like the logo (rotate −7° and skewX −14° about that point), with the fire fill, outline and glow; "waveslave.tw", VT323 48 px, `#ffcf5c`, baseline at (72, 510); a dark band behind the bottom text (y 1300 → 1640, transparent → `rgba(0,0,0,.55)`); caption in Metal Mania 72 px, fire fill, centred, baseline 1500, at most two lines within 960 px; name in VT323 56 px, centred, baseline 1600.
  - `DW.snap.compose(shot, { caption, name }) → Promise<HTMLCanvasElement>`: waits up to 1.5 s for `document.fonts.load` of Metal Mania and VT323 (offline it draws with the fallback fonts).
  - `DW.snap.share(canvas) → Promise<"shared" | "saved" | "cancelled">`: a PNG `File` named `dream-wave.png`; when `navigator.canShare({ files })` is true, `navigator.share({ files, text: "https://waveslave.tw/#dreamwave" })` (an `AbortError` gives `"cancelled"`, silently; any other error falls through to Save); otherwise Save.
  - `DW.snap.save(canvas) → "saved"`: on iPhone and iPad (`/iPhone|iPad|iPod/` in the user agent, or `MacIntel` with touch points) and in LINE's browser (`/\bLine\//i`), it shows the picture full size in the sheet with the `hold` hint; elsewhere it downloads `dream-wave.png` through an `<a download>`.
- Tapping Snapshot pauses the wave, so the picture is the moment they saw; closing the Snapshot sheet resumes play if it was playing.
- Snapshot sheet: the preview (scaled to fit), the name field (`state.name`, at most 30 characters), Share and Save.

- [ ] **Step 1: Write the failing unit tests:** `caption names the style` ("My dream wave: 3.0 m Slab" for the Slab values), `caption says Custom`, `caption in 中文` ("我的夢幻浪：2.6 公尺 A字浪" for the defaults), `layout stays in the safe area` (every LAYOUT y between 280 and 1640).
- [ ] **Step 2: Write the failing checks:** `snapshotIs1080x1920`, `snapshotHasBranding` (the pixels at the wordmark, the link and the caption differ from the bare shot), `safeAreaRespected` (rows 0–279 and 1641–1919 of the composed picture equal the bare shot's), `snapshotPausesTheWave`, `shareSendsPng` (a stubbed `navigator.share` receives one `image/png` file and the text), `shareFallsBackToSave` (no `canShare` → a download named `dream-wave.png`; a share rejected with `AbortError` → no error shown and the sheet stays open; an iPhone user agent → the full-size picture with the hint).
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Show Bryan** one finished share picture per scene, saved to `/mnt/project-files/surf-app/dream-wave/build/share-<scene>.png`, in one short message. Carry on.
- [ ] **Step 7: Commit.**

### Task 13: Phone checks

**Files:**
- Modify: `tests/dreamwave/check.js`, and any file the checks show needs fixing

- [ ] **Step 1: Write the checks** for iPhone (390 × 844, dpr 3) and Android (412 × 915, dpr 2.625), with touch: `fitsThePhone` (no horizontal scroll; every bar button at least 40 × 40 px; an open sheet leaves the top 45% of the wave visible; the three tab buttons fit the tab bar), `pinchAndDragWork` (pinch zooms the free camera and not the page; a one-finger drag on the surfer moves it), `snapshotOnPhone` (the picture is still 1080 × 1920).
- [ ] **Step 2: Run, fix, run again.** Expected: PASS.
- [ ] **Step 3:** Save phone screenshots of every sheet and each scene to `/mnt/project-files/surf-app/dream-wave/phone/` and send Bryan a contact sheet.
- [ ] **Step 4: Commit.**

### Task 14: Bryan tries it (review)

- [ ] **Step 1:** Open the pull request (developer mode only; `PUBLIC` stays `false`). After Bryan merges it, ask him to open waveslave.tw on his phone, unlock developer mode and use the Dream Wave tab.
- [ ] **Step 2:** Ask him to check the 中文 names and how the interface is organised, and collect his changes.
- [ ] **Step 3:** Write his changes up as follow-up tasks (a short plan or a list in the thread) and do them the same way, with checks and pictures.
