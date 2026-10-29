// Dream Wave: the share picture (spec "Snapshot and share"). The view renders the moment at 1080 × 1920; this part adds the WaveSlave
// wordmark and waveslave.tw in the top-left corner and the caption and name at the bottom, all inside Instagram's story safe area (nothing
// above y = 280 or below y = 1640), then hands the picture to the phone's share menu, or saves it. Nothing is uploaded.
(function (DW) { "use strict";
  const FIRE = [[0, '#fff7b0'], [0.28, '#ffd400'], [0.55, '#ff8a00'], [0.78, '#ff3d00'], [1, '#b80000']];
  const LAYOUT = {
    w: 1080, h: 1920,
    mark: { x: 64, y: 440, size: 96, rot: -7, skew: -14 },          // "WaveSlave", Metal Mania, tilted like the logo
    link: { x: 72, y: 510, size: 48 },                              // "waveslave.tw", VT323 amber
    band: { y0: 1300, y1: 1640 },                                   // dark band behind the bottom text
    caption: { y: 1500, y2: 1420, size: 72, maxW: 960 },           // y2: the first line's baseline when the caption takes two lines
    name: { y: 1600, size: 56 }
  };
  const LINK = 'https://waveslave.tw/#dreamwave';

  // "My dream wave: 3.2 m Slab", or Custom when the sliders match no style.
  function caption(S, lang = DW.lang) {
    const id = DW.shell.styleOf(S);
    return DW.t('caption', { h: (+S.height).toFixed(1), style: id ? DW.t('style_' + id, {}, lang) : DW.t('custom', {}, lang) }, lang);
  }
  const fire = (g, y0, y1) => { const f = g.createLinearGradient(0, y0, 0, y1); FIRE.forEach(([a, c]) => f.addColorStop(a, c)); return f; };
  // Words to at most two lines within w px (a break at a space, else between characters for 中文).
  function lines(g, text, w) {
    if (g.measureText(text).width <= w) return [text];
    const parts = /\s/.test(text) ? text.split(/(\s+)/) : [...text];
    let a = ''; for (let i = 0; i < parts.length; i++) { const next = a + parts[i]; if (a && g.measureText(next).width > w) return [a.trim(), parts.slice(i).join('').trim()]; a = next; }
    return [text];
  }
  function flame(g, text, x, y, size, align) {
    g.font = `${size}px "Metal Mania", fantasy`; g.textAlign = align; g.lineJoin = 'round';
    g.save(); g.shadowColor = 'rgba(255,60,0,.7)'; g.shadowBlur = 14; g.lineWidth = size * 0.09; g.strokeStyle = '#200300'; g.strokeText(text, x, y); g.restore();
    g.fillStyle = fire(g, y - size * 0.8, y + size * 0.1); g.fillText(text, x, y);
  }
  async function fonts() {
    if (!document.fonts || !document.fonts.load) return;
    await Promise.race([Promise.all([document.fonts.load('96px "Metal Mania"'), document.fonts.load('48px "VT323"')]).catch(() => {}), new Promise(r => setTimeout(r, 1500))]);
  }
  // The story picture from a 1080 × 1920 shot.
  async function compose(shot, { caption: cap = '', name = '' } = {}) {
    await fonts();
    const L = LAYOUT, c = document.createElement('canvas'); c.width = L.w; c.height = L.h; const g = c.getContext('2d');
    g.drawImage(shot, 0, 0, L.w, L.h);
    // the wordmark, tilted like the logo
    g.save(); g.translate(L.mark.x, L.mark.y); g.rotate(L.mark.rot * Math.PI / 180); g.transform(1, 0, Math.tan(L.mark.skew * Math.PI / 180), 1, 0, 0);
    flame(g, 'WaveSlave', 0, 0, L.mark.size, 'left'); g.restore();
    g.save(); g.font = `${L.link.size}px "VT323", monospace`; g.textAlign = 'left'; g.fillStyle = '#ffcf5c'; g.shadowColor = 'rgba(255,140,0,.8)'; g.shadowBlur = 8;
    g.fillText('waveslave.tw', L.link.x, L.link.y); g.restore();
    // the bottom band, caption and name
    const b = g.createLinearGradient(0, L.band.y0, 0, L.band.y1); b.addColorStop(0, 'rgba(0,0,0,0)'); b.addColorStop(0.45, 'rgba(0,0,0,.55)'); b.addColorStop(0.85, 'rgba(0,0,0,.5)'); b.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = b; g.fillRect(0, L.band.y0, L.w, L.band.y1 - L.band.y0);   // fades in and out again, so no hard line at the safe area's edge
    if (cap) { g.font = `${L.caption.size}px "Metal Mania", fantasy`; const ls = lines(g, cap, L.caption.maxW);
      if (ls.length === 1) flame(g, ls[0], L.w / 2, L.caption.y, L.caption.size, 'center');
      else { flame(g, ls[0], L.w / 2, L.caption.y2, L.caption.size, 'center'); flame(g, ls[1], L.w / 2, L.caption.y, L.caption.size, 'center'); } }
    if (name) { g.save(); g.font = `${L.name.size}px "VT323", monospace`; g.textAlign = 'center'; g.fillStyle = '#ffcf5c'; g.shadowColor = 'rgba(255,140,0,.8)'; g.shadowBlur = 8;
      g.fillText(String(name).slice(0, 30), L.w / 2, L.name.y); g.restore(); }
    return c;
  }
  const blob = c => new Promise((ok, no) => { try { c.toBlob(b => b ? ok(b) : no(new Error('no picture')), 'image/png'); } catch (e) { no(e); } });
  // iPhone and iPad, LINE's browser, and Android's in-app browsers (Instagram, Facebook), none of which can save a data: download
  const holdToSave = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) || /\bLine\/|; wv\)|FBAN|FBAV|Instagram/i.test(navigator.userAgent);
  // The picture's file, made with the preview so Share can call the share menu straight from the tap (Safari refuses it after a wait).
  async function prepare(c) { try { c._file = new File([await blob(c)], 'dream-wave.png', { type: 'image/png' }); } catch (e) {} return c; }
  // The phone's share menu with the picture and the link; where files can't be shared, Save. A cancelled share is just that, quietly.
  async function share(c) {
    let file = c._file || null;
    if (!file) try { file = new File([await blob(c)], 'dream-wave.png', { type: 'image/png' }); } catch (e) { return save(c); }
    if (navigator.canShare && navigator.share) {
      let can = false; try { can = navigator.canShare({ files: [file] }); } catch (e) {}
      if (can) {
        try { await navigator.share({ files: [file], text: LINK }); return 'shared'; }
        catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
      }
    }
    return save(c);
  }
  // On iPhone and iPad, in LINE's browser and in Android's in-app browsers, the picture shows full size to press and hold; elsewhere it downloads.
  function save(c) {
    const url = c.toDataURL('image/png');
    if (holdToSave()) { if (DW.snap.onHold) DW.snap.onHold(url); return 'saved'; }
    const a = document.createElement('a'); a.href = url; a.download = 'dream-wave.png'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
    return 'saved';
  }
  DW.snap = { LAYOUT, LINK, caption, compose, prepare, share, save, onHold: null };
})(window.DW = window.DW || {});
