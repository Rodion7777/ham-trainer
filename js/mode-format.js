// ============================================================
// Mode: Format — "Co po kodzie? / What follows the code?"
// Trains the SECOND learning target: the KIND of value that follows a
// code (a 1–5 rating, a frequency, a time, a location, nothing, …),
// NOT the literal value. Recognition grading (capped at box 2).
// Mirrors mode-flow.js lifecycle (start/stop/onKey) and UI.* helpers.
// ============================================================
window.ModeFormat = (function () {
  'use strict';
  var S = null;
  var ROUND = 14;
  // keep distractors clearly distinct from the answer by grouping near-synonym kinds
  var FAM = { freq: 'f', offset: 'f', time: 't', wait: 't', question: 'a', callsign: 'a' };
  function fam(k) { return FAM[k] || k; }
  function label(kind) { var o = window.QCODE_ARG_KINDS[kind]; return UI.lang() === 'pl' ? o.pl : o.en; }

  function start(host, ctx) {
    var q = SRS.buildQueue({ size: ROUND, onlyDue: false, includeUnseen: 4 });
    if (!q.length) q = SRS.shuffle(window.QCODE_LIST.slice()).slice(0, ROUND);
    if (ctx && ctx.inject && ctx.inject.length) {
      var inj = ctx.inject.filter(function (c) { return window.QCODE_BY[c]; });
      q = inj.concat(q.filter(function (c) { return inj.indexOf(c) < 0; }));
    }
    S = {
      queue: q, idx: 0, correct: 0, answered: 0, missed: [], nailed: [],
      code: null, choices: null, choiceEls: null, locked: false, t0: 0, dead: false
    };
    S.total = S.queue.length;
    S.header = UI.modeHeader({ title: tt({ pl: 'Format — co po kodzie?', en: 'Format — what follows?' }), progressText: '' });
    S.bar = UI.progressBar(0);
    S.card = UI.el('div', { class: 'card prompt-card' });
    S.answers = UI.el('div', { class: 'answers' });
    var root = UI.el('div', { class: 'mode mode-format' }, [S.header, S.bar, S.card, S.answers]);
    UI.setScreen(root);
    next();
  }

  function stop() { if (S) S.dead = true; }

  function setProgress() {
    var pr = S.header.querySelector('.modehead__progress span');
    if (pr) pr.textContent = S.answered + ' / ' + S.total;
    S.bar.update(S.total ? S.answered / S.total : 0);
  }

  function next() {
    if (S.dead) return;
    UI.resetAdvance();
    if (S.idx >= S.queue.length) return recap();
    S.code = S.queue[S.idx];
    S.locked = false;
    S.t0 = Date.now();
    render();
    setProgress();
  }

  function buildOptions(code) {
    var correct = window.QCODE_BY[code].arg.kind;
    // 'level9' ("a number 1–9") is distractor-ONLY (no code maps to it) — keep it out of the random pool
    var kinds = Object.keys(window.QCODE_ARG_KINDS).filter(function (k) { return k !== 'level9'; });
    var others = SRS.shuffle(kinds.filter(function (k) { return k !== correct && fam(k) !== fam(correct); })).slice(0, 3);
    // the 1–5 vs 1–9 trap: for rating codes (QRK/QSA/QRM/QRN) always tempt with "a number 1–9"
    if (correct === 'level' && others.indexOf('level9') < 0) others[others.length - 1] = 'level9';
    return SRS.shuffle([correct].concat(others)).map(function (k) {
      return { kind: k, correct: k === correct, label: label(k) };
    });
  }

  function render() {
    UI.clear(S.card); UI.clear(S.answers);
    S.card.appendChild(UI.el('div', { class: 'prompt-card__q', text: tt({ pl: 'Jaką wartość podaje się po tym kodzie?', en: 'What kind of value follows this code?' }) }));
    S.card.appendChild(UI.el('div', { class: 'prompt-card__main' }, [UI.codeChip(S.code, { big: true })]));

    S.choices = buildOptions(S.code);
    S.choiceEls = [];
    var list = UI.el('div', { class: 'choices' });
    S.choices.forEach(function (ch, i) {
      var b = UI.el('button', { type: 'button', class: 'choice', 'aria-label': (i + 1) + '. ' + ch.label }, [
        UI.el('span', { class: 'choice__key', text: String(i + 1) }),
        UI.el('span', { class: 'choice__txt', text: ch.label })
      ]);
      b.addEventListener('click', function () { choose(i); });
      S.choiceEls.push(b);
      list.appendChild(b);
    });
    S.answers.appendChild(list);
    UI.announce(tt({ pl: 'Co podaje się po ', en: 'What follows ' }) + S.code + '?');
    setTimeout(function () { if (S && !S.dead) UI.focus(S.choiceEls[0]); }, 0);
  }

  function choose(i) {
    if (S.locked || S.dead) return;
    S.locked = true;
    var ch = S.choices[i], correct = !!ch.correct, ms = Date.now() - S.t0;
    var rightIdx = -1;
    S.choices.forEach(function (c, k) { if (c.correct) rightIdx = k; });
    S.choiceEls.forEach(function (el, k) {
      if (k === rightIdx) el.classList.add('is-correct');
      else if (k === i) el.classList.add('is-wrong');
      else el.classList.add('is-dim');
      el.disabled = true; el.classList.add('is-disabled');
    });
    S.choiceEls[i].appendChild(UI.icon(correct ? 'check' : 'cross'));

    if (correct) { SRS.recogCorrect(S.code, ms); S.correct++; if (S.nailed.indexOf(S.code) < 0) S.nailed.push(S.code); if (Store.settings().sound) SFX.correct(); }
    else { SRS.recogWrong(S.code, ms); if (S.missed.indexOf(S.code) < 0) S.missed.push(S.code); if (Store.settings().sound) SFX.wrong(); }
    S.answered++;
    Store.touchActivity();
    UI.refreshChrome();
    setProgress();
    UI.announce(S.code + ' — ' + (correct ? t('fb.correct') : t('fb.wrong')));

    var c = window.QCODE_BY[S.code];
    var lines = [
      UI.el('div', { class: 'feedback__line' }, [
        UI.el('span', { class: 'mono', text: c.arg.tmpl }),
        document.createTextNode('  —  ' + (UI.lang() === 'pl' ? c.arg.pl : c.arg.en))
      ]),
      UI.el('div', { class: 'feedback__line' }, [
        UI.el('span', { class: 'code', text: S.code }),
        document.createTextNode(' = '),
        UI.el('span', { lang: UI.lang(), text: UI.meaningShort(S.code) })
      ])
    ];
    var panel = UI.feedback({
      correct: correct, lines: lines,
      onNext: function () { S.idx++; next(); },
      nextLabel: (S.idx + 1 >= S.queue.length) ? t('common.done') : t('fb.next')
    });
    S.answers.appendChild(panel);
  }

  function recap() {
    Store.state.stats.sessionsCompleted++;
    Store.save();
    var root = UI.el('div', { class: 'mode mode-format' }, [UI.modeHeader({ title: t('recap.title') })]);
    var card = UI.el('div', { class: 'card recap' });
    card.appendChild(UI.el('div', { class: 'recap__big', text: S.correct + ' / ' + S.total }));
    card.appendChild(recapRow(t('recap.advanced'), uniq(S.nailed), 'ok'));
    card.appendChild(recapRow(t('recap.slipped'), uniq(S.missed), 'bad'));
    var actions = UI.el('div', { class: 'recap__actions' });
    if (S.missed.length) actions.appendChild(UI.btn(tt({ pl: 'Powtórz słabe w Flow', en: 'Review weak in Flow' }), { variant: 'primary', onClick: function () { App.go('flow', { inject: uniq(S.missed) }); } }));
    actions.appendChild(UI.btn(t('recap.again'), { variant: S.missed.length ? 'ghost' : 'primary', onClick: function () { App.go('format'); } }));
    actions.appendChild(UI.btn(t('nav.home'), { variant: 'ghost', onClick: function () { App.go('home'); } }));
    card.appendChild(actions);
    root.appendChild(card);
    UI.setScreen(root);
    UI.announce(t('recap.title') + ' · ' + S.correct + ' / ' + S.total);
    setTimeout(function () { if (S && !S.dead) UI.focusFirst(root); }, 0);
  }
  function recapRow(title, codes, kind) {
    var chips = UI.el('div', { class: 'recap__chips' });
    if (!codes.length) chips.appendChild(UI.el('span', { class: 'muted', text: '—' }));
    codes.forEach(function (c) { chips.appendChild(UI.el('span', { class: 'code code--' + kind, text: c })); });
    return UI.el('div', { class: 'recap__row' }, [UI.el('h3', { text: title + ' (' + codes.length + ')' }), chips]);
  }
  function uniq(a) { var seen = {}, out = []; a.forEach(function (x) { if (!seen[x]) { seen[x] = 1; out.push(x); } }); return out; }

  // ---- keyboard ----
  function focusedIndex() {
    if (!S.choiceEls) return -1;
    for (var i = 0; i < S.choiceEls.length; i++) if (S.choiceEls[i] === document.activeElement) return i;
    return -1;
  }
  function moveFocus(dir) {
    if (!S.choiceEls || !S.choiceEls.length) return;
    var idx = focusedIndex();
    if (idx < 0) idx = dir > 0 ? -1 : S.choiceEls.length;
    UI.focus(S.choiceEls[(idx + dir + S.choiceEls.length) % S.choiceEls.length]);
  }
  function onKey(e) {
    if (!S || S.dead) return;
    if (UI.hasAdvance()) { if (e.key === 'Enter') { e.preventDefault(); UI.advance(); } return; }
    if (S.locked) return;
    var k = e.key;
    if (k >= '1' && k <= '9') { var i = parseInt(k, 10) - 1; if (S.choiceEls && i < S.choiceEls.length) { e.preventDefault(); choose(i); } return; }
    if (k === 'ArrowDown' || k === 'ArrowRight') { e.preventDefault(); moveFocus(1); return; }
    if (k === 'ArrowUp' || k === 'ArrowLeft') { e.preventDefault(); moveFocus(-1); return; }
    if (k === 'Enter') { var idx = focusedIndex(); if (idx >= 0) { e.preventDefault(); choose(idx); } }
  }

  return { id: 'format', start: start, stop: stop, onKey: onKey };
})();
