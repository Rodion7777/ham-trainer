// ============================================================
// App — bootstrap, routing, home hub, settings, reference table.
// Modes register as window.ModeX = { id, start(host,ctx), stop(), onKey(e) }.
// ============================================================
window.App = (function () {
  'use strict';
  var current = { route: 'home', opts: {}, mode: null };
  // ----- VFO state + Kenwood-style amber 7-seg frequency display -----
  var freqHz = 14074000;            // 14.074 MHz (a popular HF spot)
  var freqCanvas = null, knobEl = null, knobAngle = 0, dragY = 0, dragging = false, lastTickK = Math.round(14074000 / 1000);
  function clampFreq(hz) { return Math.max(1800000, Math.min(29999999, hz)); }
  function pad(n, l) { n = String(n); while (n.length < l) n = '0' + n; return n; }
  function freqMHz() { return (freqHz / 1e6).toFixed(2); }
  var SEG7 = { '0': 0x3F, '1': 0x06, '2': 0x5B, '3': 0x4F, '4': 0x66, '5': 0x6D, '6': 0x7D, '7': 0x07, '8': 0x7F, '9': 0x6F };
  function seg7(c, x, y, w, h, mask, on, off) {
    var t = Math.max(1.4, w * 0.16); function s(bit, p) { c.fillStyle = (mask & bit) ? on : off; c.beginPath(); c.moveTo(p[0], p[1]); for (var i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]); c.closePath(); c.fill(); }
    var x2 = x + w, ym = y + h / 2, y2 = y + h;
    s(0x01, [x + t, y, x2 - t, y, x2 - t * 1.5, y + t, x + t * 1.5, y + t]);
    s(0x02, [x2, y + t, x2, ym - t / 2, x2 - t, ym - t, x2 - t, y + t * 1.5]);
    s(0x04, [x2, ym + t / 2, x2, y2 - t, x2 - t, y2 - t * 1.5, x2 - t, ym + t]);
    s(0x08, [x + t, y2, x2 - t, y2, x2 - t * 1.5, y2 - t, x + t * 1.5, y2 - t]);
    s(0x10, [x, ym + t / 2, x, y2 - t, x + t, y2 - t * 1.5, x + t, ym + t]);
    s(0x20, [x, y + t, x, ym - t / 2, x + t, ym - t, x + t, y + t * 1.5]);
    s(0x40, [x + t, ym, x + t * 1.5, ym - t / 2, x2 - t * 1.5, ym - t / 2, x2 - t, ym, x2 - t * 1.5, ym + t / 2, x + t * 1.5, ym + t / 2]);
  }
  function segStr(c, str, x, y, dw, dh, on, off) {
    var gap = dw * 0.34;
    for (var i = 0; i < str.length; i++) { var ch = str[i];
      if (ch === '.') { c.fillStyle = on; c.beginPath(); c.arc(x + dw * 0.22, y + dh - dw * 0.16, Math.max(1.6, dw * 0.17), 0, 7); c.fill(); x += dw * 0.5; }
      else { seg7(c, x, y, dw, dh, SEG7[ch] || 0, on, off); x += dw + gap; }
    }
    return x;
  }
  function renderFreq() {
    var cv = freqCanvas; if (!cv) return; var c = cv.getContext('2d'); var W = cv.width, H = cv.height;
    c.clearRect(0, 0, W, H);
    var on = '#ffb43e', off = 'rgba(255,150,30,0.10)';
    var mhz = Math.floor(freqHz / 1e6), khz = Math.floor((freqHz % 1e6) / 1000), sub = Math.floor((freqHz % 1000) / 10);
    var main = mhz + '.' + pad(khz, 3), subs = pad(sub, 2);
    c.fillStyle = on; c.textBaseline = 'top'; c.font = 'bold ' + Math.round(H * 0.14) + 'px ui-monospace, monospace';
    c.textAlign = 'left'; c.fillText('USB', W * 0.05, H * 0.07);
    c.textAlign = 'right'; c.fillText('VFO A', W * 0.95, H * 0.07); c.textAlign = 'left';
    c.save(); c.shadowColor = 'rgba(255,150,30,0.6)'; c.shadowBlur = Math.round(H * 0.05);
    var dh = H * 0.46, y = H * 0.34, dw = dh * 0.56;
    var endx = segStr(c, main, W * 0.055, y, dw, dh, on, off);
    var dh2 = dh * 0.62, dw2 = dw * 0.62;
    segStr(c, subs, endx + dw * 0.18, y + (dh - dh2), dw2, dh2, on, off);
    c.restore();
    c.fillStyle = on; c.font = 'bold ' + Math.round(H * 0.12) + 'px ui-monospace, monospace'; c.textAlign = 'right'; c.textBaseline = 'bottom';
    c.fillText('MHz', W * 0.95, H * 0.95); c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    if (knobEl) knobEl.setAttribute('aria-valuetext', freqMHz() + ' MHz');
  }
  function tuneBy(hz) {
    freqHz = clampFreq(freqHz + hz);
    knobAngle += hz > 0 ? 12 : -12; if (knobEl) knobEl.style.transform = 'rotate(' + knobAngle + 'deg)';
    var k = Math.round(freqHz / 1000); if (k !== lastTickK) { lastTickK = k; if (window.SFX) SFX.tick(); } // detent click per kHz
    renderFreq();
  }
  function setupVFO(el) {
    knobEl = el; el.style.cursor = 'ns-resize'; el.style.touchAction = 'none'; // touch drags tune the knob instead of scrolling the page
    el.setAttribute('role', 'slider'); el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', 'VFO frequency'); el.setAttribute('aria-valuetext', freqMHz() + ' MHz');
    el.addEventListener('wheel', function (e) { e.preventDefault(); var step = e.shiftKey ? 10000 : 1000; tuneBy(e.deltaY < 0 ? step : -step); }, { passive: false });
    el.addEventListener('pointerdown', function (e) { dragging = true; dragY = e.clientY; try { el.setPointerCapture(e.pointerId); } catch (x) {} });
    el.addEventListener('pointermove', function (e) { if (!dragging) return; var dy = dragY - e.clientY; if (Math.abs(dy) >= 1) { tuneBy(Math.round(dy) * 100); dragY = e.clientY; } });
    el.addEventListener('pointerup', function (e) { dragging = false; try { el.releasePointerCapture(e.pointerId); } catch (x) {} });
    el.addEventListener('pointercancel', function () { dragging = false; });
    el.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 10000 : 1000;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); tuneBy(step); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); tuneBy(-step); }
      else if (e.key === 'PageUp') { e.preventDefault(); tuneBy(100000); }
      else if (e.key === 'PageDown') { e.preventDefault(); tuneBy(-100000); }
    });
  }

  var ROUTE_TO_MODE = {
    flow: 'ModeFlow', sendit: 'ModeSendIt', twintrap: 'ModeTwinTrap', format: 'ModeFormat',
    onband: 'ModeOnBand', bitsaber: 'ModeBitSaber', sweep: 'ModeSweep', pileup: 'ModePileUp', exam: 'ModePileUp'
  };

  var MODE_META = [
    { route: 'flow', title: { pl: 'Flow — powtórki', en: 'Flow — review' }, desc: { pl: 'Spokojna sesja: przypomnij sobie znaczenie i sam się oceń. To serce nauki.', en: 'Calm self-graded recall session. The heart of the learning loop.' } },
    { route: 'sendit', title: { pl: 'Wpisz kod', en: 'Send It' }, desc: { pl: 'Z opisanej sytuacji wpisz z pamięci właściwy 3-literowy kod.', en: 'Type the right 3-letter code from a described situation.' } },
    { route: 'twintrap', title: { pl: 'Bliźniacze pułapki', en: 'Twin Trap' }, desc: { pl: 'Wybierz właściwy z dwóch łatwo mylonych kodów (QRO/QRP…).', en: 'Pick the right one of two confusable codes (QRO/QRP…).' } },
    { route: 'format', title: { pl: 'Co po kodzie?', en: 'What follows?' }, desc: { pl: 'Naucz się, jaką wartość podaje się po kodzie (1–5, częstotliwość, czas, nic…).', en: 'Learn what kind of value follows each code (1–5, a frequency, a time, none…).' } },
    { route: 'onband', title: { pl: 'Na paśmie (QSO)', en: 'On the Band' }, desc: { pl: 'Uzupełnij realistyczną łączność i odczytaj znaczenie kodów w kontekście.', en: 'Fill realistic on-air exchanges and read codes in context.' } },
    { route: 'bitsaber', title: { pl: 'Ham Saber (3D)', en: 'Ham Saber (3D)' }, desc: { pl: 'Tnij saberem właściwy kod lecący na ciebie w 3D — fale, życia, seria.', en: 'Slash the right code flying at you in 3D with a saber — waves, lives, combo.' } },
    { route: 'sweep', title: { pl: 'Namiar (radar 3D)', en: 'Sweep (3D radar)' }, desc: { pl: 'Namierz właściwy kod na obrotnicy radaru 3D — fale, życia, seria.', en: 'Intercept the right code on the 3D radar sweep — waves, lives, combo.' } },
    { route: 'pileup', title: { pl: 'Pile-Up (na czas)', en: 'Pile-Up (timed)' }, desc: { pl: '60 sekund szybkiej gry na wynik i serię.', en: '60-second arcade sprint for score & combo.' } },
    { route: 'exam', title: { pl: 'Egzamin', en: 'Exam' }, desc: { pl: '28 kodów raz każdy, bez stopera. Próg zaliczenia 75%.', en: 'All 28 codes once, no timer. Pass mark 75%.' } }
  ];

  function modeFor(route) { var g = ROUTE_TO_MODE[route]; return g ? window[g] : null; }

  // lobby photo background (the reference ham-bench): show on home, hide #fxbg under it
  function showPhoto(on) {
    var ph = document.getElementById('labphoto'), fx = document.getElementById('fxbg');
    if (window.LabPhoto) LabPhoto.stop(); // retired glints
    if (ph) ph.style.display = on ? 'block' : 'none';
    if (window.LabDisplays) { if (on) LabDisplays.start(); else LabDisplays.stop(); } // animated live displays on the photo's screens
    if (window.Music) { if (on) Music.start(); else Music.stop(); } // looping lobby background music
    if (fx) fx.style.display = on ? 'none' : ''; // hide ambient bg whenever the photo lobby is shown
  }

  function stopCurrent() {
    if (current.mode && current.mode.stop) { try { current.mode.stop(); } catch (e) {} }
    current.mode = null;
    UI.resetAdvance();
  }

  function go(route, opts) {
    stopCurrent();
    // leaving the lobby: hide the photo bg, stop any living-lab loop, restore #fxbg (all safe no-ops if idle)
    showPhoto(false);
    if (window.Lab3D) Lab3D.stop();
    if (window.Lab) Lab.stop();
    current = { route: route, opts: opts || {}, mode: null };
    document.body.setAttribute('data-route', route);
    UI.refreshChrome();
    if (route === 'home') return home();
    if (route === 'settings') return settings();
    if (route === 'baza') return baza(current.opts);
    if (route === 'dashboard') {
      if (window.Dashboard) return window.Dashboard.show(UI.screen(), current.opts);
      return home();
    }
    var mode = modeFor(route);
    if (!mode) return home();
    current.mode = mode;
    UI.clear(UI.screen());
    var ctx = current.opts || {};
    if (route === 'exam') ctx = Object.assign({}, ctx, { exam: true });
    mode.start(UI.screen(), ctx);
  }

  // Re-render the current view after a language/theme change.
  // An ACTIVE game mode keeps its in-progress state — restarting it would discard
  // a running session or an unsaved result (e.g. a Pile-Up high score on the result
  // screen). Chrome (top bar + band map) is already re-localized by the caller, and
  // the next question the mode renders will pick up the new language. Static views
  // (home/settings/baza/dashboard) have current.mode === null and re-render fully.
  function rerender() {
    if (current.mode) return;
    go(current.route, current.opts);
  }

  // ---------- HOME ----------
  function statPill(label, value) {
    return UI.el('div', { class: 'pill' }, [
      UI.el('span', { class: 'pill__v', text: String(value) }),
      UI.el('span', { class: 'pill__l', text: label })
    ]);
  }

  // ---- RIG-01 faceplate: short bilingual key labels + inline-SVG helpers ----
  var KEY_NAME = {
    flow: { pl: 'Flow', en: 'Flow' }, sendit: { pl: 'Wpisz', en: 'Send It' },
    twintrap: { pl: 'Bliźniaki', en: 'Twin Trap' }, format: { pl: 'Format', en: 'Format' },
    onband: { pl: 'Na paśmie', en: 'On Band' }, bitsaber: { pl: 'Ham Saber', en: 'Ham Saber' },
    sweep: { pl: 'Radar 3D', en: 'Sweep 3D' }, pileup: { pl: 'Pile-Up', en: 'Pile-Up' },
    exam: { pl: 'Egzamin', en: 'Exam' }
  };
  var KEY_SUB = {
    flow: { pl: 'powtórki', en: 'review' }, sendit: { pl: 'z pamięci', en: 'from memory' },
    twintrap: { pl: 'mylone pary', en: 'confusables' }, format: { pl: 'co po kodzie', en: 'what follows' },
    onband: { pl: 'QSO', en: 'QSO' }, bitsaber: { pl: 'tnij kod', en: 'slash it' },
    sweep: { pl: 'namiar', en: 'intercept' }, pileup: { pl: 'na czas', en: 'timed' },
    exam: { pl: '28 kodów', en: '28 codes' }
  };
  function svgNS(tag, attrs) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function smeterSVG(frac) {
    frac = Math.max(0, Math.min(1, frac));
    var deg = -50 + 100 * frac;
    var svg = svgNS('svg', { viewBox: '0 0 120 70', 'aria-hidden': 'true', focusable: 'false' });
    svg.appendChild(svgNS('path', { d: 'M10 60 A50 50 0 0 1 110 60', fill: 'none', stroke: 'var(--border)', 'stroke-width': '3', 'stroke-linecap': 'round' }));
    svg.appendChild(svgNS('path', { d: 'M10 60 A50 50 0 0 1 110 60', fill: 'none', stroke: 'var(--green)', 'stroke-width': '3', 'stroke-linecap': 'round', 'stroke-dasharray': '157', 'stroke-dashoffset': String(157 * (1 - frac)) }));
    [['S1', 16, 58], ['3', 31, 40], ['5', 60, 30], ['7', 89, 40], ['9', 104, 58], ['+dB', 60, 68]].forEach(function (tk) {
      var tx = svgNS('text', { x: tk[1], y: tk[2], 'text-anchor': 'middle', 'font-size': '7', 'font-family': 'var(--mono)', fill: 'var(--muted)' });
      tx.textContent = tk[0]; svg.appendChild(tx);
    });
    svg.appendChild(svgNS('line', { x1: '60', y1: '60', x2: '60', y2: '16', class: 'smeter-needle', stroke: 'var(--red)', 'stroke-width': '2', 'stroke-linecap': 'round', transform: 'rotate(' + deg.toFixed(1) + ' 60 60)' }));
    svg.appendChild(svgNS('circle', { cx: '60', cy: '60', r: '4', fill: 'var(--muted)' }));
    return svg;
  }
  function vfoSVG() {
    var svg = svgNS('svg', { viewBox: '0 0 84 84', 'aria-hidden': 'true', focusable: 'false' });
    svg.appendChild(svgNS('circle', { cx: '42', cy: '42', r: '40', fill: '#11160f', stroke: 'var(--border)', 'stroke-width': '2' }));
    svg.appendChild(svgNS('circle', { cx: '42', cy: '42', r: '30', fill: '#1c241d', stroke: 'rgba(0,0,0,.5)', 'stroke-width': '1' }));
    svg.appendChild(svgNS('circle', { cx: '42', cy: '42', r: '12', fill: '#3a443d' }));
    svg.appendChild(svgNS('line', { x1: '42', y1: '12', x2: '42', y2: '4', stroke: 'var(--cyan)', 'stroke-width': '3', 'stroke-linecap': 'round' }));
    return svg;
  }
  function pttGlyphSVG() {
    var svg = svgNS('svg', { viewBox: '0 0 24 24', class: 'icon', 'aria-hidden': 'true', focusable: 'false' });
    svg.appendChild(svgNS('path', { d: 'M8 5v14l11-7z', fill: 'currentColor' }));
    return svg;
  }
  function lcdSeg(label, value, hot) {
    return UI.el('div', { class: 'rig-lcd__seg' }, [
      UI.el('span', { class: 'rig-lcd__num' + (hot ? ' is-hot' : ''), text: value }),
      UI.el('span', { class: 'rig-lcd__lbl', text: label })
    ]);
  }
  function lcdSub(label, value) {
    return UI.el('span', { class: 'rig-lcd__subseg' }, [
      UI.el('span', { class: 'rig-lcd__subnum', text: value }),
      UI.el('span', { class: 'rig-lcd__sublbl', text: label })
    ]);
  }

  function home() {
    var s = Store.settings();
    var due = SRS.dueCount();
    var mastered = SRS.masteredCount();
    var dueLbl = t('home.due').replace(/[:{].*/, '').trim();
    var root = UI.el('div', { class: 'rig' });

    ['tl', 'tr', 'bl', 'br'].forEach(function (c) { root.appendChild(UI.el('span', { class: 'rig__screw rig__screw--' + c, 'aria-hidden': 'true' })); });

    // HEAD: brand plate + analog S-meter (needle = mastery %)
    var plate = UI.el('div', { class: 'rig-plate' }, [
      UI.el('span', { class: 'rig-plate__model', text: 'RIG-01' }),
      UI.el('span', { class: 'rig-plate__name', text: t('app.title') }),
      UI.el('span', { class: 'rig-plate__sub', text: 'TRANSCEIVER · ON AIR' }),
      UI.el('div', { class: 'rig-leds', 'aria-hidden': 'true' }, [
        UI.el('span', { class: 'rig-led rig-led--pwr' }), UI.el('span', { class: 'rig-led__lbl', text: 'PWR' }),
        UI.el('span', { class: 'rig-led rig-led--tx' }), UI.el('span', { class: 'rig-led__lbl', text: 'TX' }),
        UI.el('span', { class: 'rig-led rig-led--onair' }), UI.el('span', { class: 'rig-led__lbl', text: 'ON-AIR' })
      ])
    ]);
    // Kenwood-style amber 7-seg frequency display, tuned by the VFO knob below
    var freqCv = UI.el('canvas', { class: 'rig-disp__lcd', 'aria-hidden': 'true' });
    freqCv.width = 480; freqCv.height = 150;
    freqCanvas = freqCv;
    root.appendChild(UI.el('div', { class: 'rig-head' }, [plate, UI.el('div', { class: 'rig-disp' }, [freqCv])]));

    // LCD stats readout
    var lcd = UI.el('div', { class: 'rig-lcd', role: 'group', 'aria-label': t('status.mastered') }, [
      UI.el('div', { class: 'rig-lcd__main' }, [
        lcdSeg(t('status.mastered'), mastered + '/28'),
        lcdSeg(t('nav.dashboard'), SRS.seenCount() + '/28'),
        lcdSeg(dueLbl, String(due), due > 0)
      ])
    ]);
    if (s.streakEnabled || Store.state.logbook.contacts) {
      var sub = UI.el('div', { class: 'rig-lcd__sub' });
      if (s.streakEnabled) sub.appendChild(lcdSub('STREAK', Store.state.streak.current + ' d'));
      if (Store.state.logbook.contacts) sub.appendChild(lcdSub('LOG', Store.state.logbook.contacts + ' QSO'));
      lcd.appendChild(sub);
    }
    root.appendChild(lcd);

    // VFO row: the PTT (Start session) + a decorative tuning knob
    var startLabel = due > 0 ? t('home.start.due', due) : t('home.start.none');
    var ptt = UI.el('button', { class: 'btn btn--primary rig-ptt', type: 'button' }, [
      pttGlyphSVG(),
      UI.el('span', { class: 'rig-ptt__label', text: t('home.start') }),
      UI.el('span', { class: 'rig-ptt__due', text: startLabel })
    ]);
    ptt.setAttribute('autofocus', '');
    ptt.addEventListener('click', function () { go('flow'); });
    var knob = UI.el('div', { class: 'rig-vfo' }); // Kenwood-style weighted VFO knob (CSS)
    setupVFO(knob);
    var vfoCol = UI.el('div', { class: 'rig-vfo-col' }, [knob, UI.el('span', { class: 'rig-vfo__lbl', 'aria-hidden': 'true', text: 'TUNE' })]);
    root.appendChild(UI.el('div', { class: 'rig-vfo-row' }, [ptt, vfoCol]));
    renderFreq(); // draw the initial frequency

    // MODE BANK: 9 backlit channel keys
    var grid = UI.el('div', { class: 'rig-bank' });
    MODE_META.forEach(function (m) {
      var available = !!modeFor(m.route);
      var key = UI.el(available ? 'button' : 'div', {
        class: 'rig-key' + (available ? '' : ' rig-key--soon'),
        type: available ? 'button' : null,
        'aria-disabled': available ? null : 'true'
      }, [
        UI.el('span', { class: 'rig-key__led', 'aria-hidden': 'true' }),
        UI.el('span', { class: 'rig-key__name', text: tt(KEY_NAME[m.route] || m.title) }),
        UI.el('span', { class: 'rig-key__sub', text: tt(KEY_SUB[m.route] || m.desc) }),
        available ? null : UI.el('span', { class: 'rig-key__soon', text: t('home.soon') })
      ]);
      if (available) key.addEventListener('click', function () { go(m.route); });
      grid.appendChild(key);
    });
    root.appendChild(UI.el('div', { class: 'rig-bank-wrap' }, [
      UI.el('h2', { class: 'home__h rig-bank__h', text: t('home.modes') }), grid
    ]));

    UI.setScreen(root);
    // lobby background = the reference ham-bench photo (the WebGL/2D labs are paused here)
    if (window.Lab3D) Lab3D.stop();
    if (window.Lab) Lab.stop();
    showPhoto(true);
    setTimeout(function () { UI.focusFirst(root); }, 0);
  }

  // ---------- SETTINGS ----------
  function settingRow(labelText, control) {
    return UI.el('div', { class: 'setrow' }, [UI.el('span', { class: 'setrow__l', text: labelText }), control]);
  }
  function toggle(getVal, setVal) {
    var b = UI.el('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(!!getVal()) }, [UI.el('span', { class: 'switch__knob' })]);
    function paint() { b.setAttribute('aria-checked', String(!!getVal())); b.classList.toggle('is-on', !!getVal()); }
    paint();
    b.addEventListener('click', function () { setVal(!getVal()); paint(); });
    return b;
  }
  function segmented(options, getVal, setVal) {
    var wrap = UI.el('div', { class: 'segmented', role: 'radiogroup' });
    var btns = [];
    options.forEach(function (o, i) {
      var on = getVal() === o.value;
      var b = UI.el('button', {
        class: 'seg' + (on ? ' is-on' : ''), type: 'button', role: 'radio',
        'aria-checked': String(on), tabindex: on ? '0' : '-1', text: o.label
      });
      function select() {
        setVal(o.value);
        btns.forEach(function (c, j) {
          var sel = j === i;
          c.classList.toggle('is-on', sel);
          c.setAttribute('aria-checked', String(sel));
          c.tabIndex = sel ? 0 : -1;
        });
      }
      b._select = select;
      b.addEventListener('click', select);
      b.addEventListener('keydown', function (e) {
        var d = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1
          : (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var n = (i + d + options.length) % options.length;
        btns[n]._select();      // radiogroups select-on-navigate
        UI.focus(btns[n]);
      });
      btns.push(b);
      wrap.appendChild(b);
    });
    // ensure exactly one tab stop even if nothing is currently selected
    if (!btns.some(function (b) { return b.tabIndex === 0; }) && btns[0]) btns[0].tabIndex = 0;
    return wrap;
  }

  function settings() {
    var s = Store.settings();
    var root = UI.el('div', { class: 'settings' }, [UI.modeHeader({ title: t('set.title') })]);
    var box = UI.el('div', { class: 'card' });

    box.appendChild(settingRow(t('set.lang'), segmented(
      [{ label: 'Polski', value: 'pl' }, { label: 'English', value: 'en' }],
      function () { return s.lang; }, function (v) { Store.setSetting('lang', v); UI.refreshChrome(); go('settings'); }
    )));
    box.appendChild(settingRow(t('set.theme'), segmented(
      [{ label: t('set.theme.auto'), value: 'auto' }, { label: t('set.theme.dark'), value: 'dark' }, { label: t('set.theme.light'), value: 'light' }],
      function () { return s.theme; }, function (v) { UI.setTheme(v); }
    )));
    box.appendChild(settingRow(t('set.sound'), toggle(function () { return s.sound; }, function (v) { Store.setSetting('sound', v); if (v) SFX.ensure(); UI.refreshChrome(); })));
    box.appendChild(settingRow(t('set.motion'), toggle(function () { return s.motion; }, function (v) { Store.setSetting('motion', v); UI.applyTheme(); })));
    box.appendChild(settingRow(t('set.twinTimer'), toggle(function () { return s.twinTrapTimer; }, function (v) { Store.setSetting('twinTrapTimer', v); })));
    box.appendChild(settingRow(t('set.onBandTimer'), toggle(function () { return s.onBandTimer; }, function (v) { Store.setSetting('onBandTimer', v); })));
    box.appendChild(settingRow(t('set.streak'), toggle(function () { return s.streakEnabled; }, function (v) { Store.setSetting('streakEnabled', v); })));
    box.appendChild(settingRow(t('set.crossLingual'), toggle(function () { return s.crossLingualFlow; }, function (v) { Store.setSetting('crossLingualFlow', v); })));

    var dateInput = UI.el('input', { class: 'input', type: 'date', value: s.examDate || '' });
    dateInput.addEventListener('change', function () { Store.setSetting('examDate', dateInput.value || null); });
    box.appendChild(settingRow(t('set.examDate'), dateInput));
    root.appendChild(box);

    // export / import
    var io = UI.el('div', { class: 'card' });
    var ta = UI.el('textarea', { class: 'input io__ta', rows: '3', readonly: 'readonly', 'aria-label': t('set.export') });
    io.appendChild(UI.el('p', { class: 'muted', text: t('set.export.hint') }));
    io.appendChild(ta);
    io.appendChild(UI.el('div', { class: 'io__row' }, [
      UI.btn(t('set.export'), { variant: 'ghost', onClick: function () { ta.value = Store.exportJSON(); ta.select(); } }),
      UI.btn(t('set.import'), { variant: 'ghost', onClick: function () {
        var ok = Store.importJSON(ta.value);
        UI.announce(ok ? t('set.import.ok') : t('set.import.err'));
        if (ok) { UI.refreshChrome(); go('settings'); }
      } })
    ]));
    io.appendChild(UI.el('p', { class: 'muted', text: t('set.import.hint') }));
    root.appendChild(io);

    var danger = UI.el('div', { class: 'card' }, [
      UI.btn(t('dash.reset'), { variant: 'danger', onClick: function () {
        if (window.confirm(t('dash.reset.confirm'))) { Store.reset(); UI.refreshChrome(); go('home'); }
      } })
    ]);
    root.appendChild(danger);

    UI.setScreen(root);
    setTimeout(function () { UI.focusFirst(root); }, 0);
  }

  // ---------- BAZA (reference) ----------
  function baza(opts) {
    opts = opts || {};
    var root = UI.el('div', { class: 'baza' }, [UI.modeHeader({ title: t('baza.title') })]);
    var search = UI.el('input', { class: 'input', type: 'search', placeholder: t('baza.search'), 'aria-label': t('baza.search') });
    root.appendChild(search);

    var table = UI.el('table', { class: 'qtable' });
    table.appendChild(UI.el('thead', {}, [UI.el('tr', {}, [
      UI.el('th', { text: t('baza.code') }), UI.el('th', { text: t('baza.pl'), lang: 'pl' }),
      UI.el('th', { text: t('baza.en'), lang: 'en' }), UI.el('th', { text: t('baza.ex') })
    ])]));
    var tbody = UI.el('tbody');
    var rows = [];
    window.QCODE_DATA.codes.forEach(function (c) {
      var st = SRS.status(c.code);
      var badge = c.usage === 'rare' ? UI.el('span', { class: 'badge badge--rare', text: t('usage.rare') })
        : c.usage === 'maritime' ? UI.el('span', { class: 'badge badge--maritime', text: t('usage.maritime') }) : null;
      var tr = UI.el('tr', { dataset: { code: c.code } }, [
        UI.el('td', { dataset: { label: t('baza.code') } }, [UI.el('span', { class: 'code code--dot code--' + st, text: c.code }), badge]),
        UI.el('td', { dataset: { label: t('baza.pl') }, lang: 'pl', text: c.pl }),
        UI.el('td', { dataset: { label: t('baza.en') }, lang: 'en', text: c.en }),
        UI.el('td', { dataset: { label: t('baza.ex') } }, [
          UI.el('span', { class: 'mono', text: c.ex }),
          c.arg ? UI.el('div', { class: 'muted baza__arg', text: t('reveal.arg') + ': ' + (UI.lang() === 'pl' ? c.arg.pl : c.arg.en) }) : null,
          c.note ? UI.el('div', { class: 'baza__note', text: t('reveal.note') + ': ' + (UI.lang() === 'pl' ? c.note.pl : c.note.en) }) : null
        ])
      ]);
      rows.push({ tr: tr, hay: (c.code + ' ' + c.pl + ' ' + c.en + ' ' + c.ex).toLowerCase() });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    root.appendChild(table);

    // companion (non-Q) abbreviations heard alongside Q-codes
    var abbr = UI.el('div', { class: 'card' }, [UI.el('h3', { text: t('baza.abbrevs') })]);
    var atbody = UI.el('tbody');
    (window.QCODE_ABBREVS || []).forEach(function (x) {
      atbody.appendChild(UI.el('tr', {}, [UI.el('td', { text: x.a }), UI.el('td', { text: UI.lang() === 'pl' ? x.pl : x.en })]));
    });
    abbr.appendChild(UI.el('table', { class: 'abbrevs' }, [atbody]));
    root.appendChild(abbr);

    root.appendChild(UI.el('p', { class: 'muted baza__src', text: t('baza.source') }));

    function filter() {
      var q = search.value.trim().toLowerCase();
      rows.forEach(function (r) { r.tr.style.display = (!q || r.hay.indexOf(q) >= 0) ? '' : 'none'; });
    }
    search.addEventListener('input', filter);

    UI.setScreen(root);
    if (opts.focus) {
      var row = tbody.querySelector('tr[data-code="' + opts.focus + '"]');
      if (row) { row.classList.add('is-focus'); setTimeout(function () { row.scrollIntoView({ block: 'center' }); }, 0); }
    } else {
      setTimeout(function () { UI.focus(search); }, 0);
    }
  }

  // ---------- global keyboard ----------
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (current.route !== 'home') { e.preventDefault(); go('home'); }
      return;
    }
    if (current.mode && current.mode.onKey) current.mode.onKey(e);
  }

  function boot() {
    Store.load();
    UI.init();
    UI.applyTheme();
    if (window.FX) FX.init();
    if (window.Lab) Lab.init();
    if (window.Lab3D) Lab3D.init();
    if (window.LabPhoto) LabPhoto.init();
    if (window.LabDisplays) LabDisplays.init();
    if (window.Music) Music.init();
    Store.touchActivity();
    document.addEventListener('keydown', onKeyDown);
    // every button press is followed by a short click sound. One delegated
    // listener covers all current/future <button>s; capture-phase so it fires
    // before a handler navigates or re-renders the button away. SFX.tick()
    // self-gates on the sound setting (a no-op when muted) and self-ensures the
    // audio context from this click gesture. Disabled buttons don't fire click.
    document.addEventListener('click', function (e) {
      var t = e.target, btn = t && t.closest ? t.closest('button') : null;
      if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
      if (window.SFX) SFX.tick();
    }, true);
    // Uppbeat music credits: reveal only when the user scrolls the page DOWN, collapse at the top.
    // Most screens fit the viewport exactly (nothing to scroll), so a downward wheel/touch gesture
    // also reveals them — expanding the block then makes the page scrollable to read it in full.
    var credits = document.getElementById('music-credits');
    if (credits) {
      var atTop = function () { return (window.scrollY || window.pageYOffset || 0) <= 6; };
      var setCredits = function (reveal) { credits.classList.toggle('is-revealed', reveal); };
      window.addEventListener('scroll', function () { setCredits(!atTop()); }, { passive: true });
      window.addEventListener('wheel', function (e) { if (e.deltaY > 0) setCredits(true); else if (e.deltaY < 0 && atTop()) setCredits(false); }, { passive: true });
      var touchY = null;
      window.addEventListener('touchstart', function (e) { touchY = (e.touches && e.touches[0]) ? e.touches[0].clientY : null; }, { passive: true });
      window.addEventListener('touchmove', function (e) {
        if (touchY == null || !e.touches || !e.touches[0]) return;
        var dy = touchY - e.touches[0].clientY; // >0 => finger up => scrolling down
        if (dy > 6) setCredits(true); else if (dy < -6 && atTop()) setCredits(false);
      }, { passive: true });
    }
    UI.refreshChrome();
    go('home');
  }

  return { boot: boot, go: go, rerender: rerender, home: home, current: function () { return current; }, MODE_META: MODE_META };
})();
