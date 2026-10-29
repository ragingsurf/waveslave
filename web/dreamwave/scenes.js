// Dream Wave: the five looks (spec "Scenes"). Each sets the water colours, the sky, the sun and the land around the wave in one tap.
// Neon is the Neon Wave artifact's look (the view's own); the four realistic ones paint the water per vertex (deep water darker, the thin
// lip lighter where the sun shines through, white foam on the lip and the whitewater), light it with the scene's sun so the face catches
// glints, and put a sky and a bay of land around the wave: the beach about 60 m toward the shore (+z), headlands at both far ends reaching
// out to sea past the wave, mountains behind. It looks like a good surf video game, not a photo, so it stays smooth on phones.
(function (DW) { "use strict";
  const LIST = ['neon', 'tropical', 'eastcoast', 'golden', 'stormy'];
  // water: deep / mid / lip / tube / foam; sky: top → horizon (golden has a middle stop); sun: colour, intensity, direction (toward the sun).
  const PAL = {
    tropical: { water: ['#0b6e8a', '#19b3c4', '#7ff0e6', '#0f8aa0', '#f6fdff'], sky: ['#2f8fe0', '#bfe9fb'], sun: ['#fff4d6', 1.25, [-0.5, 0.8, 0.35]], amb: 0.55,
      land: { sand: '#f1dfb0', rock: '#8f7d5e', hill: ['#3f8a3a', '#2c6b2e'], trunk: '#8a5a32', leaf: '#2e8b3d', palms: true }, clouds: 0 },
    eastcoast: { water: ['#0a3d5c', '#1d6f8f', '#4fb7c4', '#0e5470', '#eef6f8'], sky: ['#6d8fae', '#d3dde6'], sun: ['#fff1e0', 0.85, [0.3, 0.6, -0.5]], amb: 0.7,
      land: { sand: '#3a3a3e', rock: '#2e3236', hill: ['#2f6b3a', '#1f4d2a'], mist: '#b9c9cf' }, clouds: 10, cloud: '#eef2f5' },
    golden: { water: ['#0b3b4a', '#1e6c74', '#ffb04a', '#10424c', '#fff1d6'], sky: ['#3a2a6a', '#ff7a3d', '#ffd38a'], sun: ['#ffb35a', 1.3, [0.15, 0.12, -1]], amb: 0.4,
      land: { sand: '#1a1420', rock: '#1a1420', hill: ['#2a1c2c', '#1a1420'] }, clouds: 5, cloud: '#ff9a6a', glow: true },
    stormy: { water: ['#1d3a3a', '#3c5f58', '#7f9e95', '#23443f', '#e2e8e4'], sky: ['#3b4248', '#6b7378'], sun: ['#c9d1d4', 0.55, [0.2, 0.9, -0.3]], amb: 0.75,
      land: { sand: '#3d4240', rock: '#353a39', hill: ['#3a4a44', '#2b3632'] }, clouds: 16, cloud: '#4a5157', streaks: true, rain: '#c8d3d8' }
  };
  const C = c => new THREE.Color(c);

  // The pieces a realistic scene adds, built once per view and recoloured per scene.
  function kit(view) {
    if (view._kit) return view._kit;
    const k = view._kit = { group: new THREE.Group(), land: null };
    k.group.name = 'scene'; view.scene.add(k.group);
    // Sky: a big sphere coloured top to horizon (vertex colours, filled per scene).
    const sg = new THREE.SphereGeometry(2500, 32, 16), sc = new Float32Array(sg.attributes.position.count * 3);
    sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    k.sky = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }));
    k.sky.renderOrder = -1; k.group.add(k.sky);
    // The sun's disc, far away along the sun's direction.
    const dc = document.createElement('canvas'); dc.width = dc.height = 128;
    { const g = dc.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.95)'); r.addColorStop(0.4, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); }
    k.disc = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(dc), depthWrite: false, fog: false, transparent: true }));
    k.disc.scale.set(260, 260, 1); k.group.add(k.disc);
    // Clouds: soft blobs on the sky.
    const cc = document.createElement('canvas'); cc.width = 256; cc.height = 128;
    { const g = cc.getContext('2d'); for (let i = 0; i < 9; i++) { const x = 40 + i * 22, y = 70 - Math.sin(i / 8 * Math.PI) * 26, r = 26 + Math.sin(i * 1.7) * 8, gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 128); } }
    k.cloudTex = new THREE.CanvasTexture(cc); k.clouds = [];
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: k.cloudTex, depthWrite: false, fog: false, transparent: true }));
      const a = (i * 137.5) * Math.PI / 180, d = 900 + (i % 4) * 220; s.position.set(Math.sin(a) * d, 120 + (i % 5) * 55, Math.cos(a) * d - 200);
      s.scale.set(520 + (i % 3) * 180, 200 + (i % 2) * 90, 1); k.group.add(s); k.clouds.push(s);
    }
    k.sunLight = new THREE.DirectionalLight(0xffffff, 1); k.group.add(k.sunLight); k.group.add(k.sunLight.target);
    k.hemi = new THREE.HemisphereLight(0xffffff, 0x334455, 0.6); k.group.add(k.hemi);
    k.water = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
    k.seaMat = new THREE.MeshStandardMaterial({ color: 0x0b3b4a, roughness: 0.6, metalness: 0 });
    return k;
  }

  // The bay: beach toward the shore, headlands at both far ends reaching out to sea past the wave, hills and mountains behind.
  function land(k, L) {
    if (k.land) { k.group.remove(k.land); k.land.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
    const g = k.land = new THREE.Group(), std = c => new THREE.MeshStandardMaterial({ color: C(c), roughness: 0.95, flatShading: true });
    const beach = new THREE.Mesh(new THREE.PlaneGeometry(400, 70, 40, 4), std(L.sand)); beach.rotation.x = -Math.PI / 2;
    { const p = beach.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, 0.6 + (p.getY(i) + 35) / 70 * 2.4 - 0.08 * Math.cos(p.getX(i) * 0.05)); beach.geometry.computeVertexNormals(); }
    beach.position.set(0, 0, 95); g.add(beach);
    // A hill: a cone, flattened and jagged a little so it reads as land, not geometry.
    const hill = (x, z, r, h, c, seg = 9) => { const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg, 3), std(c)); const p = m.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > -h / 2 + 0.01 && y < h / 2 - 0.01) { const w = 1 + 0.18 * Math.sin(i * 2.3 + x); p.setX(i, p.getX(i) * w); p.setZ(i, p.getZ(i) * w); } }
      m.geometry.computeVertexNormals(); m.position.set(x, h / 2 - 1, z); g.add(m); return m; };
    for (const s of [-1, 1]) {   // the headlands
      hill(s * 120, 10, 45, 30, L.rock, 7); hill(s * 150, -60, 40, 24, L.rock, 7); hill(s * 135, -130, 30, 14, L.rock, 6);
      hill(s * 190, 40, 70, 70, L.hill[0]); hill(s * 230, -40, 60, 55, L.hill[1]);
    }
    for (let i = 0; i < 7; i++) hill(-300 + i * 100, 230 + (i % 2) * 40, 90 + (i % 3) * 20, 110 + (i % 3) * 40, L.hill[i % 2]);   // mountains behind the beach
    if (L.palms) for (let i = 0; i < 9; i++) {
      const x = -80 + i * 20 + (i % 2) * 6, z = 112 + (i % 3) * 6, h = 9 + (i % 3) * 2, p = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, h, 6), std(L.trunk)); trunk.position.y = h / 2; trunk.rotation.z = 0.12 * (i % 2 ? 1 : -1); p.add(trunk);
      for (let f = 0; f < 6; f++) { const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.7, 5, 4), std(L.leaf)); leaf.position.y = h; leaf.rotation.set(Math.PI / 2 - 0.5, f * Math.PI / 3, 0, 'YXZ'); leaf.translateY(2.3); p.add(leaf); }
      p.position.set(x, 2, z); g.add(p);
    }
    k.group.add(g);
  }

  function paintSky(k, P) {
    const sg = k.sky.geometry, pos = sg.attributes.position, col = sg.attributes.color, stops = P.sky.map(C), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const e = Math.max(0, pos.getY(i) / 2500);   // 0 at the horizon, 1 straight up
      if (stops.length === 3) { if (e < 0.18) c.copy(stops[2]).lerp(stops[1], e / 0.18); else c.copy(stops[1]).lerp(stops[0], Math.min(1, (e - 0.18) / 0.5)); }
      else c.copy(stops[1]).lerp(stops[0], Math.min(1, Math.pow(e, 0.6) * 1.2));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }

  // Water colour per vertex for a realistic scene.
  function painter(P) {
    const [deep, mid, lip, tube, foam] = P.water.map(C), c = new THREE.Color();
    return (F, col, S) => {
      const { J } = DW.shell, M = F.M, pos = F.pos, H = Math.max(0.5, S.height);
      for (let i = 0; i < F.NX; i++) {
        const st = F.st[i] || { p: 0, fill: 0 }, p = st.p || 0, fill = st.fill || 0;
        for (let j = 0; j < M; j++) {
          const n = i * M + j, y = pos[n * 3 + 1];
          c.copy(deep).lerp(mid, Math.min(1, Math.max(0, y / H)) ** 0.8);
          if (j >= J.outer && j < J.inner) c.lerp(lip, 0.35 + 0.55 * p);                       // the thin lip, lit through
          else if (j >= J.inner && j < J.face) c.lerp(tube, 0.6 * p);                           // inside the tube
          else if (j >= J.back && j < J.outer) c.lerp(lip, 0.15 * Math.min(1, y / H));
          if (Math.abs(j - J.inner) <= 7) c.lerp(foam, 0.75 * Math.min(1, 0.25 + p + (st.f < 0.5 ? 0.5 : 0)));   // foam on the lip tip
          if (fill > 0 && j >= J.outer - 6 && j < J.front + 2) c.lerp(foam, 0.85 * fill);       // whitewater
          if (P.streaks && j >= J.face && j < J.front && ((i * 7 + j * 3) % 23 < 3)) c.lerp(foam, 0.35);   // foam streaks down the face
          col[n * 3] = c.r; col[n * 3 + 1] = c.g; col[n * 3 + 2] = c.b;
        }
      }
    };
  }

  function apply(view, id) {
    if (!LIST.includes(id)) id = 'neon';
    const neon = id === 'neon', k = kit(view), n = view.neon;
    n.grid.visible = n.floor.visible = neon; view.flow(neon);
    view.hemi.visible = view.sun.visible = view.fill.visible = neon;
    k.group.visible = !neon;
    if (neon) {
      view.mesh.material = view.mat; view.sea.material = view.seaNeon; view.renderer.setClearColor(C(DW.view.NEON.bg)); view.scene.fog = null;
      view.paintWater = null;
    } else {
      const P = PAL[id];
      paintSky(k, P); land(k, P.land);
      const d = new THREE.Vector3(...P.sun[2]).normalize();
      k.sunLight.color.set(P.sun[0]); k.sunLight.intensity = P.sun[1]; k.sunLight.position.copy(d).multiplyScalar(100); k.sunLight.target.position.set(0, 0, 0);
      k.disc.position.copy(d).multiplyScalar(2200); k.disc.material.color.set(P.sun[0]); k.disc.visible = d.y > -0.05;
      k.hemi.color.set(P.sky[P.sky.length - 1]); k.hemi.groundColor.set(P.water[0]); k.hemi.intensity = P.amb;
      k.clouds.forEach((s, i) => { s.visible = i < P.clouds; s.material.color.set(P.cloud || '#ffffff'); s.material.opacity = id === 'stormy' ? 0.95 : 0.85; });
      k.seaMat.color.set(P.water[0]); view.sea.material = k.seaMat; view.mesh.material = k.water;
      const hz = C(P.sky[P.sky.length - 1]);
      view.renderer.setClearColor(hz); view.scene.fog = new THREE.Fog(hz, 180, 1400);
      view.paintWater = painter(P);
    }
    view.paint(); view.sceneId = id;
    view.render();
  }
  DW.scenes = { LIST, PAL, apply };
})(window.DW = window.DW || {});
