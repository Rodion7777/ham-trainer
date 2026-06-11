// ============================================================
// UI — shared rendering + accessibility toolkit used by every mode.
// Modes build their own DOM with UI.el(...) and these helpers; they must
// not touch the top bar / band strip directly (call UI.refreshChrome()).
// ============================================================
window.UI = (function () {
  'use strict';
  var screenEl = null, liveEl = null, topbarEl = null, bandEl = null;

  // ---- tiny DOM factory ----
  // el('div', {class:'x', text:'hi', onclick:fn, 'aria-label':'a', dataset:{k:v}}, [children])
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null) return;
        if (k === 'class' || k === 'className') node.className = v;
        else if (k === 'text' || k === 'textContent') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'dataset') Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
        else if (k === 'style' && typeof v === 'object') Object.keys(v).forEach(function (s) { node.style[s] = v[s]; });
        else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v);
      });
    }
    if (children != null) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) {
        if (c == null) return;
        node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
      });
    }
    return node;
  }
  function clear(node) { if (node) while (node.firstChild) node.removeChild(node.firstChild); }
  function frag(children) { var f = document.createDocumentFragment(); (children || []).forEach(function (c) { if (c != null) f.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }); return f; }

  // ---- bootstrap ----
  function init() {
    screenEl = document.getElementById('screen');
    liveEl = document.getElementById('live');
    topbarEl = document.getElementById('topbar');
    bandEl = document.getElementById('bandstrip');
    bindThemeMedia();
  }
  function screen() { return screenEl; }
  function setScreen(node) { clear(screenEl); screenEl.appendChild(node); }

  // ---- a11y helpers ----
  function announce(msg) {
    if (!liveEl) return;
    liveEl.textContent = '';
    // toggle so identical consecutive messages re-announce
    setTimeout(function () { liveEl.textContent = msg; }, 30);
  }
  function focus(node) { if (node && node.focus) try { node.focus(); } catch (e) {} }
  function focusFirst(container) {
    if (!container) return;
    var f = container.querySelector('[autofocus], input, button, [tabindex]');
    if (f) focus(f);
  }
  function reducedMotion() {
    var pref = false;
    try { pref = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    return pref || !(Store.settings().motion);
  }

  // ---- language-aware data helpers ----
  function lang() { return Store.settings().lang; }
  function codeObj(code) { return window.QCODE_BY[code]; }
  function meaning(code) { var c = codeObj(code); return c ? (lang() === 'pl' ? c.pl : c.en) : code; }
  function meaningShort(code) { var c = codeObj(code); return c ? (lang() === 'pl' ? c.pl_short : c.en_short) : code; }
  function example(code) { var c = codeObj(code); return c ? c.ex : ''; }

  // ---- common element factories ----
  function codeChip(code, opts) {
    opts = opts || {};
    return el('span', { class: 'code' + (opts.big ? ' code--big' : ''), text: code });
  }
  function btn(label, opts) {
    opts = opts || {};
    var b = el('button', {
      type: 'button',
      class: 'btn' + (opts.variant ? ' btn--' + opts.variant : '') + (opts.class ? ' ' + opts.class : '')
    });
    if (opts.icon) b.appendChild(icon(opts.icon));
    if (label) b.appendChild(el('span', { text: label }));
    if (opts.onClick) b.addEventListener('click', opts.onClick);
    if (opts['aria-label']) b.setAttribute('aria-label', opts['aria-label']);
    if (opts.title) b.setAttribute('title', opts.title);
    return b;
  }

  // bilingual reveal block — code + example + PL + EN, with optional highlight
  function usageBadge(c) {
    if (c.usage === 'rare') return el('span', { class: 'badge badge--rare', text: t('usage.rare') });
    if (c.usage === 'maritime') return el('span', { class: 'badge badge--maritime', text: t('usage.maritime') });
    return null;
  }

  function revealBlock(code, opts) {
    opts = opts || {};
    var c = codeObj(code);
    var pl = lang() === 'pl';
    var wrap = el('div', { class: 'reveal' });
    wrap.appendChild(el('div', { class: 'reveal__code' }, [codeChip(code, { big: true }), usageBadge(c)]));
    if (c.ex) wrap.appendChild(el('div', { class: 'reveal__ex' + (opts.highlight === 'ex' ? ' is-hl' : '') }, [
      el('span', { class: 'reveal__label', text: t('reveal.ex') + ': ' }), el('span', { class: 'mono', text: c.ex })
    ]));
    // the learning target: what KIND of value follows the code (not the literal value)
    if (c.arg) {
      var argRow = el('div', { class: 'reveal__ex reveal__arg' }, [
        el('span', { class: 'reveal__label', text: t('reveal.arg') + ': ' }),
        document.createTextNode(pl ? c.arg.pl : c.arg.en),
        el('span', { class: 'mono reveal__tmpl', text: c.arg.tmpl })
      ]);
      if (c.commonQuestion) argRow.appendChild(el('span', { class: 'reveal__qflag', text: ' · ' + t('reveal.question') + ': ' + code + '?' }));
      wrap.appendChild(argRow);
    }
    // 1–5 rating scale WITH direction (context, not a quiz target)
    if (c.scale) {
      wrap.appendChild(el('div', { class: 'reveal__ex reveal__scale' }, [
        el('span', { class: 'reveal__label', text: t('reveal.scale') + ': ' }),
        document.createTextNode((pl ? c.scale.lo.pl : c.scale.lo.en) + ' … ' + (pl ? c.scale.hi.pl : c.scale.hi.en)),
        el('span', { class: 'reveal__dir ' + (c.scale.dir === 'up-bad' ? 'is-bad' : 'is-good'),
          text: c.scale.dir === 'up-bad' ? (pl ? '  ↑ = gorzej' : '  ↑ = worse') : (pl ? '  ↑ = lepiej' : '  ↑ = better') })
      ]));
    }
    var plRow = el('div', { class: 'reveal__pl' + (opts.highlight === 'pl' ? ' is-hl' : ''), lang: 'pl' }, [
      el('span', { class: 'reveal__label', text: t('reveal.pl') + ': ' }), document.createTextNode(c.pl)
    ]);
    var enRow = el('div', { class: 'reveal__en' + (opts.highlight === 'en' ? ' is-hl' : ''), lang: 'en' }, [
      el('span', { class: 'reveal__label', text: t('reveal.en') + ': ' }), document.createTextNode(c.en)
    ]);
    if (pl) { wrap.appendChild(plRow); wrap.appendChild(enRow); }
    else { wrap.appendChild(enRow); wrap.appendChild(plRow); }
    // real-world usage note
    if (c.note) wrap.appendChild(el('div', { class: 'reveal__note' }, [
      el('span', { class: 'reveal__note-label', text: t('reveal.note') + ': ' }),
      document.createTextNode(pl ? c.note.pl : c.note.en)
    ]));
    return wrap;
  }

  // standardized feedback panel. opts: {correct, headline, lines[], mnemonic, onNext, nextLabel, autoFocusNext}
  var _advance = null;
  function feedback(opts) {
    opts = opts || {};
    var panel = el('div', {
      class: 'feedback ' + (opts.correct ? 'feedback--ok' : 'feedback--bad'),
      role: 'status'
    });
    var head = el('div', { class: 'feedback__head' }, [
      icon(opts.correct ? 'check' : 'cross'),
      el('span', { class: 'feedback__title', text: opts.headline || (opts.correct ? t('fb.correct') : t('fb.wrong')) })
    ]);
    panel.appendChild(head);
    (opts.lines || []).forEach(function (l) {
      panel.appendChild(typeof l === 'string' ? el('div', { class: 'feedback__line', text: l }) : l);
    });
    if (opts.mnemonic) panel.appendChild(el('div', { class: 'feedback__mnem', text: opts.mnemonic }));
    if (opts.onNext) {
      var nb = btn(opts.nextLabel || t('fb.next'), { variant: 'primary', class: 'feedback__next', onClick: function () { advance(); } });
      panel.appendChild(nb);
      panel.appendChild(el('div', { class: 'feedback__hint', text: t('fb.next.hint') }));
      _advance = opts.onNext;
      if (opts.autoFocusNext !== false) setTimeout(function () { focus(nb); }, 0);
    }
    // WebGL juice: a particle burst from the "Correct!" header once it's on screen
    if (opts.correct && window.FX) setTimeout(function () { FX.burstAt(head, { color: 'ok', count: 24, power: 0.95 }); }, 0);
    return panel;
  }
  function advance() { if (_advance) { var f = _advance; _advance = null; f(); return true; } return false; }
  function hasAdvance() { return !!_advance; }
  function resetAdvance() { _advance = null; }

  // ---- inline SVG icons ----
  function icon(name, cls) {
    var paths = {
      check: 'M5 13l4 4L19 7',
      cross: 'M6 6l12 12M18 6L6 18',
      back: 'M15 18l-6-6 6-6',
      home: 'M3 11l9-8 9 8M5 10v10h14V10',
      chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
      book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM19 3v16',
      gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12l2 1-2 4-2-1a7 7 0 0 1-2 1l-1 2H10l-1-2a7 7 0 0 1-2-1l-2 1-2-4 2-1a7 7 0 0 1 0-2L1 8l2-4 2 1a7 7 0 0 1 2-1l1-2h4l1 2a7 7 0 0 1 2 1l2-1 2 4-2 1a7 7 0 0 1 0 2z',
      sound: 'M4 9v6h4l5 5V4L8 9zM16 9a3 3 0 0 1 0 6M19 6a7 7 0 0 1 0 12',
      mute: 'M4 9v6h4l5 5V4L8 9zM17 9l4 6M21 9l-4 6'
    };
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', paths[name] || '');
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
    return svg;
  }

  // ---- theme ----
  function effectiveTheme() {
    var s = Store.settings().theme;
    if (s === 'dark' || s === 'light') return s;
    var dark = true;
    try { dark = !window.matchMedia('(prefers-color-scheme: light)').matches; } catch (e) {}
    return dark ? 'dark' : 'light';
  }
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', effectiveTheme());
    document.documentElement.setAttribute('lang', lang());
    document.documentElement.setAttribute('data-motion', reducedMotion() ? 'reduced' : 'full');
    if (window.FX) FX.refresh(); // re-tint the WebGL bg + honor the motion state
    if (window.Lab) Lab.refresh(); // re-theme / re-gate the 2D living-lab lobby bg
    if (window.Lab3D) Lab3D.refresh(); // re-theme / re-gate the 3D living-lab lobby bg
    if (window.LabPhoto) LabPhoto.refresh(); // re-gate the photo's animated glints
    if (window.LabDisplays) LabDisplays.refresh(); // re-theme / re-gate the live instrument displays
  }
  var themeBound = false;
  function bindThemeMedia() {
    if (themeBound) return; themeBound = true;
    try {
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
        if (Store.settings().theme === 'auto') applyTheme();
      });
      // keep data-motion in sync if the OS reduced-motion preference flips mid-session
      window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', applyTheme);
    } catch (e) {}
  }

  // ---- top bar + band strip chrome ----
  function masteryRing() {
    var n = SRS.masteredCount(), total = window.QCODE_LIST.length;
    var frac = total ? n / total : 0;
    var r = 13, circ = 2 * Math.PI * r;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 32 32'); svg.setAttribute('class', 'ring');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', t('home.mastered', n));
    function ring(cls, dash) {
      var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', '16'); c.setAttribute('cy', '16'); c.setAttribute('r', r);
      c.setAttribute('class', cls); c.setAttribute('fill', 'none'); c.setAttribute('stroke-width', '3');
      if (dash != null) { c.setAttribute('stroke-dasharray', circ); c.setAttribute('stroke-dashoffset', circ * (1 - frac)); c.setAttribute('transform', 'rotate(-90 16 16)'); }
      return c;
    }
    svg.appendChild(ring('ring__track'));
    svg.appendChild(ring('ring__val', true));
    var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', '16'); label.setAttribute('y', '20'); label.setAttribute('class', 'ring__txt');
    label.setAttribute('text-anchor', 'middle'); label.textContent = n;
    svg.appendChild(label);
    return svg;
  }

  function renderTopBar() {
    if (!topbarEl) return;
    clear(topbarEl);
    var brand = el('button', { class: 'brand', type: 'button', 'aria-label': t('nav.home'), onclick: function () { App.go('home'); } }, [
      el('span', { class: 'brand__dot' }),
      el('span', { class: 'brand__name', text: t('app.title') })
    ]);
    var s = Store.settings();
    var nav = el('nav', { class: 'topnav', 'aria-label': t('nav.home') }, [
      btn(t('lang.toggle'), { class: 'topnav__btn', 'aria-label': 'Język / Language: ' + s.lang.toUpperCase(), onClick: function () { toggleLang(); } }),
      btn('', { icon: s.sound ? 'sound' : 'mute', class: 'topnav__btn icon-only', 'aria-label': s.sound ? t('sound.on') : t('sound.off'), onClick: function () { toggleSound(); } }),
      btn('', { icon: 'chart', class: 'topnav__btn icon-only', 'aria-label': t('nav.dashboard'), onClick: function () { App.go('dashboard'); } }),
      btn('', { icon: 'book', class: 'topnav__btn icon-only', 'aria-label': t('nav.baza'), onClick: function () { App.go('baza'); } }),
      btn('', { icon: 'gear', class: 'topnav__btn icon-only', 'aria-label': t('nav.settings'), onClick: function () { App.go('settings'); } })
    ]);
    var ring = el('button', { class: 'ringbtn', type: 'button', 'aria-label': t('nav.dashboard') + ' — ' + t('home.mastered', SRS.masteredCount()), onclick: function () { App.go('dashboard'); } }, [masteryRing()]);
    topbarEl.appendChild(el('div', { class: 'topbar__in' }, [brand, el('div', { class: 'topbar__right' }, [ring, nav])]));
  }

  function renderBandStrip() {
    if (!bandEl) return;
    clear(bandEl);
    var strip = el('div', { class: 'bandstrip__in', role: 'group', 'aria-label': t('dash.bandmap') });
    window.QCODE_LIST.forEach(function (code) {
      var st = SRS.status(code);
      var dot = el('button', {
        class: 'banddot banddot--' + st, type: 'button',
        'aria-label': code + ', ' + t('status.' + st), title: code + ' — ' + meaningShort(code),
        onclick: function () { App.go('baza', { focus: code }); }
      });
      strip.appendChild(dot);
    });
    bandEl.appendChild(strip);
  }

  var _lastMastered = -1;
  function refreshChrome() {
    applyTheme(); renderTopBar(); renderBandStrip();
    var m = SRS.masteredCount();
    if (m === window.QCODE_LIST.length && _lastMastered >= 0 && _lastMastered < m && window.FX) {
      FX.celebrate();
      announce(t('home.mastered', m));
    }
    _lastMastered = m;
  }

  // ---- toggles ----
  function toggleLang() { Store.setSetting('lang', lang() === 'pl' ? 'en' : 'pl'); refreshChrome(); App.rerender(); }
  function toggleSound() {
    var on = !Store.settings().sound;
    Store.setSetting('sound', on);
    if (on) SFX.ensure();
    if (window.Music) Music.refresh(); // start/pause lobby music with the sound setting
    renderTopBar(); // only refresh the sound icon — NOT full refreshChrome (which re-applies the
    // theme and re-gates every lobby animation, which could disturb the live oscilloscopes)
  }
  function setTheme(v) { Store.setSetting('theme', v); refreshChrome(); }

  // ---- mode header (back button + title + optional progress) ----
  function modeHeader(opts) {
    opts = opts || {};
    var head = el('header', { class: 'modehead' });
    head.appendChild(btn(t('nav.back'), { icon: 'back', variant: 'ghost', class: 'modehead__back', onClick: function () { App.go('home'); } }));
    head.appendChild(el('h2', { class: 'modehead__title', text: opts.title || '' }));
    if (opts.progressText != null) {
      var pr = el('div', { class: 'modehead__progress', 'aria-live': 'off' }, [el('span', { text: opts.progressText })]);
      head.appendChild(pr);
    }
    return head;
  }

  // progress bar element with update()
  function progressBar(frac) {
    var fill = el('div', { class: 'pbar__fill' });
    fill.style.width = Math.round((frac || 0) * 100) + '%';
    var bar = el('div', { class: 'pbar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round((frac || 0) * 100)) }, [fill]);
    bar.update = function (f) { fill.style.width = Math.round(f * 100) + '%'; bar.setAttribute('aria-valuenow', String(Math.round(f * 100))); };
    return bar;
  }

  return {
    el: el, clear: clear, frag: frag, init: init, screen: screen, setScreen: setScreen,
    announce: announce, focus: focus, focusFirst: focusFirst, reducedMotion: reducedMotion,
    lang: lang, codeObj: codeObj, meaning: meaning, meaningShort: meaningShort, example: example,
    codeChip: codeChip, btn: btn, icon: icon, revealBlock: revealBlock,
    feedback: feedback, advance: advance, hasAdvance: hasAdvance, resetAdvance: resetAdvance,
    applyTheme: applyTheme, effectiveTheme: effectiveTheme,
    renderTopBar: renderTopBar, renderBandStrip: renderBandStrip, refreshChrome: refreshChrome,
    toggleLang: toggleLang, toggleSound: toggleSound, setTheme: setTheme,
    modeHeader: modeHeader, progressBar: progressBar
  };
})();
