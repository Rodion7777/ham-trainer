// ============================================================
// Lab3D — "The Night Bench, in Perspective": a real 3D radio-amateur lab
// rendered in raw WebGL behind the LOBBY. Shaded instrument boxes sit on a
// foreshortened wood bench against a parts-drawer wall under a warm lamp; each
// instrument's recessed SCREEN is a live texture (oscilloscope traces, SDR
// spectrum+waterfall, ticking 7-seg counters, twitching needle meters, blinking
// LEDs) repainted on a small 2D canvas each frame. A gentle eye-sway gives real
// parallax (no spin/dolly). Decorative (aria-hidden, behind content); the
// faceplate stays readable via a baked lamp falloff + screen-space dim-well +
// vignette. Lobby-only; reduced-motion -> one parked static frame; paused when
// hidden; strict teardown (loseContext). Falls back to the 2D Lab / plain bg.
// ============================================================
window.Lab3D = (function () {
  'use strict';
  var raf = window.requestAnimationFrame, caf = window.cancelAnimationFrame;
  var canvas = null, gl = null, ok = false, running = false, rafId = 0, onHome = false;
  var W = 0, H = 0, P = 1, t0 = 0, last = 0, resizeTimer = 0;
  var litProg = null, texProg = null, litBuf = null, screenBuf = null, glowBuf = null, whiteTex = null;
  var litObjs = [], screens = [], glows = [], TH = null, NB = 96, bins = null, wf = null, S = null;
  var proj = null;
  // photoreal post pipeline
  var brightProg = null, blurProg = null, compProg = null, postOK = false;
  var sceneRT = null, brightRT = null, blurA = null, blurB = null, rtList = [];
  var sPos = null, sCol = null, sN = 0; // screen point-light uniforms (built once per build)
  var faceC = [0.5, 0.5], faceH = [0.4, 0.4]; // faceplate guard rect in uv
  var FOV = 42 * Math.PI / 180, EYE = [0, 1.15, 4.6], CTR = [0, 0.55, 0];

  function now() { try { return performance.now(); } catch (e) { return Date.now(); } }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function reduced() { return window.UI && UI.reducedMotion ? UI.reducedMotion() : false; }
  function dark() { return !(window.UI && UI.effectiveTheme && UI.effectiveTheme() === 'light'); }
  function cssRGB(name, fb) { try { var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); if (v[0] === '#') { var h = v.slice(1); if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; } } catch (e) {} return fb; }
  function rgb(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a == null ? 1 : a) + ')'; }
  function mix(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
  function nrm(c) { return [c[0] / 255, c[1] / 255, c[2] / 255]; }
  function hash(n) { var s = Math.sin(n) * 43758.5453; return s - Math.floor(s); }
  function vnoise(x) { var i = Math.floor(x), f = x - i, a = hash(i), b = hash(i + 1), u = f * f * (3 - 2 * f); return a + (b - a) * u; }

  // ---------- mat4 (column-major) ----------
  function m4mul(a, b) { var o = new Float32Array(16); for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) { var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
  function m4persp(fy, asp, n, f) { var t = 1 / Math.tan(fy / 2), nf = 1 / (n - f), o = new Float32Array(16); o[0] = t / asp; o[5] = t; o[10] = (f + n) * nf; o[11] = -1; o[14] = 2 * f * n * nf; return o; }
  function v3n(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function v3s(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function v3c(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function v3d(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function m4look(e, c, u) { var z = v3n(v3s(e, c)), x = v3n(v3c(u, z)), y = v3c(z, x); return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -v3d(x, e), -v3d(y, e), -v3d(z, e), 1]); }

  // ---------- GL helpers ----------
  function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function prog(vs, fs) { var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); p.u = function (n) { return gl.getUniformLocation(p, n); }; p.a = function (n) { return gl.getAttribLocation(p, n); }; return p; }

  var VS_LIT = 'attribute vec3 a_pos;attribute vec3 a_nrm;attribute vec2 a_uv;uniform mat4 u_mvp;varying vec2 v_uv;varying vec3 v_w;varying vec3 v_n;void main(){gl_Position=u_mvp*vec4(a_pos,1.);v_uv=a_uv;v_w=a_pos;v_n=a_nrm;}';
  // relit: hemisphere ambient + warm point lamp (wrap diffuse + Blinn-Phong spec) + Schlick Fresnel rim + colored screen point-lights
  var FS_LIT = [
    'precision mediump float;',
    'uniform sampler2D u_tex;uniform vec3 u_color;uniform vec3 u_warm;uniform vec3 u_sky;uniform vec3 u_grd;',
    'uniform vec3 u_lamp;uniform float u_fall;uniform vec3 u_eye;uniform float u_spec;uniform float u_shin;uniform float u_rim;',
    'uniform int u_sN;uniform vec3 u_sPos[4];uniform vec3 u_sCol[4];',
    'varying vec2 v_uv;varying vec3 v_w;varying vec3 v_n;',
    'void main(){',
    '  vec3 base=u_color*texture2D(u_tex,v_uv).rgb;',
    '  vec3 N=normalize(v_n);vec3 V=normalize(u_eye-v_w);',
    '  vec3 Ld=u_lamp-v_w;float d=length(Ld);vec3 L=Ld/d;float fall=1.0/(1.0+u_fall*d*d);',
    '  float wrap=pow(max(dot(N,L),0.0)*0.5+0.5,1.5);',
    '  vec3 Hh=normalize(L+V);float spec=u_spec*pow(max(dot(N,Hh),0.0),u_shin)*fall;',
    '  float fres=u_rim*pow(1.0-max(dot(N,V),0.0),4.0);',
    '  vec3 hemi=mix(u_grd,u_sky,N.y*0.5+0.5);',
    '  vec3 col=base*(hemi+u_warm*wrap*fall)+u_warm*spec+u_warm*fres;',
    '  for(int i=0;i<4;i++){if(i>=u_sN)break;vec3 sd=u_sPos[i]-v_w;float sl=length(sd);vec3 sL=sd/sl;float sf=1.0/(1.0+8.0*sl*sl);col+=base*u_sCol[i]*max(dot(N,sL),0.0)*sf;}',
    '  gl_FragColor=vec4(col,1.0);',
    '}'
  ].join('');
  var VS_TEX = 'attribute vec3 a_pos;attribute vec2 a_uv;uniform mat4 u_mvp;varying vec2 v_uv;void main(){gl_Position=u_mvp*vec4(a_pos,1.);v_uv=a_uv;}';
  var FS_TEX = 'precision mediump float;uniform sampler2D u_tex;uniform vec3 u_tint;uniform float u_emis;uniform float u_alpha;uniform int u_mode;varying vec2 v_uv;void main(){if(u_mode==0){gl_FragColor=vec4(texture2D(u_tex,v_uv).rgb*u_emis,1.);}else{float r=length(v_uv-0.5);float a=smoothstep(0.5,0.0,r)*u_alpha;gl_FragColor=vec4(u_tint,a);}}';
  // ---- post-processing (fullscreen-tri) ----
  var VS_POST = 'attribute vec3 a_pos;attribute vec2 a_uv;varying vec2 v_uv;void main(){gl_Position=vec4(a_pos.xy,0.,1.);v_uv=a_uv;}';
  var FS_BRIGHT = 'precision mediump float;uniform sampler2D u_scene;uniform vec2 u_fc;uniform vec2 u_fh;varying vec2 v_uv;void main(){vec3 c=texture2D(u_scene,v_uv).rgb;vec3 b=max(c-vec3(0.62),0.0);b=b*b/(b+vec3(0.5));vec2 q=abs(v_uv-u_fc)/u_fh;float guard=smoothstep(1.0,1.4,max(q.x,q.y));gl_FragColor=vec4(b*guard,1.0);}';
  var FS_BLUR = 'precision mediump float;uniform sampler2D u_tex;uniform vec2 u_dir;varying vec2 v_uv;void main(){vec3 s=texture2D(u_tex,v_uv).rgb*0.227;s+=texture2D(u_tex,v_uv+u_dir).rgb*0.194;s+=texture2D(u_tex,v_uv-u_dir).rgb*0.194;s+=texture2D(u_tex,v_uv+u_dir*2.0).rgb*0.121;s+=texture2D(u_tex,v_uv-u_dir*2.0).rgb*0.121;s+=texture2D(u_tex,v_uv+u_dir*3.0).rgb*0.054;s+=texture2D(u_tex,v_uv-u_dir*3.0).rgb*0.054;s+=texture2D(u_tex,v_uv+u_dir*4.0).rgb*0.016;s+=texture2D(u_tex,v_uv-u_dir*4.0).rgb*0.016;gl_FragColor=vec4(s,1.0);}';
  var FS_COMP = [
    'precision mediump float;',
    'uniform sampler2D u_scene;uniform sampler2D u_bloom;uniform vec2 u_res;uniform float u_time;',
    'uniform vec2 u_fc;uniform vec2 u_fh;uniform float u_exposure;uniform float u_bloomGain;uniform float u_vig;uniform float u_dim;uniform float u_grain;uniform float u_ca;uniform float u_fog;uniform vec3 u_fogCol;uniform vec3 u_grade;uniform float u_aces;',
    'varying vec2 v_uv;',
    'vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}',
    'void main(){',
    '  float aspect=u_res.x/u_res.y;',
    '  vec2 qf=abs(v_uv-u_fc)/u_fh;float mq=max(qf.x,qf.y);float inFace=1.0-smoothstep(1.0,1.4,mq);',
    '  vec2 off=(v_uv-0.5)*u_ca*length(v_uv-0.5)*(1.0-inFace);',
    '  vec3 col;col.r=texture2D(u_scene,v_uv+off).r;col.g=texture2D(u_scene,v_uv).g;col.b=texture2D(u_scene,v_uv-off).b;',
    '  float guard=smoothstep(1.0,1.4,mq);',
    '  col+=texture2D(u_bloom,v_uv).rgb*u_bloomGain*guard;',
    '  float fband=smoothstep(0.5,0.0,v_uv.y)*(1.0-inFace);col=mix(col,u_fogCol,clamp(fband*u_fog,0.0,0.7));',
    '  col*=u_exposure;col=mix(col/(1.0+col),aces(col),u_aces);',
    '  col=pow(clamp(col,0.0,1.0),vec3(1.0/2.2));col*=u_grade;',
    '  float v=smoothstep(0.95,0.35,length((v_uv-0.5)*vec2(aspect,1.0))*1.25);col*=mix(u_vig,1.0,v);',
    '  col*=mix(u_dim,1.0,smoothstep(1.0,1.28,mq));',
    '  float g=(fract(sin(dot(v_uv*u_res+vec2(u_time),vec2(12.99,78.23)))*43758.5)-0.5)*u_grain*(1.0-0.6*inFace);col+=g;',
    '  gl_FragColor=vec4(clamp(col,0.0,1.0),1.0);',
    '}'
  ].join('');

  // ============== theme ==============
  function theme() {
    var d = dark();
    TH = { dark: d,
      bg: cssRGB('--bg', d ? [11, 15, 14] : [246, 248, 246]), deep: d ? [4, 7, 6] : [205, 214, 208],
      panel: cssRGB('--panel', d ? [18, 26, 23] : [255, 255, 255]), border: cssRGB('--border', d ? [37, 51, 44] : [216, 224, 218]),
      green: cssRGB('--green', d ? [61, 220, 132] : [23, 138, 76]), cyan: cssRGB('--cyan', d ? [79, 210, 224] : [21, 151, 166]),
      amber: cssRGB('--amber', d ? [255, 178, 62] : [181, 101, 29]), red: cssRGB('--red', d ? [255, 92, 92] : [192, 57, 43]),
      wood: d ? [44, 31, 18] : [205, 180, 138], woodHi: d ? [86, 60, 33] : [225, 205, 168],
      metal: d ? [26, 34, 30] : [205, 212, 206], glass: d ? [7, 20, 13] : [12, 26, 16],
      warm: d ? [255, 178, 62] : [255, 247, 235],
      skyAmb: d ? [30, 38, 33] : [168, 175, 168], grdAmb: d ? [9, 12, 10] : [120, 128, 120] };
  }

  // ============== geometry ==============
  function pushQuad(arr, p0, p1, p2, p3, n, fmt) {
    // two CCW tris p0,p1,p2 / p0,p2,p3 ; uv: p0=(0,0) p1=(1,0) p2=(1,1) p3=(0,1)
    var uv = [[0, 0], [1, 0], [1, 1], [0, 1]], pts = [p0, p1, p2, p0, p2, p3], ui = [0, 1, 2, 0, 2, 3];
    for (var i = 0; i < 6; i++) {
      arr.push(pts[i][0], pts[i][1], pts[i][2]);
      if (fmt === 'lit') arr.push(n[0], n[1], n[2]);
      arr.push(uv[ui[i]][0], uv[ui[i]][1]);
    }
  }
  function rotY(v, th) { var c = Math.cos(th), s = Math.sin(th); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; }
  function add(a, b, k) { return [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]; }

  function buildBox(litArr, inst) {
    var th = inst.yaw, w = inst.w, h = inst.h, d = inst.d, ctr = [inst.cx, inst.cy, inst.cz];
    var nrmF = rotY([0, 0, 1], th), right = rotY([1, 0, 0], th), up = [0, 1, 0];
    function corner(rx, uy) { return add(add(ctr, right, rx * w / 2), up, uy * h / 2); }
    var fTL = corner(-1, 1), fTR = corner(1, 1), fBR = corner(1, -1), fBL = corner(-1, -1);
    var start = litArr.length / 8;
    pushQuad(litArr, fTL, fTR, fBR, fBL, nrmF, 'lit'); // front
    // top: front-top edge back by depth
    var bTL = add(fTL, nrmF, -d), bTR = add(fTR, nrmF, -d);
    pushQuad(litArr, bTL, bTR, fTR, fTL, up, 'lit'); // top (normal up)
    // visible side (the +right side)
    var fSb = add(fBR, nrmF, -d), fTb = add(fTR, nrmF, -d);
    pushQuad(litArr, fTR, fTb, fSb, fBR, right, 'lit'); // side
    litObjs.push({ off: start, count: 18, tex: whiteTex, color: nrm(inst.bodyCol || TH.metal), spec: 0.6, shin: 48, rim: 0.22 });
    // screen quad (inset, proud)
    var ins = 0.12;
    var sTL = add(add(fTL, right, w * ins / 2), up, -h * ins / 2);
    var sTR = add(add(fTR, right, -w * ins / 2), up, -h * ins / 2);
    var sBR = add(add(fBR, right, -w * ins / 2), up, h * ins / 2);
    var sBL = add(add(fBL, right, w * ins / 2), up, h * ins / 2);
    sTL = add(sTL, nrmF, 0.012); sTR = add(sTR, nrmF, 0.012); sBR = add(sBR, nrmF, 0.012); sBL = add(sBL, nrmF, 0.012);
    return { TL: sTL, TR: sTR, BR: sBR, BL: sBL, n: nrmF, right: right, up: up, w: w * (1 - ins), h: h * (1 - ins) };
  }

  function instruments() {
    // world layout: LEFT stack (x<0), RIGHT stack (x>0), BACK shelf (high, far). Center kept clear.
    var ph = L.phone;
    var lx = ph ? -1.5 : -2.55, rx = ph ? 1.5 : 2.5;
    return [
      { key: 'scopeA', paint: 'scopeSine', accent: TH.green, sw: 132, sh: 104, cx: lx, cy: 0.55, cz: -1.0, w: 1.05, h: 0.82, d: 0.5, yaw: 0.34 },
      { key: 'scopeB', paint: 'scopeLiss', accent: TH.green, sw: 132, sh: 104, cx: lx - 0.25, cy: 1.5, cz: -1.85, w: 1.0, h: 0.78, d: 0.5, yaw: 0.34 },
      { key: 'trx', paint: 'trx', accent: TH.amber, sw: 200, sh: 96, cx: rx, cy: 0.5, cz: -0.95, w: 1.25, h: 0.62, d: 0.55, yaw: -0.34, bodyCol: dark() ? [30, 30, 28] : [210, 210, 205] },
      { key: 'sdr', paint: 'sdr', accent: TH.cyan, sw: 240, sh: 132, cx: rx + 0.2, cy: 1.45, cz: -1.8, w: 1.3, h: 0.82, d: 0.4, yaw: -0.34 },
      { key: 'meters', paint: 'meters', accent: TH.red, sw: 168, sh: 116, cx: rx - 0.3, cy: -0.15, cz: -0.35, w: 0.95, h: 0.55, d: 0.5, yaw: -0.4 },
      { key: 'counters', paint: 'counters', accent: TH.red, sw: 200, sh: 88, cx: 0.0, cy: 1.95, cz: -2.7, w: 1.5, h: 0.6, d: 0.35, yaw: 0 }
    ].filter(function (i) { return !(ph && (i.key === 'scopeB' || i.key === 'meters')); });
  }

  var L = null;
  function layout() {
    var Wc = W / P, Hc = H / P;
    L = { Wc: Wc, Hc: Hc, phone: Wc < 560, faceW: Math.min(608, Wc - 32), faceY: 0.32 * Hc };
    // faceplate guard rect in uv (oversized so bloom/CA/DoF never reach the panel text)
    var fwUV = (L.faceW / Wc) * 0.62, fhUV = Math.min(0.62 * Hc, 560) / Hc * 0.55;
    faceC = [0.5, L.faceY / Hc + fhUV * 0.7]; faceH = [Math.max(0.16, fwUV), Math.max(0.16, fhUV)];
  }

  var bakedTexList = [];
  function makeRT(w, h, depth) {
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    var tex = newTex(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    var fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    var rb = null;
    if (depth) { rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb); }
    var okfb = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!okfb) { gl.deleteTexture(tex); gl.deleteFramebuffer(fb); if (rb) gl.deleteRenderbuffer(rb); return null; }
    var rt = { fb: fb, tex: tex, rb: rb, w: w, h: h }; rtList.push(rt); return rt;
  }
  function disposeRTs() { rtList.forEach(function (r) { if (r.tex) gl.deleteTexture(r.tex); if (r.fb) gl.deleteFramebuffer(r.fb); if (r.rb) gl.deleteRenderbuffer(r.rb); }); rtList = []; sceneRT = brightRT = blurA = blurB = null; }
  function buildRTs() {
    disposeRTs();
    sceneRT = makeRT(W, H, true);
    brightRT = makeRT(Math.ceil(W / 2), Math.ceil(H / 2), false);
    blurA = makeRT(Math.ceil(W / 2), Math.ceil(H / 2), false);
    blurB = makeRT(Math.ceil(W / 2), Math.ceil(H / 2), false);
    postOK = !!(brightProg && blurProg && compProg && sceneRT && brightRT && blurA && blurB);
  }
  function buildScreenLights() {
    var pos = [], col = []; sN = Math.min(4, screens.length);
    for (var i = 0; i < sN; i++) { var c = screens[i].center, a = screens[i].accent; pos.push(c[0], c[1], c[2] + 0.15); col.push(a[0] * 0.6, a[1] * 0.6, a[2] * 0.6); }
    while (pos.length < 12) { pos.push(0, 0, 0); col.push(0, 0, 0); }
    sPos = new Float32Array(pos); sCol = new Float32Array(col);
  }
  function disposeBuffers() {
    [litBuf, screenBuf, glowBuf].forEach(function (b) { if (b) gl.deleteBuffer(b); });
    litBuf = screenBuf = glowBuf = null;
    screens.forEach(function (s) { if (s.tex && s.tex.tex) gl.deleteTexture(s.tex.tex); });
    bakedTexList.forEach(function (t) { gl.deleteTexture(t); }); bakedTexList = [];
    disposeRTs();
  }
  function build() {
    if (!litProg) { // programs + the shared 1x1 white texture are created ONCE
      litProg = prog(VS_LIT, FS_LIT); texProg = prog(VS_TEX, FS_TEX);
      try { brightProg = prog(VS_POST, FS_BRIGHT); blurProg = prog(VS_POST, FS_BLUR); compProg = prog(VS_POST, FS_COMP); } catch (e) { brightProg = blurProg = compProg = null; }
      whiteTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, whiteTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255])); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    disposeBuffers(); // free the previous build's buffers + textures (rebuilds on resize/theme)

    var lit = [], scr = [], glw = []; litObjs = []; screens = []; glows = [];
    // BACK WALL (drawer cabinet baked texture)
    var wallTex = bakedTex(512, 256, paintWall);
    var ws = lit.length / 8; pushQuad(lit, [-7, -0.2, -3.2], [7, -0.2, -3.2], [7, 4.6, -3.2], [-7, 4.6, -3.2], [0, 0, 1], 'lit'); litObjs.unshift({ off: ws, count: 6, tex: wallTex, color: [1, 1, 1], spec: 0.05, shin: 8, rim: 0.05 });
    // BENCH (wood baked texture), tilted
    var benchTex = bakedTex(256, 128, paintWood);
    var bs = lit.length / 8; pushQuad(lit, [-7, -0.30, -2.6], [7, -0.30, -2.6], [7, 0.05, 1.2], [-7, 0.05, 1.2], [0, 0.97, 0.24], 'lit'); litObjs.push({ off: bs, count: 6, tex: benchTex, color: [1, 1, 1], spec: 0.45, shin: 18, rim: 0.14 });
    // wall/bench objs were pushed before/after the boxes loop; reorder: ensure wall first. (unshift handled wall.)

    // INSTRUMENTS
    var insts = instruments();
    insts.forEach(function (inst) {
      var sq = buildBox(lit, inst); // pushes 3 lit quads + a litObjs entry
      // screen quad (TEX)
      var so = scr.length / 5; pushQuadTex(scr, sq.TL, sq.TR, sq.BR, sq.BL);
      var tex = makeScreenTex(inst);
      var ctr = [(sq.TL[0] + sq.BR[0]) / 2, (sq.TL[1] + sq.BR[1]) / 2, (sq.TL[2] + sq.BR[2]) / 2];
      screens.push({ inst: inst, off: so, tex: tex, paint: inst.paint, center: ctr, accent: nrm(inst.accent) });
      // bloom billboard (slightly bigger, in front) — only used in the no-post fallback path
      var bl = 1.18, eC = ctr;
      function bcorn(a) { return add(eC, v3s(a, eC), bl); }
      var go = glw.length / 5; pushQuadTex(glw, add(bcorn(sq.TL), sq.n, 0.02), add(bcorn(sq.TR), sq.n, 0.02), add(bcorn(sq.BR), sq.n, 0.02), add(bcorn(sq.BL), sq.n, 0.02));
      glows.push({ off: go, tint: nrm(inst.accent), alpha: TH.dark ? 0.22 : 0.10 });
    });
    // LAMP billboard
    var lampO = glw.length / 5; var L0 = [-1.6, 4.7, -2.4], L1 = [1.6, 4.7, -2.4], L2 = [1.6, 2.5, -2.4], L3 = [-1.6, 2.5, -2.4];
    pushQuadTex(glw, L0, L1, L2, L3); glows.push({ off: lampO, tint: nrm(TH.warm), alpha: TH.dark ? 0.5 : 0.18, lamp: true });

    litBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, litBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lit), gl.STATIC_DRAW);
    screenBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, screenBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(scr), gl.STATIC_DRAW);
    glowBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, glowBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(glw), gl.STATIC_DRAW);
    buildScreenLights();
    buildRTs();
  }
  function pushQuadTex(arr, p0, p1, p2, p3) { var uv = [[0, 0], [1, 0], [1, 1], [0, 1]], pts = [p0, p1, p2, p0, p2, p3], ui = [0, 1, 2, 0, 2, 3]; for (var i = 0; i < 6; i++) { arr.push(pts[i][0], pts[i][1], pts[i][2], uv[ui[i]][0], uv[ui[i]][1]); } }

  // ============== screen textures (2D canvas -> GL texture) ==============
  function newTex() { var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; }
  function makeScreenTex(inst) { var cv = document.createElement('canvas'); cv.width = inst.sw; cv.height = inst.sh; return { cv: cv, c: cv.getContext('2d'), tex: newTex(), wf: null }; }
  function bakedTex(w, h, paint) { var cv = document.createElement('canvas'); cv.width = w; cv.height = h; paint(cv.getContext('2d'), w, h); var t = newTex(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv); bakedTexList.push(t); return t; }

  function paintWall(c, w, h) {
    c.fillStyle = rgb(mix(TH.bg, TH.deep, 0.4)); c.fillRect(0, 0, w, h);
    var cell = 34, cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
    for (var r = 0; r < rows; r++) for (var k = 0; k < cols; k++) {
      var dx = k * cell + 2, dy = r * cell + 2, dw = cell - 4, dh = cell - 4;
      var dim = clamp(1 - (Math.abs(k / cols - 0.5) * 1.4 + (r / rows) * 0.3), 0.12, 1);
      c.fillStyle = rgb(mix(TH.deep, TH.metal, 0.5 * dim), 0.92); c.fillRect(dx, dy, dw, dh);
      c.strokeStyle = rgb(TH.border, 0.5 * dim); c.lineWidth = 1; c.strokeRect(dx, dy, dw, dh);
      c.fillStyle = rgb([207, 214, 208], 0.5 * dim); c.fillRect(dx + dw / 2 - 4, dy + dh - 5, 8, 2);
    }
  }
  function paintWood(c, w, h) { var g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, rgb(TH.woodHi)); g.addColorStop(0.1, rgb(TH.wood)); g.addColorStop(1, rgb(mix(TH.wood, TH.deep, 0.5))); c.fillStyle = g; c.fillRect(0, 0, w, h); for (var i = 0; i < 14; i++) { c.strokeStyle = rgb(mix(TH.wood, TH.deep, 0.6), 0.3); c.lineWidth = 1; var y = (i + 0.5) / 14 * h + (vnoise(i) - 0.5) * 4; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); } }

  // ----- live signal model (shared) -----
  function computeBins(t) {
    for (var i = 0; i < NB; i++) { bins[i] = 0.10 + 0.06 * vnoise(i * 0.5 + t * 1.7) + 0.04 * Math.sin(i / NB * 18 + t * 0.6); }
    var sig = [[0.18, 0.55, 0.9], [0.46, 0.5, 0.55], [0.72, 0.6, 0.7], [0.88, 0.45, 0.4]];
    for (var s = 0; s < sig.length; s++) { var cn = sig[s][0] + 0.02 * Math.sin(t * (0.2 + s * 0.05) + s); var amp = sig[s][1] * (0.6 + 0.4 * Math.abs(Math.sin(t * (0.5 + s * 0.3) + s))); var wd = sig[s][2] * 0.02 + 0.004; var cb = Math.round(cn * NB); for (var b = Math.max(0, cb - 6); b < Math.min(NB, cb + 6); b++) { var dx = (b / NB - cn) / wd; bins[b] = Math.max(bins[b], amp * Math.exp(-dx * dx)); } }
  }
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
  function heat(v) { v = clamp(v, 0, 1); if (v < 0.45) return rgb(mix(TH.dark ? [6, 16, 11] : [221, 232, 226], TH.green, v / 0.45)); if (v < 0.8) return rgb(mix(TH.green, TH.amber, (v - 0.45) / 0.35)); return rgb(mix(TH.amber, [255, 233, 176], (v - 0.8) / 0.2)); }

  function paintScope(sc, t, liss) {
    var c = sc.c, w = sc.cv.width, h = sc.cv.height;
    c.fillStyle = rgb(TH.glass); c.fillRect(0, 0, w, h);
    c.strokeStyle = rgb(TH.green, 0.16); c.lineWidth = 1; for (var i = 1; i < 6; i++) { c.beginPath(); c.moveTo(w * i / 6, 0); c.lineTo(w * i / 6, h); c.stroke(); } for (var j = 1; j < 5; j++) { c.beginPath(); c.moveTo(0, h * j / 5); c.lineTo(w, h * j / 5); c.stroke(); }
    function tr(lw, col, a) { c.beginPath(); var N = 120; for (var i = 0; i <= N; i++) { var u = i / N, px, py; if (!liss) { px = u * w; py = h / 2 - (Math.sin(t * 0.9 + u * 11) + 0.28 * Math.sin(2 * (t * 0.9 + u * 11))) * h * 0.34 * (1 + 0.08 * Math.sin(t * 0.6)); } else { var uu = u * Math.PI * 2; px = w / 2 + Math.sin(3 * uu + t * 0.15) * w * 0.36; py = h / 2 + Math.sin(2 * uu) * h * 0.36; } if (i === 0) c.moveTo(px, py); else c.lineTo(px, py); } c.lineWidth = lw; c.strokeStyle = rgb(col, a); c.lineJoin = 'round'; c.stroke(); }
    tr(3.5, TH.green, 0.3); tr(1.3, mix(TH.green, [255, 255, 255], 0.5), 0.95);
  }
  function paintSDR(sc, t) {
    var c = sc.c, w = sc.cv.width, h = sc.cv.height, specH = h * 0.4;
    if (!sc.wf) { sc.wf = document.createElement('canvas'); sc.wf.width = w; sc.wf.height = Math.floor(h * 0.6); sc.wfx = sc.wf.getContext('2d'); sc.wfx.imageSmoothingEnabled = false; for (var y = 0; y < sc.wf.height; y++) { computeBins((sc.wf.height - y) * 0.05); wfRow(sc, y); } }
    c.fillStyle = rgb(mix(TH.glass, [0, 0, 0], 0.3)); c.fillRect(0, 0, w, specH);
    c.beginPath(); for (var i = 0; i < NB; i++) { var px = i / (NB - 1) * w, py = specH - bins[i] * specH * 0.9; if (i === 0) c.moveTo(px, py); else c.lineTo(px, py); } c.lineWidth = 1.4; c.strokeStyle = rgb(TH.cyan, 0.95); c.stroke();
    sc.wfx.drawImage(sc.wf, 0, 0, sc.wf.width, sc.wf.height - 1, 0, 1, sc.wf.width, sc.wf.height - 1); wfRow(sc, 0);
    c.drawImage(sc.wf, 0, specH, w, h - specH);
  }
  function wfRow(sc, y) { var w = sc.wf.width, bw = w / NB; for (var i = 0; i < NB; i++) { sc.wfx.fillStyle = heat(bins[i]); sc.wfx.fillRect(Math.floor(i * bw), y, Math.ceil(bw) + 1, 1); } }
  function paintTRX(sc, t) { var c = sc.c, w = sc.cv.width, h = sc.cv.height; c.fillStyle = rgb(mix(TH.glass, [10, 6, 0], 0.5)); c.fillRect(0, 0, w, h); sc.val = (sc.val || 14074.0) + (Math.random() - 0.5) * 0.2; if (Math.random() < 0.01) sc.val += (Math.random() - 0.5) * 8; seven(c, w * 0.06, h * 0.18, w * 0.7, h * 0.5, fmtFreq(sc.val), TH.amber); c.fillStyle = rgb(TH.amber, 0.7); c.font = (h * 0.16) + 'px ui-monospace,monospace'; c.fillText('USB  14m', w * 0.06, h * 0.92); var peak = bins[40] || 0.4; for (var i = 0; i < 10; i++) { c.fillStyle = rgb(i / 10 < peak ? TH.green : TH.border, i / 10 < peak ? 0.9 : 0.3); c.fillRect(w * 0.74 + i * (w * 0.024), h * 0.2, w * 0.018, h * 0.5); } }
  function paintCounters(sc, t) { var c = sc.c, w = sc.cv.width, h = sc.cv.height; c.fillStyle = rgb(mix(TH.glass, [16, 4, 4], 0.6)); c.fillRect(0, 0, w, h); sc.v1 = (sc.v1 || 14074.0) + (Math.random() - 0.5) * 0.2; sc.v2 = (sc.v2 || 7030.2) + (Math.random() - 0.5) * 0.2; seven(c, w * 0.06, h * 0.08, w * 0.88, h * 0.36, fmtFreq(sc.v1), TH.red); seven(c, w * 0.06, h * 0.54, w * 0.88, h * 0.36, fmtFreq(sc.v2), TH.red); }
  function paintMeters(sc, t) {
    var c = sc.c, w = sc.cv.width, h = sc.cv.height; c.fillStyle = rgb(mix(TH.panel, [0, 0, 0], 0.3)); c.fillRect(0, 0, w, h);
    if (!sc.m) sc.m = [{ cur: 0.4, s: 1 }, { cur: 0.4, s: 2 }, { cur: 0.4, s: 3 }];
    var mw = w / 3;
    for (var i = 0; i < 3; i++) { var cx = mw * (i + 0.5), cy = h * 0.62, r = Math.min(mw, h) * 0.36; c.fillStyle = rgb(TH.dark ? [13, 10, 2] : [238, 244, 238]); c.beginPath(); c.arc(cx, cy, r, Math.PI, 2 * Math.PI); c.fill(); c.strokeStyle = rgb(TH.border); c.lineWidth = 1.2; c.stroke(); var peak = bins[Math.floor((0.2 + i * 0.3) * NB)] || 0.4; sc.m[i].cur += (clamp(0.25 + peak * 0.7, 0, 1) - sc.m[i].cur) * 0.12; var a = -Math.PI + clamp(sc.m[i].cur, 0, 1) * Math.PI; c.strokeStyle = rgb(TH.red); c.lineWidth = 1.6; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82); c.stroke(); }
    if (!sc.leds) sc.leds = [{ next: 0, on: 1 }, { next: 0, on: 0 }, { next: 0, on: 1 }, { next: 0, on: 0 }, { next: 0, on: 1 }];
    for (var k = 0; k < 5; k++) { var lx = w * 0.12 + k * w * 0.18, ly = h * 0.08; var col = [TH.cyan, TH.amber, TH.green, TH.amber, TH.red][k]; var on; if (k === 0) on = 0.5 + 0.4 * Math.sin(t * 3); else { if (t > sc.leds[k].next) { sc.leds[k].on = sc.leds[k].on ? 0 : 1; sc.leds[k].next = t + 0.4 + Math.random() * 1.2; } on = sc.leds[k].on ? 0.95 : 0.15; } var grd = c.createRadialGradient(lx, ly, 0, lx, ly, 7); grd.addColorStop(0, rgb(mix(col, [255, 255, 255], 0.6), on)); grd.addColorStop(0.5, rgb(col, on)); grd.addColorStop(1, rgb(col, 0)); c.fillStyle = grd; c.beginPath(); c.arc(lx, ly, 7, 0, 7); c.fill(); }
  }
  function paintScreen(s, t) {
    var p = s.paint;
    if (p === 'scopeSine') paintScope(s.tex, t, false);
    else if (p === 'scopeLiss') paintScope(s.tex, t, true);
    else if (p === 'sdr') paintSDR(s.tex, t);
    else if (p === 'trx') paintTRX(s.tex, t);
    else if (p === 'counters') paintCounters(s.tex, t);
    else if (p === 'meters') paintMeters(s.tex, t);
    gl.bindTexture(gl.TEXTURE_2D, s.tex.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, s.tex.cv);
  }

  // ============== render ==============
  function eyeAt(t) { return [EYE[0] + 0.10 * Math.sin(t * 0.21) * (L.phone ? 0.6 : 1), EYE[1] + 0.045 * Math.sin(t * 0.17 + 1.3), EYE[2] + 0.05 * Math.sin(t * 0.13 + 0.7)]; }

  function bindLit(p) { gl.bindBuffer(gl.ARRAY_BUFFER, litBuf); var ap = p.a('a_pos'), an = p.a('a_nrm'), au = p.a('a_uv'); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 32, 0); gl.enableVertexAttribArray(an); gl.vertexAttribPointer(an, 3, gl.FLOAT, false, 32, 12); gl.enableVertexAttribArray(au); gl.vertexAttribPointer(au, 2, gl.FLOAT, false, 32, 24); }
  function bindTex(p, buf) { gl.bindBuffer(gl.ARRAY_BUFFER, buf); var ap = p.a('a_pos'), au = p.a('a_uv'); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 20, 0); gl.enableVertexAttribArray(au); gl.vertexAttribPointer(au, 2, gl.FLOAT, false, 20, 12); }

  // draw the lit geometry + emissive screens (target already bound)
  function drawScene(vp, eye, t) {
    gl.clearColor(nrm(TH.deep)[0], nrm(TH.deep)[1], nrm(TH.deep)[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND);
    gl.useProgram(litProg); bindLit(litProg);
    gl.uniform3fv(litProg.u('u_warm'), nrm(TH.warm));
    gl.uniform3fv(litProg.u('u_sky'), nrm(TH.skyAmb)); gl.uniform3fv(litProg.u('u_grd'), nrm(TH.grdAmb));
    gl.uniform3fv(litProg.u('u_lamp'), [0, 3.6, -2.4]); gl.uniform1f(litProg.u('u_fall'), 0.05);
    gl.uniform3fv(litProg.u('u_eye'), eye);
    gl.uniform1i(litProg.u('u_sN'), sN); gl.uniform3fv(litProg.u('u_sPos'), sPos); gl.uniform3fv(litProg.u('u_sCol'), sCol);
    gl.uniformMatrix4fv(litProg.u('u_mvp'), false, vp);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(litProg.u('u_tex'), 0);
    litObjs.forEach(function (o) { gl.bindTexture(gl.TEXTURE_2D, o.tex); gl.uniform3fv(litProg.u('u_color'), o.color); gl.uniform1f(litProg.u('u_spec'), o.spec || 0.3); gl.uniform1f(litProg.u('u_shin'), o.shin || 24); gl.uniform1f(litProg.u('u_rim'), o.rim || 0.12); gl.drawArrays(gl.TRIANGLES, o.off, o.count); });
    gl.useProgram(texProg); bindTex(texProg, screenBuf); gl.uniform1i(texProg.u('u_tex'), 0); gl.uniform1i(texProg.u('u_mode'), 0); gl.uniform1f(texProg.u('u_emis'), TH.dark ? 1.35 : 0.82); gl.uniformMatrix4fv(texProg.u('u_mvp'), false, vp);
    screens.forEach(function (s) { gl.bindTexture(gl.TEXTURE_2D, s.tex.tex); gl.drawArrays(gl.TRIANGLES, s.off, 6); });
  }
  function drawGlows(vp, t, lampOnly) {
    gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.useProgram(texProg); bindTex(texProg, glowBuf); gl.uniform1i(texProg.u('u_mode'), 1); gl.uniformMatrix4fv(texProg.u('u_mvp'), false, vp);
    glows.forEach(function (g) { if (lampOnly && !g.lamp) return; var a = g.alpha; if (g.lamp && TH.dark) a = 0.42 + 0.06 * vnoise(t * 1.3); gl.uniform3fv(texProg.u('u_tint'), g.tint); gl.uniform1f(texProg.u('u_alpha'), a); gl.drawArrays(gl.TRIANGLES, g.off, 6); });
    gl.depthMask(true); gl.disable(gl.BLEND);
  }
  function bindPost(p) { ensureScrim(); gl.bindBuffer(gl.ARRAY_BUFFER, scrimBuf); var ap = p.a('a_pos'), au = p.a('a_uv'); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 20, 0); gl.enableVertexAttribArray(au); gl.vertexAttribPointer(au, 2, gl.FLOAT, false, 20, 12); }
  function blurPass(src, dst, dir) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb); gl.viewport(0, 0, dst.w, dst.h); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.useProgram(blurProg); bindPost(blurProg); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex); gl.uniform1i(blurProg.u('u_tex'), 0); gl.uniform2fv(blurProg.u('u_dir'), dir);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function render(t) {
    var eye = reduced() ? EYE : eyeAt(t);
    var vp = m4mul(proj, m4look(eye, CTR, [0, 1, 0]));
    if (postOK) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneRT.fb); gl.viewport(0, 0, sceneRT.w, sceneRT.h);
      drawScene(vp, eye, t); drawGlows(vp, t, true); // lamp glow blooms; instrument bloom comes from bright-pass
      // bright-pass
      gl.bindFramebuffer(gl.FRAMEBUFFER, brightRT.fb); gl.viewport(0, 0, brightRT.w, brightRT.h); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      gl.useProgram(brightProg); bindPost(brightProg); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sceneRT.tex); gl.uniform1i(brightProg.u('u_scene'), 0); gl.uniform2fv(brightProg.u('u_fc'), faceC); gl.uniform2fv(brightProg.u('u_fh'), faceH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // separable blur x2
      blurPass(brightRT, blurA, [1 / brightRT.w, 0]); blurPass(blurA, blurB, [0, 1 / brightRT.h]);
      blurPass(blurB, blurA, [1 / brightRT.w, 0]); blurPass(blurA, blurB, [0, 1 / brightRT.h]);
      // composite
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      gl.useProgram(compProg); bindPost(compProg);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sceneRT.tex); gl.uniform1i(compProg.u('u_scene'), 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, blurB.tex); gl.uniform1i(compProg.u('u_bloom'), 1); gl.activeTexture(gl.TEXTURE0);
      gl.uniform2f(compProg.u('u_res'), W, H); gl.uniform1f(compProg.u('u_time'), reduced() ? 0 : (t * 37) % 1000);
      gl.uniform2fv(compProg.u('u_fc'), faceC); gl.uniform2fv(compProg.u('u_fh'), faceH);
      var d = TH.dark;
      gl.uniform1f(compProg.u('u_exposure'), d ? 1.08 : 0.96);
      gl.uniform1f(compProg.u('u_bloomGain'), d ? 0.95 : 0.5);
      gl.uniform1f(compProg.u('u_vig'), d ? 0.55 : 0.82);
      gl.uniform1f(compProg.u('u_dim'), d ? 0.6 : 0.82);
      gl.uniform1f(compProg.u('u_grain'), d ? 0.045 : 0.018);
      gl.uniform1f(compProg.u('u_ca'), d ? 0.0022 : 0.0010);
      gl.uniform1f(compProg.u('u_fog'), d ? 0.55 : 0.30);
      gl.uniform3fv(compProg.u('u_fogCol'), nrm(TH.deep));
      gl.uniform3fv(compProg.u('u_grade'), d ? [1.06, 1.0, 0.92] : [1.02, 1.0, 0.99]);
      gl.uniform1f(compProg.u('u_aces'), d ? 1.0 : 0.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      drawScene(vp, eye, t); drawGlows(vp, t, false); drawScrim();
    }
  }
  var identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  function ensureScrim() { if (!scrimBuf) { scrimBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, scrimBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 0, 0, 3, -1, 0, 2, 0, -1, 3, 0, 0, 2]), gl.STATIC_DRAW); } }

  // screen-space scrim drawn with a tiny dedicated 2D-over approach via a fullscreen quad in clip space
  var scrimBuf = null;
  function drawScrim() {
    if (!scrimBuf) { scrimBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, scrimBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 0, 0, 3, -1, 0, 2, 0, -1, 3, 0, 0, 2]), gl.STATIC_DRAW); }
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);
    gl.useProgram(texProg); gl.bindBuffer(gl.ARRAY_BUFFER, scrimBuf); var ap = texProg.a('a_pos'), au = texProg.a('a_uv'); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 20, 0); gl.enableVertexAttribArray(au); gl.vertexAttribPointer(au, 2, gl.FLOAT, false, 20, 12);
    gl.uniform1i(texProg.u('u_mode'), 1); gl.uniform3fv(texProg.u('u_tint'), nrm(TH.deep));
    // vignette: u_alpha high at edges -> use mode1 radial which is bright at center; we want dark at edges,
    // so draw a center-bright "anti" is wrong. Instead emulate vignette by a separate dark-corner approach:
    // simplest robust: dim-well at center (mode1 gives center-strong) used as a CENTER DARKENING.
    gl.uniform1f(texProg.u('u_alpha'), TH.dark ? 0.5 : 0.26);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST);
  }

  // ============== lifecycle ==============
  function setBg(showFx) { try { var fx = document.getElementById('fxbg'); if (fx) fx.style.display = showFx ? '' : 'none'; var l2 = document.getElementById('labbg'); if (l2) l2.style.display = 'none'; } catch (e) {} }
  function sizeCanvas() { P = Math.min(window.devicePixelRatio || 1, 1.5); W = Math.floor(window.innerWidth * P); H = Math.floor(window.innerHeight * P); canvas.width = W; canvas.height = H; canvas.style.width = window.innerWidth + 'px'; canvas.style.height = window.innerHeight + 'px'; }
  function rebuild() { sizeCanvas(); theme(); layout(); proj = m4persp(FOV, W / H, 0.1, 60); NB = 96; bins = new Float32Array(NB); build(); }

  function start() {
    if (!ok) return;
    onHome = true; canvas.style.display = 'block'; setBg(false);
    rebuild(); maybeStart();
  }
  function stop() { onHome = false; running = false; if (rafId) { caf(rafId); rafId = 0; } if (canvas) canvas.style.display = 'none'; try { var fx = document.getElementById('fxbg'); if (fx) fx.style.display = ''; } catch (e) {} }
  function frame(ts) { rafId = 0; if (!ok || !running || !onHome) return; if (document.hidden || reduced()) { stop2static(); return; } if (ts - last >= 32) { last = ts; var t = (now() - t0) / 1000; computeBins(t); screens.forEach(function (s) { paintScreen(s, t); }); render(t); } rafId = raf(frame); }
  function stop2static() { running = false; if (rafId) { caf(rafId); rafId = 0; } drawStill(); }
  function drawStill() { var t = 4.2; computeBins(t); screens.forEach(function (s) { paintScreen(s, t); }); render(t); }
  function maybeStart() { if (!ok || !onHome) return; if (reduced()) { running = false; if (rafId) { caf(rafId); rafId = 0; } drawStill(); return; } if (document.hidden) { running = false; if (rafId) { caf(rafId); rafId = 0; } return; } if (!running) { running = true; last = 0; if (!rafId) rafId = raf(frame); } }
  function refresh() { if (!ok || !onHome) return; rebuild(); maybeStart(); }
  function onResize() { if (!ok || !onHome) return; clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { if (onHome) { rebuild(); maybeStart(); } }, 160); }

  function init() {
    canvas = document.getElementById('labbg3d');
    if (!canvas) return;
    var attrs = { alpha: true, antialias: true, depth: true, premultipliedAlpha: false, powerPreference: 'low-power' };
    try { gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs); } catch (e) { gl = null; }
    if (!gl) { ok = false; return; }
    try { gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); ok = true; } catch (e) { ok = false; gl = null; return; }
    t0 = now();
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', maybeStart);
  }

  return { init: init, start: start, stop: stop, refresh: refresh, resize: onResize, available: function () { return ok; } };
})();
