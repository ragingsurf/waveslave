// Dream Wave: the wave model (docs/superpowers/specs/2026-10-29-dream-wave-design.md, "The wave"). WaveShell from the Neon Wave artifact
// (Version 17, surf-app/dream-wave/source/neon-wave-v17.html) unchanged, plus its Shape sliders, the six one-tap styles, applyShape and
// fitLoop, with the wave settings S passed in. No three.js and no DOM, so node:test runs it (tests/dreamwave/shell.test.js).
(function (DW) { "use strict";
  const WAVE = {
    height: 2.6, backSlope: 14, faceSteepness: 82, faceHollowness: 0.6,
    lipThickness: 0.30, lipThrow: 2.1, tubeSize: 2.3, tubeRoundness: 0.8,
    peelAngle: 30, peelSpeed: 4.0, wallLength: 3.0, closedLength: 3.6,
    shoulderLength: 10.4, shoulderTaper: 0.72,
    scoop: 0,        // how far the face under the barrel is pushed back into the wave (x wave height)
    troughAngle: 26,   // face angle where it meets the flat water: low = long flat ramp that bulges out, high = short clean curve
    whitewater: { amount: 0.7, depth: 1.2 }, spray: { amount: 0.5 },
    // A-frame
    aFrame: true, peakX: 0, peelLeft: true, peelRight: true,
    loopTime: 9, standTime: 3.0, pitchTime: 1.5, crestZ: 0,
    bend: 4        // seen from above the crest is a U: the walls curve in toward the beach by this many m, 15 m from the peak.
                   // A parabola: the walls turn toward pointing straight at the beach but never past it (never more than a 180° U).
  };
  const D2R = Math.PI / 180, cl = (v, a, b) => Math.max(a, Math.min(b, v)),
    lerp = (a, b, t) => a + (b - a) * t, sm = t => t * t * (3 - 2 * t);
  const SEG = { far: 10, back: 40, outer: 46, inner: 46, face: 50, front: 10 };
  const J = { back: 10, outer: 50, inner: 96, face: 142, front: 192, M: 202 };

  // Timeline: swell stands up, the peak pitches, then both sides peel outward.
  function timeState(S, t) {
    const Lt = S.height / Math.tan(S.peelAngle * D2R), T0 = S.standTime, T1 = T0 + S.pitchTime;
    const end = sm(cl((t - (S.loopTime - 1.2)) / 1.2, 0, 1));
    const g = lerp(lerp(0.35, 1, sm(cl(t / T0, 0, 1))), 0.35, end);
    const lip = Math.max(0.02, sm(cl((t - 0.55 * T0) / (0.45 * T0), 0, 1)) * (1 - end));
    let d;
    if (t < T0) d = -Lt - 0.5;
    else if (t < T1) d = lerp(-Lt - 0.5, 0, sm((t - T0) / (T1 - T0)));
    else d = S.peelSpeed * (t - T1);
    const phase = t < T0 ? 'Standing up' : t < T1 ? 'Pitching' : t < S.loopTime - 1.2 ? 'Peeling' : 'Fading';
    return { t, g, lip, d, Lt, phase, form: sm(cl((g - 0.35) / 0.65, 0, 1)) };
  }
  // Stage of the station at distance u past its break point (one side of the A-frame).
  // Every hand-over (tube -> wall -> shoulder -> flat) eases in and out, so the crest has no kinks or bumps.
  function stageU(S, u, A) {
    const H = S.height * A.g, Lt = A.Lt, tubeH = (S.tubeSize + S.lipThickness) * A.g;
    const st = { u, p: 0, f: 1, aTop: S.faceSteepness, hol: S.faceHollowness, Ht: H, fill: 0, broken: 0 };
    if (u < 0) {
      const c = sm(cl(-u / S.closedLength, 0, 1));
      st.p = 1; st.fill = c; st.broken = 1;
      st.Ht = lerp(tubeH, 0.85 * H, c) * lerp(1, 0.45, sm(cl((-u - S.closedLength) / 6, 0, 1)));
    } else if (u < Lt) {
      st.p = sm(1 - u / Lt); st.Ht = lerp(H, tubeH, st.p);
    } else if (u > Lt + S.wallLength) {
      const s = cl((u - Lt - S.wallLength) / S.shoulderLength, 0, 1), e = sm(s);
      st.f = Math.max(0.02, 1 - sm(cl(s / 0.6, 0, 1)));
      st.aTop = lerp(S.faceSteepness, 32, e); st.hol = lerp(S.faceHollowness, 0, e);
    }
    st.f = Math.max(0.02, st.f * A.lip);
    st.aTop = lerp(30, st.aTop, A.form); st.hol = lerp(0.05, st.hol, A.form);
    if (A.lip < 0.5 && st.p > 0) st.p *= A.lip * 2;
    return st;
  }
  // A-frame height along the beach, fixed in place (1 at the peak): the crest slants down in one steady line from the
  // peak and eases out only at the far ends. The break travels along this slope, so nothing tall rides along with the peel.
  function envelope(S, ax) {
    const span = S.wallLength + S.shoulderLength, q = ax / span, b = 0.05;
    if (q <= 1) return 1 - S.shoulderTaper * (q < b ? q * q / (2 * b) : q - b / 2);
    const h1 = 1 - S.shoulderTaper * (1 - b / 2), tq = S.shoulderTaper / span / h1 * (ax - span);
    return h1 / (1 + tq + 0.5 * tq * tq);
  }
  function stage(S, x, A) {
    const ax = Math.abs(x - S.peakX), right = x >= S.peakX;
    const peels = S.aFrame ? (right ? S.peelRight : S.peelLeft) : right;
    const d = peels ? A.d : -(A.Lt + S.wallLength);
    const u = ax - d, st = stageU(S, u, A);
    let e = envelope(S, ax);
    if (u < 0) e = Math.min(e, envelope(S, Math.max(0, d)));   // whitewater behind the break never stands taller than the wave breaking now
    st.Ht *= e; st.env = e;           // the whole section (lip, tube, face) scales with the local height
    return st;
  }
  function bez(P0, P1, P2, P3, t) {
    const m = 1 - t, a = m * m * m, b = 3 * m * m * t, c = 3 * m * t * t, d = t * t * t;
    return [a * P0[0] + b * P1[0] + c * P2[0] + d * P3[0], a * P0[1] + b * P1[1] + c * P2[1] + d * P3[1]];
  }
  function resample(pts, n) {
    const L = [0];
    for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const T = L[L.length - 1], out = []; let j = 0;
    for (let k = 0; k < n; k++) {
      const s = T * k / (n - 1);
      while (j < pts.length - 2 && L[j + 1] < s) j++;
      const w = T > 1e-9 ? cl((s - L[j]) / Math.max(1e-9, L[j + 1] - L[j]), 0, 1) : 0;
      out.push([lerp(pts[j][0], pts[j + 1][0], w), lerp(pts[j][1], pts[j + 1][1], w)]);
    }
    return out;
  }
  // Cross-section [z,y] (J.M points) from far back to front flat. Lip root at z = 0. H = scaled height.
  function section(S, st, g) {
    g *= st.env || 1;
    const H = S.height * g, p = st.p, f = st.f;
    const lt = S.lipThickness * g * f, ceil = st.Ht - lt;
    const yr = lerp(ceil - 0.06 * H * f, 0.85 * ceil, p);   // the face stays near full height through the pocket; the lip throwing out makes the tube
    const thr = f * lerp(0.12 * H, S.lipThrow * g, p);
    const q = Math.pow(p, 1 + 2 * S.tubeRoundness);   // lip comes down to the water in a smooth bowl curve
    const yT = (ceil - 0.03 * H * f) * (1 - q);
    const rnd = S.tubeRoundness, P0 = [0, yr], P3 = [thr, yT], N = 48;
    let inner, outer;
    const curl = hc => {
      const P1 = [lerp(0.5 * thr, -0.15 * thr * p, rnd), hc], P2 = [lerp(0.5 * thr, thr, rnd), hc];
      inner = []; outer = [];
      for (let i = 0; i <= N; i++) inner.push(bez(P0, P1, P2, P3, i / N));
      for (let i = 0; i <= N; i++) {
        const a = inner[Math.max(0, i - 1)], b = inner[Math.min(N, i + 1)];
        let dz = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dz, dy) || 1; dz /= l; dy /= l;
        const th = lt * (1 - Math.pow(i / N, 1.5));
        outer.push([inner[i][0] - dy * th, inner[i][1] + dz * th]);
      }
      return Math.max(...outer.map(q => q[1]));
    };
    const hc0 = Math.max(yr, (8 * ceil - yr - yT) / 6), top = curl(hc0);
    // Keep the crest at the same height through the pocket as on the open wall (no hump running ahead of the curl).
    const want = st.Ht - 0.038 * H * f;
    if (p > 1e-3 && Math.abs(top - want) > 1e-3) curl(Math.max(0.8 * yr, hc0 + (want - top) / 0.75));
    // Crest apex found between samples (not snapped to one), so the crest and back glide smoothly from station to station.
    let ia = 0; for (let i = 1; i <= N; i++) if (outer[i][1] > outer[ia][1]) ia = i;
    let apex = outer[ia], from = ia + 1;
    if (ia > 0 && ia < N) {
      const y0 = outer[ia - 1][1], y1 = outer[ia][1], y2 = outer[ia + 1][1], den = y0 - 2 * y1 + y2;
      const tt = den < -1e-9 ? cl(0.5 * (y0 - y2) / den, -0.5, 0.5) : 0, nb = outer[tt < 0 ? ia - 1 : ia + 1], a = Math.abs(tt);
      apex = [lerp(outer[ia][0], nb[0], a), y1 - 0.25 * (y0 - y2) * tt];
      from = tt < 0 ? ia : ia + 1;
    }
    const za = apex[0], ya = apex[1];
    const Lb = Math.PI * ya / (2 * Math.tan(S.backSlope * D2R));
    const back = []; for (let i = 0; i <= 30; i++) { const s = i / 30; back.push([za - Lb * (1 - s), ya * (0.5 - 0.5 * Math.cos(Math.PI * s))]); }
    const face = [[0, yr]]; let z = 0; const aB = S.troughAngle, k = 1 + 4 * Math.max(0, st.hol), aT = Math.min(st.aTop, 89.5), bul = Math.max(0, -st.hol);
    for (let i = 1; i <= 60; i++) {
      const y0 = yr * (1 - (i - 1) / 60), y1 = yr * (1 - i / 60), ym = 0.5 * (y0 + y1);
      const r = ym / Math.max(1e-6, yr);
      // negative hollowness: the face bulges out (fat / mushy): steep low down, rounding off gently toward the top
      const a = lerp(aB + (aT - aB) * Math.pow(r, k), 22 + (Math.min(aT, 80) - 22) * Math.pow(1 - r, 0.6), bul) * D2R;
      z += (y0 - y1) / Math.tan(a); face.push([z, y1]);
    }
    // Under the barrel the lip root sits lower, so the face is shorter; stretch only its lower part out to where the
    // open wall's face meets the water, so the bottom of the wave lines up evenly (no belly bulging out beside the barrel).
    const yRef = ceil - 0.06 * H * f;
    if (yr > 1e-6 && yRef > yr) {
      const add = z * (yRef / yr - 1);
      for (const q of face) q[0] += add * sm(1 - q[1] / yr);
      z += add;
    }
    // Under the barrel the face is scooped back into the wave (like Teahupoo): strongest in the pocket, none on the open wall.
    const scoop = S.scoop * H * p * (1 - (st.fill || 0));
    if (scoop > 0) for (const q of face) { const s = 1 - q[1] / Math.max(1e-6, yr); q[0] -= scoop * Math.sin(Math.PI * s); }
    if (st.aTop > 90) {   // steeper than vertical: the face under the lip undercuts back beneath it (ledge / slab)
      const O = yr * Math.tan((Math.min(st.aTop, 120) - 90) * D2R) * 1.2;
      for (const q of face) { const s = 1 - q[1] / Math.max(1e-6, yr); q[0] -= O * 6.75 * s * (1 - s) * (1 - s); }
    }
    const far = [[za - Lb - 60, 0], [za - Lb, 0]], front = [[z, 0], [z + 60, 0]];
    const oS = resample([apex].concat(outer.slice(from)), SEG.outer), iS = resample(inner.slice().reverse(), SEG.inner);
    let fS = resample(face, SEG.face), frS = resample(front, SEG.front);
    const w = st.fill || 0;
    if (w > 0) {
      const oR = oS.slice().reverse(), tip = oS[oS.length - 1];
      for (let i = 0; i < iS.length; i++) iS[i] = [lerp(iS[i][0], oR[i][0], w), lerp(iS[i][1], oR[i][1] - 0.06, w)];
      const root = iS[iS.length - 1];
      fS = fS.map((q, i) => { const s = i / (fS.length - 1); return [lerp(q[0], lerp(root[0], tip[0], s), w), lerp(q[1], lerp(root[1], tip[1], s) - 0.06 * (1 - s), w)]; });
      const z0 = lerp(frS[0][0], tip[0], w); frS = frS.map((q, i) => [z0 + 60 * i / (frS.length - 1), 0]);
    }
    st.thr = thr;
    return [].concat(resample(far, SEG.far), resample(back, SEG.back), oS, iS, fS, frS);
  }

  // The Shape sliders, in the panel's order. Names, end labels and units come from the strings (slider_<k>, ends_<k>); fmt(v, t) gives
  // the value as the artifact shows it, with t = DW.t for the units.
  const SLIDERS = [
    { k: 'height', min: 1, max: 6, step: 0.1, fmt: (v, t) => v.toFixed(1) + ' ' + t('unit_m') },
    { k: 'lipThickness', min: 0.05, max: 0.8, step: 0.01, fmt: (v, t) => Math.round(v * 100) + ' ' + t('unit_cm') },
    { k: 'length', min: 5, max: 26, step: 0.5, fmt: (v, t) => t('unit_side', { n: Math.round(v) }) },
    { k: 'bend', min: 0, max: 10, step: 0.1, fmt: (v, t) => v.toFixed(1) + ' ' + t('unit_m') },
    { k: 'shoulderTaper', min: 0.1, max: 0.9, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
    { k: 'faceSteepness', min: 15, max: 115, step: 1, fmt: (v, t) => Math.round(v) + '°' + (v > 90 ? ' ' + t('unit_over') : '') },
    { k: 'faceHollowness', min: -1, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
    { k: 'scoop', min: 0, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
    { k: 'troughAngle', min: 5, max: 45, step: 1, fmt: v => Math.round(v) + '°' },
    { k: 'peelSpeed', min: 1, max: 10, step: 0.1, fmt: (v, t) => v.toFixed(1) + ' ' + t('unit_ms') },
    { k: 'lipThrow', min: 0.5, max: 6, step: 0.1, fmt: (v, t) => v.toFixed(1) + ' ' + t('unit_m') }
  ];
  const LENGTH0 = WAVE.wallLength + WAVE.shoulderLength, TUBE = WAVE.tubeSize / WAVE.height, WALL = WAVE.wallLength / LENGTH0;
  // A fresh copy of the wave settings: Length = open wall + shoulder on each side of the peak (13.4 m), the loop fitted to it.
  function fresh() { const S = JSON.parse(JSON.stringify(WAVE)); S.length = LENGTH0; fitLoop(S); return S; }
  // One slider value, plus the values that follow from it: the barrel grows with the wave, Length stretches wall and shoulder together.
  function applyShape(S, k, v) {
    S[k] = v; if (k === 'height') S.tubeSize = v * TUBE;
    if (k === 'length') { S.wallLength = v * WALL; S.shoulderLength = v * (1 - WALL); }
  }
  // The loop runs until the break reaches the end of the walls, then fades, so a fast peel or a short wave never leaves flat water.
  function fitLoop(S) {
    return S.loopTime = Math.min(16, Math.max(7, S.standTime + S.pitchTime + (S.wallLength + S.shoulderLength) / S.peelSpeed + 1.2));
  }
  // One-tap wave styles (A-frame = the defaults, and Reset).
  const STYLES = [
    { id: 'aframe', v: Object.fromEntries(SLIDERS.map(c => [c.k, c.k === 'length' ? LENGTH0 : WAVE[c.k]])) },
    { id: 'slab', v: { height: 3, lipThickness: 0.8, length: 12, bend: 4, shoulderTaper: 0.5, faceSteepness: 105, faceHollowness: 1, scoop: 0.6, troughAngle: 45, peelSpeed: 5, lipThrow: 4 } },
    { id: 'reef', v: { height: 3.6, lipThickness: 0.5, length: 16, bend: 3, shoulderTaper: 0.5, faceSteepness: 95, faceHollowness: 0.85, scoop: 0.3, troughAngle: 36, peelSpeed: 5.5, lipThrow: 3.2 } },
    { id: 'longwall', v: { height: 1.8, lipThickness: 0.2, length: 26, bend: 1.5, shoulderTaper: 0.3, faceSteepness: 62, faceHollowness: 0.25, scoop: 0, troughAngle: 16, peelSpeed: 2.5, lipThrow: 1 } },
    { id: 'mushy', v: { height: 1.2, lipThickness: 0.1, length: 12, bend: 2, shoulderTaper: 0.5, faceSteepness: 38, faceHollowness: -0.7, scoop: 0, troughAngle: 10, peelSpeed: 2.2, lipThrow: 0.6 } },
    { id: 'closeout', v: { height: 2.4, lipThickness: 0.4, length: 20, bend: 0, shoulderTaper: 0.12, faceSteepness: 86, faceHollowness: 0.5, scoop: 0, troughAngle: 30, peelSpeed: 10, lipThrow: 2.4 } }
  ];
  // The style whose eleven values each sit within half a slider step of S, else null (a wave of their own: "Custom").
  function styleOf(S) {
    const s = STYLES.find(s => SLIDERS.every(c => Math.abs(+S[c.k] - s.v[c.k]) <= c.step / 2 + 1e-9));
    return s ? s.id : null;
  }
  DW.shell = { WAVE, timeState, stage, section, J, cl, lerp, sm, SLIDERS, STYLES, fresh, applyShape, fitLoop, styleOf };
})(window.DW = window.DW || {});
