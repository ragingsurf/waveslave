# Dream Wave tab: design

Date: 2026-10-29. Agreed with Bryan in chat, part by part (the thread "Build the 3D A-frame wave"). This file is the written version for his review.

## Goal

People build the wave of their dreams, put a cartoon version of themselves in the barrel, and share a picture of it. Every picture carries the WaveSlave name, so the people who see it find waveslave.tw and make their own.

## What Bryan decided

| Topic | Decision |
|---|---|
| Putting yourself in | A 3D cartoon surfer people style to look like them (not their real face), plus GoPro camera views. No photo uploads, no cut-outs, no AI faces. |
| Where it lives | The third tab, after Forecast and Map: **Dream Wave** (中文 **夢幻浪**). The Coach tab is not on the site yet; when it comes it goes fourth. |
| Who sees it | Developer mode only (the W in the logo) until Bryan says "go live". No sign-in. English and 中文. |
| The wave | Our own 3D wave (the Neon Wave artifact): its shape sliders and the six one-tap styles. Not a game engine. |
| The surfer | Rides along with the barrel as it peels; people drag them to their spot in it (deep in the tube, at the opening, out on the wall). |
| Looks | Five scenes, one tap each: Neon, Tropical, Taiwan east coast, Golden hour, Stormy. A still of each goes to Bryan for his OK before the scenes are finished. |
| Style | WaveSlave 90s metal. The surfer is a cartoon with bold dark outlines, flat colours and a fiery orange glow along the edges (a glowing wireframe in the Neon scene). Titles and the picture's caption use the flame lettering from the logo (Metal Mania, yellow to red, dark outline); numbers use the amber VT323; panels match the site's dark panels. A WaveSlave flame graphic is one of the board designs. |
| The shared picture | Tall story size for Instagram and LINE stories. WaveSlave logo and waveslave.tw in a corner. A caption like "My dream wave: 3.2 m Slab", plus a name or IG handle if they type one. A Share button (the phone's share menu: Instagram, LINE, Facebook) and a Save button. |
| After the build | Bryan tries it on his phone and may ask to reorganise the interface to make it easier to use. That review is part of the plan. |

## What people see and do

- The wave fills the screen and plays in a loop, with a play/pause button and a time bar.
- Buttons along the bottom: **Styles** (the six one-tap waves), **Shape** (all the sliders), **Surfer**, **Look** (the five scenes), **Camera**, and a big **Snapshot** button.
- The steps: pick a style or shape your own wave, make your surfer, drag them to your spot in the barrel, pick a look and a camera, then tap Snapshot. A preview of the story picture appears with Share and Save.
- Your surfer and your last wave are remembered on your phone for next time.

## The wave

Taken from the Neon Wave artifact (`surf-app/coach/3d-demo/wave-restart/neon/neon-wave.html`, published at https://claude.ai/artifact/BZWmvm7TkwodcaG7zpaxg4), which already has:

- the A-frame wave model (`WaveShell`): the height stays fixed in place from the peak, so the break runs down the slanted walls and the curl gets smaller as it peels; a smooth crest, no bump ahead of the pocket;
- the power colours (`WavePower`) and the water flow (`WaveFlow`), used by the Neon scene;
- the Shape sliders: Size, Lip thickness, Length, Bend, Wall slant, Steepness (to 115°, overhang), Hollowness (−100% to 100%), Scoop under barrel, Trough, Peel speed, Lip throw (to 6 m);
- the six styles (A-frame, Slab, Reef barrel, Long wall, Mushy, Closeout): a tap glides every slider to the style in 0.7 s, and moving a slider by hand turns the style button off; Reset goes back to A-frame;
- a loop that lasts until the break reaches the end of the walls (7 to 16 s, from Length and Peel speed).

## The surfer

The look was tried in throwaway samples (`surf-app/dream-wave/character-sample.png`, `character-lineup.png`; code `character-spike-v2.js`). Bryan: "they look alright".

**Options people pick**

- Skin tone (8 shades), and a slim or broad build.
- Hair: spiky, short, long, bun, curly, or a backwards cap; hair colour.
- Outfit: full wetsuit, springsuit, boardshorts, rash vest with boardshorts, bikini, one-piece; main and accent colours. Suits carry the flame W on the chest (never on bare skin).
- Board: shortboard, fish, longboard, soft-top; board colour; graphic: WaveSlave flames, stripes, checker, or plain. Fins, a leash, a tail pad.
- Stance: regular or goofy.
- Pose: crouched in the tube, hand dragging on the wall, bottom turn, standing tall, horns up, shaka.
- Face: grin, stoked, focused, metal scream (tongue out).
- Extras: shades, headband, helmet.

**How it is drawn.** Cartoon proportions (big head, hands and feet) built from simple rounded parts. Toon shading with two tones, an orange-red glow on the edges, and dark outlines. In the Neon scene the same body is drawn as glowing wireframe lines.

**Riding.** The surfer's spot is kept relative to the curl: how far into the tube (from deep inside to out on the open wall) and how high on the face. Each frame the surfer is placed on the face at that spot, so they move with the barrel as the wave peels. The board points along the peel, its deck tilts with the face, and the face looks toward the opening. Dragging the surfer on screen changes the spot, kept within the barrel and the wall.

## Cameras

- **Free**: drag to orbit, pinch to zoom, always around the wave's peak (as now).
- **GoPro nose cam**: a mount just ahead of the board, looking back at the surfer inside the barrel (the barrel selfie). Wide angle.
- **GoPro head cam**: the surfer's view out through the opening. Wide angle.

## Scenes

Each scene sets the water colours, the sky, the sun, and the land around the wave, all in one tap:

| Scene | Water | Sky and light | Land |
|---|---|---|---|
| Neon | The 90s grid with the power colours and flow (as now) | Dark | None |
| Tropical | Clear turquoise, bright aqua where the lip is thin | Blue sky, high sun | White sand, palm trees |
| Taiwan east coast | Deep blue | Clouds, soft light | Dark pebble beach, green mountains behind (like Donghe) |
| Golden hour | Deep teal | Low sunset sun | The lip glows orange where the sun shines through; dark shore |
| Stormy | Grey-green, foam streaks | Dark clouds, rain | Grey shore |

Realistic touches: deep water darker and the thin lip lighter (the sun shining through), white foam on the lip and the whitewater, spray off the lip, sun glints on the face. It looks like a good surf video game, not a photo, so it stays smooth on phones. Heavy effects (spray, rain) are reduced on phones.

## Snapshot and share

- Tapping Snapshot freezes the wave and renders the current camera view at 1080 × 1920.
- A 2D canvas adds the WaveSlave wordmark and "waveslave.tw" in a corner, the caption in the flame lettering ("My dream wave: 3.2 m Slab", or "Custom" when the sliders don't match a style; in 中文 "我的夢幻浪：3.2 公尺" plus the style's 中文 name, the names checked with Bryan), and the name or IG handle if typed.
- **Share** uses the phone's share menu with the picture (Web Share with files), adding the link waveslave.tw/#dreamwave where the app takes text with a picture. Where sharing a file isn't available, **Save** downloads the picture (on iPhone it opens the picture to long-press and save).
- Nothing is uploaded and there is no sign-in, so it costs nothing to run.
- The link waveslave.tw/#dreamwave opens the tab (in developer mode until go-live).

## How it is built

- **Files.** The tab's code lives in `web/dreamwave.js` (the loader, like `web/chat.js`) and `web/dreamwave/` (the wave model, surfer, scenes, snapshot and panels as separate files). three.js r149 is kept in `web/vendor/three.min.js` so it comes from the site itself and the service worker keeps it for offline use. `build-site.sh` copies these files and gives `dreamwave.js` a version in its address (`?v=<checksum>`), as it does for `chat.js`.
- **Loading.** Nothing 3D loads until someone opens the Dream Wave tab, so the Forecast page stays as fast as now. Rendering pauses when the tab is hidden.
- **The tab.** `template.html` gets a third tab button (`data-v="dw"`, `data-zh="夢幻浪"`) and a view container. The button shows only while `PUBLIC` (in `web/dreamwave.js`, false until go-live) or developer mode is on; `keepWorld()` tells the tab when developer mode changes, as it does for the chat.
- **Remembered.** The surfer and the last wave are kept in localStorage, inside try/catch, so the tab still works in private browsing.
- **Language.** All labels in English and 中文, following the page's language switch.
- **Phones.** Fewer wave stations, pixel ratio at most 2, fewer flow tracers and particles; aim for smooth play on a mid-range Android.

## Build order

Each step ends with pictures for Bryan.

1. The tab with the wave, the styles and the sliders (developer mode only).
2. The surfer maker and riding in the barrel, with the cameras.
3. The five scenes: stills of each for Bryan's OK, then the finished scenes.
4. Snapshot and share.
5. Checks on iPhone and Android sizes.
6. Bryan tries it on his phone; reorganise the interface where he asks.

## Testing

- Node tests for the wave model: the crest has no bump ahead of the break, and the six styles stay inside the slider ranges.
- Surfer placement: the surfer stays on the face and inside the barrel for every style and spot.
- Snapshot: the picture is 1080 × 1920, with the logo, link and caption drawn.
- Page check (Playwright, like `tests/map/check.js`): the tab is hidden outside developer mode, opens in it, loads three.js only on first open, and the Forecast tab works as before.
- Screenshots of each scene and camera for Bryan.

## Not in this build

Photo uploads or AI faces, sign-in, saving waves to a server, video or GIF export, bodyboards, going live.
