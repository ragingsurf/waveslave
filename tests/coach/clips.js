// Test clips for the coach's browser checks (tests/coach/shell.test.js and app.test.js), made with ffmpeg. They are VP9 WebM (ruling R13):
// Playwright's Chromium has no H.264 or HEVC decoder. A clip is a sea-coloured background (0x1d6f8c) with a white box 1/14 of its width
// by 1/9 of its height, halfway down, sliding from the left edge at the start to the right edge at the end: at a fraction f of the clip
// its left edge is about (w - box) * f.
//   makeClip(dir, {w, h, secs, rotate, gap})   makes <dir>/clip-<w>x<h>-<secs>s.webm and returns its path. With rotate: 90 it also
//                                         copies it, tagged to be shown turned 90° as a phone tags a clip filmed upright (…-r90.webm),
//                                         and returns that path instead: the browser then reports videoWidth h and videoHeight w, and the
//                                         box climbs from the bottom to the top. With gap: [from, to] (seconds) the box isn't there from
//                                         `from` to `to` (…-gap<from>-<to>.webm), as when a surfer goes behind a wave.
// A clip already in dir is used again. ffmpeg's own output goes nowhere unless it fails.
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");

// One ffmpeg run, written to a .part file first so a run cut short never leaves a clip that looks made.
function ffmpeg(args, out) {
  const part = out + ".part";
  try { execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args, "-f", "webm", part], { stdio: ["ignore", "ignore", "pipe"] }); }
  catch (e) { try { fs.rmSync(part, { force: true }); } catch (e2) {} throw new Error(`ffmpeg couldn't make ${path.basename(out)}: ${String(e.stderr || e.message).trim()}`); }
  fs.renameSync(part, out);
}

function makeClip(dir, { w = 640, h = 360, secs = 6, rotate = 0, gap = null } = {}) {
  if (![w, h].every(n => Number.isInteger(n) && n >= 28 && n <= 4096)) throw new Error(`makeClip: ${w}x${h} isn't a clip size`);
  if (!(secs > 0 && secs <= 600)) throw new Error(`makeClip: ${secs} s isn't a clip length`);
  if (rotate !== 0 && rotate !== 90) throw new Error("makeClip: rotate is 0 or 90");
  if (gap !== null && !(Array.isArray(gap) && gap.length === 2 && gap[0] >= 0 && gap[1] > gap[0])) throw new Error("makeClip: gap is [from, to] in seconds");
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `clip-${w}x${h}-${secs}s${gap ? `-gap${gap[0]}-${gap[1]}` : ""}`), out = base + ".webm";
  const hide = gap ? `:enable='not(between(t,${gap[0]},${gap[1]}))'` : "";
  if (!fs.existsSync(out)) ffmpeg(["-f", "lavfi", "-i", `color=c=0x1d6f8c:s=${w}x${h}:d=${secs}`, "-f", "lavfi", "-i", `color=c=white:s=${Math.floor(w / 14)}x${Math.floor(h / 9)}`,
    "-filter_complex", `[0][1]overlay=x='(W-w)*t/${secs}':y='(H-h)/2':shortest=1${hide}`, "-c:v", "libvpx-vp9", "-b:v", "300k"], out);
  if (!rotate) return out;
  const turned = base + "-r90.webm";
  if (!fs.existsSync(turned)) ffmpeg(["-display_rotation", "90", "-i", out, "-c", "copy"], turned);
  return turned;
}

module.exports = { makeClip };
