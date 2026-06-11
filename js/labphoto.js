// ============================================================
// LabPhoto — animated "glints" overlaid on the photographic lobby background
// so the bench's instruments look powered/alive. A transparent canvas (#labglint)
// sits just above the photo (#labphoto) and additively paints soft glows at the
// oscilloscope / spectrum / readout positions, mapped through the SAME center/cover
// transform the CSS background uses, so they track the crop at any window size.
// Decorative (aria-hidden, behind content); lobby-only; reduced-motion -> one
// static glow frame; paused when hidden/off-lobby; graceful (no canvas -> just the photo).
// ============================================================
window.LabPhoto = (function () {
  'use strict';
  var raf = window.requestAnimationFrame, caf = window.cancelAnimationFrame;
  var canvas = null, ctx = null, ok = false, running = false, rafId = 0, onHome = false;
  var W = 0, H = 0, P = 1, t0 = 0, last = 0, resizeTimer = 0;
  var IMG_W = 1599, IMG_H = 900; // natural size of assets/lab-bench.jpg

  // glint emitters in IMAGE-pixel space (tuned to the photo's instrument screens)
  // small, contained emitters — a gentle "breathing" glow confined to each screen (no halos, no sweep stripes)
  var G = [
    { x: 1100, y: 320, w: 110, h: 86, c: [120, 255, 150], kind: 'scope', ph: 0.0 }, // central green scope
    { x: 195, y: 408, w: 118, h: 88, c: [90, 230, 140], kind: 'scope', ph: 1.7 },   // left analog scope
    { x: 1505, y: 158, w: 96, h: 74, c: [120, 255, 175], kind: 'scope', ph: 0.6 },  // top-right green screen
    { x: 1128, y: 470, w: 96, h: 40, c: [255, 80, 64], kind: 'led', ph: 2.4 }       // red 7-seg readout
  ];

  function now() { try { return performance.now(); } catch (e) { return Date.now(); } }
  function reduced() { return window.UI && UI.reducedMotion ? UI.reducedMotion() : false; }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function vnoise(x) { var i = Math.floor(x), f = x - i, s1 = Math.sin(i) * 43758.5, s2 = Math.sin(i + 1) * 43758.5; var a = s1 - Math.floor(s1), b = s2 - Math.floor(s2), u = f * f * (3 - 2 * f); return a + (b - a) * u; }

  function sizeCanvas() {
    P = Math.min(window.devicePixelRatio || 1, 1.5);
    W = Math.floor(window.innerWidth * P); H = Math.floor(window.innerHeight * P);
    canvas.width = W; canvas.height = H; canvas.style.width = window.innerWidth + 'px'; canvas.style.height = window.innerHeight + 'px';
  }
  function coverMap() { var s = Math.max(W / IMG_W, H / IMG_H); return { s: s, ox: (W - IMG_W * s) / 2, oy: (H - IMG_H * s) / 2 }; }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    var m = coverMap();
    for (var i = 0; i < G.length; i++) {
      var g = G[i];
      var x = m.ox + g.x * m.s, y = m.oy + g.y * m.s, w = g.w * m.s, h = g.h * m.s;
      var cx = x + w / 2, cy = y + h / 2, r = Math.max(w, h) * 0.5; // ~screen-sized, no big halo
      // gentle breathing; the photo screens are already lit, so this only adds a soft live pulse
      var puls = g.kind === 'led'
        ? 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * 2.0 + g.ph))
        : 0.7 + 0.3 * Math.sin(t * 1.1 + g.ph) + 0.06 * (vnoise(t * 4 + g.ph) - 0.5);
      var a = (g.kind === 'led' ? 0.26 : 0.22) * Math.max(0.05, puls);
      var rad = ctx.createRadialGradient(cx, cy, r * 0.12, cx, cy, r);
      rad.addColorStop(0, rgba(g.c, a)); rad.addColorStop(0.55, rgba(g.c, a * 0.32)); rad.addColorStop(1, rgba(g.c, 0));
      ctx.fillStyle = rad; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function frame(ts) {
    rafId = 0; if (!ok || !running || !onHome) return;
    if (document.hidden || reduced()) { stopStatic(); return; }
    if (ts - last >= 33) { last = ts; draw((now() - t0) / 1000); }
    rafId = raf(frame);
  }
  function stopStatic() { running = false; if (rafId) { caf(rafId); rafId = 0; } draw(3.0); }

  function start() { if (!ok) return; onHome = true; canvas.style.display = 'block'; sizeCanvas(); maybeStart(); }
  function stop() { onHome = false; running = false; if (rafId) { caf(rafId); rafId = 0; } if (canvas) canvas.style.display = 'none'; }
  function maybeStart() {
    if (!ok || !onHome) return;
    sizeCanvas();
    if (reduced()) { running = false; if (rafId) { caf(rafId); rafId = 0; } draw(3.0); return; }
    if (document.hidden) { running = false; if (rafId) { caf(rafId); rafId = 0; } return; }
    if (!running) { running = true; last = 0; if (!rafId) rafId = raf(frame); }
  }
  function refresh() { if (ok && onHome) maybeStart(); }
  function onResize() { if (!ok || !onHome) return; clearTimeout(resizeTimer); resizeTimer = setTimeout(maybeStart, 160); }

  function init() {
    canvas = document.getElementById('labglint');
    if (!canvas) return;
    try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
    if (!ctx) { ok = false; return; }
    ok = true; t0 = now();
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', maybeStart);
  }

  return { init: init, start: start, stop: stop, refresh: refresh, resize: onResize, available: function () { return ok; } };
})();
