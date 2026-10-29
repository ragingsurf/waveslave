// Dream Wave: the bar along the bottom and its sheets (spec "What people see and do"), and what the phone remembers ("Remembered").
// Styles (six one-tap waves and Reset), Shape (the eleven sliders), Surfer, Look, Camera and a big Snapshot button; one sheet open at a
// time, from the bottom, the wave still showing above it. The state is saved in localStorage on every change, inside try/catch, and a
// saved value is used only for a key the defaults have and only when it is valid.
(function (DW) { "use strict";
  const KEY = 'waveslave-dreamwave', SHEETS = ['styles', 'shape', 'surfer', 'look', 'camera', 'snap'];
  const { SLIDERS, STYLES, styleOf, lerp, sm } = DW.shell;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (e) { return {}; } };
  const okNum = (c, v) => typeof v === 'number' && isFinite(v) && v >= c.min && v <= c.max;
  // The parts of the state the other parts fill in: each gives its defaults and checks what was saved (parts: {name: {def(), take(saved)}}).
  const PARTS = {};
  const P = { state: null, view: null, PARTS, sheets: {}, mount, relang, sheet, save, open: null, KEY };

  function save() { try { localStorage.setItem(KEY, JSON.stringify(P.state)); } catch (e) {} }

  function mount(layer, view) {
    P.view = view; const saved = read();
    P.state = { shape: {}, scene: 'neon', name: '' };
    for (const c of SLIDERS) if (okNum(c, saved.shape && saved.shape[c.k])) { P.state.shape[c.k] = saved.shape[c.k]; view.shape(c.k, saved.shape[c.k]); }
    for (const k in PARTS) { const v = PARTS[k].take(saved[k]); if (v !== null) P.state[k] = v; }
    if (typeof saved.name === 'string') P.state.name = saved.name.slice(0, 30);

    // Layout: [time bar][open sheet][bar] stacked at the bottom.
    const bottom = el('div', 'dw-bottom'), sheetBox = el('div', 'dw-sheet'), bar = el('div', 'dw-bar');
    sheetBox.hidden = true; sheetBox.setAttribute('role', 'region');
    const time = layer.querySelector('.dw-time'); if (time) bottom.appendChild(time);
    bottom.append(sheetBox, bar); layer.appendChild(bottom);
    P.bottom = bottom; P.box = sheetBox; P.bar = bar; P.buttons = {};
    for (const s of SHEETS) {
      const b = el('button', 'dw-tab' + (s === 'snap' ? ' dw-snapbtn' : '')); b.type = 'button'; b.dataset.s = s; b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => sheet(P.open === s ? null : s)); bar.appendChild(b); P.buttons[s] = b;
    }
    P.sheets.styles = stylesSheet(); P.sheets.shape = shapeSheet();
    for (const k in PARTS) if (PARTS[k].sheet) P.sheets[k === 'snapshot' ? 'snap' : k] = PARTS[k].sheet();
    for (const s of SHEETS) { if (!P.sheets[s]) P.sheets[s] = { el: el('div', 'dw-empty') }; P.sheets[s].el.hidden = true; sheetBox.appendChild(P.sheets[s].el); }
    for (const k in PARTS) if (PARTS[k].mounted) PARTS[k].mounted(view, P.state);
    relang(); refresh(); save();
  }

  // One sheet open at a time (null closes it); the picture lifts so the wave stays above it.
  function sheet(name) {
    if (name && !P.sheets[name]) name = null;
    const was = P.open; if (was === name) return;
    if (was && P.sheets[was].close) P.sheets[was].close();
    P.open = name;
    for (const s of SHEETS) { P.sheets[s].el.hidden = s !== name; P.buttons[s].setAttribute('aria-pressed', String(s === name)); }
    P.box.hidden = !name;
    if (name && P.sheets[name].open) P.sheets[name].open();
    // lift the picture by half the height the sheet takes, so the middle of the wave sits in the middle of what still shows
    const H = P.view.canvas.clientHeight || innerHeight; P.view.lift(name ? Math.min(0.35, P.box.offsetHeight / 2 / H) : 0);
    P.view.emit('sheet', name);
  }

  // ---- Styles: six chips and Reset. A tap glides every slider to the style in 700 ms (instant with reduced motion).
  let glide = 0, gliding = null;
  function stylesSheet() {
    const box = el('div', 'dw-chips'), chips = {};
    for (const s of STYLES) { const b = el('button', 'dw-chip'); b.type = 'button'; b.dataset.id = s.id; b.addEventListener('click', () => pick(s)); box.appendChild(b); chips[s.id] = b; }
    const reset = el('button', 'dw-chip dw-reset'); reset.type = 'button'; reset.addEventListener('click', () => pick(STYLES[0])); box.appendChild(reset);
    return { el: box, chips, reset };
  }
  function pick(s) {
    const id = ++glide, from = {}, t0 = performance.now(), T = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 700, S = P.view.S;
    SLIDERS.forEach(c => { from[c.k] = +S[c.k]; }); gliding = s.id; refresh();
    (function step(now) {
      if (id !== glide) return;   // another tap or a hand-moved slider took over
      const a = T ? sm(Math.min(1, Math.max(0, (now - t0) / T))) : 1;
      SLIDERS.forEach(c => DW.shell.applyShape(S, c.k, lerp(from[c.k], s.v[c.k], a)));
      P.view.shape('height', S.height);   // rebuild once with every value in
      if (a < 1) { showValues(); requestAnimationFrame(step); }
      else { gliding = null; keepShape(); refresh(); }
    })(t0);
  }
  function keepShape() { const S = P.view.S; P.state.shape = Object.fromEntries(SLIDERS.map(c => [c.k, +S[c.k]])); save(); }

  // ---- Shape: the eleven sliders with their names, end labels and values (amber VT323, with units).
  function shapeSheet() {
    const box = el('div', 'dw-sliders'), rows = {};
    for (const c of SLIDERS) {
      const row = el('div', 'dw-row'), lab = el('label', 'dw-lab'), name = el('span'), val = el('b'), input = el('input'), ends = el('div', 'dw-ends'), e0 = el('span'), e1 = el('span');
      input.type = 'range'; input.min = c.min; input.max = c.max; input.step = c.step; input.id = 'dw-sl-' + c.k; input.dataset.k = c.k; lab.htmlFor = input.id;
      lab.append(name, val); ends.append(e0, e1); row.append(lab, input, ends); box.appendChild(row);
      input.addEventListener('input', () => { glide++; gliding = null; P.view.shape(c.k, +input.value); keepShape(); refresh(); });
      rows[c.k] = { name, val, input, e0, e1 };
    }
    return { el: box, rows };
  }
  function showValues() {
    const S = P.view.S, rows = P.sheets.shape.rows;
    for (const c of SLIDERS) { const r = rows[c.k]; if (document.activeElement !== r.input || gliding) r.input.value = S[c.k]; r.val.textContent = c.fmt(+S[c.k], DW.t); }
  }
  function refresh() {
    const on = gliding || styleOf(P.view.S), ch = P.sheets.styles.chips;
    for (const id in ch) ch[id].setAttribute('aria-pressed', String(id === on));
    showValues();
  }

  function relang() {
    if (!P.state) return;
    for (const s of SHEETS) P.buttons[s].textContent = DW.t(s);
    P.box.setAttribute('aria-label', P.open ? DW.t(P.open) : DW.t('tab'));
    const st = P.sheets.styles; for (const id in st.chips) st.chips[id].textContent = DW.t('style_' + id); st.reset.textContent = DW.t('reset');
    const rows = P.sheets.shape.rows;
    for (const c of SLIDERS) { const r = rows[c.k], [a, b] = DW.t('ends_' + c.k).split('–'); r.name.textContent = DW.t('slider_' + c.k); r.e0.textContent = a; r.e1.textContent = b || ''; }
    for (const k in PARTS) if (PARTS[k].relang) PARTS[k].relang();
    showValues();
  }
  P.refresh = refresh;
  // ---- Surfer: the maker. Colours are swatches, other choices chips; every change rebuilds the surfer at once and is saved.
  const ROWS = ['skin', 'build', 'hair', 'hairColor', 'outfit', 'suit', 'accent', 'board', 'boardColor', 'graphic', 'stance', 'pose', 'face', 'extra'];
  const SWATCH = { skin: 1, hairColor: 1, suit: 1, accent: 1, boardColor: 1 };
  const LABEL = { build: 'build', hair: 'hair', outfit: 'outfit', board: 'board', graphic: 'graphic', stance: 'stance', pose: 'pose', face: 'face', extra: 'extra' };
  PARTS.surfer = {
    take: s => DW.surfer.clean(s),
    sheet() {
      const box = el('div', 'dw-maker'), hint = el('p', 'dw-hint'), rows = {}; box.appendChild(hint);
      for (const k of ROWS) {
        const row = el('div', 'dw-mrow'), name = el('div', 'dw-mname'), opts = el('div', SWATCH[k] ? 'dw-swatches' : 'dw-chips');
        opts.setAttribute('role', 'group'); row.append(name, opts); box.appendChild(row); const btns = {};
        for (const v of DW.surfer.OPTIONS[k]) {
          const b = el('button', SWATCH[k] ? 'dw-swatch' : 'dw-chip'); b.type = 'button'; b.dataset.k = k; b.dataset.v = v;
          if (SWATCH[k]) { b.style.background = v; b.setAttribute('aria-label', v); }
          b.addEventListener('click', () => { P.state.surfer = Object.assign({}, P.state.surfer, { [k]: v }); P.view.setSurfer(P.state.surfer); save(); mark(); });
          opts.appendChild(b); btns[v] = b;
        }
        rows[k] = { name, opts, btns };
      }
      const mark = () => { for (const k of ROWS) for (const v in rows[k].btns) rows[k].btns[v].setAttribute('aria-pressed', String(P.state.surfer[k] === v)); };
      P.makerRows = rows; P.makerHint = hint; P.makerMark = mark;
      return { el: box };
    },
    mounted(view, state) { view.setSurfer(state.surfer); P.makerMark(); },
    relang() {
      P.makerHint.textContent = DW.t('dragHint');
      for (const k of ROWS) { const r = P.makerRows[k]; r.name.textContent = DW.t('row_' + k); r.opts.setAttribute('aria-label', DW.t('row_' + k));
        if (LABEL[k]) for (const v in r.btns) r.btns[v].textContent = DW.t(LABEL[k] + '_' + v); }
    }
  };
  // ---- Snapshot: the wave pauses on the moment they saw; a preview of the story picture, their name or IG handle, Share and Save.
  PARTS.snapshot = {
    take: () => null,
    sheet() {
      const box = el('div', 'dw-snapsheet'), prev = el('div', 'dw-preview'), name = el('input', 'dw-name'), row = el('div', 'dw-snaprow'),
        share = el('button', 'dw-chip dw-share'), saveBtn = el('button', 'dw-chip dw-save'), err = el('p', 'dw-snaperr'), hold = el('div', 'dw-hold'), holdImg = el('img'), holdHint = el('p');
      name.type = 'text'; name.maxLength = 30; name.autocomplete = 'off'; name.spellcheck = false; share.type = saveBtn.type = 'button';
      err.hidden = true; hold.hidden = true; hold.append(holdImg, holdHint); row.append(share, saveBtn); box.append(prev, name, row, err, hold);
      let pic = null, shot = null, was = false, gen = 0, typing = 0;
      const draw = async () => { const g = ++gen, c = await DW.snap.compose(shot, { caption: DW.snap.caption(P.view.S), name: P.state.name });
        if (g !== gen || P.open !== 'snap') return; pic = c; prev.replaceChildren(c); };
      const busy = on => { share.disabled = saveBtn.disabled = on; };
      share.addEventListener('click', async () => { if (!pic) return; busy(true); err.hidden = true;
        try { await DW.snap.share(pic); } catch (e) { err.hidden = false; err.textContent = DW.t('failed'); } busy(false); });
      saveBtn.addEventListener('click', () => { if (!pic) return; try { DW.snap.save(pic); } catch (e) {} });
      name.addEventListener('input', () => { P.state.name = name.value.slice(0, 30); save(); clearTimeout(typing); typing = setTimeout(draw, 250); });
      DW.snap.onHold = url => { holdImg.src = url; holdImg.alt = DW.t('tab'); holdHint.textContent = DW.t('hold'); hold.hidden = false; prev.hidden = true; };
      P.snapEls = { share, save: saveBtn, name };
      return { el: box,
        open() { was = P.view.playing(); P.view.play(false); hold.hidden = true; prev.hidden = false; err.hidden = true; name.value = P.state.name || '';
          pic = null; prev.replaceChildren(); shot = P.view.snapshot(DW.snap.LAYOUT.w, DW.snap.LAYOUT.h); draw(); },
        close() { gen++; pic = shot = null; prev.replaceChildren(); hold.hidden = true; holdImg.removeAttribute('src'); if (was) P.view.play(true); } };
    },
    relang() { const s = P.snapEls; s.share.textContent = DW.t('share'); s.save.textContent = DW.t('save'); s.name.placeholder = DW.t('name'); s.name.setAttribute('aria-label', DW.t('name')); }
  };
  // ---- Camera: Free, GoPro nose cam, GoPro head cam.
  const CAMS = ['free', 'nose', 'head'];
  PARTS.camera = {
    take: c => CAMS.includes(c) ? c : 'free',
    sheet() { const box = el('div', 'dw-chips'), chips = {};
      for (const c of CAMS) { const b = el('button', 'dw-chip'); b.type = 'button'; b.dataset.cam = c; b.addEventListener('click', () => P.view.setCamera(c)); box.appendChild(b); chips[c] = b; }
      P.camChips = chips; return { el: box }; },
    mounted(view, state) {
      const mark = () => { for (const c of CAMS) P.camChips[c].setAttribute('aria-pressed', String(view.camMode === c)); };
      view.on('camera', c => { state.camera = c; save(); mark(); }); view.setCamera(state.camera); mark(); },
    relang() { for (const c of CAMS) P.camChips[c].textContent = DW.t('cam_' + c); }
  };
  // The surfer's spot in the wave: restored on mount, saved when a drag ends.
  PARTS.spot = { take: s => DW.surfer.clampSpot(s), mounted(view, state) { view.setSpot(state.spot); view.on('spot', s => { state.spot = s; save(); }); } };
  DW.panel = P;
})(window.DW = window.DW || {});
