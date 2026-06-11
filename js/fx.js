// ============================================================
// FX — raw WebGL effects layer (no libraries; runs from file://).
//   • animated "radio shack at night" background shader
//   • GPU particle bursts on correct answers / combos
//   • screen pulses on big events
// Graceful: if WebGL is unavailable, every method is a safe no-op and the
// CSS body background shows instead. Fully gated by reduced-motion / the
// motion toggle, paused when the tab is hidden, and theme-aware.
// ============================================================
window.FX = (function () {
  'use strict';
  var canvas = null, gl = null, ok = false, running = false, rafId = 0;
  var bgProg = null, partProg = null, flatProg = null;
  var quadBuf = null, partBuf = null;
  var W = 0, H = 0, dpr = 1;
  var t0 = 0;

  // particle ring buffer
  var CAP = 1400, STRIDE = 10; // p0.xy vel.xy birth life col.rgb size
  var pdata = new Float32Array(CAP * STRIDE);
  var head = 0;
  var dirty = false;

  // screen pulse (single decaying flash)
  var pulse = { t: -1, life: 0.5, col: [1, 1, 1], power: 0 };

  var theme = { bg: [0.043, 0.059, 0.055], a1: [1, 0.7, 0.24], a2: [0.24, 0.86, 0.52], a3: [0.31, 0.82, 0.88], dark: 1 };
  var ACCENTS = { ok: 'a2', amber: 'a1', cyan: 'a3', combo: 'a1' };

  function now() { try { return performance.now() / 1000; } catch (e) { return 0; } }

  // ---- GL helpers ----
  function sh(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function prog(vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    p.u = function (n) { return gl.getUniformLocation(p, n); };
    p.a = function (n) { return gl.getAttribLocation(p, n); };
    return p;
  }

  var VS_QUAD = 'attribute vec2 a_pos; void main(){ gl_Position = vec4(a_pos,0.,1.); }';

  var FS_BG = [
    'precision highp float;',
    'uniform vec2 u_res; uniform float u_time; uniform float u_dark;',
    'uniform vec3 u_bg,u_a1,u_a2,u_a3;',
    'float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }',
    'void main(){',
    '  vec2 p = (gl_FragCoord.xy - 0.5*u_res)/u_res.y;',
    '  float t = u_time;',
    '  float amp = mix(0.45, 1.0, u_dark);',     // calmer in light theme
    '  vec3 col = u_bg;',
    '  vec2 g1 = vec2(sin(t*0.13)*0.55, cos(t*0.11)*0.32);',
    '  vec2 g2 = vec2(cos(t*0.09)*0.62, sin(t*0.07)*0.42 - 0.2);',
    '  col += u_a3 * exp(-3.0*length(p-g1)) * 0.13 * amp;',
    '  col += u_a1 * exp(-3.5*length(p-g2)) * 0.11 * amp;',
    '  float wave = 0.18*sin(p.x*6.0 + t*1.3) + 0.06*sin(p.x*17.0 - t*2.1);',
    '  col += u_a2 * smoothstep(0.035,0.0,abs(p.y-wave)) * 0.45 * amp;',
    '  float wave2 = 0.12*sin(p.x*4.0 - t*0.9 + 1.5);',
    '  col += u_a3 * smoothstep(0.02,0.0,abs(p.y-wave2)) * 0.18 * amp;',
    '  vec2 grid = abs(fract(p*8.0 + vec2(0.0,t*0.05))-0.5);',
    '  col += (u_a2*0.5+u_a3*0.5) * smoothstep(0.47,0.5,max(grid.x,grid.y)) * 0.022 * amp;',
    '  float scan = 0.5+0.5*sin(gl_FragCoord.y*1.5 + t*2.0);',
    '  col *= 1.0 - 0.035*scan*u_dark;',
    '  col += (hash(gl_FragCoord.xy + t)-0.5)*0.014;',
    '  float vig = smoothstep(1.25,0.2,length(p));',
    '  col *= mix(0.72, 1.06, vig);',
    '  gl_FragColor = vec4(col,1.0);',
    '}'
  ].join('\n');

  var VS_PART = [
    'attribute vec2 a_p0; attribute vec2 a_vel; attribute float a_birth;',
    'attribute float a_life; attribute vec3 a_col; attribute float a_size;',
    'uniform float u_time; uniform float u_dpr;',
    'varying vec3 v_col; varying float v_a;',
    'void main(){',
    '  float t = u_time - a_birth;',
    '  if(t<0.0 || t>a_life){ gl_Position=vec4(2.,2.,2.,1.); gl_PointSize=0.0; v_a=0.0; return; }',
    '  float k = t/a_life;',
    '  vec2 pos = a_p0 + a_vel*t + vec2(0.0,-0.5)*t*t;',
    '  gl_Position = vec4(pos,0.,1.);',
    '  gl_PointSize = max(1.0, a_size*(1.0-k)*u_dpr);',
    '  v_col = a_col; v_a = (1.0-k);',
    '}'
  ].join('\n');

  var FS_PART = [
    'precision mediump float; varying vec3 v_col; varying float v_a;',
    'void main(){',
    '  float r = length(gl_PointCoord-0.5);',
    '  float a = smoothstep(0.5,0.0,r) * v_a;',
    '  gl_FragColor = vec4(v_col, a);',
    '}'
  ].join('\n');

  var FS_FLAT = 'precision mediump float; uniform vec3 u_color; uniform float u_alpha; void main(){ gl_FragColor=vec4(u_color,u_alpha); }';

  function build() {
    bgProg = prog(VS_QUAD, FS_BG);
    partProg = prog(VS_PART, FS_PART);
    flatProg = prog(VS_QUAD, FS_FLAT);
    quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // big triangle
    partBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pdata, gl.DYNAMIC_DRAW);
  }

  // ---- theme ----
  function cssRGB(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      if (v[0] === '#') {
        var h = v.slice(1);
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
      }
    } catch (e) {}
    return fallback;
  }
  function refresh() {
    if (!ok) return;
    theme.bg = cssRGB('--bg', theme.bg);
    theme.a1 = cssRGB('--amber', theme.a1);
    theme.a2 = cssRGB('--green', theme.a2);
    theme.a3 = cssRGB('--cyan', theme.a3);
    theme.dark = (window.UI && UI.effectiveTheme && UI.effectiveTheme() === 'light') ? 0 : 1;
    maybeStart();
  }

  function reduced() { return window.UI && UI.reducedMotion ? UI.reducedMotion() : false; }

  function resize() {
    if (!ok) return;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = Math.floor(window.innerWidth * dpr);
    H = Math.floor(window.innerHeight * dpr);
    canvas.width = W; canvas.height = H;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    gl.viewport(0, 0, W, H);
  }

  // ---- particle emission ----
  function accent(c) {
    if (Array.isArray(c)) return c;
    return theme[ACCENTS[c] || 'a2'] || theme.a2;
  }
  function rand(a, b) { return a + Math.random() * (b - a); }

  // burst at NDC (x,y in [-1,1]); opts: {count,color,power,size,spread,gravity}
  function burst(x, y, opts) {
    if (!ok || reduced()) return;
    opts = opts || {};
    var n = Math.min(opts.count || 26, 120);
    var col = accent(opts.color);
    var power = opts.power || 0.9;
    var baseSize = opts.size || 9;
    var b = now() - t0;
    for (var i = 0; i < n; i++) {
      var ang = rand(0, Math.PI * 2);
      var spd = power * rand(0.25, 1.0);
      var o = (head % CAP) * STRIDE; head++;
      pdata[o] = x; pdata[o + 1] = y;
      pdata[o + 2] = Math.cos(ang) * spd; pdata[o + 3] = Math.sin(ang) * spd + rand(0.1, 0.5);
      pdata[o + 4] = b; pdata[o + 5] = rand(0.5, 1.1);
      // slight color jitter toward white core
      var w = rand(0, 0.5);
      pdata[o + 6] = Math.min(1, col[0] + w); pdata[o + 7] = Math.min(1, col[1] + w); pdata[o + 8] = Math.min(1, col[2] + w);
      pdata[o + 9] = baseSize * rand(0.6, 1.4);
    }
    dirty = true;
    maybeStart();
  }

  function elNDC(el) {
    if (!el || !el.getBoundingClientRect) return [0, 0];
    var r = el.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return [cx / window.innerWidth * 2 - 1, 1 - cy / window.innerHeight * 2];
  }
  function burstAt(el, opts) { var p = elNDC(el); burst(p[0], p[1], opts); }

  function flash(color, power) {
    if (!ok || reduced()) return;
    pulse.t = now() - t0; pulse.col = accent(color); pulse.power = power || 0.35; pulse.life = 0.45;
    maybeStart();
  }

  function celebrate() {
    if (!ok || reduced()) return;
    flash('a2', 0.4);
    for (var i = 0; i < 5; i++) burst(rand(-0.6, 0.6), rand(-0.2, 0.5), { count: 36, color: i % 2 ? 'a1' : 'a2', power: 1.3, size: 11 });
  }

  // ---- render ----
  function bindAttrib(p, name, size, off) {
    var loc = p.a(name);
    if (loc < 0) return;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, off * 4);
  }

  function frame() {
    rafId = 0;
    if (!ok || !running) return;
    var time = now() - t0;

    // background (opaque)
    gl.disable(gl.BLEND);
    gl.useProgram(bgProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    var ap = bgProg.a('a_pos');
    gl.enableVertexAttribArray(ap);
    gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(bgProg.u('u_res'), W, H);
    gl.uniform1f(bgProg.u('u_time'), time);
    gl.uniform1f(bgProg.u('u_dark'), theme.dark);
    gl.uniform3fv(bgProg.u('u_bg'), theme.bg);
    gl.uniform3fv(bgProg.u('u_a1'), theme.a1);
    gl.uniform3fv(bgProg.u('u_a2'), theme.a2);
    gl.uniform3fv(bgProg.u('u_a3'), theme.a3);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // additive layers
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    // screen pulse
    if (pulse.t >= 0) {
      var pk = (time - pulse.t) / pulse.life;
      if (pk >= 1) { pulse.t = -1; }
      else {
        gl.useProgram(flatProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        var fp = flatProg.a('a_pos'); gl.enableVertexAttribArray(fp);
        gl.vertexAttribPointer(fp, 2, gl.FLOAT, false, 0, 0);
        gl.uniform3fv(flatProg.u('u_color'), pulse.col);
        gl.uniform1f(flatProg.u('u_alpha'), pulse.power * (1 - pk));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }

    // particles
    gl.useProgram(partProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
    if (dirty) { gl.bufferData(gl.ARRAY_BUFFER, pdata, gl.DYNAMIC_DRAW); dirty = false; }
    bindAttrib(partProg, 'a_p0', 2, 0);
    bindAttrib(partProg, 'a_vel', 2, 2);
    bindAttrib(partProg, 'a_birth', 1, 4);
    bindAttrib(partProg, 'a_life', 1, 5);
    bindAttrib(partProg, 'a_col', 3, 6);
    bindAttrib(partProg, 'a_size', 1, 9);
    gl.uniform1f(partProg.u('u_time'), time);
    gl.uniform1f(partProg.u('u_dpr'), dpr);
    gl.drawArrays(gl.POINTS, 0, CAP);

    rafId = requestAnimationFrame(frame);
  }

  function start() { if (ok && !running) { running = true; if (!rafId) rafId = requestAnimationFrame(frame); } }
  function stop() { running = false; if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }
  function maybeStart() {
    if (!ok) return;
    if (reduced() || document.hidden) { stop(); if (canvas) canvas.style.display = 'none'; return; }
    if (canvas) canvas.style.display = '';
    start();
  }

  function init() {
    canvas = document.getElementById('fxbg');
    if (!canvas) return;
    var attrs = { alpha: true, antialias: true, depth: false, premultipliedAlpha: false, powerPreference: 'low-power' };
    try { gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs); } catch (e) { gl = null; }
    if (!gl) { ok = false; return; } // graceful fallback: body bg shows, all FX no-op
    try { build(); } catch (e) { ok = false; gl = null; return; }
    ok = true;
    t0 = now();
    refresh();
    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', maybeStart);
    maybeStart();
  }

  return {
    init: init, refresh: refresh, resize: resize,
    burst: burst, burstAt: burstAt, flash: flash, celebrate: celebrate,
    available: function () { return ok; }
  };
})();
