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
    P.state = { shape: {}, scene: 'neon', camera: 'free', name: '' };
    for (const c of SLIDERS) if (okNum(c, saved.shape && saved.shape[c.k])) { P.state.shape[c.k] = saved.shape[c.k]; view.shape(c.k, saved.shape[c.k]); }
    for (const k in PARTS) P.state[k] = PARTS[k].take(saved[k]);
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
    for (const k in PARTS) if (PARTS[k].sheet) P.sheets[k] = PARTS[k].sheet();
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
  // The surfer's spot in the wave: restored on mount, saved when a drag ends.
  PARTS.spot = { take: s => DW.surfer.clampSpot(s), mounted(view, state) { view.setSpot(state.spot); view.on('spot', s => { state.spot = s; save(); }); } };
  DW.panel = P;
})(window.DW = window.DW || {});
