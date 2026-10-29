// Dream Wave: the cartoon surfer (spec "The surfer"), from the character spike Bryan saw (surf-app/dream-wave/character-lineup.png).
// Local frame: x = board nose, y = up off the deck. The spike's body is goofy (chest toward -z); regular is the same body with every
// joint's z negated (never a negative scale). Look: two flat tones, an orange-red glow along the edges, bold dark outlines (90s metal).
(function (DW) { "use strict";
DW.surfer = (function () {
  const V = (x, y, z) => new THREE.Vector3(x, y, z), UP = V(0, 1, 0);
  const grad = new THREE.DataTexture(new Uint8Array([105, 105, 105, 255, 255, 255, 255, 255]), 2, 1);
  grad.minFilter = grad.magFilter = THREE.NearestFilter; grad.needsUpdate = true; grad.userData.keep = true;
  const rim = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <output_fragment>',
    '{ float rim = 1.0 - max(dot(normalize(normal), normalize(vViewPosition)), 0.0); outgoingLight += vec3(1.0, 0.38, 0.06) * smoothstep(0.5, 1.0, rim) * 1.15; }\n#include <output_fragment>'); };
  let mats = new Map();   // this surfer's materials (a fresh set for each make, so a rebuild can dispose the old one)
  const toon = (c, map) => { const k = c + (map ? map.uuid : ''); if (mats.has(k)) return mats.get(k);
    const m = new THREE.MeshToonMaterial({ color: c, gradientMap: grad, map: map || null }); m.onBeforeCompile = rim; mats.set(k, m); return m; };
  const flat = c => { const k = 'flat' + c; if (!mats.has(k)) mats.set(k, new THREE.MeshBasicMaterial({ color: c })); return mats.get(k); };
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x140300, side: THREE.BackSide }); lineMat.userData.keep = true;
  lineMat.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * 0.024;'); };
  function part(g, geo, m, line = true) { const k = new THREE.Group(); k.add(new THREE.Mesh(geo, m)); if (line) k.add(new THREE.Mesh(geo, lineMat)); g.add(k); return k; }
  function limb(g, a, b, r, m, line = true) { const d = b.clone().sub(a), L = d.length();
    const k = part(g, new THREE.CapsuleGeometry(r, Math.max(0.001, L), 6, 14), m, line); k.position.copy(a).addScaledVector(d, 0.5); k.quaternion.setFromUnitVectors(UP, d.normalize()); return k; }
  function ball(g, p, r, m, line = true) { const k = part(g, new THREE.SphereGeometry(r, 20, 14), m, line); k.position.copy(p); return k; }

  // ---------- boards ----------
  const BOARDS = {
    short: { L: 0.93, W: 0.25, T: 0.035, fins: [[-0.8, 0, 0.1], [-0.66, 0.17, 0.09], [-0.66, -0.17, 0.09]], pad: true },
    fish: { L: 0.8, W: 0.27, T: 0.04, fins: [[-0.6, 0.17, 0.1], [-0.6, -0.17, 0.1]], pad: true },
    long: { L: 1.4, W: 0.29, T: 0.05, fins: [[-1.15, 0, 0.2]], pad: false },
    soft: { L: 1.05, W: 0.29, T: 0.07, fins: [[-0.9, 0, 0.07], [-0.78, 0.18, 0.06], [-0.78, -0.18, 0.06]], pad: false }
  };
  function outline(type) {
    const b = BOARDS[type], L = b.L, W = b.W, s = new THREE.Shape();
    if (type === 'short') { s.moveTo(L, 0); s.quadraticCurveTo(0.45, W * 0.98, -0.1, W); s.quadraticCurveTo(-0.7, W * 0.95, -L + 0.04, W * 0.62);
      s.lineTo(-L, W * 0.4); s.lineTo(-L, -W * 0.4); s.lineTo(-L + 0.04, -W * 0.62); s.quadraticCurveTo(-0.7, -W * 0.95, -0.1, -W); s.quadraticCurveTo(0.45, -W * 0.98, L, 0); }
    else if (type === 'fish') { s.moveTo(L, 0); s.quadraticCurveTo(L * 0.6, W * 1.02, -0.05, W); s.quadraticCurveTo(-0.55, W * 0.96, -L, W * 0.58);
      s.lineTo(-L + 0.17, 0); s.lineTo(-L, -W * 0.58); s.quadraticCurveTo(-0.55, -W * 0.96, -0.05, -W); s.quadraticCurveTo(L * 0.6, -W * 1.02, L, 0); }
    else { s.moveTo(L, 0); s.bezierCurveTo(L, W * 0.75, L * 0.68, W, 0, W); s.bezierCurveTo(-L * 0.7, W, -L, W * 0.82, -L, W * 0.42);
      s.lineTo(-L, -W * 0.42); s.bezierCurveTo(-L, -W * 0.82, -L * 0.7, -W, 0, -W); s.bezierCurveTo(L * 0.68, -W, L, -W * 0.75, L, 0); }
    return s;
  }
  function deckTex(o, b) {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const g = c.getContext('2d');
    g.fillStyle = o.boardColor; g.fillRect(0, 0, 1024, 256);
    if (o.graphic === 'flames') {
      const f = g.createLinearGradient(0, 0, 600, 0); f.addColorStop(0, '#ff2a00'); f.addColorStop(0.45, '#ff8a00'); f.addColorStop(0.8, '#ffd400'); f.addColorStop(1, '#fff7b0');
      g.fillStyle = f; g.strokeStyle = '#200300'; g.lineWidth = 7; g.lineJoin = 'round'; g.beginPath(); g.moveTo(0, 18);
      for (const [x0, yc, len, bend] of [[40, 70, 520, 28], [30, 128, 620, 0], [40, 186, 500, -26]]) {
        g.lineTo(x0, yc - 44); g.bezierCurveTo(x0 + len * 0.45, yc - 46, x0 + len * 0.7, yc - 20 + bend, x0 + len, yc + bend);
        g.bezierCurveTo(x0 + len * 0.62, yc + 4 + bend * 0.5, x0 + len * 0.35, yc + 30, x0, yc + 44); }
      g.lineTo(0, 238); g.closePath(); g.fill(); g.stroke();
    } else if (o.graphic === 'stripes') {
      for (const [y, h, col] of [[92, 22, o.accent], [118, 20, '#ffffff'], [142, 22, o.accent]]) { g.fillStyle = col; g.fillRect(0, y, 1024, h); }
    } else if (o.graphic === 'checker') {
      for (let x = 0; x < 1024; x += 32) for (let y = 64; y < 192; y += 32) { g.fillStyle = ((x + y) / 32) % 2 ? '#111111' : '#f2f2f2'; g.fillRect(x, y, 32, 32); }
    }
    g.fillStyle = 'rgba(60,30,10,0.6)'; g.fillRect(0, 126, 1024, 4);                     // stringer
    if (b.pad) { g.fillStyle = '#1b1b1f'; g.fillRect(0, 54, 150, 148); g.fillStyle = '#34343a'; for (let y = 60; y < 200; y += 14) g.fillRect(0, y, 150, 5); }
    const t = new THREE.CanvasTexture(c); t.repeat.set(1 / (2 * b.L), 1 / (2 * b.W)); t.offset.set(0.5, 0.5); return t;
  }
  function board(o) {
    const b = BOARDS[o.board], g = new THREE.Group(); g.name = 'board';
    const geo = new THREE.ExtrudeGeometry(outline(o.board), { depth: b.T, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.02, bevelSegments: 3, curveSegments: 28 });
    geo.rotateX(-Math.PI / 2); geo.translate(0, -b.T - 0.015, 0);
    const deck = toon('#ffffff', deckTex(o, b)), rail = toon(o.boardColor);
    g.add(new THREE.Mesh(geo, [deck, rail]), new THREE.Mesh(geo, lineMat));
    const fin = new THREE.Shape(); fin.moveTo(0.06, 0); fin.quadraticCurveTo(0.0, -0.05, -0.07, -1); fin.lineTo(-0.1, -1); fin.quadraticCurveTo(-0.11, -0.4, -0.06, 0); fin.closePath();
    for (const [x, z, h] of b.fins) { const fg = new THREE.ExtrudeGeometry(fin, { depth: 0.012, bevelEnabled: false }); fg.scale(1, h, 1); fg.translate(0, 0, -0.006);
      const f = part(g, fg, toon(o.board === 'soft' ? '#1d6fd8' : '#26262c')); f.position.set(x, -b.T - 0.03, z); f.rotation.y = -z * 0.25; }
    return g;
  }

  // ---------- poses (joints in the local frame) ----------
  const P = (a) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, V(...v)]));
  const LEGS_LOW = { bAnk: [-0.27, 0.08, 0.02], fAnk: [0.27, 0.08, 0.02], bToe: [-0.25, 0.05, -0.14], fToe: [0.31, 0.05, -0.14] };
  const POSES = {
    crouch: P({ ...LEGS_LOW, bKnee: [-0.02, 0.22, -0.16], fKnee: [0.42, 0.36, -0.16], pelvis: [0.05, 0.41, 0.05], bHip: [-0.04, 0.4, 0.06], fHip: [0.14, 0.39, 0.02],
      chest: [0.24, 0.7, 0.04], bSh: [0.1, 0.78, 0.12], fSh: [0.36, 0.72, 0], bEl: [0.08, 0.56, -0.18], bHand: [0.24, 0.44, -0.3], fEl: [0.58, 0.7, -0.12], fHand: [0.8, 0.6, -0.2], head: [0.4, 0.98, -0.04] }),
    drag: P({ ...LEGS_LOW, bKnee: [-0.02, 0.22, -0.16], fKnee: [0.42, 0.36, -0.16], pelvis: [0.05, 0.41, 0.05], bHip: [-0.04, 0.4, 0.06], fHip: [0.14, 0.39, 0.02],
      chest: [0.24, 0.7, 0.04], bSh: [0.1, 0.78, 0.12], fSh: [0.36, 0.72, 0], bEl: [-0.1, 0.58, 0.36], bHand: [-0.3, 0.4, 0.55], fEl: [0.58, 0.7, -0.12], fHand: [0.8, 0.6, -0.2], head: [0.4, 0.98, -0.04] }),
    bottom: P({ ...LEGS_LOW, bKnee: [-0.08, 0.26, -0.14], fKnee: [0.4, 0.4, -0.14], pelvis: [0.06, 0.46, 0], bHip: [-0.03, 0.46, 0.02], fHip: [0.15, 0.45, -0.02],
      chest: [0.3, 0.76, -0.1], bSh: [0.16, 0.84, -0.04], fSh: [0.42, 0.78, -0.16], bEl: [-0.06, 0.64, -0.1], bHand: [-0.26, 0.5, -0.16], fEl: [0.66, 0.82, -0.24], fHand: [0.9, 0.84, -0.3], head: [0.46, 1.04, -0.16] }),
    tall: P({ ...LEGS_LOW, bKnee: [-0.22, 0.45, -0.06], fKnee: [0.25, 0.46, -0.06], pelvis: [0, 0.82, 0.02], bHip: [-0.1, 0.82, 0.03], fHip: [0.1, 0.82, 0.01],
      chest: [0.04, 1.18, 0], bSh: [-0.14, 1.22, 0.02], fSh: [0.2, 1.2, -0.02], bEl: [-0.34, 1.02, 0.06], bHand: [-0.5, 0.86, 0.04], fEl: [0.42, 1.04, -0.08], fHand: [0.6, 0.92, -0.12], head: [0.08, 1.48, -0.04] }),
    claim: P({ ...LEGS_LOW, bKnee: [-0.22, 0.45, -0.06], fKnee: [0.25, 0.46, -0.06], pelvis: [0, 0.82, 0.02], bHip: [-0.1, 0.82, 0.03], fHip: [0.1, 0.82, 0.01],
      chest: [0.02, 1.18, 0], bSh: [-0.16, 1.22, 0], fSh: [0.18, 1.22, 0], bEl: [-0.38, 1.46, -0.06], bHand: [-0.5, 1.72, -0.1], fEl: [0.4, 1.46, -0.06], fHand: [0.52, 1.72, -0.1], head: [0.04, 1.48, -0.06] }),
    shaka: P({ ...LEGS_LOW, bKnee: [-0.22, 0.45, -0.06], fKnee: [0.25, 0.46, -0.06], pelvis: [0, 0.82, 0.02], bHip: [-0.1, 0.82, 0.03], fHip: [0.1, 0.82, 0.01],
      chest: [0.04, 1.18, 0], bSh: [-0.14, 1.22, 0.02], fSh: [0.2, 1.2, -0.02], bEl: [-0.34, 1.02, 0.06], bHand: [-0.5, 0.86, 0.04], fEl: [0.36, 1.1, -0.26], fHand: [0.4, 1.36, -0.4], head: [0.08, 1.48, -0.04] })
  };
  const GESTURE = { claim: ['horns', 'horns'], shaka: ['fist', 'shaka'] };
  function hand(g, el, wr, r, m, gesture, mz) {
    const d = wr.clone().sub(el).normalize(), c = wr.clone().addScaledVector(d, r * 0.45);
    let s = new THREE.Vector3().crossVectors(d, UP); if (s.lengthSq() < 1e-4) s.set(0, 0, 1); s.normalize(); s.multiplyScalar(mz);   // the mirror of the goofy hand
    const palm = ball(g, c, r, m);
    if (gesture === 'shaka') { limb(g, c, c.clone().addScaledVector(s, r * 1.8).addScaledVector(d, r * 0.4), r * 0.34, m); limb(g, c, c.clone().addScaledVector(s, -r * 1.8).addScaledVector(d, r * 0.6), r * 0.32, m); }
    else if (gesture === 'horns') { for (const k of [-1, 1]) limb(g, c.clone().addScaledVector(s, k * r * 0.5), c.clone().addScaledVector(s, k * r * 0.62).addScaledVector(d, r * 2.2), r * 0.3, m);
      limb(g, c, c.clone().addScaledVector(s, r * 0.2).addScaledVector(d, r * 0.2).add(V(0, 0, -r * 0.9 * mz)), r * 0.3, m); }
    else limb(g, c, c.clone().addScaledVector(s, r * 0.95).addScaledVector(d, r * 0.5), r * 0.34, m);
    return palm;
  }

  // ---------- head, face, hair ----------
  function head(o, skin, hairM, accM, mz) {
    const h = new THREE.Group(), R = 0.19; h.name = 'head';
    const fwd = V(0.85, 0.05, -0.52 * mz).normalize(), side = UP.clone().cross(fwd).normalize(), up = fwd.clone().cross(side).normalize(), back = fwd.clone().negate();
    const at = (f, s, u) => fwd.clone().multiplyScalar(f).addScaledVector(side, s).addScaledVector(up, u);
    const Q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, fwd));
    const face = (k, roll = 0) => { k.quaternion.copy(Q); k.rotateZ(roll); return k; };
    ball(h, V(0, 0, 0), R, skin);
    for (const s of [-1, 1]) ball(h, at(0, R * 0.98 * s, -0.01), 0.045, skin);                       // ears
    ball(h, at(R * 0.98, 0, -0.005), 0.032, skin);                                                      // nose
    const brow = { grin: 0.12, stoked: -0.1, focus: 0.38, scream: 0.55 }[o.face] || 0.12, browUp = o.face === 'stoked' ? 0.125 : 0.105;
    for (const s of [-1, 1]) {
      ball(h, at(0.155, 0.072 * s, 0.045), 0.048, flat('#ffffff'), true); ball(h, at(0.193, 0.074 * s, 0.04), 0.025, flat('#111111'), false);
      ball(h, at(0.213, 0.064 * s, 0.054), 0.009, flat('#ffffff'), false);
      face(part(h, new THREE.BoxGeometry(0.085, 0.022, 0.02), toon('#1a120c')), -brow * s * mz).position.copy(at(0.168, 0.072 * s, browUp));
    }
    if (o.face === 'grin') face(part(h, new THREE.TorusGeometry(0.07, 0.015, 6, 18, Math.PI), flat('#2a0a04'), false), Math.PI).position.copy(at(0.17, 0, -0.06));
    else if (o.face === 'focus') face(part(h, new THREE.CapsuleGeometry(0.012, 0.07, 3, 6), flat('#2a0a04'), false), Math.PI / 2).position.copy(at(0.178, 0, -0.075));
    else {
      const big = o.face === 'scream', mouth = part(h, new THREE.SphereGeometry(big ? 0.072 : 0.06, 16, 10), flat('#3a0606'), false);
      face(mouth).position.copy(at(0.155, 0, big ? -0.085 : -0.075)); mouth.scale.set(1, big ? 0.95 : 0.62, 0.55);
      ball(h, at(0.17, 0, big ? -0.03 : -0.05), 0.0, flat('#ffffff'), false);
      face(part(h, new THREE.BoxGeometry(big ? 0.09 : 0.08, 0.022, 0.03), flat('#ffffff'), false)).position.copy(at(0.18, 0, big ? -0.035 : -0.052));
      if (big) limb(h, at(0.18, 0, -0.11), at(0.25, 0, -0.17), 0.026, toon('#ff5e7a'), true);           // metal tongue
    }
    // hair
    const cap = (r = 0.186) => ball(h, back.clone().multiplyScalar(0.03).addScaledVector(up, 0.055), r, hairM);
    if (o.extra !== 'helmet') {
      if (o.hair === 'spiky') { cap(); for (let k = 0; k < 7; k++) { const a = -1.2 + k * 0.4, d = back.clone().multiplyScalar(0.5 * Math.cos(a) + 0.35).addScaledVector(up, 0.75).addScaledVector(side, 0.55 * Math.sin(a)).normalize();
          const sp = part(h, new THREE.ConeGeometry(0.08, 0.34, 8), hairM); sp.position.copy(d.clone().multiplyScalar(0.21)); sp.quaternion.setFromUnitVectors(UP, d); } }
      else if (o.hair === 'short') cap(0.18);
      else if (o.hair === 'long') { cap(); limb(h, back.clone().multiplyScalar(0.12).addScaledVector(up, 0.06), back.clone().multiplyScalar(0.2).addScaledVector(up, -0.34), 0.1, hairM);
        for (const s of [-1, 1]) limb(h, at(-0.04, 0.15 * s, 0.05), at(-0.1, 0.17 * s, -0.3), 0.055, hairM); }
      else if (o.hair === 'bun') { cap(0.18); ball(h, back.clone().multiplyScalar(0.12).addScaledVector(up, 0.2), 0.085, hairM); }
      else if (o.hair === 'curly') { cap(0.18); for (let k = 0; k < 16; k++) { const a = k * 2.4, e = 0.15 + (k % 4) * 0.22;
          const d = back.clone().multiplyScalar(Math.cos(a) * Math.cos(e) * 0.8 + 0.25).addScaledVector(side, Math.sin(a) * Math.cos(e)).addScaledVector(up, Math.sin(e) + 0.25).normalize();
          ball(h, d.multiplyScalar(0.2), 0.072, hairM); } }
      else if (o.hair === 'cap') { cap(0.18); const dome = part(h, new THREE.SphereGeometry(0.2, 22, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), accM); dome.position.copy(up.clone().multiplyScalar(0.03));
        const brim = part(h, new THREE.BoxGeometry(0.17, 0.016, 0.12), accM); face(brim).position.copy(back.clone().multiplyScalar(0.22).addScaledVector(up, 0.04)); }
    }
    if (o.extra === 'helmet') { const dome = part(h, new THREE.SphereGeometry(0.215, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.44), toon('#d7261e')); dome.position.copy(up.clone().multiplyScalar(0.05).addScaledVector(back, 0.03)); }
    if (o.extra === 'headband') { const b = part(h, new THREE.TorusGeometry(0.192, 0.024, 8, 32), accM); b.quaternion.setFromUnitVectors(V(0, 0, 1), up); b.position.copy(up.clone().multiplyScalar(0.085)); }
    if (o.extra === 'shades') { const sh = part(h, new THREE.TorusGeometry(0.2, 0.036, 8, 24, 2.3), toon('#1c0a02'));
      sh.quaternion.setFromUnitVectors(V(0, 0, 1), up); sh.rotateZ(Math.atan2(fwd.z, fwd.x) * -1 - 1.15); sh.position.copy(up.clone().multiplyScalar(0.045)); }
    return h;
  }

  let logoTex = null;
  function chestLogo(g, J, r, mz) {
    if (!logoTex) { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
      const f = x.createLinearGradient(0, 20, 0, 108); f.addColorStop(0, '#fff7b0'); f.addColorStop(0.35, '#ffd400'); f.addColorStop(0.65, '#ff8a00'); f.addColorStop(1, '#ff3d00');
      x.lineJoin = 'round'; x.beginPath(); x.moveTo(10, 22); x.lineTo(34, 108); x.lineTo(64, 52); x.lineTo(94, 108); x.lineTo(118, 22); x.lineTo(98, 22); x.lineTo(90, 70); x.lineTo(64, 24); x.lineTo(38, 70); x.lineTo(30, 22); x.closePath();
      x.fillStyle = f; x.fill(); x.lineWidth = 6; x.strokeStyle = '#200300'; x.stroke(); logoTex = new THREE.CanvasTexture(c); logoTex.userData.keep = true; }
    const d = J.chest.clone().sub(J.pelvis).normalize(), n = V(0, 0, -mz).addScaledVector(d, -V(0, 0, -mz).dot(d)).normalize();
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.13), new THREE.MeshBasicMaterial({ map: logoTex, transparent: true })); p.name = 'chestLogo';
    p.position.copy(J.pelvis.clone().lerp(J.chest, 0.72)).addScaledVector(n, r + 0.004);
    p.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(d.clone().cross(n).normalize(), d, n)); g.add(p);
  }
  // ---------- the whole surfer ----------
  const OUTFIT = {   // torso, pelvis, upper arm, forearm, thigh, shin: 's' suit colour, 'a' accent, 'k' skin
    full: 'ssasas', spring: 'ssakak', shorts: 'kakkak', vest: 'sassak', bikini: 'kskkkk', onepiece: 'sskkkk'
  };
  // The choices people pick (spec "Options people pick"), each list in the panel's order, and the lineup's spiky surfer as the default.
  const OPTIONS = {
    skin: ['#f6d3b3', '#eebc8f', '#e0ac7e', '#c98d5f', '#b97a50', '#8d5a35', '#6b4226', '#4a2c18'],
    build: ['slim', 'broad'],
    hair: ['spiky', 'short', 'long', 'bun', 'curly', 'cap'],
    hairColor: ['#120c08', '#2b1a10', '#3b2416', '#7a4a26', '#e8bf4f', '#b8471e', '#d9d9d9', '#ff3d7f'],
    outfit: ['full', 'spring', 'shorts', 'vest', 'bikini', 'onepiece'],
    suit: ['#17171c', '#e63946', '#17b3a6', '#2f7de1', '#5b2fb0', '#b6e600', '#ff8a00', '#f2f2f2'],
    accent: ['#ff4a12', '#ffd23f', '#e63946', '#1d2a5c', '#17b3a6', '#ff3d7f', '#f2f2f2', '#17171c'],
    board: ['short', 'fish', 'long', 'soft'],
    boardColor: ['#f6f3ea', '#f2f2f2', '#ffd23f', '#d9a066', '#2f7de1', '#d7261e', '#17b3a6', '#17171c'],
    graphic: ['flames', 'stripes', 'checker', 'solid'],
    stance: ['regular', 'goofy'],
    pose: ['crouch', 'drag', 'bottom', 'tall', 'claim', 'shaka'],
    face: ['grin', 'stoked', 'focus', 'scream'],
    extra: ['none', 'shades', 'headband', 'helmet']
  };
  const DEFAULT = { skin: '#c98d5f', build: 'broad', hair: 'spiky', hairColor: '#2b1a10', outfit: 'full', suit: '#17171c', accent: '#ff4a12',
    board: 'short', boardColor: '#f6f3ea', graphic: 'flames', stance: 'regular', pose: 'crouch', face: 'grin', extra: 'none' };
  // A surfer with only known values: anything missing or no longer offered takes the default.
  function clean(o) { const out = {}; for (const k in DEFAULT) out[k] = o && OPTIONS[k].includes(o[k]) ? o[k] : DEFAULT[k]; return out; }
  const mirror = (J, mz) => mz > 0 ? J : Object.fromEntries(Object.entries(J).map(([k, v]) => [k, V(v.x, v.y, -v.z)]));
  // The Neon scene's surfer: the same body drawn as glowing lines, each part's wireframe in its own colour, brightened, additive.
  function wire(g) {
    const swap = [];
    g.traverse(k => { if (k.isMesh) swap.push(k); });
    for (const m of swap) {
      const parent = m.parent, mat = [].concat(m.material)[m.material.length > 1 ? 1 : 0];
      if (mat !== lineMat) {
        const c = new THREE.Color(mat.color || 0xffffff), hsl = {}; c.getHSL(hsl); c.setHSL(hsl.h, Math.min(1, hsl.s + 0.2), Math.min(0.75, 0.45 + hsl.l * 0.5));
        const ln = new THREE.LineSegments(new THREE.WireframeGeometry(m.geometry), new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
        ln.name = m.name; ln.position.copy(m.position); ln.quaternion.copy(m.quaternion); ln.scale.copy(m.scale); parent.add(ln);
      }
      parent.remove(m); m.geometry.dispose(); for (const x of [].concat(m.material)) if (!x.userData.keep) { if (x.map && !x.map.userData.keep) x.map.dispose(); x.dispose(); }
    }
    return g;
  }
  function make(o, look = 'toon') {
    if (look === 'wire') return wire(make(o, 'toon'));
    o = clean(o); mats = new Map();
    const mz = o.stance === 'goofy' ? 1 : -1;
    const g = new THREE.Group(), skin = toon(o.skin), suit = toon(o.suit), acc = toon(o.accent), hairM = toon(o.hairColor);
    const m = c => c === 's' ? suit : c === 'a' ? acc : skin, w = OUTFIT[o.outfit], sc = o.build === 'slim' ? 0.93 : 1.08;
    const J = mirror(POSES[o.pose], mz), gest = GESTURE[o.pose] || ['fist', 'fist'];
    g.add(board(o));
    for (const s of ['b', 'f']) {
      limb(g, J[s + 'Ank'], J[s + 'Toe'], 0.052, skin);
      limb(g, J[s + 'Ank'], J[s + 'Knee'], 0.082 * sc, m(w[5])); limb(g, J[s + 'Knee'], J[s + 'Hip'], 0.1 * sc, m(w[4]));
      if (o.outfit === 'full') ball(g, J[s + 'Knee'], 0.09 * sc, toon('#2c2c33'));                      // knee pads
      ball(g, J[s + 'Sh'], 0.085 * sc, m(w[2])); limb(g, J[s + 'Sh'], J[s + 'El'], 0.072 * sc, m(w[2])); limb(g, J[s + 'El'], J[s + 'Hand'], 0.064 * sc, m(w[3]));
      const palm = hand(g, J[s + 'El'], J[s + 'Hand'], 0.078, skin, gest[s === 'b' ? 0 : 1], mz);
      if (s === 'f') palm.name = 'handFront';
    }
    ball(g, J.pelvis, 0.16 * sc, m(w[1])); limb(g, J.pelvis, J.chest, 0.18 * sc, m(w[0]));
    if (['full', 'spring', 'vest', 'onepiece'].includes(o.outfit)) chestLogo(g, J, 0.18 * sc, mz);   // flame W on the suit, never on bare skin
    if (o.outfit === 'bikini') { const d = J.chest.clone().sub(J.pelvis).normalize(); limb(g, J.chest.clone().addScaledVector(d, -0.09), J.chest.clone().addScaledVector(d, 0.02), 0.18 * sc + 0.012, suit); }
    limb(g, J.chest, J.head, 0.06, skin);
    const hd = head(o, skin, hairM, acc, mz); hd.position.copy(J.head); hd.scale.setScalar(1.15); g.add(hd);
    { const tail = V(-BOARDS[o.board].L + 0.04, 0.0, 0), ank = J.bAnk.clone();   // the leash, from the tail to the back ankle
      const cv = new THREE.CatmullRomCurve3([tail, tail.clone().lerp(ank, 0.5).add(V(-0.05, -0.04, 0.08 * mz)), ank]);
      g.add(new THREE.Mesh(new THREE.TubeGeometry(cv, 20, 0.008, 6), toon('#151515'))); }
    g.userData.o = o; g.userData.headAt = J.head.clone(); g.userData.mz = mz;
    return g;
  }
  // Frees a surfer's geometries, materials and textures (the shared outline material, shading ramp and chest logo stay).
  function dispose(g) {
    const seen = new Set();
    g.traverse(k => { if (k.geometry) k.geometry.dispose();
      for (const m of [].concat(k.material || [])) if (!seen.has(m) && !m.userData.keep) { seen.add(m); if (m.map && !m.map.userData.keep) m.map.dispose(); m.dispose(); } });
  }
  // ---- Riding (spec "Riding"): the spot is kept relative to the curl. u = how far ahead of the curl in tube lengths (0 deep inside, 1 at
  // the opening, above 1 out on the wall); h = the feet's height as a share of the local wave height.
  const SPOT = { side: 'left', u: 0.35, h: 0.2 };
  function clampSpot(s) {
    const n = (v, a, b, d) => typeof v === 'number' && isFinite(v) ? Math.max(a, Math.min(b, v)) : d;
    s = s && typeof s === 'object' ? s : {};
    return { side: s.side === 'right' || s.side === 'left' ? s.side : SPOT.side, u: n(s.u, 0.15, 1.6, SPOT.u), h: n(s.h, 0.08, 0.6, SPOT.h) };
  }
  // On a section [z, y], the first face segment (J.face to J.front, from the lip root down to the flat) that crosses height y, interpolated;
  // slope is the face angle from level in radians (past π/2 where the face undercuts).
  function spotOnFace(sec, J, y) {
    for (let j = J.face; j < J.front; j++) {
      const a = sec[j], b = sec[j + 1];
      if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) {
        const w = (a[1] - y) / (a[1] - b[1]);
        return { z: a[0] + (b[0] - a[0]) * w, slope: Math.atan2(a[1] - b[1], b[0] - a[0]) };
      }
    }
    return null;
  }
  // Where the surfer rides at time state A: their feet on the face, the travel direction along the U seen from above, the deck's tilt.
  function place(S, A, spot) {
    const { stage, section, J } = DW.shell, sp = clampSpot(spot), s = sp.side === 'left' ? -1 : 1;
    const x = S.peakX + s * (Math.max(0, A.d) + sp.u * A.Lt), sec = section(S, stage(S, x, A), A.g);
    let top = 0; for (const q of sec) if (q[1] > top) top = q[1];
    if (!(top > 0)) return null;
    let y = sp.h * top, hit = spotOnFace(sec, J, y);
    if (!hit) {   // the face doesn't reach that height here (a small Slab, a heavy lip): ride the face point nearest it instead of vanishing
      let best = J.face; for (let j = J.face; j <= J.front; j++) if (Math.abs(sec[j][1] - y) < Math.abs(sec[best][1] - y)) best = j;
      const a = sec[Math.min(best, J.front - 1)], b = sec[Math.min(best, J.front - 1) + 1];
      y = sec[best][1]; hit = { z: sec[best][0], slope: Math.max(0, Math.atan2(a[1] - b[1], b[0] - a[0])) };
    }
    const dx = (x - S.peakX) / 15, z = hit.z + S.crestZ + S.bend * dx * dx, b = 2 * S.bend * (x - S.peakX) / 225, l = Math.hypot(1, b);
    return { x, y, z, dir: [s / l, s * b / l], tilt: Math.min(hit.slope, 0.55) };
  }
  return { OPTIONS, DEFAULT, SPOT, clean, make, dispose, clampSpot, spotOnFace, place, POSES: Object.keys(POSES) };
})();
})(window.DW = window.DW || {});
