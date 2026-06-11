// ============================================================
// Lab — "The Night Bench": a procedural, living ham-radio bench rendered on a
// canvas behind the LOBBY (home) only. Raw canvas-2D, no images, offline-safe.
//   • two glowing-green oscilloscopes (sine + Lissajous, phosphor afterglow)
//   • an SDR spectrum + scrolling waterfall
//   • two red 7-segment frequency counters (ticking)
//   • three analog needle meters (twitching)
//   • an LED cluster (blinking) + a warm tungsten lamp pool
// Static art (drawers, bezels, graticules, dials, wood, dim-well, vignette) is
// baked once to an offscreen; only the live sub-rects redraw each frame.
// One rAF, ~30fps, paused off-lobby / hidden / reduced-motion. Decorative:
// the canvas is aria-hidden and behind all content; the faceplate stays readable.
// ============================================================
window.Lab = (function () {
  'use strict';
  var raf = window.requestAnimationFrame, caf = window.cancelAnimationFrame;
  var canvas = null, ctx = null, bg = null, bgx = null, wf = null, wfx = null;
  var ok = false, running = false, rafId = 0, onHome = false;
  var W = 0, H = 0, P = 1, t0 = 0, last = 0, resizeTimer = 0;
  var L = null, TH = null, bins = null, NB = 168;

  function now() { try { return performance.now(); } catch (e) { return Date.now(); } }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function reduced() { return window.UI && UI.reducedMotion ? UI.reducedMotion() : false; }
  function dark() { return !(window.UI && UI.effectiveTheme && UI.effectiveTheme() === 'light'); }

  function cssRGB(name, fb) {
    try { var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); if (v[0] === '#') { var h = v.slice(1); if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; } } catch (e) {}
    return fb;
  }
  function rgb(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a == null ? 1 : a) + ')'; }
  function mix(c1, c2, k) { return [Math.round(c1[0] + (c2[0] - c1[0]) * k), Math.round(c1[1] + (c2[1] - c1[1]) * k), Math.round(c1[2] + (c2[2] - c1[2]) * k)]; }

  function theme() {
    var d = dark();
    TH = {
      dark: d,
      bg: cssRGB('--bg', d ? [11, 15, 14] : [246, 248, 246]),
      deep: d ? [4, 7, 6] : [210, 220, 214],
      panel: cssRGB('--panel', d ? [18, 26, 23] : [255, 255, 255]),
      raised: cssRGB('--raised', d ? [24, 36, 31] : [255, 255, 255]),
      border: cssRGB('--border', d ? [37, 51, 44] : [216, 224, 218]),
      green: cssRGB('--green', d ? [61, 220, 132] : [23, 138, 76]),
      cyan: cssRGB('--cyan', d ? [79, 210, 224] : [21, 151, 166]),
      amber: cssRGB('--amber', d ? [255, 178, 62] : [181, 101, 29]),
      red: cssRGB('--red', d ? [255, 92, 92] : [192, 57, 43]),
      wood: d ? [44, 31, 18] : [205, 180, 138],
      woodHi: d ? [86, 60, 33] : [225, 205, 168],
      glass: d ? [7, 20, 13] : [11, 26, 16],
      pull: [207, 214, 208]
    };
  }

  // ---- value noise ----
  function hash(n) { var s = Math.sin(n) * 43758.5453; return s - Math.floor(s); }
  function vnoise(x) { var i = Math.floor(x), f = x - i; var a = hash(i), b = hash(i + 1); var u = f * f * (3 - 2 * f); return a + (b - a) * u; }

  // ============== layout ==============
  function layout() {
    var Wc = W / P, Hc = H / P; // CSS px
    var faceW = Math.min(608, Wc - 32);
    var faceH = Math.min(0.62 * Hc, 560);
    var faceX = (Wc - faceW) / 2, faceY = 0.32 * Hc;
    var gutter = (Wc - faceW) / 2;
    var phone = Wc < 560, tablet = Wc >= 560 && Wc < 900;
    function R(x, y, w, h) { return { x: x * P, y: y * P, w: w * P, h: h * P }; }
    L = { Wc: Wc, Hc: Hc, phone: phone, tablet: tablet,
      face: R(faceX, faceY, faceW, faceH),
      lamp: { cx: Wc * 0.5 * P, cy: Hc * 0.05 * P, r: Math.min(Wc, Hc) * 0.62 * P },
      drawerBand: { y0: 0, y1: Hc * 0.40 * P },
      woodY: Hc * 0.63 * P,
      scopes: [], counters: [], meters: [], leds: [], sdr: null
    };
    var scopeSz = clamp(gutter - 24, 96, 190);
    if (phone) {
      // thin top strip only: one small scope + waterfall + one counter
      L.scopes.push({ kind: 'sine', x: 8 * P, y: 10 * P, w: 96 * P, h: 74 * P });
      L.sdr = R(Math.max(112, Wc * 0.30), 8, Math.min(Wc * 0.5, 200), 76);
      L.counters.push({ x: (Wc - 86) * P, y: 12 * P, w: 78 * P, h: 30 * P, val: 14074.0, str: '' });
    } else {
      var sy = faceY - 6;
      L.scopes.push({ kind: 'sine', x: (gutter - scopeSz - 8) > 8 ? (gutter - scopeSz - 6) * P : 10 * P, y: sy * P, w: scopeSz * P, h: scopeSz * 0.82 * P });
      L.scopes.push({ kind: 'liss', x: (Wc - gutter + 6) * P, y: sy * P, w: scopeSz * P, h: scopeSz * 0.82 * P });
      var sdrW = Math.min(faceW * 0.92, Wc * 0.46);
      L.sdr = R((Wc - sdrW) / 2, Hc * 0.13, sdrW, Hc * 0.155);
      // right gutter shelf: counters + meters + leds
      var rx = Wc - gutter + 10;
      L.counters.push({ x: rx * P, y: (faceY + 70) * P, w: Math.min(gutter - 20, 150) * P, h: 32 * P, val: 14074.0, str: '' });
      L.counters.push({ x: rx * P, y: (faceY + 110) * P, w: Math.min(gutter - 20, 150) * P, h: 32 * P, val: 7030.2, str: '' });
      var mr = clamp((gutter - 30) / 3.4, 24, 44);
      for (var i = 0; i < 3; i++) L.meters.push({ cx: (rx + mr + i * (mr * 2.2 + 6)) * P, cy: (faceY + 18) * P, r: mr * P, cur: 0.4, target: 0.4, seed: i * 7 + 1 });
      for (var j = 0; j < 5; j++) L.leds.push({ x: (rx + 10 + j * 24) * P, y: (faceY + 160) * P, r: 5 * P, kind: j, next: 0, on: j % 2 });
      if (tablet) { L.counters.length = 1; L.meters.length = 2; }
    }
    // SDR bin buffer
    NB = L.phone ? 110 : 168;
    bins = new Float32Array(NB);
  }

  // ============== static art ==============
  function rrect(c, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  function buildStatic() {
    if (!ok) return;
    bg = bg || document.createElement('canvas'); bgx = bg.getContext('2d');
    bg.width = W; bg.height = H;
    var c = bgx;
    // base wall
    var g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgb(mix(TH.bg, TH.deep, 0.25))); g.addColorStop(0.45, rgb(TH.bg)); g.addColorStop(1, rgb(mix(TH.bg, TH.deep, 0.5)));
    c.fillStyle = g; c.fillRect(0, 0, W, H);

    // drawer wall (top band)
    var band = L.drawerBand, cell = 58 * P, cols = Math.ceil(W / cell), rows = Math.ceil((band.y1 - band.y0) / cell);
    for (var r = 0; r < rows; r++) for (var k = 0; k < cols; k++) {
      var dx = k * cell + 3 * P, dy = band.y0 + r * cell + 3 * P, dw = cell - 6 * P, dh = cell - 6 * P;
      var cxn = (dx + dw / 2) / W - 0.5, cyn = (dy + dh / 2) / H - 0.5;
      var dimv = clamp(1 - (Math.abs(cxn) * 1.3 + cyn * 0.4 + 0.15), 0.12, 1); // darker at corners/edges
      c.fillStyle = rgb(mix(TH.deep, TH.raised, 0.5 * dimv), 0.9);
      rrect(c, dx, dy, dw, dh, 4 * P); c.fill();
      c.strokeStyle = rgb(TH.border, 0.5 * dimv); c.lineWidth = P; c.stroke();
      c.fillStyle = rgb(mix(TH.bg, [255, 255, 255], 0.25), 0.18 * dimv); c.fillRect(dx + 2 * P, dy + 2 * P, dw - 4 * P, 1.5 * P); // top highlight
      c.fillStyle = rgb(TH.pull, 0.5 * dimv); rrect(c, dx + dw / 2 - 7 * P, dy + dh - 9 * P, 14 * P, 3 * P, 1.5 * P); c.fill(); // chrome pull
    }

    // lamp pool
    var lp = c.createRadialGradient(L.lamp.cx, L.lamp.cy, L.lamp.r * 0.08, L.lamp.cx, L.lamp.cy, L.lamp.r);
    var warm = TH.dark ? [255, 178, 62] : [255, 255, 255];
    lp.addColorStop(0, rgb(warm, TH.dark ? 0.22 : 0.16)); lp.addColorStop(0.5, rgb(warm, TH.dark ? 0.07 : 0.05)); lp.addColorStop(1, rgb(warm, 0));
    c.fillStyle = lp; c.fillRect(0, 0, W, H);

    // wood bench (bottom band)
    var wg = c.createLinearGradient(0, L.woodY, 0, H);
    wg.addColorStop(0, rgb(TH.woodHi)); wg.addColorStop(0.06, rgb(TH.wood)); wg.addColorStop(1, rgb(mix(TH.wood, TH.deep, 0.6)));
    c.fillStyle = wg; c.fillRect(0, L.woodY, W, H - L.woodY);
    c.strokeStyle = rgb(mix(TH.woodHi, [255, 255, 255], 0.3), 0.5); c.lineWidth = 1.5 * P; c.beginPath(); c.moveTo(0, L.woodY); c.lineTo(W, L.woodY); c.stroke(); // desk edge
    for (var gw = 0; gw < 10; gw++) { var gy = L.woodY + (gw + 1) / 10 * (H - L.woodY); c.strokeStyle = rgb(mix(TH.wood, TH.deep, 0.5), 0.25); c.lineWidth = P; c.beginPath(); c.moveTo(0, gy); c.lineTo(W, gy); c.stroke(); }

    // instrument bezels (static)
    L.scopes.forEach(function (s) { bezel(c, s.x - 9 * P, s.y - 9 * P, s.w + 18 * P, s.h + 18 * P); c.fillStyle = rgb(TH.glass); rrect(c, s.x, s.y, s.w, s.h, 5 * P); c.fill(); graticule(c, s); label(c, s.x, s.y - 12 * P, s.kind === 'sine' ? 'SCOPE' : 'X-Y'); });
    if (L.sdr) { bezel(c, L.sdr.x - 8 * P, L.sdr.y - 8 * P, L.sdr.w + 16 * P, L.sdr.h + 16 * P); c.fillStyle = rgb(mix(TH.glass, [0, 0, 0], 0.3)); c.fillRect(L.sdr.x, L.sdr.y, L.sdr.w, L.sdr.h); label(c, L.sdr.x, L.sdr.y - 11 * P, 'SDR  14.074'); }
    L.counters.forEach(function (ct) { bezel(c, ct.x, ct.y, ct.w, ct.h); }); // housing; ghost segs drawn live (cheap)
    L.meters.forEach(function (m) { dialFace(c, m); });
    L.leds.forEach(function (e) { c.fillStyle = rgb(TH.deep); c.beginPath(); c.arc(e.x, e.y, e.r + 2 * P, 0, 7); c.fill(); });

    // central dim-well over the faceplate footprint
    var f = L.face, cx = f.x + f.w / 2, cy = f.y + f.h / 2, rr = Math.max(f.w, f.h) * 0.7;
    var dw2 = c.createRadialGradient(cx, cy, rr * 0.2, cx, cy, rr);
    dw2.addColorStop(0, rgb(TH.deep, TH.dark ? 0.55 : 0.28)); dw2.addColorStop(0.7, rgb(TH.deep, TH.dark ? 0.22 : 0.1)); dw2.addColorStop(1, rgb(TH.deep, 0));
    c.fillStyle = dw2; c.fillRect(0, 0, W, H);

    // four-corner vignette
    var vg = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, rgb(TH.deep, 0)); vg.addColorStop(1, rgb(TH.deep, TH.dark ? 0.62 : 0.28));
    c.fillStyle = vg; c.fillRect(0, 0, W, H);

    buildWaterfall();
  }
  function bezel(c, x, y, w, h) { rrect(c, x, y, w, h, 7 * P); c.fillStyle = rgb(mix(TH.raised, [0, 0, 0], 0.25)); c.fill(); c.lineWidth = 1.5 * P; c.strokeStyle = rgb(TH.border); c.stroke(); c.strokeStyle = rgb([0, 0, 0], 0.5); c.lineWidth = P; rrect(c, x + 3 * P, y + 3 * P, w - 6 * P, h - 6 * P, 5 * P); c.stroke(); }
  function graticule(c, s) { c.save(); c.beginPath(); rrect(c, s.x, s.y, s.w, s.h, 5 * P); c.clip(); c.strokeStyle = rgb(TH.green, 0.16); c.lineWidth = P; for (var i = 1; i < 6; i++) { var gx = s.x + s.w * i / 6; c.beginPath(); c.moveTo(gx, s.y); c.lineTo(gx, s.y + s.h); c.stroke(); } for (var j = 1; j < 5; j++) { var gy = s.y + s.h * j / 5; c.beginPath(); c.moveTo(s.x, gy); c.lineTo(s.x + s.w, gy); c.stroke(); } c.restore(); }
  function dialFace(c, m) { c.fillStyle = rgb(TH.dark ? [13, 10, 2] : [238, 244, 238]); c.beginPath(); c.arc(m.cx, m.cy, m.r, 0, 7); c.fill(); c.strokeStyle = rgb(TH.border); c.lineWidth = 1.5 * P; c.stroke(); c.strokeStyle = rgb(TH.dark ? [107, 116, 109] : [120, 130, 120]); c.lineWidth = P; for (var i = 0; i <= 8; i++) { var a = -2.27 + i / 8 * 1.74; c.beginPath(); c.moveTo(m.cx + Math.cos(a) * m.r * 0.74, m.cy + Math.sin(a) * m.r * 0.74); c.lineTo(m.cx + Math.cos(a) * m.r * 0.9, m.cy + Math.sin(a) * m.r * 0.9); c.stroke(); } }
  function label(c, x, y, txt) { c.fillStyle = rgb(TH.dark ? [143, 163, 152] : [90, 107, 97], 0.8); c.font = (9 * P) + 'px ' + 'ui-monospace,monospace'; c.textBaseline = 'alphabetic'; c.fillText(txt, x, y); }

  // ============== waterfall ==============
  function heat(v) { v = clamp(v, 0, 1); if (v < 0.45) return rgb(mix(TH.dark ? [6, 16, 11] : [221, 232, 226], TH.green, v / 0.45)); if (v < 0.8) return rgb(mix(TH.green, TH.amber, (v - 0.45) / 0.35)); return rgb(mix(TH.amber, [255, 233, 176], (v - 0.8) / 0.2)); }
  function buildWaterfall() {
    if (!L.sdr) return;
    var wfw = Math.floor(L.sdr.w), wfh = Math.floor(L.sdr.h * 0.6);
    wf = wf || document.createElement('canvas'); wfx = wf.getContext('2d');
    wf.width = Math.max(1, wfw); wf.height = Math.max(1, wfh);
    wfx.imageSmoothingEnabled = false;
    // pre-fill with a plausible spectrogram
    for (var y = 0; y < wf.height; y++) { computeBins((wf.height - y) * 0.05); paintWfRowAt(y); }
  }
  function paintWfRowAt(y) {
    var wfw = wf.width; var bw = wfw / NB;
    for (var i = 0; i < NB; i++) { wfx.fillStyle = heat(bins[i]); wfx.fillRect(Math.floor(i * bw), y, Math.ceil(bw) + 1, 1); }
  }

  // ============== live signal model ==============
  function computeBins(t) {
    for (var i = 0; i < NB; i++) {
      var x = i / NB;
      var floorv = 0.10 + 0.06 * vnoise(i * 0.5 + t * 1.7) + 0.04 * Math.sin(x * 18 + t * 0.6);
      bins[i] = floorv;
    }
    // a few drifting carriers
    var sig = [[0.18, 0.55, 0.9], [0.46, 0.5, 0.55], [0.72, 0.6, 0.7], [0.88, 0.45, 0.4]];
    for (var s = 0; s < sig.length; s++) {
      var center = sig[s][0] + 0.02 * Math.sin(t * (0.2 + s * 0.05) + s);
      var amp = sig[s][1] * (0.6 + 0.4 * Math.abs(Math.sin(t * (0.5 + s * 0.3) + s)));
      var wdt = sig[s][2] * 0.02 + 0.004;
      var cb = Math.round(center * NB);
      for (var b = Math.max(0, cb - 6); b < Math.min(NB, cb + 6); b++) { var dx = (b / NB - center) / wdt; bins[b] = Math.max(bins[b], amp * Math.exp(-dx * dx)); }
    }
  }

  // ============== draw helpers ==============
  // 7-seg
  var SEG = { '0': 0x3F, '1': 0x06, '2': 0x5B, '3': 0x4F, '4': 0x66, '5': 0x6D, '6': 0x7D, '7': 0x07, '8': 0x7F, '9': 0x6F };
  function drawDigit(c, x, y, w, h, mask) {
    var t = Math.max(2 * P, w * 0.16); // thickness
    var on = TH.red, off = rgb(TH.red, 0.07);
    function seg(bit, pts) { c.fillStyle = (mask & bit) ? rgb(on) : off; if (mask & bit) { c.shadowColor = rgb(on, 0.8); c.shadowBlur = 5 * P; } else c.shadowBlur = 0; c.beginPath(); c.moveTo(pts[0], pts[1]); for (var i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.closePath(); c.fill(); c.shadowBlur = 0; }
    var x2 = x + w, ym = y + h / 2, y2 = y + h;
    seg(0x01, [x + t, y, x2 - t, y, x2 - t * 1.5, y + t, x + t * 1.5, y + t]); // a top
    seg(0x02, [x2, y + t, x2, ym - t / 2, x2 - t, ym - t, x2 - t, y + t * 1.5]); // b
    seg(0x04, [x2, ym + t / 2, x2, y2 - t, x2 - t, y2 - t * 1.5, x2 - t, ym + t]); // c
    seg(0x08, [x + t, y2, x2 - t, y2, x2 - t * 1.5, y2 - t, x + t * 1.5, y2 - t]); // d bottom
    seg(0x10, [x, ym + t / 2, x, y2 - t, x + t, y2 - t * 1.5, x + t, ym + t]); // e
    seg(0x20, [x, y + t, x, ym - t / 2, x + t, ym - t, x + t, y + t * 1.5]); // f
    seg(0x40, [x + t, ym, x + t * 1.5, ym - t / 2, x2 - t * 1.5, ym - t / 2, x2 - t, ym, x2 - t * 1.5, ym + t / 2, x + t * 1.5, ym + t / 2]); // g
  }
  function drawCounter(ct) {
    // erase housing from bg, then digits
    ctx.drawImage(bg, ct.x, ct.y, ct.w, ct.h, ct.x, ct.y, ct.w, ct.h);
    var s = ct.str, pad = 6 * P, dw = (ct.w - pad * 2) / (s.length * 0.62), dh = ct.h - 8 * P, gap = dw * 0.24;
    var x = ct.x + pad, y = ct.y + 4 * P;
    for (var i = 0; i < s.length; i++) { var ch = s[i]; if (ch === '.') { ctx.fillStyle = rgb(TH.red); ctx.shadowColor = rgb(TH.red, 0.8); ctx.shadowBlur = 4 * P; ctx.beginPath(); ctx.arc(x + dw * 0.18, y + dh - 2 * P, 1.6 * P, 0, 7); ctx.fill(); ctx.shadowBlur = 0; x += dw * 0.42; } else { drawDigit(ctx, x, y, dw * 0.6, dh, SEG[ch] || 0); x += dw * 0.6 + gap; } }
  }
  function drawScope(s, t) {
    ctx.save(); ctx.beginPath(); rrect(ctx, s.x, s.y, s.w, s.h, 5 * P); ctx.clip();
    // re-blit graticule glass + afterglow
    ctx.drawImage(bg, s.x, s.y, s.w, s.h, s.x, s.y, s.w, s.h);
    ctx.fillStyle = rgb(TH.glass, 0.55); ctx.fillRect(s.x, s.y, s.w, s.h);
    var midY = s.y + s.h / 2, amp = s.h * 0.34 * (1 + 0.08 * Math.sin(t * 0.6));
    function stroke(lw, col, a) { ctx.beginPath(); var N = 130; for (var i = 0; i <= N; i++) { var u = i / N; var px, py; if (s.kind === 'sine') { px = s.x + u * s.w; py = midY - (Math.sin(t * 0.9 + u * 11) + 0.28 * Math.sin(2 * (t * 0.9 + u * 11))) * amp * 0.55; } else { var uu = u * Math.PI * 2; px = s.x + s.w / 2 + Math.sin(3 * uu + t * 0.15) * s.w * 0.36; py = midY + Math.sin(2 * uu) * s.h * 0.36; } if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); } ctx.lineWidth = lw; ctx.strokeStyle = rgb(col, a); ctx.lineJoin = 'round'; ctx.stroke(); }
    stroke(3.5 * P, TH.green, 0.3); stroke(1.3 * P, mix(TH.green, [255, 255, 255], 0.5), 0.95);
    ctx.restore();
  }
  function drawSpectrum(t) {
    var r = L.sdr, specH = r.h * 0.38;
    ctx.drawImage(bg, r.x, r.y, r.w, specH, r.x, r.y, r.w, specH); // erase
    ctx.beginPath();
    for (var i = 0; i < NB; i++) { var px = r.x + i / (NB - 1) * r.w, py = r.y + specH - bins[i] * specH * 0.92; if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
    ctx.lineWidth = 1.3 * P; ctx.strokeStyle = rgb(TH.cyan, 0.9); ctx.shadowColor = rgb(TH.cyan, 0.6); ctx.shadowBlur = 4 * P; ctx.stroke(); ctx.shadowBlur = 0;
  }
  function drawWaterfall() {
    var r = L.sdr; if (!wf) return;
    wfx.drawImage(wf, 0, 0, wf.width, wf.height - 1, 0, 1, wf.width, wf.height - 1); // shift down 1px
    paintWfRowAt(0);
    var wy = r.y + r.h * 0.4;
    ctx.drawImage(wf, 0, 0, wf.width, wf.height, r.x, wy, r.w, r.h * 0.6);
  }
  function drawNeedle(m) {
    ctx.drawImage(bg, m.cx - m.r - 2 * P, m.cy - m.r - 2 * P, m.r * 2 + 4 * P, m.r * 2 + 4 * P, m.cx - m.r - 2 * P, m.cy - m.r - 2 * P, m.r * 2 + 4 * P, m.r * 2 + 4 * P);
    var a = -2.27 + clamp(m.cur, 0, 1) * 1.74;
    ctx.save(); ctx.translate(m.cx, m.cy); ctx.rotate(a + Math.PI / 2);
    ctx.strokeStyle = rgb(TH.red, 0.35); ctx.lineWidth = 3 * P; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -m.r * 0.84); ctx.stroke();
    ctx.strokeStyle = rgb(TH.red); ctx.lineWidth = 1.3 * P; ctx.beginPath(); ctx.moveTo(0, m.r * 0.12); ctx.lineTo(0, -m.r * 0.84); ctx.stroke();
    ctx.restore(); ctx.fillStyle = rgb(TH.border); ctx.beginPath(); ctx.arc(m.cx, m.cy, 2.5 * P, 0, 7); ctx.fill();
  }
  function drawLED(e, on, k) {
    ctx.drawImage(bg, e.x - e.r - 3 * P, e.y - e.r - 3 * P, e.r * 2 + 6 * P, e.r * 2 + 6 * P, e.x - e.r - 3 * P, e.y - e.r - 3 * P, e.r * 2 + 6 * P, e.r * 2 + 6 * P);
    var col = [TH.cyan, TH.amber, TH.green, TH.amber, TH.red][k % 5];
    var grd = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r * 1.8);
    grd.addColorStop(0, rgb(mix(col, [255, 255, 255], 0.6), on)); grd.addColorStop(0.4, rgb(col, on)); grd.addColorStop(1, rgb(col, 0));
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 1.8, 0, 7); ctx.fill();
  }

  // ============== frame ==============
  function formatFreq(v) { var s = v.toFixed(1); var p = s.split('.'); var whole = p[0]; if (whole.length > 4) whole = whole.slice(0, 2) + '.' + whole.slice(2); else if (whole.length > 3) whole = whole.slice(0, whole.length - 3) + '.' + whole.slice(-3); return whole + '.' + p[1]; }

  function frame(ts) {
    rafId = 0; if (!ok || !running || !onHome) return;
    if (document.hidden || reduced()) { stop(); return; }
    if (ts - last >= 32) {
      last = ts; var t = (now() - t0) / 1000;
      ctx.drawImage(bg, 0, 0); // baked scene
      // lamp breathe
      if (TH.dark) { var a = 0.04 + 0.02 * vnoise(t * 1.3); var lp = ctx.createRadialGradient(L.lamp.cx, L.lamp.cy, L.lamp.r * 0.05, L.lamp.cx, L.lamp.cy, L.lamp.r * 0.6); lp.addColorStop(0, rgb([255, 178, 62], a)); lp.addColorStop(1, rgb([255, 178, 62], 0)); ctx.fillStyle = lp; ctx.fillRect(0, 0, W, H); }
      computeBins(t);
      L.scopes.forEach(function (s) { drawScope(s, t); });
      if (L.sdr) { drawWaterfall(); drawSpectrum(t); }
      L.counters.forEach(function (ct) { ct.val += (Math.random() - 0.5) * 0.2; if (Math.random() < 0.01) ct.val += (Math.random() - 0.5) * 8; ct.str = formatFreq(ct.val); drawCounter(ct); });
      L.meters.forEach(function (m) { var peak = bins[Math.floor((0.2 + (m.seed % 3) * 0.3) * NB)] || 0.4; m.target = clamp(0.25 + peak * 0.7 + 0.08 * Math.sin(t * (0.5 + m.seed * 0.2)), 0, 1); m.cur += (m.target - m.cur) * 0.12; drawNeedle(m); });
      var nowS = t; L.leds.forEach(function (e, i) { var on; if (e.kind === 0) on = 0.5 + 0.4 * Math.sin(t * 3); else if (e.kind === 3) on = 0.4 + 0.5 * (0.5 + 0.5 * Math.sin(t * 3.1)); else { if (nowS > e.next) { e.on = e.on ? 0 : 1; e.next = nowS + 0.4 + Math.random() * 1.2; } on = e.on ? 0.95 : 0.12; } drawLED(e, on, e.kind); });
    }
    rafId = raf(frame);
  }

  function drawStill() {
    if (!ok) return;
    ctx.drawImage(bg, 0, 0);
    var t = 4.2; computeBins(t);
    L.scopes.forEach(function (s) { drawScope(s, t); });
    if (L.sdr) { drawWaterfall(); drawSpectrum(t); }
    L.counters.forEach(function (ct, i) { ct.val = i === 0 ? 14074.0 : 7030.2; ct.str = formatFreq(ct.val); drawCounter(ct); });
    L.meters.forEach(function (m) { m.cur = 0.45 + (m.seed % 3) * 0.12; drawNeedle(m); });
    L.leds.forEach(function (e) { drawLED(e, e.kind % 2 ? 0.9 : 0.3, e.kind); });
  }

  // ============== lifecycle ==============
  function setBg(visible) { try { var fx = document.getElementById('fxbg'); if (fx) fx.style.display = visible ? '' : 'none'; } catch (e) {} }
  function sizeCanvas() { P = Math.min(window.devicePixelRatio || 1, 1.5); W = Math.floor(window.innerWidth * P); H = Math.floor(window.innerHeight * P); canvas.width = W; canvas.height = H; canvas.style.width = window.innerWidth + 'px'; canvas.style.height = window.innerHeight + 'px'; }

  function rebuild() { if (!ok) return; sizeCanvas(); theme(); layout(); buildStatic(); }

  function start() {
    if (!ok) { return; }
    onHome = true;
    canvas.style.display = 'block'; setBg(false); // explicit (CSS default for #labbg is none)
    rebuild();
    maybeStart();
  }
  function stop() {
    onHome = false; running = false;
    if (rafId) { caf(rafId); rafId = 0; }
    if (canvas) canvas.style.display = 'none';
    setBg(true);
  }
  function maybeStart() {
    if (!ok || !onHome) return;
    if (reduced()) { running = false; if (rafId) { caf(rafId); rafId = 0; } drawStill(); return; }
    if (document.hidden) { running = false; if (rafId) { caf(rafId); rafId = 0; } return; }
    if (!running) { running = true; last = 0; if (!rafId) rafId = raf(frame); }
  }
  function refresh() { if (!ok || !onHome) return; rebuild(); maybeStart(); }
  function onResize() { if (!ok || !onHome) return; clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { if (onHome) { rebuild(); maybeStart(); } }, 160); }

  function init() {
    canvas = document.getElementById('labbg');
    if (!canvas) return;
    try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
    if (!ctx) { ok = false; return; }
    ok = true; t0 = now();
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', maybeStart);
  }

  return { init: init, start: start, stop: stop, refresh: refresh, resize: onResize, available: function () { return ok; } };
})();
