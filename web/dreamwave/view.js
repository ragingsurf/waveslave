// Dream Wave: the 3D view (spec "What people see and do", "Cameras"). The Neon Wave artifact's renderer (Version 17): the dark wave
// with its glowing grid, the power colours and the water flow, the free orbit camera that always circles the peak, and the play button
// with the time bar. One view per page: the tab hides and shows it, and its loop runs only while it shows.
(function (DW) { "use strict";
  const { J, cl, sm, applyShape, fitLoop } = DW.shell;
  const C = c => new THREE.Color(c);
  const NEON = { bg: '#05010d', ramp: ['#1b2cff', '#00d5ff', '#00ff9c', '#fff200', '#ff7a00', '#ff1fd1'], grey: '#5a6a8a', sea: '#07021a', floor: '#3a0a5a',
    flow: ['#ffffff', '#00f0ff', '#ff3df2'] };

  function create(layer, S) {
    const stage = layer.querySelector('.dw-stage') || layer;
    const phone = () => Math.min(innerWidth, innerHeight) < 600;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', DW.t('tab'));
    stage.appendChild(canvas);
    const R = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
    R.setPixelRatio(Math.min(2, devicePixelRatio || 1)); R.setClearColor(C(NEON.bg));
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(40, 1, 0.1, 6000);
    const RAMP = NEON.ramp.map(C), GREY = C(NEON.grey), SEA = C(NEON.sea);

    // The wave surface: DW.frame fills the positions, three's normals feed the flow.
    const F = DW.frame.create(S, phone() ? 0.25 : 0.2), { NX, M } = F;
    const col = new Float32Array(NX * M * 3), geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(F.pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(F.idx, 1));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; scene.add(mesh);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: SEA, roughness: 0.6 }));
    sea.rotation.x = -Math.PI / 2; sea.position.y = -0.05; scene.add(sea);
    const floor = new THREE.GridHelper(600, 300, C(NEON.floor), C(NEON.floor)); floor.position.y = -0.04; scene.add(floor);
    const hemi = new THREE.HemisphereLight(0xdfe6ee, 0x202328, 0.5); scene.add(hemi);
    const L1 = new THREE.DirectionalLight(0xffffff, 0.7); L1.position.set(-12, 40, 16); scene.add(L1);
    const L2 = new THREE.DirectionalLight(0xffffff, 0.25); L2.position.set(30, 10, -20); scene.add(L2);

    let showPower = true;
    const tmp = new THREE.Color();
    function ramp(v, c) { const s = cl(v, 0, 1) * 5, k = Math.min(4, Math.floor(s)); return c.copy(RAMP[k]).lerp(RAMP[k + 1], s - k); }
    function paint() {
      const pos = F.pos, pw = F.pw;
      for (let n = 0; n < NX * M; n++) {
        const y = pos[n * 3 + 1], w = sm(cl(y / (0.12 * S.height), 0, 1));
        if (showPower) { ramp(pw[n], tmp).multiplyScalar(0.55 + 0.45 * w); tmp.lerp(SEA, 1 - sm(cl(pw[n] / 0.07, 0, 1))); }
        else tmp.copy(SEA).lerp(GREY, w);
        col[n * 3] = tmp.r; col[n * 3 + 1] = tmp.g; col[n * 3 + 2] = tmp.b;
      }
      geo.attributes.color.needsUpdate = true;
    }
    function build(t) {
      const A = DW.frame.build(F, S, t);
      geo.attributes.position.needsUpdate = true; geo.computeVertexNormals(); F.nrm = geo.attributes.normal.array;
      paint(); view.lastA = A; emit('build', A); return A;
    }
    // Neon grid: glowing lines over a near-black wave, sharing the wave's position and colour buffers.
    const gi = [];
    for (let i = 0; i < NX; i += 5) for (let j = J.back; j < M - 1; j++) gi.push(i * M + j, i * M + j + 1);
    for (let j = J.back; j < M; j += 4) for (let i = 0; i < NX - 5; i += 5) gi.push(i * M + j, (i + 5) * M + j);
    const gGeo = new THREE.BufferGeometry(); gGeo.setAttribute('position', geo.attributes.position); gGeo.setAttribute('color', geo.attributes.color); gGeo.setIndex(gi);
    const grid = new THREE.LineSegments(gGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    grid.frustumCulled = false; scene.add(grid);
    mat.color.setRGB(0.14, 0.14, 0.14); mat.polygonOffset = true; mat.polygonOffsetFactor = 1; mat.polygonOffsetUnits = 1;

    // Flow tracers: comet trails (lines), glowing heads and beads (points).
    const NT = phone() ? 360 : 650, K = 14, flow = DW.flow.create(NT, K);
    const tPos = new Float32Array(NT * (K - 1) * 2 * 3), tCol = new Float32Array(NT * (K - 1) * 2 * 3);
    const tGeo = new THREE.BufferGeometry(); tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3)); tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
    const trails = new THREE.LineSegments(tGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    trails.frustumCulled = false; scene.add(trails);
    const hPos = new Float32Array(NT * 3), hCol = new Float32Array(NT * 3);
    const hGeo = new THREE.BufferGeometry(); hGeo.setAttribute('position', new THREE.BufferAttribute(hPos, 3)); hGeo.setAttribute('color', new THREE.BufferAttribute(hCol, 3));
    const dot = document.createElement('canvas'); dot.width = dot.height = 64;
    { const c = dot.getContext('2d'), g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 64); }
    const dotTex = new THREE.CanvasTexture(dot);
    const hMat = new THREE.PointsMaterial({ size: 0.6, map: dotTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const heads = new THREE.Points(hGeo, hMat); heads.frustumCulled = false; scene.add(heads);
    const bPos = new Float32Array(NT * K * 3), bCol = new Float32Array(NT * K * 3);
    const bGeo = new THREE.BufferGeometry(); bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3)); bGeo.setAttribute('color', new THREE.BufferAttribute(bCol, 3));
    const beads = new THREE.Points(bGeo, new THREE.PointsMaterial({ size: 0.3, map: dotTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    beads.frustumCulled = false; scene.add(beads);
    const FLOWC = NEON.flow.map(C);
    function drawFlow() {
      let o = 0;
      flow.tr.forEach((T, n) => {
        const a = T.alive ? T.a : 0, FL = FLOWC[T.c || 0];
        for (let k = 0; k < K - 1; k++) {
          const w0 = a * (1 - k / (K - 1)), w1 = a * (1 - (k + 1) / (K - 1));
          for (let c = 0; c < 3; c++) { tPos[o + c] = T.hist[k * 3 + c]; tPos[o + 3 + c] = T.hist[(k + 1) * 3 + c]; }
          tCol[o] = FL.r * w0; tCol[o + 1] = FL.g * w0; tCol[o + 2] = FL.b * w0;
          tCol[o + 3] = FL.r * w1; tCol[o + 4] = FL.g * w1; tCol[o + 5] = FL.b * w1; o += 6;
        }
        bPos.set(T.hist, n * K * 3);
        for (let k = 0; k < K; k++) { const w = 0.8 * a * (1 - k / K); bCol[(n * K + k) * 3] = FL.r * w; bCol[(n * K + k) * 3 + 1] = FL.g * w; bCol[(n * K + k) * 3 + 2] = FL.b * w; }
        hPos.set(T.hist.subarray(0, 3), n * 3); hCol[n * 3] = FL.r * a; hCol[n * 3 + 1] = FL.g * a; hCol[n * 3 + 2] = FL.b * a;
      });
      tGeo.attributes.position.needsUpdate = tGeo.attributes.color.needsUpdate = true;
      hGeo.attributes.position.needsUpdate = hGeo.attributes.color.needsUpdate = true;
      bGeo.attributes.position.needsUpdate = bGeo.attributes.color.needsUpdate = true;
    }
    let flowOn = true;
    const neon = { grid, trails, heads, beads, floor };

    // The free camera: drag to orbit, pinch or wheel to zoom, always around the wave's peak; it opens on the artifact's ¾ view.
    const O = { target: new THREE.Vector3(S.peakX, 1.1, 0.5), az: 34, el: 15, r: 30, fov: 40 };
    let lift = 0;   // share of the screen height the picture is lifted by, so the wave stays above an open sheet
    function place() {
      const a = cam.aspect, az = O.az * Math.PI / 180, el = O.el * Math.PI / 180;
      cam.fov = Math.min(80, O.fov / Math.min(1, a) ** 0.5);
      cam.position.set(O.target.x + O.r * Math.cos(el) * Math.sin(az), O.target.y + O.r * Math.sin(el), O.target.z + O.r * Math.cos(el) * Math.cos(az));
      cam.lookAt(O.target);
      applyLift();
    }
    function applyLift() {
      const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
      if (lift) cam.setViewOffset(w, h, 0, h * lift, w, h); else cam.clearViewOffset();
      cam.updateProjectionMatrix();
    }
    const ptrs = new Map(); let pinch0 = 0, r0 = 0;
    const handlers = [];   // pointer grabs added by later parts (the surfer drag): (event) → true to take the pointer
    canvas.addEventListener('pointerdown', e => {
      if (ptrs.size === 0 && handlers.some(h => h(e))) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); r0 = O.r; }
    });
    canvas.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return;
      const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (view.camMode !== 'free') return;
      if (ptrs.size === 1) { O.az -= (e.clientX - prev[0]) * 0.3; O.el = cl(O.el + (e.clientY - prev[1]) * 0.25, -5, 89); place(); }
      else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch0 > 0) { O.r = cl(r0 * pinch0 / d, 4, 160); place(); } }
    });
    const up = e => { ptrs.delete(e.pointerId); pinch0 = 0; };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', e => { e.preventDefault(); if (view.camMode !== 'free') return; O.r = cl(O.r * Math.exp(e.deltaY * 0.001), 4, 160); place(); }, { passive: false });
    // Safari's own pinch gestures would zoom the page under the layer.
    for (const k of ['gesturestart', 'gesturechange']) canvas.addEventListener(k, e => e.preventDefault());

    function resize() {
      const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
      R.setSize(w, h, false); cam.aspect = w / h; place(); if (!running) render();
    }
    const ro = window.ResizeObserver ? new ResizeObserver(() => resize()) : null;
    if (ro) ro.observe(stage); else addEventListener('resize', resize);

    // The play button and the time bar.
    const bar = document.createElement('div'); bar.className = 'dw-time';
    const playBtn = document.createElement('button'); playBtn.type = 'button'; playBtn.className = 'dw-play';
    const scrub = document.createElement('input'); scrub.type = 'range'; scrub.min = 0; scrub.step = 0.01; scrub.className = 'dw-scrub';
    const timeEl = document.createElement('span'); timeEl.className = 'dw-clock';
    bar.append(playBtn, scrub, timeEl); layer.appendChild(bar);
    let t = reduce ? 7 : 0, playing = !reduce;
    function showPlay() { playBtn.textContent = playing ? '❚❚' : '▶'; const k = playing ? 'pause' : 'play'; playBtn.setAttribute('aria-label', DW.t(k)); playBtn.title = DW.t(k); scrub.setAttribute('aria-label', DW.t('tab')); }
    function setPlaying(p) { playing = !!p; showPlay(); emit('play', playing); }
    playBtn.addEventListener('click', () => setPlaying(!playing));
    scrub.addEventListener('input', () => { t = +scrub.value; build(t); showTime(); if (!running) render(); });
    function showTime() { scrub.max = S.loopTime; scrub.value = t; timeEl.textContent = t.toFixed(1) + ' s'; }

    // Listeners: 'frame' (each frame drawn), 'build' (the wave rebuilt), 'play', and later parts' own events.
    const subs = {};
    function on(ev, fn) { (subs[ev] = subs[ev] || []).push(fn); }
    function emit(ev, ...a) { (subs[ev] || []).forEach(fn => { try { fn(...a); } catch (e) { if (window.__dwTest) console.error(e); } }); }

    let running = false, raf = 0, prev = 0, lastBuild = 0;
    function render() { R.render(scene, cam); view.frames++; }
    function frame(now) {
      raf = 0; if (!running) return;
      const dt = Math.min(0.05, prev ? (now - prev) / 1000 : 0); prev = now;
      if (playing) { t = (t + dt) % S.loopTime; if (now - lastBuild > 32 || !view.lastA) { build(t); lastBuild = now; } showTime(); }
      else if (!view.lastA) build(t);
      if (flowOn && trails.visible && (playing || !reduce)) { DW.flow.step(flow, F, playing ? dt : 0); drawFlow(); }
      emit('frame', dt);
      render(); raf = requestAnimationFrame(frame);
    }
    function resume() { if (running) return; running = true; prev = 0; resize(); raf = requestAnimationFrame(frame); }
    function pause() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
    document.addEventListener('visibilitychange', () => { if (document.hidden) { if (running) { pause(); view._hiddenRun = true; } } else if (view._hiddenRun) { view._hiddenRun = false; resume(); } });

    const view = {
      S, F, lastA: null, frames: 0, canvas, scene, camera: cam, renderer: R, mesh, geo, mat, sea, hemi, sun: L1, fill: L2, neon, orbit: O, camMode: 'free',
      time: () => t,
      setTime(v) { t = cl(+v, 0, S.loopTime); build(t); showTime(); if (!running) render(); },
      play(p) { setPlaying(p); }, playing: () => playing,
      shape(k, v) { applyShape(S, k, v); fitLoop(S); if (t > S.loopTime) t = 0; build(t); showTime(); if (!running) render(); emit('shape', k, v); },
      pause, resume, running: () => running, render, build: () => build(t), paint,
      power(on) { showPower = !!on; paint(); }, flow(on) { flowOn = !!on; trails.visible = heads.visible = beads.visible = flowOn; },
      lift(v) { lift = v || 0; applyLift(); if (!running) render(); }, place, phone, on, emit, grab: h => handlers.push(h),
      relang() { showPlay(); canvas.setAttribute('aria-label', DW.t('tab')); emit('relang'); }
    };
    place(); showPlay(); build(t); showTime(); resize();
    return view;
  }
  DW.view = { create, NEON };
})(window.DW = window.DW || {});
