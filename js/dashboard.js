// ============================================================
// Dashboard — read-only progress view (NOT a mode).
//   window.Dashboard = { show(host, opts) }
// App calls Dashboard.show(UI.screen(), opts). Escape is handled globally
// by App; there is no onKey/stop here. Build the DOM with UI.* helpers,
// mirror the mode lifecycle's focus + aria conventions, and use the
// existing CSS class vocabulary (.card, .code code--dot code--<status>,
// .recap, etc.). Anything without a class gets inline styles via UI.el.
// ============================================================
window.Dashboard = (function () {
  'use strict';

  // ---- section scaffold: a .card with a small uppercase heading ----
  function section(titleText) {
    var card = UI.el('div', { class: 'card' });
    card.appendChild(UI.el('h3', {
      class: 'home__h',
      text: titleText,
      style: { marginTop: '0' }
    }));
    return card;
  }

  // ---- 1) band map: 28 status cells, click jumps to the reference ----
  function bandMapCard() {
    var card = section(t('dash.bandmap'));
    var grid = UI.el('div', {
      role: 'group',
      'aria-label': t('dash.bandmap'),
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(5.2rem, 1fr))',
        gap: '.5rem'
      }
    });
    window.QCODE_LIST.forEach(function (code) {
      var st = SRS.status(code);
      var pct = Math.round(SRS.accuracy(code) * 100);
      var cell = UI.el('button', {
        type: 'button',
        class: 'tile',
        'aria-label': code + ', ' + t('status.' + st) + ', ' + pct + '%',
        title: code + ' — ' + UI.meaningShort(code),
        style: {
          minHeight: '0',
          padding: '.5rem .55rem',
          alignItems: 'flex-start',
          gap: '.15rem'
        },
        onClick: function () { App.go('baza', { focus: code }); }
      }, [
        UI.el('span', { class: 'code code--dot code--' + st, text: code }),
        UI.el('span', { class: 'muted', style: { fontSize: '.78rem', fontFamily: 'var(--mono)' }, text: pct + '%' })
      ]);
      grid.appendChild(cell);
    });
    card.appendChild(grid);

    // legend (icon-free, but each status keeps its dot + word, never colour alone)
    var legend = UI.el('div', {
      style: { display: 'flex', flexWrap: 'wrap', gap: '.8rem', marginTop: '.7rem', fontSize: '.8rem' }
    });
    ['noisy', 'shaky', 'mastered'].forEach(function (st) {
      legend.appendChild(UI.el('span', { class: 'code code--dot code--' + st, style: { color: 'var(--muted)', fontFamily: 'var(--sans)', fontWeight: '400', letterSpacing: '0' }, text: t('status.' + st) }));
    });
    card.appendChild(legend);
    return card;
  }

  // ---- 2) summary counters + optional exam countdown ----
  function summaryCard() {
    var s = Store.settings();
    var card = UI.el('div', { class: 'card' });
    var stats = UI.el('div', { class: 'home__stats', style: { margin: '0', justifyContent: 'flex-start' } }, [
      pill(label(t('home.mastered')) || t('status.mastered'), SRS.masteredCount() + '/28'),
      pill(t('nav.dashboard'), SRS.seenCount() + '/28'),
      pill(label(t('home.due')), SRS.dueCount())
    ]);
    card.appendChild(stats);

    if (s.examDate) {
      var ms = Date.parse(s.examDate);
      if (!isNaN(ms)) {
        var days = Math.max(0, Math.ceil((ms - Date.now()) / 86400000));
        card.appendChild(UI.el('p', {
          class: 'muted',
          style: { marginBottom: '0', marginTop: '.6rem' },
          text: t('dash.exam.countdown', days)
        }));
      }
    }
    return card;
  }

  // strip the "{0}" placeholder + trailing colon from a chrome label so it
  // reads as a short noun on a pill (e.g. "Due today: {0}" -> "Due today")
  function label(s) {
    return String(s).replace(/[:：]?\s*\{0\}.*$/, '').replace(/[:：]\s*$/, '').trim();
  }
  function pill(labelText, value) {
    return UI.el('div', { class: 'pill' }, [
      UI.el('span', { class: 'pill__v', text: String(value) }),
      UI.el('span', { class: 'pill__l', text: labelText })
    ]);
  }

  // ---- 3) confusion matrix: which code got picked when another was shown ----
  function confusionCard() {
    var card = section(t('dash.confusion'));
    var matrix = (Store.state && Store.state.confusionMatrix) || {};

    // flatten to rows; find the max count to scale heat opacity
    var rows = [], maxCount = 0;
    Object.keys(matrix).forEach(function (shown) {
      var picks = matrix[shown] || {};
      Object.keys(picks).forEach(function (picked) {
        var n = picks[picked];
        if (!n) return;
        if (n > maxCount) maxCount = n;
        rows.push({ shown: shown, picked: picked, count: n });
      });
    });

    if (!rows.length) {
      card.appendChild(UI.el('p', { class: 'muted', style: { margin: '0' }, text: t('dash.confusion.empty') }));
      return card;
    }

    rows.sort(function (a, b) { return b.count - a.count; });

    var listWrap = UI.el('div', {
      role: 'list',
      'aria-label': t('dash.confusion'),
      style: { display: 'flex', flexDirection: 'column', gap: '.4rem' }
    });
    rows.forEach(function (r) {
      var opacity = 0.12 + 0.5 * (r.count / (maxCount || 1)); // readable heat band
      var row = UI.el('div', {
        role: 'listitem',
        'aria-label': r.shown + ' ' + tt({ pl: 'pomylone z', en: 'confused with' }) + ' ' + r.picked + ' x' + r.count,
        style: {
          display: 'flex', alignItems: 'center', gap: '.5rem',
          padding: '.45rem .6rem', borderRadius: 'var(--r-sm)',
          border: '1px solid var(--border)',
          backgroundColor: 'rgba(255,92,92,' + opacity.toFixed(3) + ')'
        }
      }, [
        UI.el('span', { class: 'code', text: r.shown }),
        UI.el('span', { class: 'muted', 'aria-hidden': 'true', text: '→' }),
        UI.el('span', { class: 'code code--bad', text: r.picked }),
        UI.el('span', { class: 'mono', style: { marginLeft: 'auto', color: 'var(--muted)' }, text: '×' + r.count })
      ]);
      listWrap.appendChild(row);
    });
    card.appendChild(listWrap);
    return card;
  }

  // ---- 4) exam report ----
  function examCard() {
    var card = section(t('dash.exam'));
    var ex = (Store.state && Store.state.exam) || {};
    var best = ex.bestScore;
    var line = UI.el('div', {
      style: { display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }
    });
    line.appendChild(UI.el('span', {
      text: (best != null) ? t('dash.exam.best', best) : t('dash.exam.none')
    }));
    if (ex.passed) {
      line.appendChild(UI.el('span', {
        class: 'pill',
        style: { borderColor: 'var(--green)', color: 'var(--green)', fontWeight: '700' },
        text: t('dash.exam.passed')
      }));
    }
    card.appendChild(line);
    return card;
  }

  // ---- 5) high scores (per current language, top 5) ----
  function highScoresCard() {
    var card = section(t('dash.highscores'));
    var lang = Store.settings().lang;
    var list = ((Store.state && Store.state.highScores) ? Store.state.highScores[lang] : null) || [];

    if (!list.length) {
      card.appendChild(UI.el('p', { class: 'muted', style: { margin: '0' }, text: t('dash.highscores.empty') }));
      return card;
    }

    var ol = UI.el('ol', {
      style: { listStyle: 'none', margin: '0', padding: '0', display: 'flex', flexDirection: 'column', gap: '.4rem' }
    });
    list.forEach(function (entry, i) {
      var callsign = entry && entry.callsign ? String(entry.callsign) : '—';
      var score = entry && entry.score != null ? entry.score : 0;
      var combo = entry && entry.maxCombo != null ? entry.maxCombo : 0;
      var li = UI.el('li', {
        style: {
          display: 'flex', alignItems: 'baseline', gap: '.6rem',
          padding: '.4rem 0', borderBottom: i < list.length - 1 ? '1px solid var(--border)' : '0'
        }
      }, [
        UI.el('span', { class: 'mono muted', style: { width: '1.4rem', flex: '0 0 auto' }, text: (i + 1) + '.' }),
        UI.el('span', { class: 'mono', style: { flex: '1', letterSpacing: '.5px' }, text: callsign }),
        UI.el('span', { class: 'pill__v', style: { fontFamily: 'var(--mono)' }, text: String(score) }),
        UI.el('span', { class: 'muted', style: { fontSize: '.8rem', fontFamily: 'var(--mono)' }, text: 'x' + combo })
      ]);
      ol.appendChild(li);
    });
    card.appendChild(ol);
    return card;
  }

  // ---- 6) reset (danger) ----
  function resetCard() {
    return UI.el('div', { class: 'card' }, [
      UI.btn(t('dash.reset'), {
        variant: 'danger',
        onClick: function () {
          if (window.confirm(t('dash.reset.confirm'))) {
            Store.reset();
            UI.refreshChrome();
            App.go('home');
          }
        }
      })
    ]);
  }

  // ---- entry point ----
  function show(host, opts) {
    var root = UI.el('div', { class: 'mode' }, [
      UI.modeHeader({ title: t('dash.title') }),
      bandMapCard(),
      summaryCard(),
      confusionCard(),
      examCard(),
      highScoresCard(),
      resetCard()
    ]);
    UI.setScreen(root);
    setTimeout(function () { UI.focusFirst(root); }, 0);
  }

  return { show: show };
})();
