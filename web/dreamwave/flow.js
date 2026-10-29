// Dream Wave: power, the sampled wave surface and the water flow (spec "The wave"). WavePower and WaveFlow from the Neon Wave artifact
// (Version 17) unchanged but for reading DW.shell, and the artifact's build(t) as DW.frame without three.js or the painting: it fills the
// surface positions, the power per point and the station stages. No three.js and no DOM (tests/dreamwave/flow.test.js).
(function (DW) { "use strict";
DW.power = (function () {
  const { J, cl } = DW.shell;
  // Proxy for energy: face steepness x local height x closeness to the pocket; broken water lower and fading.
  function segWeight(j) {
    if (j < J.back || j >= J.front) return 0;
    if (j < J.outer) return 0.2;     // back
    if (j < J.inner) return 0.8;     // outside of the lip
    return 1;                        // under the lip + face
  }
  function value(S, st, A, j, y, steep) {
    const H = S.height, Lt = A.Lt;
    const w = segWeight(j); if (!w) return 0;
    const hT = Math.pow(cl(y / (0.9 * H), 0, 1), 0.6);
    const hTerm = (j >= J.inner && j < J.face) ? Math.max(hT, 0.65 * st.p) : hT;
    let pocket, broken = 1;
    if (st.u >= 0) { const r = (st.u - 0.25 * Lt) / (1.1 * Lt); pocket = Math.exp(-r * r); }
    else { pocket = 0.6; broken = 0.5 * Math.exp(st.u / S.closedLength); }
    const v = w * (0.3 + 0.7 * steep) * hTerm * (0.2 + 0.8 * pocket) * broken * (0.3 + 0.7 * A.form);
    return cl(v * 1.15, 0, 1);
  }

  return { value };
})();

DW.flow = (function () {
  const { J, cl } = DW.shell;
  function create(n, K) {
    return { n, K, tr: Array.from({ length: n }, () => ({ alive: false, hist: new Float32Array(K * 3), hn: 0, a: 0 })) };
  }
  // F: frame {pos, nrm, pw, NX, M, x0, dx, st[]}
  function sample(F, i, j, out) {
    const i0 = Math.floor(i), j0 = Math.floor(j), fi = i - i0, fj = j - j0, M = F.M;
    const i1 = Math.min(F.NX - 1, i0 + 1), j1 = Math.min(M - 1, j0 + 1);
    for (let c = 0; c < 3; c++) {
      const a = F.pos[(i0 * M + j0) * 3 + c], b = F.pos[(i0 * M + j1) * 3 + c], d = F.pos[(i1 * M + j0) * 3 + c], e = F.pos[(i1 * M + j1) * 3 + c];
      const na = F.nrm[(i0 * M + j0) * 3 + c];
      out[c] = (a * (1 - fj) + b * fj) * (1 - fi) + (d * (1 - fj) + e * fj) * fi + na * 0.05;
    }
    return out;
  }
  // How hard the curl pulls water toward itself at this station: strongest in the pocket, fading along the wall, ~0 on the shoulder.
  function pull(F, st) {
    if (st.u < 0) return 0;
    const r = (st.u - 0.25 * F.Lt) / (1.4 * F.Lt); return Math.exp(-r * r);
  }
  // Which way along the beach the curl is from x: back toward the peak (the broken part) on each side of the A-frame.
  function toCurl(F, x) { return x >= F.peakX ? -1 : 1; }
  function pwAt(F, i, j) { return F.pw[Math.round(i) * F.M + Math.round(j)]; }
  function spawn(F, T) {
    for (let k = 0; k < 20; k++) {
      const i = 1 + Math.random() * (F.NX - 3);
      const st = F.st[Math.round(i)];
      if (st.Ht < 0.6) continue;
      const r = Math.random(), drain = r < 0.22;
      const j = drain ? J.front - 6 + Math.random() * 6.6 : r < 0.72 ? J.face + 2 + Math.random() * 40 : r < 0.88 ? J.back + 8 + Math.random() * 30 : J.outer + Math.random() * 20;
      const odds = drain ? 0.05 + 0.9 * pull(F, st) : 0.04 + 2.2 * pwAt(F, i, j) * (st.broken ? 0.25 : 1);
      if (st.broken && drain || Math.random() > odds) continue;
      T.alive = true; T.mode = 0; T.c = drain ? 1 : 0; T.i = i; T.j = j; T.age = 0; T.life = 2 + Math.random() * 2; T.fade = 1;
      const p = sample(F, i, j, [0, 0, 0]);
      for (let h = 0; h < T.hist.length; h += 3) { T.hist[h] = p[0]; T.hist[h + 1] = p[1]; T.hist[h + 2] = p[2]; }
      T.v = [0, 0, 0]; T.pos = p.slice(); return;
    }
  }
  function step(sys, F, dt) {
    const p = [0, 0, 0], q = [0, 0, 0];
    for (const T of sys.tr) {
      if (!T.alive) { if (Math.random() < 0.25) spawn(F, T); continue; }
      T.age += dt;
      if (T.mode === 0) {                       // on the surface
        const st = F.st[Math.round(T.i)], j = T.j, pw = pwAt(F, T.i, j);
        const inUp = j >= J.inner;              // under the lip or on the face: moves toward lower j (up, then out along the lip)
        let v;                                  // m/s along the surface
        const pk = pull(F, st);
        if (j >= J.front) v = 1.2 + 2 * pk;     // drain-back: drawn off the bottom toward the face
        else if (j >= J.face) v = 0.5 + 3.2 * pw;    // drawn up the face, strongest in the pocket
        else if (j >= J.inner) v = 2.5 + 3 * pw;
        else if (j >= J.outer) v = 2.5 + 2.5 * pw;
        else v = 0.25 + 0.5 * pw;               // back: slow, forward and up
        if (st.broken) v *= 0.5;
        const j2 = Math.round(cl(j + (inUp ? -1 : 1), 0, F.M - 1)), jr = Math.round(j);
        const b = (Math.round(T.i) * F.M);
        const ds = Math.max(0.02, Math.hypot(F.pos[(b + j2) * 3 + 1] - F.pos[(b + jr) * 3 + 1], F.pos[(b + j2) * 3 + 2] - F.pos[(b + jr) * 3 + 2]));
        T.j = j + (inUp ? -1 : 1) * v * dt / ds;
        if (inUp) {                             // in the pocket the water runs diagonally up the face and into the curl
          const x = F.pos[(b + jr) * 3], lat = 1.1 * pk * (j >= J.front ? 0.4 : 1);
          T.i = cl(T.i + toCurl(F, x) * lat * v * dt / F.dx, 0, F.NX - 1.001);
        }
        T.c = T.j > J.front - 8 ? 1 : 0;
        const lipWeak = st.thr < 0.35 || st.p < 0.04 && st.f < 0.3;
        if (T.j < J.face && T.j >= J.outer && lipWeak) { T.mode = 2; T.v = [0, 0, 0]; }
        else if ((inUp && T.j <= J.inner) || (!inUp && T.j >= J.inner - 1)) {   // reached the lip tip: thrown
          sample(F, T.i, J.inner - 2, q); sample(F, T.i, J.inner - 1, p);
          const dz = p[2] - q[2], dy = p[1] - q[1], l = Math.hypot(dz, dy) || 1, sp = 2.5 + 3 * st.p;
          T.v = [toCurl(F, p[0]) * 0.8 * pull(F, st) * sp, dy / l * sp, dz / l * sp]; T.mode = 1; T.c = 2; T.pos = p.slice();
        } else T.pos = sample(F, T.i, T.j, p).slice();
        if (T.j > F.M - 2 || T.j < J.back) T.mode = 2;
      } else if (T.mode === 1) {                // thrown with the lip
        T.v[1] -= 9.8 * dt; T.pos[0] += T.v[0] * dt; T.pos[1] += T.v[1] * dt; T.pos[2] += T.v[2] * dt;
        if (T.pos[1] < 0.08) { T.pos[1] = 0.08; T.mode = 2; T.v = [T.v[0] * 0.3, 0, Math.abs(T.v[2]) * 0.4]; }
      } else {                                  // landed / fading
        T.fade -= dt * 1.8; T.pos[0] += T.v[0] * dt; T.pos[2] += T.v[2] * dt;
        if (T.fade <= 0) T.alive = false;
      }
      if (T.age > T.life && T.mode === 0) T.mode = 2, T.v = [0, 0, 0];
      if (T.alive && T.pos) {            // trail points every 40 ms so the streak shows ~0.5 s of travel
        T.ht = (T.ht || 0) + dt; if (T.ht >= 0.04) { T.ht = 0; T.hist.copyWithin(3, 0, T.hist.length - 3); }
        T.hist[0] = T.pos[0]; T.hist[1] = T.pos[1]; T.hist[2] = T.pos[2]; T.a = Math.min(1, T.age * 3) * T.fade; }
    }
  }
  return { create, step };
})();

// The wave surface sampled every DX m along the beach (34 m each side of the peak), J.M points across. The view shares pos with its mesh
// and fills nrm from three's vertex normals (the flow reads them).
DW.frame = (function () {
  const { J, timeState, stage, section } = DW.shell, HALF = 34;
  function create(S, DX) {
    const NX = 2 * Math.round(HALF / DX) + 1, M = J.M, MID = (NX - 1) / 2;
    const idx = new (NX * M > 65535 ? Uint32Array : Uint16Array)((NX - 1) * (M - 1) * 6);
    for (let i = 0, o = 0; i < NX - 1; i++) for (let j = 0; j < M - 1; j++) { const a = i * M + j, b = a + M; idx.set([a, b, a + 1, a + 1, b, b + 1], o); o += 6; }
    return { pos: new Float32Array(NX * M * 3), pw: new Float32Array(NX * M), st: new Array(NX), idx, nrm: null, NX, M, MID, x0: -MID * DX, dx: DX, peakX: S.peakX, Lt: 1 };
  }
  function build(F, S, t) {
    const A = timeState(S, t), sh = S.crestZ, { pos, pw, NX, M, MID, dx: DX } = F; F.Lt = A.Lt; F.peakX = S.peakX;
    for (let i = MID; i < NX; i++) {
      const x = (i - MID) * DX + S.peakX;
      const fill = (ii, sx) => {
        const st = stage(S, sx, A), sec = section(S, st, A.g), dx = (sx - S.peakX) / 15, bz = sh + S.bend * dx * dx;
        F.st[ii] = st;
        for (let j = 0; j < M; j++) {
          const o = (ii * M + j) * 3, z = sec[j][0] + bz, y = sec[j][1];
          pos[o] = sx; pos[o + 1] = y; pos[o + 2] = z;
          const a = sec[Math.max(0, j - 1)], b = sec[Math.min(M - 1, j + 1)];
          const steep = Math.abs(b[1] - a[1]) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1);
          pw[ii * M + j] = DW.power.value(S, st, A, j, y, steep);
        }
      };
      fill(i, x);
      const mi = NX - 1 - i;
      if (mi !== i) {
        const left = 2 * S.peakX - x;
        if (S.peelLeft === S.peelRight) {       // symmetric: mirror
          for (let j = 0; j < M; j++) { const o = (i * M + j) * 3, m = (mi * M + j) * 3; pos[m] = left; pos[m + 1] = pos[o + 1]; pos[m + 2] = pos[o + 2]; pw[mi * M + j] = pw[i * M + j]; }
          F.st[mi] = F.st[i];
        } else fill(mi, left);
      }
    }
    return A;
  }
  return { create, build };
})();
})(window.DW = window.DW || {});
