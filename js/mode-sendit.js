// ============================================================
// Mode: Send It — typed production from a described situation.
// The ONLY mode that can MASTER a code (SRS.sendItFirstTry).
// Mirrors mode-flow.js: lifecycle (start/stop/onKey), UI.* helpers,
// focus management, aria-live announcements, reduced-motion respect.
// ============================================================
window.ModeSendIt = (function () {
  'use strict';
  var S = null; // per-session state

  // ---- answer normalization ----
  // uppercase, trim, take FIRST whitespace token, strip a trailing '?',
  // then keep only the leading run of LETTERS (so "QRN 5" / "QRN?" -> "QRN").
  function normalize(raw) {
    if (raw == null) return '';
    var first = String(raw).toUpperCase().trim().split(/\s+/)[0] || '';
    if (first.charAt(first.length - 1) === '?') first = first.slice(0, -1);
    var m = first.match(/^[A-Z]+/);
    return m ? m[0] : '';
  }

  // ---- Levenshtein edit distance, early-exit at >1 (only care about <=1) ----
  function levenshtein(a, b) {
    if (a === b) return 0;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return 2; // > 1, good enough for our threshold
    var prev = [], cur = [], i, j;
    for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) {
      cur[0] = i;
      for (j = 1; j <= lb; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      for (j = 0; j <= lb; j++) prev[j] = cur[j];
    }
    return prev[lb];
  }

  function isRealCode(tok) { return !!window.QCODE_BY[tok]; }
  function familyName(famKey) {
    var names = {
      conditions: { pl: 'warunki odbioru', en: 'conditions' },
      requests: { pl: 'prośby / polecenia', en: 'requests' },
      contact: { pl: 'nawiązanie / koniec łączności', en: 'contact' },
      frequency: { pl: 'częstotliwość / dane', en: 'frequency & data' }
    };
    return names[famKey] || { pl: famKey || '', en: famKey || '' };
  }

  // ---- session queue (honor ctx.inject like Flow) ----
  function buildQueue(ctx) {
    var q = SRS.buildQueue({ size: 16, onlyDue: false, includeUnseen: 4 });
    if (ctx && ctx.inject && ctx.inject.length) {
      var inj = ctx.inject.filter(function (c) { return window.QCODE_BY[c]; });
      q = inj.concat(q.filter(function (c) { return inj.indexOf(c) < 0; }));
    }
    return q;
  }

  function start(host, ctx) {
    S = {
      queue: buildQueue(ctx),
      answered: 0,
      advanced: [],   // first/second-try correct
      slipped: [],    // revealed / given up
      code: null,
      tries: 0,       // genuine wrong attempts consumed on the current card (0 or 1)
      hinted: false,
      done: false,    // card has been graded (feedback shown)
      t0: 0,
      input: null,
      msg: null,
      dead: false
    };
    S.total = S.queue.length;
    S.header = UI.modeHeader({ title: tt({ pl: 'Wpisz kod', en: 'Send It' }), progressText: '' });
    S.bar = UI.progressBar(0);
    S.card = UI.el('div', { class: 'card prompt-card' });
    S.answers = UI.el('div', { class: 'answers' });
    var root = UI.el('div', { class: 'mode mode-sendit' }, [S.header, S.bar, S.card, S.answers]);
    UI.setScreen(root);
    next();
  }

  function setProgress() {
    var done = S.answered, total = Math.max(S.total, S.answered + S.queue.length);
    var pr = S.header.querySelector('.modehead__progress span');
    if (pr) pr.textContent = done + ' / ' + total;
    S.bar.update(total ? done / total : 0);
  }

  function next() {
    if (S.dead) return;
    UI.resetAdvance();
    if (!S.queue.length) return recap();
    S.code = S.queue.shift();
    S.tries = 0;
    S.hinted = false;
    S.done = false;
    S.t0 = Date.now();
    renderPrompt();
    setProgress();
  }

  // ---- question card with text input ----
  function renderPrompt() {
    UI.clear(S.card); UI.clear(S.answers);
    S.card.className = 'card prompt-card';

    var sit = window.QCODE_SITUATIONS[S.code] || { pl: UI.meaning(S.code), en: UI.meaning(S.code) };
    S.card.appendChild(UI.el('div', { class: 'prompt-card__q', text: tt({ pl: 'Sytuacja na paśmie:', en: 'Situation on the air:' }) }));
    S.card.appendChild(UI.el('div', { id: 'sendit-sit', class: 'prompt-card__meaning', lang: UI.lang() }, [tt(sit)]));
    S.card.appendChild(UI.el('div', { class: 'prompt-card__cue muted', text: tt({ pl: 'Wpisz właściwy 3-literowy kod Q i naciśnij Enter.', en: 'Type the right 3-letter Q-code and press Enter.' }) }));

    S.input = UI.el('input', {
      class: 'input mono mono--big',
      type: 'text',
      autocomplete: 'off',
      autocapitalize: 'characters',
      autocorrect: 'off',
      spellcheck: 'false',
      maxlength: '12',
      'aria-label': tt({ pl: 'Twój kod', en: 'Your code' }),
      'aria-describedby': 'sendit-sit',
      placeholder: 'Q__',
      style: { textTransform: 'uppercase', letterSpacing: '2px' }
    });
    S.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); return; }
      // 'h' opens the hint while in wrong-state. To avoid blocking a typed H
      // (e.g. QTH), only intercept it when the field is empty OR fully selected
      // (the exact post-wrong state, when the rejected guess is still highlighted).
      if ((e.key === 'h' || e.key === 'H') && S.tries > 0 && !S.hinted &&
          (!S.input.value || (S.input.selectionStart === 0 && S.input.selectionEnd === S.input.value.length))) {
        e.preventDefault(); showHint();
      }
    });

    // inline message slot (near-miss / wrong nudge), polite live region
    S.msg = UI.el('div', { class: 'feedback__hint', 'aria-live': 'polite', style: { minHeight: '1.2em' } });

    var submitBtn = UI.btn(tt({ pl: 'Wyślij', en: 'Send' }), { variant: 'primary', class: 'flip-btn', onClick: submit });
    var giveUp = UI.btn(tt({ pl: 'Nie wiem — pokaż', en: "Don't know — reveal" }), { variant: 'ghost', onClick: giveUpReveal });

    S.answers.appendChild(S.input);
    S.answers.appendChild(S.msg);
    S.answers.appendChild(submitBtn);
    S.answers.appendChild(giveUp);

    setTimeout(function () { UI.focus(S.input); }, 0);
  }

  function setMsg(text, isWrong) {
    if (!S.msg) return;
    S.msg.textContent = text || '';
    S.msg.style.color = isWrong ? 'var(--red)' : 'var(--muted)';
  }

  function shakeInput() {
    if (!S.input || UI.reducedMotion()) return;
    S.input.classList.remove('anim-shake');
    void S.input.offsetWidth; // force reflow so re-adding restarts the animation
    S.input.classList.add('anim-shake');
  }

  // ---- submit handler (two-try state machine) ----
  function submit() {
    if (S.dead || S.done) return;
    var raw = S.input ? S.input.value : '';
    var tok = normalize(raw);
    if (!tok) { setMsg(tt({ pl: 'Wpisz kod (np. QTH).', en: 'Type a code (e.g. QTH).' }), false); if (S.input) UI.focus(S.input); return; }

    var code = S.code;

    // exact match -> correct
    if (tok === code) {
      return (S.tries === 0) ? correctFirst() : correctSecond();
    }

    // typed token is a DIFFERENT real Q-code -> always wrong (never forgiven)
    if (isRealCode(tok)) {
      Store.recordConfusion(code, tok);
      var partners = window.QCODE_CONFUSABLES_OF[code] || [];
      var mnem = (partners.indexOf(tok) >= 0) ? window.qcodeMnemonic(code, tok) : null;
      return registerWrong(mnem);
    }

    // not a real code but within edit-distance 1 -> near-miss (does NOT consume a try)
    if (levenshtein(tok, code) <= 1) {
      shakeInput();
      setMsg(tt({ pl: 'Blisko — spróbuj jeszcze raz.', en: 'Close — try again.' }), true);
      if (S.input) { S.input.select(); UI.focus(S.input); }
      return;
    }

    // any other non-match (far-off typo / nonsense) -> a genuine wrong try
    return registerWrong(null);
  }

  // ---- grading paths ----
  function correctFirst() {
    var ms = Date.now() - S.t0;
    SRS.sendItFirstTry(S.code, ms);
    S.advanced.push(S.code);
    finishTrial(true, tt({ pl: 'Z pamięci — świetnie!', en: 'From memory — great!' }), null);
  }

  function correctSecond() {
    var ms = Date.now() - S.t0;
    SRS.sendItSecondTry(S.code, ms);
    S.advanced.push(S.code);
    finishTrial(true, tt({ pl: 'Dobrze — za drugim razem.', en: 'Correct — second try.' }), null);
  }

  // mnem (or null): contrast nudge shown when the wrong token was a confusable partner
  function registerWrong(mnem) {
    // First genuine wrong -> stay on the card for a SECOND try, offer a hint.
    if (S.tries === 0) {
      S.tries = 1;
      shakeInput();
      setMsg(tt({ pl: 'Nie tak — naciśnij „h”, by zobaczyć podpowiedź.', en: 'Not quite — press "h" for a hint.' }), true);
      if (mnem) {
        var nud = UI.el('div', { class: 'feedback__mnem', style: { marginTop: '.4rem' }, text: tt(mnem) });
        S.answers.insertBefore(nud, S.msg.nextSibling);
      }
      ensureHintButton();
      if (S.input) { S.input.select(); UI.focus(S.input); }
      return;
    }
    // Second genuine wrong -> reveal (counts as fail / slipped).
    return giveUpReveal();
  }

  function ensureHintButton() {
    if (S.answers.querySelector('.sendit-hint')) return;
    var hb = UI.btn(tt({ pl: 'Podpowiedź (h)', en: 'Hint (h)' }), { variant: 'ghost', class: 'sendit-hint', onClick: showHint });
    S.answers.insertBefore(hb, S.msg.nextSibling); // right after the message slot
  }

  function showHint() {
    if (S.dead || S.done || S.hinted) return;
    S.hinted = true;
    var fam = familyName(window.QCODE_FAMILY_OF[S.code]);
    var hintText = tt({
      pl: 'Zaczyna się na Q, rodzina: ' + fam.pl + '.',
      en: 'Starts with Q, family: ' + fam.en + '.'
    });
    var hintEl = UI.el('div', { class: 'feedback__mnem', style: { marginTop: '.4rem' }, text: hintText });
    S.answers.insertBefore(hintEl, S.msg.nextSibling);
    var hb = S.answers.querySelector('.sendit-hint');
    if (hb) hb.disabled = true;
    UI.announce(hintText);
    if (S.input) UI.focus(S.input);
  }

  function giveUpReveal() {
    if (S.dead || S.done) return;
    var ms = Date.now() - S.t0;
    SRS.sendItReveal(S.code, ms);
    S.slipped.push(S.code);
    finishTrial(false, tt({ pl: 'Poprawny kod:', en: 'The correct code:' }), null);
  }

  // ---- shared trial completion: show feedback + reveal, wire next ----
  function finishTrial(correct, headline, mnem) {
    S.done = true;
    S.answered++;
    Store.touchActivity();
    UI.announce(S.code + ' · ' + t('status.' + SRS.status(S.code)) + ' · ' +
      (correct ? t('fb.correct') : t('fb.wrong')));
    UI.refreshChrome();

    if (Store.settings().sound) { (correct ? SFX.correct : SFX.wrong)(); SFX.morse(S.code); }

    UI.clear(S.answers);
    UI.clear(S.card);
    S.card.className = 'card'; // drop prompt-card layout for the feedback panel

    var panel = UI.feedback({
      correct: correct,
      headline: headline,
      lines: [UI.revealBlock(S.code, { highlight: UI.lang() === 'pl' ? 'pl' : 'en' })],
      mnemonic: mnem ? tt(mnem) : null,
      onNext: next,
      nextLabel: t('fb.next')
    });
    if (!UI.reducedMotion()) panel.classList.add(correct ? 'anim-flash' : 'anim-shake');
    S.card.appendChild(panel);
    setProgress();
  }

  // ---- recap (chips + Play again + Home), in the spirit of Flow ----
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

  // ---- keyboard ----
  function onKey(e) {
    if (!S || S.dead) return;
    // After feedback: Enter advances to the next card.
    if (S.done) {
      if (e.key === 'Enter') { e.preventDefault(); if (UI.hasAdvance()) UI.advance(); }
      return;
    }
    // 'h' opens the hint once we are in wrong-state — but only when the input
    // is NOT focused (there 'h' is a letter the user may want to type).
    if ((e.key === 'h' || e.key === 'H') && S.tries > 0 && !S.hinted && document.activeElement !== S.input) {
      e.preventDefault();
      showHint();
    }
    // Enter while focused in the input is handled by the input's own keydown.
  }

  function stop() { if (S) S.dead = true; }

  return { id: 'sendit', start: start, stop: stop, onKey: onKey };
})();
