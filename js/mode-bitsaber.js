// ============================================================
// Mode: Bit Saber — "Cięcie" (Beat-Saber-style 3D slasher).
// Neon code-cubes fly toward the camera down a perspective corridor; SLASH the
// one matching the prompt (swipe / click / keys) and dodge the decoys. A glowing
// saber trail follows the pointer; correct cuts shatter into sparks. Waves, lives,
// combo, high scores — SRS-weighted so it's targeted study. 3-letter codes ride the
// cubes (readable); the longer meaning/format is always the stable prompt readout.
// Single rAF + one canvas; strict teardown. Reduced-motion -> calm self-paced MCQ.
// ============================================================
window.ModeBitSaber = (function () {
  'use strict';
  var S = null;
  var raf = window.requestAnimationFrame, caf = window.cancelAnimationFrame;
  var LOCKS_PER_WAVE = 6, START_LIVES = 3;
  var FAM = { freq: 'f', offset: 'f', time: 't', wait: 't', question: 'a', callsign: 'a' };
  function fam(k) { return FAM[k] || k; }
  function kindLabel(k) { var o = window.QCODE_ARG_KINDS[k]; return UI.lang() === 'pl' ? o.pl : o.en; }
  function nowMs() { try { return performance.now(); } catch (e) { return Date.now(); } }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rangeArr(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }
  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { if (x != null && !s[x]) { s[x] = 1; o.push(x); } }); return o; }

  // ---------- lifecycle ----------
  function start(host, ctx) {
    S = {
      dead: false, state: 'ready', motion: !UI.reducedMotion(),
      score: 0, combo: 0, maxCombo: 0, lives: START_LIVES, wave: 1,
      lockInWave: 0, totalLocks: 0, correctLocks: 0, waveMisses: 0,
      recent: [], fumbled: [], blocks: [], lock: null, lockResolved: false,
      speed: 0.34, w: 0, h: 0, cx: 0, vy: 0, dpr: 1,
      trail: [], particles: [], pointer: null, rafId: 0, lastT: 0, timers: [],
      canvas: null, cctx: null, els: {}, calmWrap: null, ptr: {}
    };
    var root = UI.el('div', { class: 'mode bitsaber' });
    S.els.score = UI.el('span', { class: 'hud__score', text: '0' });
    S.els.combo = UI.el('span', { class: 'hud__combo' });
    S.els.wave = UI.el('span', { class: 'arcade-wave' });
    S.els.lives = UI.el('span', { class: 'arcade-lives' });
    var hud = UI.el('div', { class: 'hud' }, [
      UI.el('span', {}, [S.els.score, S.els.combo]),
      UI.el('span', {}, [S.els.wave, document.createTextNode(' '), S.els.lives])
    ]);
    S.els.meterFill = UI.el('div', { class: 'smeter__fill', style: { transform: 'scaleX(0)' } });
    var meter = UI.el('div', { class: 'smeter', 'aria-hidden': 'true' }, [S.els.meterFill]);
    // the question rides INSIDE the game window (overlaid on the 3D canvas), not as a bar above it
    S.els.readout = UI.el('div', { class: 'arcade-readout bitsaber-q', 'aria-live': 'off' });
    S.els.field = UI.el('div', { class: 'arcade-field bitsaber-field', role: 'group', 'aria-label': tt({ pl: 'Tor', en: 'Lane' }), tabindex: '-1' });
    S.els.header = UI.modeHeader({ title: tt({ pl: 'Ham Saber (3D)', en: 'Ham Saber (3D)' }) });
    root.appendChild(S.els.header);
    root.appendChild(hud);
    root.appendChild(meter);
    root.appendChild(S.els.field);
    UI.setScreen(root);
    updateHUD();
    renderIntro();
  }

  // ---------- music ----------
  function playMusic() {
    var a = document.getElementById('bgm-saber'); if (!a) return;
    a.loop = true; a.volume = 0.3;
    if (window.Store && Store.settings().sound) { try { var p = a.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {} }
  }
  function stopMusic() { var a = document.getElementById('bgm-saber'); if (a) { try { a.pause(); a.currentTime = 0; } catch (e) {} } }

  function stop() {
    if (!S) return;
    S.dead = true;
    if (S.rafId) { caf(S.rafId); S.rafId = 0; }
    stopMusic();
    clearTimers();
    unbindPointer();
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('resize', onResize);
  }
  function clearTimers() { if (S) { S.timers.forEach(function (id) { clearTimeout(id); }); S.timers = []; } }
  function later(fn, ms) {
    var id = setTimeout(function () { if (!S) return; var i = S.timers.indexOf(id); if (i >= 0) S.timers.splice(i, 1); if (S.dead) return; fn(); }, ms);
    S.timers.push(id); return id;
  }

  // ---------- intro ----------
  function renderIntro() {
    var f = S.els.field; UI.clear(f);
    var card = UI.el('div', { class: 'arcade-intro' }, [
      UI.el('div', { class: 'arcade-intro__title', text: tt({ pl: 'Tnij sygnał', en: 'Slash the signal' }) }),
      UI.el('p', { class: 'muted', text: S.motion
        ? tt({ pl: 'Przeciągnij saberem (mysz / dotyk) przez właściwy kod lecący na ciebie. Klawisze 1–5 tną od razu. Omijaj błędne. Masz 3 życia.', en: 'Swipe the saber (mouse / touch) through the right code flying at you. Keys 1–5 slash instantly. Dodge the wrong ones. 3 lives.' })
        : tt({ pl: 'Tryb spokojny: wybierz właściwą odpowiedź (klik / 1–5). Bez ruchu i czasu.', en: 'Calm mode: pick the right answer (click / 1–5). No motion, no timer.' }) }),
      UI.btn(tt({ pl: 'Start', en: 'Start' }), { variant: 'primary', class: 'arcade-start', onClick: beginPlay })
    ]);
    if (S.motion) card.appendChild(UI.el('p', { class: 'muted', style: { fontSize: '.82rem' } }, [
      document.createTextNode(tt({ pl: 'Wolisz spokojniej? ', en: 'Prefer something calmer? ' })),
      UI.btn(tt({ pl: 'Flow', en: 'Flow' }), { variant: 'ghost', onClick: function () { App.go('flow'); } })
    ]));
    f.appendChild(card);
    later(function () { var b = f.querySelector('.arcade-start'); if (b) UI.focus(b); }, 0);
  }

  // ---------- geometry / canvas ----------
  function measure() {
    var f = S.els.field; S.w = f.clientWidth || 320; S.h = f.clientHeight || 360;
    S.cx = S.w / 2; S.vy = S.h * 0.40; S.dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (S.canvas) { S.canvas.width = Math.floor(S.w * S.dpr); S.canvas.height = Math.floor(S.h * S.dpr); S.canvas.style.width = S.w + 'px'; S.canvas.style.height = S.h + 'px'; }
  }
  function onResize() { if (!S || S.dead) return; measure(); }
  function project(b) {
    var prog = clamp(1 - b.z, 0, 1);            // 0 far .. 1 near
    var scale = 0.20 + 0.95 * prog;
    var spread = 0.26 + 0.74 * prog;
    var sx = S.cx + b.x * (S.w * 0.40) * spread;
    var sy = S.vy + (S.h * 0.74 - S.vy) * prog; // finish higher up so the bottom stays clear for the question
    var size = (94 + 26 * (S.h / 480)) * scale;
    return { sx: sx, sy: sy, size: size, prog: prog };
  }
  function slashableProg() { return 0.46; } // a block becomes slashable once prog >= this (near the camera)

  // ---------- beat clock (cubes pop up on the music's pulse) ----------
  // hamsaber-music.mp3 runs ~110 BPM (estimated offline). Cubes are released one
  // per beat so their pop-in lands on the track's pulse. We read the *playback*
  // position so it stays locked to the music even if a frame hitches; if the
  // track isn't playing (sound off / not yet started) we fall back to a wall
  // clock at the same tempo so the game still flows.
  var BPM = 110, BEAT = 60 / BPM;
  function beatInfo() {
    // Prefer the track's playback position so releases stay locked to the music;
    // fall back to a wall clock at the same tempo when it isn't playing. The two
    // clocks have unrelated origins, so we report which one is in use and rebase
    // on a switch (see step) — otherwise the index would jump and stall releases.
    var a = document.getElementById('bgm-saber');
    if (a && !a.paused && a.currentTime > 0.05) return { idx: Math.floor(a.currentTime / BEAT), src: 'music' };
    return { idx: Math.floor(nowMs() / 1000 / BEAT), src: 'wall' };
  }
  function popEase(t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); } // ease-out-back: small overshoot
  function hasPending() { for (var i = 0; i < S.blocks.length; i++) if (!S.blocks[i].released) return true; return false; }
  function releaseNext() { // bring the next queued cube onto the field (it pops in from the far point)
    for (var i = 0; i < S.blocks.length; i++) { var b = S.blocks[i]; if (!b.released) { b.released = true; b.active = true; b.z = 1; b.born = nowMs(); b.pop = 0; return true; } }
    return false;
  }

  // ---------- begin ----------
  function beginPlay() {
    if (Store.settings().sound) SFX.ensure();
    playMusic(); // start the Ham Saber theme as the game begins (the Start click is the gesture)
    UI.clear(S.els.field);
    if (S.motion) {
      S.canvas = UI.el('canvas', { class: 'bitsaber-canvas', 'aria-hidden': 'true' });
      S.els.field.appendChild(S.canvas);
      S.els.field.appendChild(S.els.readout); // question overlay, on top of the canvas
      S.cctx = S.canvas.getContext('2d');
      measure();
      bindPointer();
      window.addEventListener('resize', onResize);
      document.addEventListener('visibilitychange', onVis);
      S.state = 'playing'; S.lastT = nowMs(); S.rafId = raf(loop);
    } else {
      S.calmWrap = UI.el('div', { class: 'bitsaber-calm' });
      S.els.field.appendChild(S.calmWrap);
      S.els.field.appendChild(S.els.readout); // question overlay
      S.state = 'playing';
    }
    startLock();
    later(function () { UI.focus(S.els.field); }, 0);
  }
  function onVis() { if (S && !S.dead) S.lastT = nowMs(); }

  // ---------- lock building ----------
  function simultCount(dir) {
    var base = S.wave < 2 ? 3 : (S.wave < 4 ? 4 : 5);
    if (dir === 'format') base = Math.min(base, 4);
    return Math.max(2, base);
  }
  function nextDirection() {
    // Bit Saber rides 3-letter codes on the cubes -> only meaning/format (never long meanings on a cube)
    if (S.wave >= 2 && (S.totalLocks % 3 === 2)) return 'format';
    return 'meaning';
  }
  function buildLock() {
    var dir = nextDirection();
    var answer = SRS.pickOne(S.recent.slice(-5)) || SRS.pickOne([]) || window.QCODE_LIST[0];
    S.recent.push(answer); if (S.recent.length > 12) S.recent.shift();
    var simult = simultCount(dir);
    var options = [];
    if (dir === 'meaning') {
      uniq([answer].concat(SRS.distractors(answer, simult))).slice(0, simult)
        .forEach(function (code) { options.push({ label: code, code: code, kind: 'code', correct: code === answer }); });
    } else {
      var ck = window.QCODE_BY[answer].arg.kind;
      var kinds = Object.keys(window.QCODE_ARG_KINDS).filter(function (k) { return k !== 'level9'; });
      var others = SRS.shuffle(kinds.filter(function (k) { return k !== ck && fam(k) !== fam(ck); })).slice(0, simult - 1);
      if (ck === 'level' && others.indexOf('level9') < 0) others[others.length - 1] = 'level9';
      uniq([ck].concat(others)).slice(0, simult).forEach(function (k) { options.push({ label: kindLabel(k), code: null, kind: 'format', correct: k === ck }); });
    }
    if (!options.some(function (o) { return o.correct; })) options[0].correct = true;
    options = SRS.shuffle(options);
    return { answer: answer, dir: dir, options: options };
  }
  function renderReadout(lock, reveal) {
    var r = S.els.readout; UI.clear(r);
    if (reveal) {
      r.appendChild(UI.el('span', { class: 'code', text: lock.answer }));
      r.appendChild(document.createTextNode(' = '));
      r.appendChild(UI.el('span', { lang: UI.lang(), text: UI.meaningShort(lock.answer) }));
      return;
    }
    if (lock.dir === 'meaning') {
      r.appendChild(UI.el('span', { class: 'arcade-readout__lbl', text: tt({ pl: 'Tnij kod dla: ', en: 'Slash the code for: ' }) }));
      r.appendChild(UI.el('span', { class: 'arcade-readout__big', lang: UI.lang(), text: UI.meaningShort(lock.answer) }));
    } else {
      r.appendChild(UI.el('span', { class: 'arcade-readout__lbl', text: tt({ pl: 'Co podaje się po: ', en: 'What follows: ' }) }));
      r.appendChild(UI.codeChip(lock.answer, { big: true }));
    }
  }

  // ---------- start one lock ----------
  function startLock() {
    if (S.dead) return;
    S.state = 'playing'; S.lockResolved = false; S.blocks = [];
    S.lock = buildLock();
    renderReadout(S.lock, false);
    if (S.els.readout) S.els.readout.classList.remove('anim-shake');
    var n = S.lock.options.length;
    if (S.motion) {
      S.lock.options.forEach(function (opt, i) {
        var x = n === 1 ? 0 : (i / (n - 1)) * 2 - 1; // spread across [-1,1]
        S.blocks.push({                              // queued (released:false) — released one per beat
          label: opt.label, code: opt.code, kind: opt.kind, correct: opt.correct,
          x: x * 0.82, z: 1, born: nowMs(), resolved: false, active: false, released: false, pop: 0,
          reveal: null, cut: 0, hue: opt.kind === 'format' ? 188 : 168, idx: i
        });
      });
      var bt0 = beatInfo(); S.beatIdx = bt0.idx; S.beatSrc = bt0.src; // remaining cubes pop on the next beats
      releaseNext();                                                  // first cube pops in right away, no dead air
    } else {
      renderCalm();
    }
    UI.announce((S.lock.dir === 'meaning'
      ? tt({ pl: 'Tnij kod dla: ', en: 'Slash the code for: ' }) + UI.meaningShort(S.lock.answer)
      : tt({ pl: 'Co podaje się po ', en: 'What follows ' }) + S.lock.answer));
  }

  // ---------- main loop ----------
  function loop(ts) {
    S.rafId = 0;
    if (!S || S.dead) return;
    if (document.hidden) { S.lastT = ts; S.rafId = raf(loop); return; }
    var dt = clamp((ts - S.lastT) / 1000, 0, 0.05); S.lastT = ts;
    if (S.state === 'playing' || S.state === 'beat') step(dt, ts);
    render(ts);
    S.rafId = raf(loop);
  }
  function step(dt, ts) {
    // release the next queued cube when the music ticks over to a new beat
    if (S.state === 'playing' && !S.lockResolved && hasPending()) {
      var bt = beatInfo();
      if (bt.src !== S.beatSrc) { S.beatSrc = bt.src; S.beatIdx = bt.idx; } // clock switched (music<->wall): rebase, don't release
      else if (bt.idx > S.beatIdx) { S.beatIdx = bt.idx; releaseNext(); }
    }
    for (var i = 0; i < S.blocks.length; i++) {
      var b = S.blocks[i];
      if (b.cut > 0) { b.cut += dt * 2.6; continue; }
      if (!b.active || b.resolved) continue;
      if (b.pop < 1) b.pop = Math.min(1, b.pop + dt * 6); // ~170ms pop-in
      b.z -= S.speed * dt;
      if (b.z <= -0.04) { // reached / passed the camera
        b.active = false; b.resolved = true;
        if (b.correct && !S.lockResolved) resolveLock(b, 'pass');
      }
    }
    // particles + trail fade
    for (var p = S.particles.length - 1; p >= 0; p--) {
      var pa = S.particles[p]; pa.life -= dt; if (pa.life <= 0) { S.particles.splice(p, 1); continue; }
      pa.x += pa.vx * dt; pa.y += pa.vy * dt; pa.vy += 420 * dt;
    }
    var cut = ts - 230; while (S.trail.length && S.trail[0].t < cut) S.trail.shift();
  }

  // ---------- render ----------
  function render(ts) {
    var c = S.cctx; if (!c) return;
    c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    // background
    var bg = c.createLinearGradient(0, 0, 0, S.h);
    bg.addColorStop(0, '#070b12'); bg.addColorStop(1, '#02040a');
    c.fillStyle = bg; c.fillRect(0, 0, S.w, S.h);
    drawCorridor(c, ts);
    // blocks far -> near
    var order = S.blocks.slice().sort(function (a, b) { return b.z - a.z; });
    for (var i = 0; i < order.length; i++) drawBlock(c, order[i], ts);
    drawParticles(c);
    drawSaber(c);
  }
  function drawCorridor(c, ts) {
    var cx = S.cx, vy = S.vy, w = S.w, h = S.h;
    c.save(); c.globalCompositeOperation = 'lighter';
    // radial back-glow at the vanishing point
    var g = c.createRadialGradient(cx, vy, 2, cx, vy, h * 0.5);
    g.addColorStop(0, 'rgba(60,150,200,0.22)'); g.addColorStop(1, 'rgba(60,150,200,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    // converging rails
    c.strokeStyle = 'rgba(90,200,230,0.30)'; c.lineWidth = 1.5;
    for (var r = -3; r <= 3; r++) { c.beginPath(); c.moveTo(cx, vy); c.lineTo(cx + r * (w * 0.20), h); c.stroke(); }
    // depth lines (animated toward camera)
    var t = (ts / 1000) % 1;
    for (var k = 0; k < 8; k++) {
      var prog = clamp(((k + t) / 8), 0, 1);
      var y = vy + (h - vy) * prog * prog;
      var spreadW = (w * 0.06 + (w * 0.62) * prog);
      c.strokeStyle = 'rgba(90,200,230,' + (0.05 + 0.18 * prog) + ')'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(cx - spreadW, y); c.lineTo(cx + spreadW, y); c.stroke();
    }
    c.restore();
  }
  function blockColor(b, a) {
    if (b.reveal === 'correct') return 'rgba(61,220,132,' + a + ')';
    if (b.reveal === 'wrong') return 'rgba(255,92,92,' + a + ')';
    return 'hsla(' + b.hue + ',85%,62%,' + a + ')';
  }
  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function drawBlock(c, b, ts) {
    if (!b.active && b.cut <= 0) return;
    var pr = project(b); var s = pr.size, sx = pr.sx, sy = pr.sy;
    if (b.cut > 0) { // sliced: two halves separate along the cut + fade out
      var k = Math.min(b.cut, 1), off = k * s * 0.85, al = 1 - k;
      c.save(); c.globalAlpha = al; c.shadowColor = blockColor(b, 0.8); c.shadowBlur = s * 0.25;
      c.fillStyle = blockColor(b, 0.85);
      roundRect(c, sx - s / 2 - off, sy - s / 2 - off * 0.4, s, s / 2 - 1.5, 6); c.fill();        // upper-left half
      roundRect(c, sx - s / 2 + off, sy + 1.5 + off * 0.4, s, s / 2 - 1.5, 6); c.fill();          // lower-right half
      c.restore(); return;
    }
    if (b.pop < 1) s *= popEase(b.pop); // pop-in on the beat (scale up with a small overshoot)
    var dim = pr.prog < slashableProg() ? 0.55 : 1; // distant blocks dimmer
    c.save();
    c.shadowColor = blockColor(b, 0.9); c.shadowBlur = s * 0.28 * dim;
    // cube face
    var grad = c.createLinearGradient(sx, sy - s / 2, sx, sy + s / 2);
    grad.addColorStop(0, blockColor(b, 0.30 * dim)); grad.addColorStop(1, 'rgba(6,12,20,' + (0.82 * dim) + ')');
    c.fillStyle = grad; roundRect(c, sx - s / 2, sy - s / 2, s, s, s * 0.12); c.fill();
    c.shadowBlur = 0; c.lineWidth = Math.max(1.5, s * 0.035); c.strokeStyle = blockColor(b, dim); c.stroke();
    // down-arrow (Beat-Saber flair)
    c.strokeStyle = blockColor(b, 0.5 * dim); c.lineWidth = Math.max(1, s * 0.03);
    c.beginPath(); c.moveTo(sx, sy + s * 0.30); c.moveTo(sx - s * 0.14, sy + s * 0.16); c.lineTo(sx, sy + s * 0.32); c.lineTo(sx + s * 0.14, sy + s * 0.16); c.stroke();
    // label
    c.fillStyle = blockColor(b, dim); c.textAlign = 'center'; c.textBaseline = 'middle';
    if (b.label.length <= 4) { c.font = '700 ' + Math.round(s * 0.36) + 'px ui-monospace, monospace'; c.fillText(b.label, sx, sy - s * 0.04); }
    else { c.font = '700 ' + Math.round(s * 0.15) + 'px var(--sans, sans-serif)'; wrapText(c, b.label, sx, sy - s * 0.06, s * 0.82, s * 0.17); }
    c.restore();
  }
  function wrapText(c, text, cx, cy, maxW, lh) {
    var words = text.split(' '), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) { var test = cur ? cur + ' ' + words[i] : words[i]; if (c.measureText(test).width > maxW && cur) { lines.push(cur); cur = words[i]; } else cur = test; }
    if (cur) lines.push(cur); lines = lines.slice(0, 3);
    var y0 = cy - (lines.length - 1) * lh / 2;
    for (var j = 0; j < lines.length; j++) c.fillText(lines[j], cx, y0 + j * lh);
  }
  function drawParticles(c) {
    c.save(); c.globalCompositeOperation = 'lighter';
    for (var i = 0; i < S.particles.length; i++) { var p = S.particles[i]; c.globalAlpha = clamp(p.life / p.max, 0, 1); c.fillStyle = p.col; c.beginPath(); c.arc(p.x, p.y, p.r, 0, 7); c.fill(); }
    c.restore();
  }
  function drawSaber(c) {
    if (!S.trail.length) return;
    c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round'; c.lineJoin = 'round';
    var n = S.trail.length;
    for (var pass = 0; pass < 2; pass++) {
      c.beginPath();
      for (var i = 0; i < n; i++) { var p = S.trail[i]; if (i === 0) c.moveTo(p.x, p.y); else c.lineTo(p.x, p.y); }
      c.strokeStyle = pass === 0 ? 'rgba(120,240,255,0.22)' : 'rgba(220,255,255,0.9)';
      c.lineWidth = pass === 0 ? 16 : 4; c.stroke();
    }
    var tip = S.trail[n - 1];
    var g = c.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 16);
    g.addColorStop(0, 'rgba(230,255,255,0.95)'); g.addColorStop(1, 'rgba(120,240,255,0)');
    c.fillStyle = g; c.beginPath(); c.arc(tip.x, tip.y, 16, 0, 7); c.fill();
    c.restore();
  }
  function spark(b) {
    var pr = project(b), col = blockColor(b, 1), n = 18 + Math.min(S.combo, 10) * 2;
    for (var i = 0; i < n; i++) { var a = Math.random() * 6.283, sp = 60 + Math.random() * 320; S.particles.push({ x: pr.sx, y: pr.sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, r: 1.5 + Math.random() * 2.5, life: 0.5 + Math.random() * 0.4, max: 0.9, col: col }); }
  }

  // ---------- slashing / resolve ----------
  function blockAt(px, py) {
    var hit = null, hb = -1;
    for (var i = 0; i < S.blocks.length; i++) {
      var b = S.blocks[i]; if (!b.active || b.resolved || b.cut > 0) continue;
      var pr = project(b); if (pr.prog < slashableProg()) continue;
      var r = pr.size / 2 * 1.18;
      if (px >= pr.sx - r && px <= pr.sx + r && py >= pr.sy - r && py <= pr.sy + r) { if (b.z < hb || hb < 0) { hb = b.z; hit = b; } }
    }
    return hit;
  }
  function slash(b) {
    if (!S || S.dead || S.lockResolved || !b || b.resolved || !b.active) return;
    b.resolved = true; b.active = false; b.cut = 0.001; b.reveal = b.correct ? 'correct' : 'wrong';
    spark(b);
    resolveLock(b, b.correct ? 'hit' : 'wrong');
  }
  function slashNearest() { var best = null; for (var i = 0; i < S.blocks.length; i++) { var b = S.blocks[i]; if (b.active && !b.resolved && b.cut <= 0) { var pr = project(b); if (pr.prog >= slashableProg() && (!best || b.z < best.z)) best = b; } } if (best) slash(best); }
  function slashIndex(i) { for (var j = 0; j < S.blocks.length; j++) if (S.blocks[j].idx === i && S.blocks[j].active && !S.blocks[j].resolved) { slash(S.blocks[j]); return; } }

  function resolveLock(block, outcome) {
    if (S.lockResolved) return;
    S.lockResolved = true; S.state = 'beat'; S.totalLocks++;
    var answer = S.lock.answer, ms = nowMs() - block.born;
    // reveal correct among the rest
    S.blocks.forEach(function (b) { if (b === block) return; if (b.correct) b.reveal = 'correct'; });
    if (outcome === 'hit') {
      S.correctLocks++;
      var pts = Math.round(120 * Math.min(1 + S.combo / 10, 5));
      S.score += pts; S.combo++; if (S.combo > S.maxCombo) S.maxCombo = S.combo;
      SRS.recogCorrect(answer, ms);
      if (window.FX && S.combo % 5 === 0) FX.flash('amber', 0.28);
      SFX.correct(); SFX.combo(S.combo); bumpMeter(Math.min(1, S.combo / 12));
      UI.announce(t('fb.correct') + ' · ' + answer + ' +' + pts + (S.combo >= 2 ? ' · ×' + S.combo : ''));
    } else {
      S.lives--; S.combo = 0; S.waveMisses++;
      SRS.recogWrong(answer, ms);
      if (outcome === 'wrong' && block.code && block.code !== answer) SRS.recordConfusion(answer, block.code);
      if (S.fumbled.indexOf(answer) < 0) S.fumbled.push(answer);
      if (window.FX) FX.flash([1, 0.36, 0.36], 0.22);
      SFX.wrong();
      if (S.motion && S.els.readout) S.els.readout.classList.add('anim-shake');
      renderReadout(S.lock, true);
      bumpMeter(0);
      var extra = '';
      if (outcome === 'wrong' && block.code && block.code !== answer) { var mn = window.qcodeMnemonic(answer, block.code); if (mn) extra = ' · ' + tt(mn); }
      UI.announce((outcome === 'pass' ? tt({ pl: 'Przeleciał', en: 'Flew past' }) : t('fb.wrong')) + ' · ' + answer + ' = ' + UI.meaningShort(answer) + extra);
    }
    updateHUD(); Store.touchActivity(); S.lockInWave++;
    if (!S.motion && S.calmWrap) markCalm(block, outcome);
    later(afterBeat, outcome === 'hit' ? 620 : 1050);
  }
  function afterBeat() {
    if (S.dead) return;
    S.blocks = [];
    if (S.calmWrap) UI.clear(S.calmWrap);
    if (S.lives <= 0) return gameOver();
    if (S.lockInWave >= LOCKS_PER_WAVE) return waveBreak();
    startLock();
  }
  function waveBreak() {
    var perfect = S.waveMisses === 0;
    if (perfect) { S.score += 250; if (window.FX) FX.celebrate(); }
    S.wave++; S.lockInWave = 0; S.waveMisses = 0;
    S.speed = Math.min(0.85, 0.34 + (S.wave - 1) * 0.07); // faster cubes each wave
    updateHUD();
    if (S.motion) {
      var banner = UI.el('div', { class: 'arcade-banner' }, [
        UI.el('div', { class: 'arcade-banner__big', text: 'QSY ↑' }),
        UI.el('div', { text: (perfect ? tt({ pl: 'Czysta fala! +250 · ', en: 'Clean wave! +250 · ' }) : '') + tt({ pl: 'Fala ', en: 'Wave ' }) + S.wave })
      ]);
      S.els.field.appendChild(banner);
      later(function () { if (banner.parentNode) banner.parentNode.removeChild(banner); startLock(); }, perfect ? 1500 : 1200);
    } else { startLock(); }
    UI.announce(tt({ pl: 'Fala ', en: 'Wave ' }) + S.wave);
  }

  // ---------- calm (reduced-motion) MCQ ----------
  function renderCalm() {
    var wrap = S.calmWrap; UI.clear(wrap);
    var grid = UI.el('div', { class: 'choices' });
    S.lock.options.forEach(function (opt, i) {
      var b = UI.el('button', { type: 'button', class: 'choice' + (opt.kind === 'code' ? ' choice--code' : '') }, [
        UI.el('span', { class: 'choice__key', text: String(i + 1) }),
        UI.el('span', { class: 'choice__txt', lang: opt.kind === 'meaning' ? UI.lang() : null, text: opt.label })
      ]);
      b._opt = opt; b._idx = i;
      b.addEventListener('click', function () { calmPick(opt, b); });
      grid.appendChild(b);
    });
    wrap.appendChild(grid);
    later(function () { var f = wrap.querySelector('.choice'); if (f) UI.focus(f); }, 0);
  }
  function calmPick(opt, btnEl) {
    if (S.lockResolved) return;
    var pseudo = { correct: opt.correct, code: opt.code, born: nowMs(), idx: btnEl._idx };
    resolveLock(pseudo, opt.correct ? 'hit' : 'wrong');
  }
  function markCalm(block, outcome) {
    if (!S.calmWrap) return;
    [].slice.call(S.calmWrap.querySelectorAll('.choice')).forEach(function (el) {
      var o = el._opt; el.setAttribute('disabled', '');
      if (o.correct) el.classList.add('is-correct');
      else if (el._idx === block.idx && outcome === 'wrong') el.classList.add('is-wrong');
      else el.classList.add('is-dim');
    });
  }

  // ---------- HUD ----------
  function updateHUD() {
    S.els.score.textContent = String(S.score);
    S.els.combo.textContent = S.combo >= 2 ? ('×' + S.combo) : '';
    S.els.wave.textContent = tt({ pl: 'Fala ', en: 'Wave ' }) + S.wave;
    UI.clear(S.els.lives);
    for (var i = 0; i < START_LIVES; i++) S.els.lives.appendChild(UI.el('span', { class: 'arcade-life' + (i < S.lives ? ' is-on' : ''), 'aria-hidden': 'true' }));
    S.els.lives.appendChild(UI.el('span', { class: 'sr-only', text: tt({ pl: 'Życia: ', en: 'Lives: ' }) + S.lives + '/' + START_LIVES }));
  }
  function bumpMeter(frac) { if (S.els.meterFill) S.els.meterFill.style.transform = 'scaleX(' + clamp(frac, 0, 1) + ')'; }

  // ---------- game over ----------
  function gameOver() {
    S.state = 'over';
    if (S.rafId) { caf(S.rafId); S.rafId = 0; }
    stopMusic(); // the theme ends with the game, not when you leave the recap screen
    Store.state.stats.sessionsCompleted++; Store.save(); UI.refreshChrome();
    var lang = Store.settings().lang;
    var acc = S.totalLocks ? Math.round(S.correctLocks / S.totalLocks * 100) : 0;
    var root = UI.el('div', { class: 'mode' }, [UI.modeHeader({ title: tt({ pl: 'Koniec gry', en: 'Game over' }) })]);
    var card = UI.el('div', { class: 'card recap center' });
    card.appendChild(UI.el('div', { class: 'recap__big', text: tt({ pl: 'Wynik ', en: 'Score ' }) + S.score }));
    card.appendChild(UI.el('div', { class: 'arcade-stats' }, [
      statPill(tt({ pl: 'Maks. seria', en: 'Max combo' }), '×' + S.maxCombo),
      statPill(tt({ pl: 'Celność', en: 'Accuracy' }), acc + '%'),
      statPill(tt({ pl: 'Fale', en: 'Waves' }), S.wave)
    ]));
    if (qualifies(lang, S.score)) card.appendChild(highScoreEntry(lang)); else card.appendChild(scoreTable(lang));
    if (S.fumbled.length) {
      var chips = UI.el('div', { class: 'recap__chips' });
      uniq(S.fumbled).forEach(function (c) { chips.appendChild(UI.el('span', { class: 'code code--bad', text: c })); });
      card.appendChild(UI.el('div', { class: 'recap__row' }, [UI.el('h3', { text: tt({ pl: 'Zaszumione', en: 'Noisy ones' }) }), chips]));
    }
    var actions = UI.el('div', { class: 'recap__actions' });
    if (S.fumbled.length) actions.appendChild(UI.btn(tt({ pl: 'Powtórz słabe w Flow', en: 'Review weak in Flow' }), { variant: 'primary', onClick: function () { App.go('flow', { inject: uniq(S.fumbled) }); } }));
    actions.appendChild(UI.btn(t('recap.again'), { variant: S.fumbled.length ? 'ghost' : 'primary', onClick: function () { App.go('bitsaber'); } }));
    actions.appendChild(UI.btn(t('nav.home'), { variant: 'ghost', onClick: function () { App.go('home'); } }));
    card.appendChild(actions);
    root.appendChild(card); UI.setScreen(root);
    UI.announce(tt({ pl: 'Koniec gry. Wynik ', en: 'Game over. Score ' }) + S.score);
    later(function () { UI.focusFirst(root); }, 0);
  }
  function statPill(label, value) { return UI.el('div', { class: 'pill' }, [UI.el('span', { class: 'pill__v', text: String(value) }), UI.el('span', { class: 'pill__l', text: label })]); }
  function qualifies(lang, score) { if (score <= 0) return false; var list = (Store.state.highScores[lang] || []); return list.length < 5 || score > list[list.length - 1].score; }
  function highScoreEntry(lang) {
    var box = UI.el('div', { class: 'card', style: { margin: '0 0 .8rem' } });
    box.appendChild(UI.el('p', { class: 'muted', text: tt({ pl: 'Nowy wynik! Wpisz swój znak (3 znaki):', en: 'New high score! Enter your callsign (3 chars):' }) }));
    var input = UI.el('input', { class: 'input', maxlength: '3', style: { textTransform: 'uppercase', maxWidth: '8rem', textAlign: 'center', fontFamily: 'var(--mono)' }, 'aria-label': tt({ pl: 'Znak', en: 'Callsign' }), value: 'SP' });
    var saved = false;
    function save() { if (saved) return; saved = true; var cs = (input.value || '---').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || '---'; var place = Store.addHighScore(lang, { callsign: cs, score: S.score, maxCombo: S.maxCombo, ts: Date.now() }); if (window.FX) FX.celebrate(); box.parentNode.replaceChild(scoreTable(lang, place), box); }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    box.appendChild(UI.el('div', { class: 'io__row' }, [input, UI.btn(t('common.done'), { variant: 'primary', onClick: save })]));
    later(function () { UI.focus(input); input.select(); }, 0);
    return box;
  }
  function scoreTable(lang, place) {
    var list = Store.state.highScores[lang] || [];
    var box = UI.el('div', { class: 'card', style: { margin: '0 0 .8rem' } }, [UI.el('h3', { text: t('dash.highscores') })]);
    if (!list.length) { box.appendChild(UI.el('p', { class: 'muted', text: t('dash.highscores.empty') })); return box; }
    var tb = UI.el('tbody');
    list.forEach(function (e, i) { tb.appendChild(UI.el('tr', { class: i === place ? 'is-focus' : '' }, [UI.el('td', { text: '#' + (i + 1) }), UI.el('td', { class: 'mono', text: e.callsign || '—' }), UI.el('td', { class: 'mono', text: String(e.score) }), UI.el('td', { class: 'muted', text: '×' + (e.maxCombo || 0) })])); });
    box.appendChild(UI.el('table', { class: 'abbrevs' }, [tb]));
    return box;
  }

  // ---------- pointer ----------
  function bindPointer() {
    if (S.ptr.bound) return; S.ptr.bound = true;
    var f = S.els.field;
    S.ptr.move = function (e) {
      if (!S || S.dead || S.state !== 'playing') return;
      var rect = f.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
      var prev = S.trail.length ? S.trail[S.trail.length - 1] : null;
      S.trail.push({ x: x, y: y, t: nowMs() }); if (S.trail.length > 24) S.trail.shift();
      var sp = prev ? Math.hypot(x - prev.x, y - prev.y) : 0;
      if (e.buttons > 0 || e.pointerType !== 'mouse' || sp > 6) { var b = blockAt(x, y); if (b) slash(b); }
    };
    S.ptr.down = function (e) {
      if (!S || S.dead || S.state !== 'playing') return;
      var rect = f.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
      S.trail.push({ x: x, y: y, t: nowMs() });
      var b = blockAt(x, y); if (b) { e.preventDefault(); slash(b); }
    };
    f.addEventListener('pointermove', S.ptr.move);
    f.addEventListener('pointerdown', S.ptr.down);
  }
  function unbindPointer() {
    if (S && S.ptr && S.ptr.bound && S.els.field) {
      if (S.ptr.move) S.els.field.removeEventListener('pointermove', S.ptr.move);
      if (S.ptr.down) S.els.field.removeEventListener('pointerdown', S.ptr.down);
    }
  }

  // ---------- keyboard ----------
  function onKey(e) {
    if (!S || S.dead) return;
    if (S.state === 'ready') { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); beginPlay(); } return; }
    if (S.state !== 'playing') return;
    var k = e.key;
    if (k >= '1' && k <= '9') { e.preventDefault(); slashIndex(parseInt(k, 10) - 1); return; }
    if (S.motion) { if (k === ' ' || k === 'Enter') { e.preventDefault(); slashNearest(); } }
    else if (k === 'Enter') { for (var i = 0; i < S.calmWrap.querySelectorAll('.choice').length; i++) { var el = S.calmWrap.querySelectorAll('.choice')[i]; if (el === document.activeElement) { e.preventDefault(); calmPick(el._opt, el); return; } } }
  }

  return { id: 'bitsaber', start: start, stop: stop, onKey: onKey };
})();
