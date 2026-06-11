// ============================================================
// Mode: Flow — the default self-graded recall session (SRS spine).
// REFERENCE TEMPLATE for the other modes: note the lifecycle
// (start/stop/onKey), the use of UI.* helpers, SRS.* for grading,
// focus management, aria-live announcements, and reduced-motion respect.
// ============================================================
window.ModeFlow = (function () {
  'use strict';
  var S = null; // per-session state

  function buildQueue(ctx) {
    var q = SRS.buildQueue({ size: 20, onlyDue: true, includeUnseen: 3 });
    if (!q.length) q = SRS.buildQueue({ size: 12, onlyDue: false });
    if (ctx && ctx.inject && ctx.inject.length) {
      // "review the noisy ones" from On the Band etc. — prioritize these
      var inj = ctx.inject.filter(function (c) { return window.QCODE_BY[c]; });
      q = inj.concat(q.filter(function (c) { return inj.indexOf(c) < 0; }));
    }
    return q;
  }

  function pickFace(code) {
    var box = Store.code(code).box;
    if (box <= 1) return 'a';          // recognition-ish: show code, recall meaning
    return Math.random() < 0.5 ? 'b' : 'c'; // production-leaning
  }

  function start(host, ctx) {
    S = { queue: buildQueue(ctx), answered: 0, advanced: [], slipped: [], revealed: false, code: null, face: 'a', t0: 0, dead: false };
    S.total = S.queue.length;
    S.header = UI.modeHeader({ title: tt({ pl: 'Flow — powtórki', en: 'Flow — review' }), progressText: '' });
    S.bar = UI.progressBar(0);
    S.card = UI.el('div', { class: 'card prompt-card' });
    S.answers = UI.el('div', { class: 'answers' });
    var root = UI.el('div', { class: 'mode mode-flow' }, [S.header, S.bar, S.card, S.answers]);
    UI.setScreen(root);
    next();
  }

  function setProgress() {
    var done = S.answered, total = Math.max(S.total, S.answered + S.queue.length);
    var txt = (done) + ' / ' + total;
    var pr = S.header.querySelector('.modehead__progress span');
    if (pr) pr.textContent = txt;
    S.bar.update(total ? done / total : 0);
  }

  function next() {
    if (S.dead) return;
    UI.resetAdvance();
    if (!S.queue.length) return recap();
    S.code = S.queue.shift();
    S.face = pickFace(S.code);
    S.revealed = false;
    S.t0 = Date.now();
    renderPrompt();
    setProgress();
  }

  function promptText() {
    var c = window.QCODE_BY[S.code];
    if (S.face === 'a') {
      return { node: UI.el('div', { class: 'prompt-card__main' }, [UI.codeChip(S.code, { big: true })]),
        q: tt({ pl: 'Co oznacza ten kod?', en: 'What does this code mean?' }) };
    }
    if (S.face === 'b') {
      var useOther = Store.settings().crossLingualFlow && Math.random() < 0.5;
      var ml = useOther ? (UI.lang() === 'pl' ? c.en : c.pl) : UI.meaning(S.code);
      return { node: UI.el('div', { class: 'prompt-card__meaning', lang: useOther ? (UI.lang() === 'pl' ? 'en' : 'pl') : UI.lang(), text: ml }),
        q: tt({ pl: 'Który to kod?', en: 'Which code is this?' }) };
    }
    return { node: UI.el('div', { class: 'prompt-card__ex' }, [UI.el('span', { class: 'mono mono--big', text: c.ex })]),
      q: tt({ pl: 'Co się dzieje na paśmie?', en: 'What is happening on the air?' }) };
  }

  function renderPrompt() {
    UI.clear(S.card); UI.clear(S.answers);
    var p = promptText();
    S.card.appendChild(UI.el('div', { class: 'prompt-card__q', text: p.q }));
    S.card.appendChild(p.node);
    S.card.appendChild(UI.el('div', { class: 'prompt-card__cue muted', text: tt({ pl: 'Pomyśl, potem odsłoń (spacja / Enter).', en: 'Think, then reveal (Space / Enter).' }) }));
    var flip = UI.btn(tt({ pl: 'Odsłoń', en: 'Reveal' }), { variant: 'primary', class: 'flip-btn', onClick: reveal });
    flip.setAttribute('autofocus', '');
    S.answers.appendChild(flip);
    // announce the prompt so screen-reader users hear what to recall (focus lands on Reveal)
    var c = window.QCODE_BY[S.code];
    var spoken = (S.face === 'a') ? S.code : (S.face === 'b') ? UI.meaning(S.code) : c.ex;
    UI.announce(p.q + ' ' + spoken);
    setTimeout(function () { UI.focus(flip); }, 0);
  }

  function reveal() {
    if (S.revealed) return;
    S.revealed = true;
    UI.clear(S.card); UI.clear(S.answers);
    var hl = (S.face === 'b') ? null : (UI.lang() === 'pl' ? 'pl' : 'en');
    if (S.face === 'c') hl = 'ex';
    S.card.appendChild(UI.revealBlock(S.code, { highlight: hl }));
    if (Store.settings().sound) SFX.morse(S.code);

    var grades = UI.el('div', { class: 'grades' }, [
      gradeBtn('again', '1', tt({ pl: 'Jeszcze raz', en: 'Again' }), 'bad'),
      gradeBtn('hard', '2', tt({ pl: 'Trudne', en: 'Hard' }), 'warn'),
      gradeBtn('good', '3', tt({ pl: 'Dobrze', en: 'Good' }), 'ok')
    ]);
    S.answers.appendChild(grades);
    setTimeout(function () { UI.focus(S.answers.querySelector('.grade-btn')); }, 0);
  }

  function gradeBtn(grade, num, label, kind) {
    var b = UI.el('button', { class: 'grade-btn grade-btn--' + kind, type: 'button' }, [
      UI.el('span', { class: 'grade-btn__k', text: num }),
      UI.el('span', { text: label })
    ]);
    b.addEventListener('click', function () { grade_(grade); });
    return b;
  }

  function grade_(grade) {
    if (!S.revealed) return;
    var code = S.code, ms = Date.now() - S.t0;
    SRS.gradeFlow(code, grade, ms);
    Store.touchActivity();
    if (grade === 'good' && window.FX) FX.burstAt(S.card, { color: 'ok', count: 16, power: 0.8 });
    if (grade === 'good' || grade === 'hard') S.advanced.push(code);
    else {
      S.slipped.push(code);
      // re-queue after a lag of ~3 cards (never immediately)
      S.queue.splice(Math.min(S.queue.length, 3), 0, code);
    }
    S.answered++;
    UI.announce(code + ' · ' + t('status.' + SRS.status(code)));
    UI.refreshChrome();
    next();
  }

  function recap() {
    Store.state.stats.sessionsCompleted++;
    Store.save();
    var uniqAdv = dedupe(S.advanced), uniqSlip = dedupe(S.slipped);
    var root = UI.el('div', { class: 'mode' }, [UI.modeHeader({ title: t('recap.title') })]);
    var card = UI.el('div', { class: 'card recap' });
    card.appendChild(UI.el('div', { class: 'recap__big', text: t('recap.title') }));
    card.appendChild(recapList(t('recap.advanced'), uniqAdv, 'ok'));
    card.appendChild(recapList(t('recap.slipped'), uniqSlip, 'bad'));
    card.appendChild(UI.el('div', { class: 'recap__actions' }, [
      UI.btn(t('recap.again'), { variant: 'primary', onClick: function () { start(UI.screen(), {}); } }),
      UI.btn(t('nav.home'), { variant: 'ghost', onClick: function () { App.go('home'); } })
    ]));
    root.appendChild(card);
    UI.setScreen(root);
    setTimeout(function () { UI.focusFirst(root); }, 0);
  }
  function recapList(title, codes, kind) {
    var chips = UI.el('div', { class: 'recap__chips' });
    if (!codes.length) chips.appendChild(UI.el('span', { class: 'muted', text: '—' }));
    codes.forEach(function (c) { chips.appendChild(UI.el('span', { class: 'code code--' + kind, text: c })); });
    return UI.el('div', { class: 'recap__row' }, [UI.el('h3', { text: title + ' (' + codes.length + ')' }), chips]);
  }
  function dedupe(a) { var seen = {}, out = []; a.forEach(function (x) { if (!seen[x]) { seen[x] = 1; out.push(x); } }); return out; }

  function onKey(e) {
    if (!S || S.dead) return;
    if (!S.revealed) {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'Spacebar') { e.preventDefault(); reveal(); }
      return;
    }
    if (e.key === '1') { e.preventDefault(); grade_('again'); }
    else if (e.key === '2') { e.preventDefault(); grade_('hard'); }
    else if (e.key === '3') { e.preventDefault(); grade_('good'); }
  }

  function stop() { if (S) S.dead = true; }

  return { id: 'flow', start: start, stop: stop, onKey: onKey };
})();
