// ============================================================
// LabDisplays — LIVE instrument displays overlaid ON the photographic lobby.
// Instead of vague glows, each instrument screen in assets/lab-bench.jpg is
// COMPLETELY COVERED by a real, animated display: an oscilloscope trace, an
// SDR spectrum+waterfall, a ticking 7-seg readout, a twitching meter. Each
// display is a small <canvas> warped onto the screen's quadrilateral with a
// perspective-correct CSS matrix3d homography, so it sits in the screen's
// plane and tracks the photo's center/cover crop at any window size.
// Decorative (aria-hidden, behind the .rig faceplate); lobby-only; reduced-motion
// -> one static frame; paused when hidden/off-lobby; graceful (no 2d ctx -> plain photo).
//
// Painter logic (scope / SDR / 7-seg / meters / signal model / theme) is ported
// from js/lab3d.js (those functions live inside its IIFE and aren't exported).
//
// Alignment: set LabDisplays.calib(true) to draw bright numbered quad outlines +
// corner dots so corners can be tuned from screenshots, then calib(false) to fill.
// ============================================================
window.LabDisplays = (function () {
  'use strict';
  var raf = window.requestAnimationFrame, caf = window.cancelAnimationFrame;
  var root = null, ok = false, running = false, rafId = 0, onHome = false;
  var t0 = 0, last = 0, resizeTimer = 0, calibOn = false;
  var IMG_W = 1672, IMG_H = 941;            // natural size of assets/lab-bench-blue.jpg
  var NB = 96, bins = new Float32Array(NB), TH = null;
  // Analog-clock dial tilt, in DEGREES (negative = counter-clockwise). This is the
  // one knob to fit the dial to the bezel angle. Tune it LIVE in the browser console:
  //   LabDisplays.setClockRotation(-6)   // try values, then bake the final number here
  var CLOCK_ROT_DEG = -4;
  // Clock dial box in IMAGE space (the photo is 1672x941): center (x,y), half-size, and overfill.
  // These four numbers fully control the dial's POSITION and SIZE — edit here to bake, or tune LIVE:
  //   LabDisplays.setClockBox(1634, 116, 30.5)   // (centerX, centerY, halfSize)
  //   LabDisplays.setClockGrow(1.11)             // dial overfill vs the box (>1 covers the hole edge)
  //   LabDisplays.getClockBox()                  // read the current values
  var CLOCK_CX = 1632, CLOCK_CY = 118, CLOCK_HALF = 30.5, CLOCK_GROW = 1.15;

  function now() { try { return performance.now(); } catch (e) { return Date.now(); } }
  function reduced() { return window.UI && UI.reducedMotion ? UI.reducedMotion() : false; }
  function dark() { return !(window.UI && UI.effectiveTheme && UI.effectiveTheme() === 'light'); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rgb(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a == null ? 1 : a) + ')'; }
  function mix(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
  function hash(n) { var s = Math.sin(n) * 43758.5453; return s - Math.floor(s); }
  function vnoise(x) { var i = Math.floor(x), f = x - i, a = hash(i), b = hash(i + 1), u = f * f * (3 - 2 * f); return a + (b - a) * u; }
  function cssRGB(name, fb) { try { var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); if (v[0] === '#') { var h = v.slice(1); if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; } } catch (e) {} return fb; }

  function theme() {
    var d = dark();
    TH = {
      dark: d,
      green: cssRGB('--green', d ? [61, 220, 132] : [23, 138, 76]),
      cyan: cssRGB('--cyan', d ? [79, 210, 224] : [21, 151, 166]),
      amber: cssRGB('--amber', d ? [255, 178, 62] : [181, 101, 29]),
      red: cssRGB('--red', d ? [255, 92, 92] : [192, 57, 43]),
      border: cssRGB('--border', d ? [37, 51, 44] : [216, 224, 218]),
      panel: cssRGB('--panel', d ? [18, 26, 23] : [255, 255, 255]),
      glass: d ? [6, 18, 12] : [10, 22, 14]
    };
  }

  // ----- shared live signal model (ported from lab3d) -----
  function computeBins(t) {
    for (var i = 0; i < NB; i++) { bins[i] = 0.10 + 0.06 * vnoise(i * 0.5 + t * 1.7) + 0.04 * Math.sin(i / NB * 18 + t * 0.6); }
    var sig = [[0.18, 0.55, 0.9], [0.46, 0.5, 0.55], [0.72, 0.6, 0.7], [0.88, 0.45, 0.4]];
    for (var s = 0; s < sig.length; s++) { var cn = sig[s][0] + 0.02 * Math.sin(t * (0.2 + s * 0.05) + s); var amp = sig[s][1] * (0.6 + 0.4 * Math.abs(Math.sin(t * (0.5 + s * 0.3) + s))); var wd = sig[s][2] * 0.02 + 0.004; var cb = Math.round(cn * NB); for (var b = Math.max(0, cb - 6); b < Math.min(NB, cb + 6); b++) { var dx = (b / NB - cn) / wd; bins[b] = Math.max(bins[b], amp * Math.exp(-dx * dx)); } }
  }
  function heat(v) { v = clamp(v, 0, 1); if (v < 0.45) return rgb(mix(TH.dark ? [6, 16, 11] : [221, 232, 226], TH.green, v / 0.45)); if (v < 0.8) return rgb(mix(TH.green, TH.amber, (v - 0.45) / 0.35)); return rgb(mix(TH.amber, [255, 233, 176], (v - 0.8) / 0.2)); }

  // ----- 7-seg (ported) -----
  var SEG = { '0': 0x3F, '1': 0x06, '2': 0x5B, '3': 0x4F, '4': 0x66, '5': 0x6D, '6': 0x7D, '7': 0x07, '8': 0x7F, '9': 0x6F };
  function drawDigit(c, x, y, w, h, mask, col) {
    var t = Math.max(2, w * 0.18); function seg(bit, p) { c.fillStyle = (mask & bit) ? rgb(col) : rgb(col, 0.08); c.beginPath(); c.moveTo(p[0], p[1]); for (var i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]); c.closePath(); c.fill(); }
    var x2 = x + w, ym = y + h / 2, y2 = y + h;
    seg(0x01, [x + t, y, x2 - t, y, x2 - t * 1.5, y + t, x + t * 1.5, y + t]);
    seg(0x02, [x2, y + t, x2, ym - t / 2, x2 - t, ym - t, x2 - t, y + t * 1.5]);
    seg(0x04, [x2, ym + t / 2, x2, y2 - t, x2 - t, y2 - t * 1.5, x2 - t, ym + t]);
    seg(0x08, [x + t, y2, x2 - t, y2, x2 - t * 1.5, y2 - t, x + t * 1.5, y2 - t]);
    seg(0x10, [x, ym + t / 2, x, y2 - t, x + t, y2 - t * 1.5, x + t, ym + t]);
    seg(0x20, [x, y + t, x, ym - t / 2, x + t, ym - t, x + t, y + t * 1.5]);
    seg(0x40, [x + t, ym, x + t * 1.5, ym - t / 2, x2 - t * 1.5, ym - t / 2, x2 - t, ym, x2 - t * 1.5, ym + t / 2, x + t * 1.5, ym + t / 2]);
  }
  function seven(c, x, y, w, h, str, col) { var dw = w / (str.length * 0.62), gap = dw * 0.24, cx = x; for (var i = 0; i < str.length; i++) { var ch = str[i]; if (ch === '.') { c.fillStyle = rgb(col); c.beginPath(); c.arc(cx + dw * 0.16, y + h - 2, 1.7, 0, 7); c.fill(); cx += dw * 0.4; } else { drawDigit(c, cx, y, dw * 0.6, h, SEG[ch] || 0, col); cx += dw * 0.6 + gap; } } }
  function fmtFreq(v) { var s = v.toFixed(1), p = s.split('.'), wpart = p[0]; if (wpart.length > 4) wpart = wpart.slice(0, 2) + '.' + wpart.slice(2); else if (wpart.length > 3) wpart = wpart.slice(0, wpart.length - 3) + '.' + wpart.slice(-3); return wpart + '.' + p[1]; }

  // ----- screen painters (ported / adapted to paint a bezel + glass so they fully cover the photo screen) -----
  function bezel(c, w, h, accent) {
    // dark glass fill with a faint inner vignette + a thin lit rim, so the live display reads as a real powered screen
    c.clearRect(0, 0, w, h);
    var g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.1, w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, rgb(mix(TH.glass, accent, 0.06))); g.addColorStop(1, rgb(TH.glass));
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }
  function vignetteRim(c, w, h, accent) {
    // subtle CRT corner darkening + faint phosphor bloom toward edges
    // light edge-darkening only — the photo bezel masks the rim, so we keep the lit content near the edges
    var v = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34, w / 2, h / 2, Math.max(w, h) * 0.68);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.16)');
    c.fillStyle = v; c.fillRect(0, 0, w, h);
  }
  function paintScope(c, w, h, t, liss, accent) {
    bezel(c, w, h, accent);
    c.strokeStyle = rgb(accent, 0.16); c.lineWidth = 1;
    for (var i = 1; i < 6; i++) { c.beginPath(); c.moveTo(w * i / 6, 0); c.lineTo(w * i / 6, h); c.stroke(); } // graticule fills edge-to-edge
    for (var j = 1; j < 5; j++) { c.beginPath(); c.moveTo(0, h * j / 5); c.lineTo(w, h * j / 5); c.stroke(); }
    function tr(lw, col, a) { c.beginPath(); var N = 120; for (var i = 0; i <= N; i++) { var u = i / N, px, py; if (!liss) { px = u * w; py = h / 2 - (Math.sin(t * 0.9 + u * 11) + 0.28 * Math.sin(2 * (t * 0.9 + u * 11))) * h * 0.32 * (1 + 0.08 * Math.sin(t * 0.6)); } else { var uu = u * Math.PI * 2; px = w / 2 + Math.sin(3 * uu + t * 0.15) * w * 0.34; py = h / 2 + Math.sin(2 * uu) * h * 0.34; } if (i === 0) c.moveTo(px, py); else c.lineTo(px, py); } c.lineWidth = lw; c.strokeStyle = rgb(col, a); c.lineJoin = 'round'; c.stroke(); }
    tr(Math.max(3, w * 0.026), accent, 0.28); tr(Math.max(1.2, w * 0.01), mix(accent, [255, 255, 255], 0.55), 0.96);
    vignetteRim(c, w, h, accent);
  }
  function paintSDR(c, w, h, t, st, accent) {
    bezel(c, w, h, accent);
    var specH = h * 0.42;
    if (!st.wf) { st.wf = document.createElement('canvas'); st.wf.width = w; st.wf.height = Math.max(1, Math.floor(h * 0.58)); st.wfx = st.wf.getContext('2d'); st.wfx.imageSmoothingEnabled = false; for (var y = 0; y < st.wf.height; y++) { computeBins((st.wf.height - y) * 0.05); wfRow(st, y); } computeBins(t); }
    c.beginPath(); for (var i = 0; i < NB; i++) { var px = i / (NB - 1) * w, py = specH - bins[i] * specH * 0.86; if (i === 0) c.moveTo(px, py); else c.lineTo(px, py); } c.lineWidth = Math.max(1.2, w * 0.008); c.strokeStyle = rgb(accent, 0.95); c.stroke();
    st.wfx.drawImage(st.wf, 0, 0, st.wf.width, st.wf.height - 1, 0, 1, st.wf.width, st.wf.height - 1); wfRow(st, 0);
    c.drawImage(st.wf, 0, specH, w, h - specH);
    vignetteRim(c, w, h, accent);
  }
  function wfRow(st, y) { var w = st.wf.width, bw = w / NB; for (var i = 0; i < NB; i++) { st.wfx.fillStyle = heat(bins[i]); st.wfx.fillRect(Math.floor(i * bw), y, Math.ceil(bw) + 1, 1); } }
  function paintCounter(c, w, h, t, st, accent) {
    bezel(c, w, h, accent);
    if (st.val == null) st.val = 14074.0;
    st.val += (vnoise(t * 1.3 + 7) - 0.5) * 0.4; if (vnoise(t * 0.21) > 0.985) st.val += (vnoise(t) - 0.5) * 8;
    seven(c, w * 0.08, h * 0.22, w * 0.84, h * 0.56, fmtFreq(st.val), accent);
    vignetteRim(c, w, h, accent);
  }
  function paintMeter(c, w, h, t, st, accent) {
    bezel(c, w, h, accent);
    if (st.cur == null) st.cur = 0.4;
    var cx = w / 2, cy = h * 0.78, r = Math.min(w, h) * 0.62;
    c.fillStyle = rgb(TH.dark ? [13, 10, 2] : [238, 244, 238]); c.beginPath(); c.arc(cx, cy, r, Math.PI, 2 * Math.PI); c.fill();
    c.strokeStyle = rgb(TH.border); c.lineWidth = 1.2; c.stroke();
    // scale ticks
    for (var k = 0; k <= 8; k++) { var aa = -Math.PI + k / 8 * Math.PI; c.strokeStyle = rgb(accent, 0.5); c.lineWidth = 1; c.beginPath(); c.moveTo(cx + Math.cos(aa) * r * 0.86, cy + Math.sin(aa) * r * 0.86); c.lineTo(cx + Math.cos(aa) * r * 0.98, cy + Math.sin(aa) * r * 0.98); c.stroke(); }
    var peak = bins[40] || 0.4; st.cur += (clamp(0.2 + peak * 0.7, 0, 1) - st.cur) * 0.12;
    var a = -Math.PI + clamp(st.cur, 0, 1) * Math.PI;
    c.strokeStyle = rgb(TH.red); c.lineWidth = Math.max(1.6, w * 0.018); c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9); c.stroke();
    c.fillStyle = rgb(TH.red); c.beginPath(); c.arc(cx, cy, Math.max(2, w * 0.02), 0, 7); c.fill();
    vignetteRim(c, w, h, accent);
  }

  function paintBars(c, w, h, t, accent) {
    bezel(c, w, h, accent);
    var n = Math.max(5, Math.floor(w / 8)), bw = w / n;
    for (var i = 0; i < n; i++) {
      var v = 0.18 + 0.82 * Math.abs(Math.sin(t * 1.6 + i * 0.7)) * (0.55 + 0.45 * vnoise(i * 1.3 + t * 2));
      var bh = v * h * 0.78, bx = i * bw + bw * 0.16, by = h - bh - h * 0.1, bwi = bw * 0.68;
      var col = v > 0.78 ? TH.amber : accent;
      c.fillStyle = rgb(col, 0.92); c.fillRect(bx, by, bwi, bh);
      c.fillStyle = rgb(mix(col, [255, 255, 255], 0.55), 0.95); c.fillRect(bx, by, bwi, Math.max(1, h * 0.04));
    }
    vignetteRim(c, w, h, accent);
  }

  // a REAL ham-radio signal: an AM-modulated RF carrier — a fast carrier filling a
  // slowly-evolving (voice-like) modulation envelope, the classic "scoping the rig" picture.
  function paintSignalScope(c, w, h, t, st, accent) {
    bezel(c, w, h, accent);
    c.strokeStyle = rgb(accent, 0.14); c.lineWidth = 1;
    for (var k = 1; k < 6; k++) { c.beginPath(); c.moveTo(w * k / 6, 0); c.lineTo(w * k / 6, h); c.stroke(); }
    for (var j = 1; j < 5; j++) { c.beginPath(); c.moveTo(0, h * j / 5); c.lineTo(w, h * j / 5); c.stroke(); }
    var fc = 17; // carrier cycles across the screen
    function env(u) { // voice-like AM envelope, evolving (sum of a few low tones), 0.18..0.95
      var m = 0.5 + 0.30 * Math.sin(2 * Math.PI * 1 * u + t * 3.4) + 0.16 * Math.sin(2 * Math.PI * 2 * u - t * 2.4) + 0.08 * Math.sin(2 * Math.PI * 3.3 * u + t * 4.6);
      return clamp(0.18 + 0.8 * m, 0.05, 1);
    }
    function sig(u) { return Math.sin(2 * Math.PI * fc * u + t * 5.5) * env(u); } // brisk carrier scroll
    function tr(lw, col, a) { c.beginPath(); var N = 380; for (var i = 0; i <= N; i++) { var u = i / N, x = u * w, y = h / 2 - sig(u) * h * 0.42; if (i === 0) c.moveTo(x, y); else c.lineTo(x, y); } c.lineWidth = lw; c.strokeStyle = rgb(col, a); c.lineJoin = 'round'; c.stroke(); }
    // faint envelope outline (top & bottom) to read as a modulated signal, then the glowing carrier trace
    c.beginPath(); for (var e = 0; e <= 120; e++) { var u = e / 120, x = u * w, y = h / 2 - env(u) * h * 0.42; if (e === 0) c.moveTo(x, y); else c.lineTo(x, y); } c.lineWidth = 1; c.strokeStyle = rgb(accent, 0.22); c.stroke();
    c.beginPath(); for (var e2 = 0; e2 <= 120; e2++) { var u2 = e2 / 120, x2 = u2 * w, y2 = h / 2 + env(u2) * h * 0.42; if (e2 === 0) c.moveTo(x2, y2); else c.lineTo(x2, y2); } c.lineWidth = 1; c.strokeStyle = rgb(accent, 0.22); c.stroke();
    tr(Math.max(3, w * 0.022), accent, 0.26);
    tr(Math.max(1.1, w * 0.009), mix(accent, [255, 255, 255], 0.5), 0.95);
    vignetteRim(c, w, h, accent);
  }

  // a real analog wall-clock dial showing the CURRENT time (cream face, black hands, red second)
  function paintClock(c, w, h) {
    c.clearRect(0, 0, w, h);
    var cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2, d = new Date();
    c.save(); c.translate(cx, cy); c.rotate(CLOCK_ROT_DEG * Math.PI / 180); c.translate(-cx, -cy); // tilt whole dial by CLOCK_ROT_DEG to sit square in the bezel
    var fg = c.createRadialGradient(cx - R * 0.22, cy - R * 0.26, R * 0.1, cx, cy, R);
    fg.addColorStop(0, '#f5f0e3'); fg.addColorStop(1, '#d6d0be');
    c.fillStyle = fg; c.beginPath(); c.arc(cx, cy, R * 0.97, 0, 7); c.fill();
    c.lineWidth = Math.max(2, R * 0.07); c.strokeStyle = '#1b1c19'; c.beginPath(); c.arc(cx, cy, R * 0.97 - c.lineWidth / 2, 0, 7); c.stroke();
    for (var i = 0; i < 12; i++) { var a = i / 12 * 6.2832, mj = (i % 3 === 0); var r1 = R * (mj ? 0.72 : 0.80), r2 = R * 0.88; c.lineWidth = mj ? Math.max(2, R * 0.06) : Math.max(1, R * 0.03); c.strokeStyle = '#26271f'; c.beginPath(); c.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); c.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); c.stroke(); }
    // maker's mark / callsign printed on the dial (sits above the 6, below center; hands sweep over it)
    c.fillStyle = '#2a2b22'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '700 ' + Math.max(6, Math.round(R * 0.18)) + 'px ui-monospace, "SFMono-Regular", monospace';
    if ('letterSpacing' in c) { try { c.letterSpacing = (R * 0.02).toFixed(1) + 'px'; } catch (e) {} }
    c.fillText('SP6HACK', cx, cy + R * 0.42);
    if ('letterSpacing' in c) { try { c.letterSpacing = '0px'; } catch (e) {} }
    var hr = d.getHours() % 12, mn = d.getMinutes(), sc = d.getSeconds() + d.getMilliseconds() / 1000;
    function hand(ang, len, width, col) { c.save(); c.translate(cx, cy); c.rotate(ang - 1.5708); c.strokeStyle = col; c.lineWidth = width; c.lineCap = 'round'; c.beginPath(); c.moveTo(-len * 0.2, 0); c.lineTo(len, 0); c.stroke(); c.restore(); }
    hand((hr + mn / 60) / 12 * 6.2832, R * 0.50, Math.max(2.5, R * 0.085), '#1b1c19');
    hand((mn + sc / 60) / 60 * 6.2832, R * 0.74, Math.max(1.8, R * 0.055), '#1b1c19');
    hand(sc / 60 * 6.2832, R * 0.80, Math.max(1, R * 0.026), '#c0392b');
    c.fillStyle = '#1b1c19'; c.beginPath(); c.arc(cx, cy, R * 0.06, 0, 7); c.fill();
    c.fillStyle = '#c0392b'; c.beginPath(); c.arc(cx, cy, R * 0.03, 0, 7); c.fill();
    c.restore();
  }

  function paintOne(scr, t) {
    var c = scr.ctx, w = scr.cv.width, h = scr.cv.height, ac = scr.accent;
    if (calibOn) { paintCalib(scr, w, h); return; }
    if (scr.kind === 'scope') paintScope(c, w, h, t + scr.ph, scr.liss, ac);
    else if (scr.kind === 'signal') paintSignalScope(c, w, h, t + scr.ph, scr.st, ac);
    else if (scr.kind === 'sdr') paintSDR(c, w, h, t, scr.st, ac);
    else if (scr.kind === 'counter') paintCounter(c, w, h, t, scr.st, ac);
    else if (scr.kind === 'meter') paintMeter(c, w, h, t + scr.ph, scr.st, ac);
    else if (scr.kind === 'bars') paintBars(c, w, h, t + scr.ph, ac);
    else if (scr.kind === 'clock') paintClock(c, w, h);
  }
  function paintCalib(scr, w, h) {
    var c = scr.ctx;
    c.clearRect(0, 0, w, h); // transparent interior so the photo screen shows through for edge alignment
    c.strokeStyle = '#ff00c8'; c.lineWidth = 2; c.strokeRect(1, 1, w - 2, h - 2);
    var dots = [[0, 0], [w, 0], [w, h], [0, h]];
    c.fillStyle = '#00ffd0'; for (var i = 0; i < 4; i++) { c.beginPath(); c.arc(dots[i][0], dots[i][1], 5, 0, 7); c.fill(); }
    c.fillStyle = '#ff00c8'; c.font = 'bold ' + Math.floor(h * 0.22) + 'px monospace'; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText(String(scr.idx), 4, 3); c.textBaseline = 'alphabetic';
  }

  // ============== screens ==============
  // The background (assets/lab-bench-holes.webp) has 3 transparent screen holes; the
  // animations render BEHIND it and show through. Each quad is the hole's 4 corners
  // (TL,TR,BR,BL) in image px (1672x941) — detected from the transparent regions, so the
  // perspective/keystone matches the real screens. We render slightly LARGER than the hole
  // (enlarged about the centroid) so the photo's bezel masks the animation edges.
  var QUADS = [
    { id: 'centralScope', kind: 'signal', accentKey: 'green', corners: [[1148, 331], [1225, 331], [1223, 395], [1147, 393]] },
    { id: 'leftScope', kind: 'scope', liss: false, accentKey: 'green', corners: [[214, 411], [288, 409], [286, 470], [214, 476]] },
    { id: 'topRightScope', kind: 'sdr', accentKey: 'green', corners: [[1578, 178], [1652, 171], [1653, 221], [1578, 228]] },
    // round wall-clock hole (re-cut as a clean circle inside the brass bezel, center ≈1634,116 r30)
    { id: 'clock', kind: 'clock', accentKey: 'green', grow: CLOCK_GROW, corners: clockBoxCorners(CLOCK_CX, CLOCK_CY, CLOCK_HALF) }
  ];
  var GROW = 1.1; // render ~20% bigger than the hole so its content fully backs it and edges hide behind the bezel
  function enlarge(c, f) {
    var cx = (c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4, cy = (c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4;
    return c.map(function (p) { return [cx + (p[0] - cx) * f, cy + (p[1] - cy) * f]; });
  }
  // a centered square (TL,TR,BR,BL) — the clock dial's box
  function clockBoxCorners(cx, cy, half) { return [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]]; }
  var SCREENS = QUADS.map(function (q, i) {
    var c = enlarge(q.corners, q.grow || GROW);
    var w = Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]), h = Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1]);
    return {
      id: q.id, kind: q.kind, liss: !!q.liss, ph: i * 1.1, accentKey: q.accentKey,
      res: [Math.max(120, Math.round(w * 2.6)), Math.max(90, Math.round(h * 2.6))],
      corners: c
    };
  });
  var built = [];

  // ----- homography: map element box (0,0)-(w,0)-(0,h)-(w,h) to dest quad TL,TR,BL,BR -> CSS matrix3d -----
  function adj(m) { return [m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4], m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5], m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]]; }
  function mmm(a, b) { var c = []; for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) { var s = 0; for (var k = 0; k < 3; k++) s += a[3 * i + k] * b[3 * k + j]; c[3 * i + j] = s; } return c; }
  function mmv(m, v) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; }
  function basis(x1, y1, x2, y2, x3, y3, x4, y4) { var m = [x1, x2, x3, y1, y2, y3, 1, 1, 1]; var v = mmv(adj(m), [x4, y4, 1]); return mmm(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]); }
  function homography(sw, sh, d) {
    // source corners TL,TR,BL,BR of the element box; dest TL,TR,BL,BR
    var s = basis(0, 0, sw, 0, 0, sh, sw, sh);
    var t = basis(d[0][0], d[0][1], d[1][0], d[1][1], d[3][0], d[3][1], d[2][0], d[2][1]);
    var H = mmm(t, adj(s));
    for (var i = 0; i < 9; i++) H[i] = H[i] / H[8];
    return H;
  }
  function coverMap() { var s = Math.max(window.innerWidth / IMG_W, window.innerHeight / IMG_H); return { s: s, ox: (window.innerWidth - IMG_W * s) / 2, oy: (window.innerHeight - IMG_H * s) / 2 }; }

  function placeAll() {
    var m = coverMap();
    for (var i = 0; i < built.length; i++) {
      var scr = built[i], sw = scr.cv.width, sh = scr.cv.height;
      var d = scr.corners.map(function (p) { return [m.ox + p[0] * m.s, m.oy + p[1] * m.s]; });
      var H = homography(sw, sh, d);
      var t3 = [H[0], H[3], 0, H[6], H[1], H[4], 0, H[7], 0, 0, 1, 0, H[2], H[5], 0, H[8]];
      scr.cv.style.transform = 'matrix3d(' + t3.join(',') + ')';
    }
  }

  function buildScreens() {
    if (!root) return;
    while (root.firstChild) root.removeChild(root.firstChild);
    built = [];
    for (var i = 0; i < SCREENS.length; i++) {
      var s = SCREENS[i];
      var cv = document.createElement('canvas');
      cv.width = s.res[0]; cv.height = s.res[1];
      cv.style.position = 'absolute'; cv.style.left = '0'; cv.style.top = '0';
      cv.style.transformOrigin = '0 0'; cv.style.willChange = 'transform';
      var ctx = cv.getContext('2d');
      root.appendChild(cv);
      built.push({ id: s.id, idx: i, kind: s.kind, liss: !!s.liss, ph: s.ph || 0, accent: TH[s.accentKey] || TH.green, corners: s.corners, cv: cv, ctx: ctx, st: {} });
    }
    placeAll();
  }

  function paintAll(t) { computeBins(t); for (var i = 0; i < built.length; i++) paintOne(built[i], t); }

  // ============== lifecycle ==============
  function frame(ts) {
    rafId = 0; if (!ok || !running || !onHome) return;
    if (document.hidden || reduced()) { stopStatic(); return; }
    if (ts - last >= 33) { last = ts; paintAll((now() - t0) / 1000); }
    rafId = raf(frame);
  }
  function stopStatic() { running = false; if (rafId) { caf(rafId); rafId = 0; } paintAll(3.2); }

  function start() { if (!ok) return; onHome = true; root.style.display = 'block'; theme(); buildScreens(); maybeStart(); }
  function stop() { onHome = false; running = false; if (rafId) { caf(rafId); rafId = 0; } if (root) root.style.display = 'none'; }
  function maybeStart() {
    if (!ok || !onHome) return;
    placeAll();
    if (reduced() || document.hidden) { running = false; if (rafId) { caf(rafId); rafId = 0; } if (reduced()) paintAll(3.2); return; }
    if (!running) { running = true; last = 0; if (!rafId) rafId = raf(frame); }
  }
  function refresh() { if (!ok || !onHome) return; theme(); for (var i = 0; i < built.length; i++) built[i].accent = TH[SCREENS[i].accentKey] || TH.green; maybeStart(); }
  function onResize() { if (!ok || !onHome) return; clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { if (onHome) { placeAll(); maybeStart(); } }, 140); }

  // calibration toggle (for aligning corners from screenshots)
  function calib(on) { calibOn = !!on; if (ok && onHome) paintAll(3.2); return calibOn; }
  // live corner editing during alignment: setCorners('centralScope',[[..]x4]) then it re-places + repaints
  function setCorners(id, corners) { for (var i = 0; i < built.length; i++) if (built[i].id === id) { built[i].corners = corners; SCREENS[i].corners = corners; } placeAll(); paintAll(3.2); }
  function getCorners() { var o = {}; for (var i = 0; i < built.length; i++) o[built[i].id] = built[i].corners; return o; }
  // live clock-dial rotation tuning: LabDisplays.setClockRotation(-7.5) -> repaints immediately
  function setClockRotation(deg) { var v = parseFloat(deg); CLOCK_ROT_DEG = isNaN(v) ? CLOCK_ROT_DEG : v; if (ok && onHome) paintAll(3.2); return CLOCK_ROT_DEG; }
  function getClockRotation() { return CLOCK_ROT_DEG; }
  // live clock-dial size/position tuning (image-space). Bake the values into CLOCK_CX/CY/HALF/GROW when happy.
  function applyClock() { setCorners('clock', enlarge(clockBoxCorners(CLOCK_CX, CLOCK_CY, CLOCK_HALF), CLOCK_GROW)); }
  function setClockBox(cx, cy, half) { if (cx != null && cx !== '') CLOCK_CX = +cx; if (cy != null && cy !== '') CLOCK_CY = +cy; if (half != null && half !== '') CLOCK_HALF = +half; applyClock(); return getClockBox(); }
  function setClockGrow(g) { var v = parseFloat(g); if (!isNaN(v)) CLOCK_GROW = v; applyClock(); return CLOCK_GROW; }
  function getClockBox() { return { cx: CLOCK_CX, cy: CLOCK_CY, half: CLOCK_HALF, grow: CLOCK_GROW }; }

  function init() {
    root = document.getElementById('labdisp');
    if (!root) return;
    var test = document.createElement('canvas');
    try { ok = !!test.getContext('2d'); } catch (e) { ok = false; }
    if (!ok) return;
    t0 = now();
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', maybeStart);
  }

  return { init: init, start: start, stop: stop, refresh: refresh, resize: onResize, available: function () { return ok; }, calib: calib, setCorners: setCorners, getCorners: getCorners, setClockRotation: setClockRotation, getClockRotation: getClockRotation, setClockBox: setClockBox, getClockBox: getClockBox, setClockGrow: setClockGrow };
})();
