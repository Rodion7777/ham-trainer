// ============================================================
// Mode: Sweep — "Namiar" (3D radar PPI dome). RAW WebGL, no libraries.
// A fixed-perspective 3D radar dome (lat rings + spokes + rotating sweep arm)
// rendered in its own <canvas>; contacts ("blips") ride inward from the rim
// toward the centre. Answer labels are real DOM buttons projected onto each
// blip's 3D screen position and scaled by depth — crisp, clickable, a11y.
// Intercept the blip matching the prompt before it reaches the centre.
// Lock/SRS/recap/high-score machinery mirrors mode-arcade.js. A reduced-motion
// CALM branch lays the same blips out statically. Strict rAF/timer/GL teardown.
// ============================================================
window.ModeSweep = (function () {
  'use strict';
  var S = null;
  var raf = window.requestAnimationFrame, caf = window.cancelAnimationFrame;
  var POOL = 5, START_LIVES = 3, LOCKS_PER_WAVE = 6;
  var R = 2.2, FOV = 48 * Math.PI / 180, NEAR_W = 5.4;
  var EYE = [0, 3.4, 5.4], CTR = [0, 0.3, 0];
  var FAM = { freq: 'f', offset: 'f', time: 't', wait: 't', question: 'a', callsign: 'a' };
  function fam(k) { return FAM[k] || k; }
  function kindLabel(k) { var o = window.QCODE_ARG_KINDS[k]; return UI.lang() === 'pl' ? o.pl : o.en; }
  function nowMs() { try { return performance.now(); } catch (e) { return Date.now(); } }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rangeArr(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }
  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { if (x != null && !s[x]) { s[x] = 1; o.push(x); } }); return o; }

  // ---------- mat4 (column-major, GL convention) ----------
  function m4mul(a, b) { var o = new Float32Array(16); for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) { var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
  function m4persp(fovy, aspect, near, far) { var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far); var o = new Float32Array(16); o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = 2 * far * near * nf; return o; }
  function m4rotY(rad) { var c = Math.cos(rad), s = Math.sin(rad); var o = new Float32Array(16); o[0] = c; o[2] = -s; o[5] = 1; o[8] = s; o[10] = c; o[15] = 1; return o; }
  function v3norm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function v3cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function m4lookAt(e, c, u) { var z = v3norm(v3sub(e, c)), x = v3norm(v3cross(u, z)), y = v3cross(z, x); return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -v3dot(x, e), -v3dot(y, e), -v3dot(z, e), 1]); }
  // project world (x,y,z) with mvp -> {sx,sy,w,visible}
  function project(mvp, x, y, z, W, H) {
    var cx = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12];
    var cy = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13];
    var cw = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
    if (cw <= 1e-4) return { visible: false };
    var nx = cx / cw, ny = cy / cw;
    return { sx: (nx * 0.5 + 0.5) * W, sy: (1 - (ny * 0.5 + 0.5)) * H, w: cw, visible: nx >= -1.25 && nx <= 1.25 && ny >= -1.25 && ny <= 1.25 };
  }

  // ---------- GL helpers ----------
  function sh(gl, type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function prog(gl, vs, fs) { var p = gl.createProgram(); gl.attachShader(p, sh(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl, gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); p.u = function (n) { return gl.getUniformLocation(p, n); }; p.a = function (n) { return gl.getAttribLocation(p, n); }; return p; }
  var VS = 'attribute vec3 a_pos; attribute float a_alpha; uniform mat4 u_mvp; uniform float u_psize; uniform float u_dpr; varying float v_a; void main(){ gl_Position=u_mvp*vec4(a_pos,1.0); gl_PointSize=u_psize*u_dpr/max(0.5,gl_Position.w); v_a=a_alpha; }';
  var FS_LINE = 'precision mediump float; uniform vec3 u_color; uniform float u_alpha; varying float v_a; void main(){ gl_FragColor=vec4(u_color, u_alpha*v_a); }';
  var FS_BLIP = 'precision mediump float; uniform vec3 u_color; uniform float u_alpha; varying float v_a; void main(){ float r=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.0,r); gl_FragColor=vec4(u_color, a*u_alpha*v_a); }';

  function cssRGB(name, fb) {
    try { var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); if (v[0] === '#') { var h = v.slice(1); if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]; } } catch (e) {}
    return fb;
  }

  // ---------- scene buffers ----------
  function buildScene() {
    var gl = S.gl;
    S.lineProg = prog(gl, VS, FS_LINE);
    S.blipProg = prog(gl, VS, FS_BLIP);
    // dome rings + spokes -> one static interleaved buffer (x,y,z,alpha)
    var L = [];
    var RINGS = 6, SEG = 48;
    for (var i = 1; i <= RINGS; i++) {
      var th = (i / RINGS) * (Math.PI / 2) * 0.94;
      var rr = R * Math.cos(th), yy = R * Math.sin(th) * 0.9;
      var al = 0.2 + 0.65 * (i / RINGS);
      for (var s = 0; s < SEG; s++) {
        var p1 = s / SEG * Math.PI * 2, p2 = (s + 1) / SEG * Math.PI * 2;
        L.push(rr * Math.cos(p1), yy, rr * Math.sin(p1), al, rr * Math.cos(p2), yy, rr * Math.sin(p2), al);
      }
    }
    for (var k = 0; k < 12; k++) { var a = k / 12 * Math.PI * 2; L.push(0, 0.02, 0, 0.28, R * Math.cos(a), 0.02, R * Math.sin(a), 0.28); }
    S.lineCount = L.length / 4;
    S.lineBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, S.lineBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(L), gl.STATIC_DRAW);
    // sweep arm (around +x) + trailing fan, rotated each frame via model matrix
    var W = [0, 0.05, 0, 1.0, R, 0.05, 0, 1.0];
    for (var t = 1; t <= 7; t++) { var ang = -t * 0.10, aa = 0.5 * (1 - t / 8); W.push(0, 0.04, 0, aa, R * Math.cos(ang), 0.04, R * Math.sin(ang), aa); }
    S.sweepCount = W.length / 4;
    S.sweepBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, S.sweepBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(W), gl.STATIC_DRAW);
    // blip dynamic buffer (POOL points: x,y,z,alpha)
    S.blipArr = new Float32Array(POOL * 4);
    S.blipBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, S.blipBuf); gl.bufferData(gl.ARRAY_BUFFER, S.blipArr, gl.DYNAMIC_DRAW);
    refreshColors();
  }
  function refreshColors() {
    S.col = { dome: cssRGB('--cyan', [0.31, 0.82, 0.88]), sweep: cssRGB('--green', [0.24, 0.86, 0.52]), blip: cssRGB('--amber', [1, 0.7, 0.24]) };
  }

  // ---------- lifecycle ----------
  function start(host, ctx) {
    S = {
      dead: false, state: 'ready', glOk: false, motion: !UI.reducedMotion(),
      score: 0, combo: 0, maxCombo: 0, lives: START_LIVES, wave: 1,
      lockInWave: 0, totalLocks: 0, correctLocks: 0, waveMisses: 0,
      recent: [], fumbled: [], blips: [], pool: [],
      fieldW: 0, fieldH: 0, dpr: 1, mvp: null, sweepAngle: 0, approach: 1 / 5.0,
      rafId: 0, timers: [], lastT: 0, lockResolved: false, lock: null,
      els: {}, ptrBound: false, gl: null, canvas: null
    };
    var root = UI.el('div', { class: 'mode sweep' });
    S.els.score = UI.el('span', { class: 'hud__score', text: '0' });
    S.els.combo = UI.el('span', { class: 'hud__combo' });
    S.els.wave = UI.el('span', { class: 'arcade-wave' });
    S.els.lives = UI.el('span', { class: 'arcade-lives' });
    var hud = UI.el('div', { class: 'hud' }, [UI.el('span', {}, [S.els.score, S.els.combo]), UI.el('span', {}, [S.els.wave, document.createTextNode(' '), S.els.lives])]);
    S.els.readout = UI.el('div', { class: 'arcade-readout', 'aria-live': 'off' });
    S.els.field = UI.el('div', { class: 'arcade-field sweep-field', role: 'group', 'aria-label': tt({ pl: 'Radar', en: 'Radar' }), tabindex: '-1' });
    root.appendChild(UI.modeHeader({ title: tt({ pl: 'Namiar (radar 3D)', en: 'Sweep (3D radar)' }) }));
    root.appendChild(hud); root.appendChild(S.els.readout); root.appendChild(S.els.field);
    UI.setScreen(root);
    updateHUD();
    renderIntro();
  }

  function stop() {
    if (!S) return;
    S.dead = true;
    if (S.rafId) { caf(S.rafId); S.rafId = 0; }
    clearTimers(); unbindPointer();
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('resize', onResize);
    if (S.gl) { try { var ext = S.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (e) {} }
    S.gl = null; S.canvas = null;
  }
  function clearTimers() { if (S) { S.timers.forEach(function (id) { clearTimeout(id); }); S.timers = []; } }
  function later(fn, ms) { var id = setTimeout(function () { if (!S) return; var i = S.timers.indexOf(id); if (i >= 0) S.timers.splice(i, 1); if (S.dead) return; fn(); }, ms); S.timers.push(id); return id; }

  function renderIntro() {
    var f = S.els.field; UI.clear(f);
    var card = UI.el('div', { class: 'arcade-intro' }, [
      UI.el('div', { class: 'arcade-intro__title', text: tt({ pl: 'Namierz sygnał', en: 'Track the signal' }) }),
      UI.el('p', { class: 'muted', text: S.motion
        ? tt({ pl: 'Kontakty nadlatują znad krawędzi radaru do środka. Namierz właściwy kod (klik / 1–5) zanim dotrze do centrum. 3 życia.', en: 'Contacts sweep in from the rim toward the centre. Intercept the right code (click / 1–5) before it reaches the middle. 3 lives.' })
        : tt({ pl: 'Tryb spokojny: wybierz właściwy kontakt (klik / 1–5). Bez ruchu i czasu.', en: 'Calm mode: pick the right contact (click / 1–5). No motion, no timer.' }) }),
      UI.btn(tt({ pl: 'Włącz radar — start', en: 'Power up — start' }), { variant: 'primary', class: 'sweep-start', onClick: beginPlay })
    ]);
    if (S.motion) card.appendChild(UI.el('p', { class: 'muted', style: { fontSize: '.82rem' } }, [document.createTextNode(tt({ pl: 'Wolisz spokojniej? ', en: 'Prefer something calmer? ' })), UI.btn('Flow', { variant: 'ghost', onClick: function () { App.go('flow'); } })]));
    f.appendChild(card);
    later(function () { var b = f.querySelector('.sweep-start'); if (b) UI.focus(b); }, 0);
  }

  // ---------- geometry / GL init ----------
  function measure() {
    var f = S.els.field;
    S.fieldW = f.clientWidth || 320; S.fieldH = f.clientHeight || 360;
    S.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    if (S.canvas && S.gl) {
      S.canvas.width = Math.floor(S.fieldW * S.dpr); S.canvas.height = Math.floor(S.fieldH * S.dpr);
      S.canvas.style.width = S.fieldW + 'px'; S.canvas.style.height = S.fieldH + 'px';
      S.gl.viewport(0, 0, S.canvas.width, S.canvas.height);
    }
    var proj = m4persp(FOV, S.fieldW / Math.max(1, S.fieldH), 0.1, 100);
    S.mvp = m4mul(proj, m4lookAt(EYE, CTR, [0, 1, 0]));
  }
  function onResize() { if (!S || S.dead) return; measure(); if (!S.motion) layoutCalm(); }

  function initGL() {
    var c = UI.el('canvas', { class: 'sweep-canvas', 'aria-hidden': 'true' });
    S.els.field.appendChild(c);
    S.canvas = c;
    var attrs = { alpha: true, antialias: true, depth: true, premultipliedAlpha: false, powerPreference: 'low-power' };
    try { S.gl = c.getContext('webgl', attrs) || c.getContext('experimental-webgl', attrs); } catch (e) { S.gl = null; }
    if (!S.gl) { S.glOk = false; return; }
    try { buildScene(); S.glOk = true; } catch (e) { S.glOk = false; S.gl = null; if (c.parentNode) c.parentNode.removeChild(c); }
  }

  // ---------- pool of label buttons ----------
  function buildPool() {
    var f = S.els.field;
    for (var i = 0; i < POOL; i++) {
      var key = UI.el('span', { class: 'arcade-chip__key' });
      var txt = UI.el('span', { class: 'arcade-chip__txt' });
      var el = UI.el('button', { type: 'button', class: 'sweep-blip', style: { display: 'none' } }, [key, txt]);
      var b = { el: el, key: key, txt: txt, az: 0, t: 0, correct: false, code: null, kind: null, resolved: true, active: false, bornAt: 0, slot: i };
      (function (bl) { el.addEventListener('pointerdown', function (e) { e.stopPropagation(); e.preventDefault(); tryFire(bl); }); })(b);
      f.appendChild(el);
      S.pool.push(b);
    }
  }

  function beginPlay() {
    if (Store.settings().sound) SFX.ensure();
    UI.clear(S.els.field);
    if (S.motion) initGL();
    if (!S.glOk) S.motion = false; // no WebGL -> calm
    measure();
    buildPool();
    bindPointer();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('resize', onResize);
    S.state = 'playing';
    if (S.motion) { S.lastT = nowMs(); S.rafId = raf(loop); }
    startLock();
    later(function () { UI.focus(S.els.field); }, 0);
  }
  function onVis() { if (S && !S.dead) S.lastT = nowMs(); }

  // ---------- lock building (mirrors arcade) ----------
  function simultCount(dir) { var base = S.wave < 2 ? 3 : (S.wave < 4 ? 4 : 5); if (dir === 'code' || dir === 'format') base = Math.min(base, 4); return Math.max(2, Math.min(base, POOL)); }
  function nextDirection() { if (S.wave >= 2 && (S.totalLocks % 3 === 2)) return 'format'; return (S.totalLocks % 2 === 0) ? 'meaning' : 'code'; }
  function buildLock() {
    var dir = nextDirection();
    var answer = SRS.pickOne(S.recent.slice(-5)) || SRS.pickOne([]) || window.QCODE_LIST[0];
    S.recent.push(answer); if (S.recent.length > 12) S.recent.shift();
    var simult = simultCount(dir), options = [];
    if (dir === 'meaning') uniq([answer].concat(SRS.distractors(answer, simult))).slice(0, simult).forEach(function (c) { options.push({ label: c, code: c, kind: 'code', correct: c === answer }); });
    else if (dir === 'code') uniq([answer].concat(SRS.distractors(answer, simult))).slice(0, simult).forEach(function (c) { options.push({ label: UI.meaningShort(c), code: c, kind: 'meaning', correct: c === answer }); });
    else {
      var ck = window.QCODE_BY[answer].arg.kind;
      var kinds = Object.keys(window.QCODE_ARG_KINDS).filter(function (k) { return k !== 'level9'; });
      var others = SRS.shuffle(kinds.filter(function (k) { return k !== ck && fam(k) !== fam(ck); })).slice(0, simult - 1);
      if (ck === 'level' && others.indexOf('level9') < 0) others[others.length - 1] = 'level9';
      uniq([ck].concat(others)).slice(0, simult).forEach(function (k) { options.push({ label: kindLabel(k), code: null, kind: 'format', correct: k === ck }); });
    }
    if (!options.some(function (o) { return o.correct; })) options[0].correct = true;
    return { answer: answer, dir: dir, options: SRS.shuffle(options) };
  }

  function renderReadout(lock, reveal) {
    var r = S.els.readout; UI.clear(r);
    if (reveal) { r.appendChild(UI.el('span', { class: 'code', text: lock.answer })); r.appendChild(document.createTextNode(' = ')); r.appendChild(UI.el('span', { lang: UI.lang(), text: UI.meaningShort(lock.answer) })); return; }
    if (lock.dir === 'meaning') { r.appendChild(UI.el('span', { class: 'arcade-readout__lbl', text: tt({ pl: 'Namierz kod dla: ', en: 'Track the code for: ' }) })); r.appendChild(UI.el('span', { class: 'arcade-readout__big', lang: UI.lang(), text: UI.meaningShort(lock.answer) })); }
    else if (lock.dir === 'code') { r.appendChild(UI.el('span', { class: 'arcade-readout__lbl', text: tt({ pl: 'Namierz znaczenie: ', en: 'Track the meaning of: ' }) })); r.appendChild(UI.codeChip(lock.answer, { big: true })); }
    else { r.appendChild(UI.el('span', { class: 'arcade-readout__lbl', text: tt({ pl: 'Co podaje się po: ', en: 'What follows: ' }) })); r.appendChild(UI.codeChip(lock.answer, { big: true })); }
  }

  function startLock() {
    if (S.dead) return;
    S.state = 'playing'; S.lockResolved = false;
    S.lock = buildLock();
    renderReadout(S.lock, false);
    if (S.els.readout) S.els.readout.classList.remove('anim-shake');
    hideAllBlips();
    S.blips = [];
    var n = S.lock.options.length;
    S.lock.options.forEach(function (opt, i) {
      var b = S.pool[i]; if (!b) return;
      b.correct = opt.correct; b.code = opt.code; b.kind = opt.kind; b.resolved = false; b.active = true; b.bornAt = nowMs();
      b.az = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      b.t = S.motion ? -i * 0.12 : 0.5; // staggered entry in motion; mid for calm
      b.key.textContent = String(i + 1);
      b.txt.textContent = opt.label; b.el.title = opt.label;
      b.el.className = 'sweep-blip' + (opt.kind === 'code' ? ' arcade-chip--code' : '');
      if (opt.kind === 'meaning') b.txt.setAttribute('lang', UI.lang()); else b.txt.removeAttribute('lang');
      b.el.setAttribute('aria-label', opt.label + ', ' + tt({ pl: 'kontakt', en: 'contact' }) + ' ' + (i + 1));
      b.el.style.display = ''; b.el.removeAttribute('disabled');
      S.blips.push(b);
    });
    if (S.motion) drawScene(0); else layoutCalm();
    UI.announce((S.lock.dir === 'meaning' ? tt({ pl: 'Namierz kod dla: ', en: 'Track the code for: ' }) + UI.meaningShort(S.lock.answer)
      : (S.lock.dir === 'code' ? tt({ pl: 'Namierz znaczenie ', en: 'Track the meaning of ' }) : tt({ pl: 'Co podaje się po ', en: 'What follows ' })) + S.lock.answer));
    if (!S.motion) later(function () { if (S.blips[0]) UI.focus(S.blips[0].el); }, 0);
  }
  function hideAllBlips() { S.pool.forEach(function (b) { b.active = false; b.resolved = true; b.el.style.display = 'none'; b.el.classList.remove('is-correct', 'is-wrong', 'is-dim'); var ic = b.el.querySelector('.icon'); if (ic) ic.remove(); }); }

  function blipWorld(b) {
    var tt2 = clamp(b.t, 0, 1);
    var rx = R * Math.cos(b.az) * 0.96, rz = R * Math.sin(b.az) * 0.96, ry = 0.16;
    return [rx + (0 - rx) * tt2, ry + (0.35 - ry) * tt2, rz + (0 - rz) * tt2];
  }

  // ---------- calm static layout ----------
  function layoutCalm() {
    var cxp = S.fieldW / 2, cyp = S.fieldH / 2, rad = Math.min(S.fieldW, S.fieldH) * 0.32;
    var n = S.blips.length;
    S.blips.forEach(function (b, i) {
      var a = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
      var x = cxp + Math.cos(a) * rad, y = cyp + Math.sin(a) * rad;
      b.el.style.opacity = '1'; b.el.style.pointerEvents = 'auto';
      b.el.style.transform = 'translate(' + x + 'px,' + y + 'px) translate(-50%,-50%)';
    });
  }

  // ---------- main loop ----------
  function loop(ts) {
    S.rafId = 0; if (!S || S.dead) return;
    if (document.hidden) { S.lastT = ts; S.rafId = raf(loop); return; }
    var dt = clamp((ts - S.lastT) / 1000, 0, 0.05); S.lastT = ts;
    if (S.state === 'playing') step(dt, ts);
    S.rafId = raf(loop);
  }
  function step(dt, ts) {
    S.sweepAngle += dt * (0.9 + (S.wave - 1) * 0.12);
    for (var i = 0; i < S.blips.length; i++) {
      var b = S.blips[i]; if (!b.active || b.resolved) continue;
      b.t += S.approach * dt;
      if (b.correct && b.t >= 1 && !S.lockResolved) { b.resolved = true; b.active = false; resolveLock(b, 'escape'); }
    }
    drawScene(ts);
    projectLabels(ts);
  }

  function drawScene(ts) {
    var gl = S.gl; if (!gl || !S.glOk) return;
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    // dome + spokes
    var lp = S.lineProg; gl.useProgram(lp);
    gl.bindBuffer(gl.ARRAY_BUFFER, S.lineBuf);
    var ap = lp.a('a_pos'), aa = lp.a('a_alpha');
    gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aa); gl.vertexAttribPointer(aa, 1, gl.FLOAT, false, 16, 12);
    gl.uniformMatrix4fv(lp.u('u_mvp'), false, S.mvp);
    gl.uniform3fv(lp.u('u_color'), S.col.dome); gl.uniform1f(lp.u('u_alpha'), 0.85);
    gl.drawArrays(gl.LINES, 0, S.lineCount);
    // sweep arm (rotated) — motion only
    if (S.motion) {
      gl.bindBuffer(gl.ARRAY_BUFFER, S.sweepBuf);
      gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 16, 0); gl.vertexAttribPointer(aa, 1, gl.FLOAT, false, 16, 12);
      gl.uniformMatrix4fv(lp.u('u_mvp'), false, m4mul(S.mvp, m4rotY(S.sweepAngle)));
      gl.uniform3fv(lp.u('u_color'), S.col.sweep); gl.uniform1f(lp.u('u_alpha'), 0.9);
      gl.drawArrays(gl.LINES, 0, S.sweepCount);
    }
    // blips (additive glow)
    var nb = 0;
    for (var i = 0; i < S.blips.length; i++) { var b = S.blips[i]; if (!b.active || b.t < 0) continue; var w = blipWorld(b); var o = nb * 4; S.blipArr[o] = w[0]; S.blipArr[o + 1] = w[1]; S.blipArr[o + 2] = w[2]; S.blipArr[o + 3] = b.correct ? 1.0 : 0.85; nb++; }
    if (nb) {
      gl.disable(gl.DEPTH_TEST); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      var bp = S.blipProg; gl.useProgram(bp);
      gl.bindBuffer(gl.ARRAY_BUFFER, S.blipBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, S.blipArr);
      var bap = bp.a('a_pos'), baa = bp.a('a_alpha');
      gl.enableVertexAttribArray(bap); gl.vertexAttribPointer(bap, 3, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(baa); gl.vertexAttribPointer(baa, 1, gl.FLOAT, false, 16, 12);
      gl.uniformMatrix4fv(bp.u('u_mvp'), false, S.mvp);
      gl.uniform3fv(bp.u('u_color'), S.col.blip); gl.uniform1f(bp.u('u_alpha'), 0.9); gl.uniform1f(bp.u('u_psize'), 30); gl.uniform1f(bp.u('u_dpr'), S.dpr);
      gl.drawArrays(gl.POINTS, 0, nb);
    }
  }

  function projectLabels(ts) {
    for (var i = 0; i < S.blips.length; i++) {
      var b = S.blips[i]; if (!b.active) continue;
      if (b.t < 0) { b.el.style.opacity = '0'; b.el.style.pointerEvents = 'none'; continue; }
      var w = blipWorld(b);
      var p = project(S.mvp, w[0], w[1], w[2], S.fieldW, S.fieldH);
      if (!p.visible) { b.el.style.opacity = '0'; b.el.style.pointerEvents = 'none'; continue; }
      var ds = clamp(NEAR_W / p.w, 0.66, 1.18);
      var shim = 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(ts / 1000 * 3 + b.slot));
      b.el.style.transform = 'translate(' + p.sx + 'px,' + p.sy + 'px) translate(-50%,-50%) scale(' + ds + ')';
      b.el.style.opacity = String(clamp(0.6 + 0.5 * (ds - 0.66), 0.6, 1) * (b.resolved ? 1 : shim));
      b.el.style.pointerEvents = b.resolved ? 'none' : 'auto';
    }
  }

  // ---------- resolve (mirrors arcade) ----------
  function tryFire(b) { if (!S || S.dead || S.lockResolved || b.resolved || !b.active || b.t < 0) return; b.resolved = true; resolveLock(b, b.correct ? 'hit' : 'wrong'); }
  function directFireIndex(i) { if (S.blips[i] && S.blips[i].active && !S.blips[i].resolved) tryFire(S.blips[i]); }
  function quality(b) { return S.motion ? clamp(1 - clamp(b.t, 0, 1), 0.4, 1) : 0.85; }
  function markIcon(b, cls, icon) { b.el.classList.add(cls); b.el.insertBefore(UI.icon(icon), b.el.firstChild); }

  function resolveLock(chip, outcome) {
    if (S.lockResolved) return;
    S.lockResolved = true; S.state = 'beat'; S.totalLocks++;
    var answer = S.lock.answer, ms = nowMs() - chip.bornAt;
    S.blips.forEach(function (b) { if (b === chip) return; if (b.correct) { if (b.active) markIcon(b, 'is-correct', 'check'); } else if (b.active) b.el.classList.add('is-dim'); });
    if (outcome === 'hit') {
      S.correctLocks++;
      var pts = Math.round(100 * quality(chip) * Math.min(1 + S.combo / 10, 5));
      S.score += pts; S.combo++; if (S.combo > S.maxCombo) S.maxCombo = S.combo;
      SRS.recogCorrect(answer, ms);
      markIcon(chip, 'is-correct', 'check');
      if (window.FX) { FX.burstAt(chip.el, { color: S.combo >= 3 ? 'combo' : 'ok', count: 22 + Math.min(S.combo, 10) * 4, power: 0.95 + Math.min(S.combo, 12) * 0.06, size: 10 }); if (S.combo % 5 === 0) FX.flash('amber', 0.3); }
      SFX.correct(); SFX.combo(S.combo);
      UI.announce(t('fb.correct') + ' · ' + answer + ' +' + pts + (S.combo >= 2 ? ' · ×' + S.combo : ''));
    } else {
      S.lives--; S.combo = 0; S.waveMisses++;
      SRS.recogWrong(answer, ms);
      if (outcome === 'wrong' && chip.code && chip.code !== answer) SRS.recordConfusion(answer, chip.code);
      if (S.fumbled.indexOf(answer) < 0) S.fumbled.push(answer);
      if (outcome === 'wrong') markIcon(chip, 'is-wrong', 'cross');
      if (window.FX) FX.flash([1, 0.36, 0.36], 0.22);
      SFX.wrong();
      if (S.motion && !UI.reducedMotion() && S.els.readout) S.els.readout.classList.add('anim-shake');
      renderReadout(S.lock, true);
      var extra = '';
      if (outcome === 'wrong' && chip.code && chip.code !== answer) { var mn = window.qcodeMnemonic(answer, chip.code); if (mn) extra = ' · ' + tt(mn); }
      UI.announce((outcome === 'escape' ? tt({ pl: 'Przeoczony', en: 'Missed' }) : t('fb.wrong')) + ' · ' + answer + ' = ' + UI.meaningShort(answer) + extra);
    }
    updateHUD(); Store.touchActivity(); S.lockInWave++;
    later(afterBeat, outcome === 'hit' ? 650 : 1050);
  }
  function afterBeat() { if (S.dead) return; hideAllBlips(); if (S.lives <= 0) return gameOver(); if (S.lockInWave >= LOCKS_PER_WAVE) return waveBreak(); startLock(); }

  function waveBreak() {
    var perfect = S.waveMisses === 0;
    if (perfect) { S.score += 250; if (window.FX) FX.celebrate(); }
    S.wave++; S.lockInWave = 0; S.waveMisses = 0;
    var travel = Math.max(2.4, 5.0 / Math.pow(1.12, S.wave - 1)); S.approach = 1 / travel;
    updateHUD();
    var banner = UI.el('div', { class: 'arcade-banner' }, [UI.el('div', { class: 'arcade-banner__big', text: 'QSY ↑' }), UI.el('div', { text: (perfect ? tt({ pl: 'Czysta fala! +250 · ', en: 'Clean wave! +250 · ' }) : '') + tt({ pl: 'Fala ', en: 'Wave ' }) + S.wave })]);
    S.els.field.appendChild(banner);
    UI.announce(tt({ pl: 'Fala ', en: 'Wave ' }) + S.wave);
    later(function () { if (banner.parentNode) banner.parentNode.removeChild(banner); startLock(); }, perfect ? 1500 : 1200);
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

  // ---------- game over / recap (mirrors arcade) ----------
  function gameOver() {
    S.state = 'over'; if (S.rafId) { caf(S.rafId); S.rafId = 0; }
    hideAllBlips();
    Store.state.stats.sessionsCompleted++; Store.save(); UI.refreshChrome();
    var lang = Store.settings().lang;
    var acc = S.totalLocks ? Math.round(S.correctLocks / S.totalLocks * 100) : 0;
    var root = UI.el('div', { class: 'mode' }, [UI.modeHeader({ title: tt({ pl: 'Koniec gry', en: 'Game over' }) })]);
    var card = UI.el('div', { class: 'card recap center' });
    card.appendChild(UI.el('div', { class: 'recap__big', text: tt({ pl: 'Wynik ', en: 'Score ' }) + S.score }));
    card.appendChild(UI.el('div', { class: 'arcade-stats' }, [statPill(tt({ pl: 'Maks. seria', en: 'Max combo' }), '×' + S.maxCombo), statPill(tt({ pl: 'Celność', en: 'Accuracy' }), acc + '%'), statPill(tt({ pl: 'Fale', en: 'Waves' }), S.wave)]));
    if (qualifies(lang, S.score)) card.appendChild(highScoreEntry(lang)); else card.appendChild(scoreTable(lang));
    if (S.fumbled.length) { var chips = UI.el('div', { class: 'recap__chips' }); uniq(S.fumbled).forEach(function (c) { chips.appendChild(UI.el('span', { class: 'code code--bad', text: c })); }); card.appendChild(UI.el('div', { class: 'recap__row' }, [UI.el('h3', { text: tt({ pl: 'Zaszumione', en: 'Noisy ones' }) }), chips])); }
    var actions = UI.el('div', { class: 'recap__actions' });
    if (S.fumbled.length) actions.appendChild(UI.btn(tt({ pl: 'Powtórz słabe w Flow', en: 'Review weak in Flow' }), { variant: 'primary', onClick: function () { App.go('flow', { inject: uniq(S.fumbled) }); } }));
    actions.appendChild(UI.btn(t('recap.again'), { variant: S.fumbled.length ? 'ghost' : 'primary', onClick: function () { App.go('sweep'); } }));
    actions.appendChild(UI.btn(t('nav.home'), { variant: 'ghost', onClick: function () { App.go('home'); } }));
    card.appendChild(actions); root.appendChild(card); UI.setScreen(root);
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

  // ---------- pointer / keyboard ----------
  function bindPointer() { if (S.ptrBound) return; S.ptrBound = true; }
  function unbindPointer() {}
  function onKey(e) {
    if (!S || S.dead) return;
    if (S.state === 'ready') { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); beginPlay(); } return; }
    if (S.state !== 'playing') return;
    var k = e.key;
    if (k >= '1' && k <= '9') { e.preventDefault(); directFireIndex(parseInt(k, 10) - 1); return; }
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'd' || k === 'D') { e.preventDefault(); moveFocus(1); }
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'a' || k === 'A') { e.preventDefault(); moveFocus(-1); }
    else if (k === ' ' || k === 'Enter') {
      for (var i = 0; i < S.blips.length; i++) if (S.blips[i].el === document.activeElement) { e.preventDefault(); tryFire(S.blips[i]); return; }
      if (k === ' ') { // Space with no focus: fire nearest-to-centre live blip (assist)
        e.preventDefault(); var best = null; S.blips.forEach(function (b) { if (b.active && !b.resolved && b.t >= 0) { if (!best || b.t > best.t) best = b; } }); if (best) tryFire(best);
      }
    }
  }
  function moveFocus(dir) {
    var live = S.blips.filter(function (b) { return b.active && !b.resolved && b.t >= 0; });
    if (!live.length) return;
    var idx = -1; for (var i = 0; i < live.length; i++) if (live[i].el === document.activeElement) idx = i;
    if (idx < 0) idx = dir > 0 ? -1 : 0;
    UI.focus(live[(idx + dir + live.length) % live.length].el);
  }

  return { id: 'sweep', start: start, stop: stop, onKey: onKey };
})();
