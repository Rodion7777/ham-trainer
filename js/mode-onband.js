// ============================================================
// Mode: On the Band — applied QSO cloze + argument interpretation.
// Two question shapes from window.QCODE_QSOS:
//   fill: replace "___" in a monospace log with the right Q-code, and
//         (when needsQ is defined) set the "?" switch to match question
//         vs. statement (e.g. "QRL?" asks, "QRL" states).
//   arg : pick the right plain-language reading of an on-air phrase.
// Recognition grading (capped at box 2), confusion logging on fill slips,
// optional per-question timer, and a log-sheet recap at the end.
// Mirrors mode-flow.js lifecycle (start/stop/onKey), UI.* helpers,
// focus + aria-live management, and reduced-motion respect.
// ============================================================
window.ModeOnBand = (function () {
  'use strict';
  var S = null; // per-session state
  var RUN = 10; // questions per run
  var TIMER_MS = 14000; // per-question budget when the timer is on
  var TICK = 100; // timer redraw interval (ms)

  // ---- which Q-code does a question train (for SRS + recap)? ----
  function questionCode(q) {
    if (q.type === 'fill') return q.answer;
    if (q.code) return q.code; // arg may carry an explicit code
    return null;               // otherwise it is not SRS-graded
  }
  function isWeak(q) {
    var c = questionCode(q);
    if (!c || !window.QCODE_BY[c]) return false;
    var st = SRS.status(c);
    return st === 'noisy' || st === 'shaky';
  }

  // ---- build the run: flatten, shuffle, keep a fill/arg mix, bias to weak ----
  function buildRun() {
    var all = [];
    (window.QCODE_QSOS || []).forEach(function (ex) {
      (ex.questions || []).forEach(function (q) { all.push({ q: q, ex: ex }); });
    });
    if (!all.length) return [];

    var pool = SRS.shuffle(all);
    // Float weak items forward while keeping the shuffle within each group.
    pool.sort(function (a, b) { return (isWeak(b.q) ? 1 : 0) - (isWeak(a.q) ? 1 : 0); });

    var fills = pool.filter(function (p) { return p.q.type === 'fill'; });
    var args = pool.filter(function (p) { return p.q.type === 'arg'; });
    var want = Math.min(RUN, pool.length);

    var picked = [], used = [];
    function take(arr, n) {
      for (var i = 0; i < arr.length && n > 0; i++) {
        if (used.indexOf(arr[i]) < 0) { picked.push(arr[i]); used.push(arr[i]); n--; }
      }
    }
    // Reserve at least a quarter of the run for each shape when both exist,
    // so a run is never all-fill or all-arg.
    if (fills.length && args.length) {
      var minEach = Math.max(1, Math.floor(want / 4));
      take(args, Math.min(minEach, args.length));
      take(fills, Math.min(minEach, fills.length));
    }
    take(pool, want - picked.length);
    return SRS.shuffle(picked).slice(0, want);
  }

  // ---- lifecycle ----
  function start(host, ctx) {
    S = {
      run: buildRun(), idx: 0, answered: 0, correct: 0, wrongCount: 0,
      missed: [], nailed: [], item: null, q: null,
      choices: null, choiceEls: null, qtoggle: null,
      toggleOn: false, locked: false, timer: null, deadline: 0,
      t0: 0, dead: false
    };
    S.total = S.run.length;

    S.header = UI.modeHeader({
      title: tt({ pl: 'Na paśmie (QSO)', en: 'On the Band' }),
      progressText: ''
    });
    S.bar = UI.progressBar(0);
    S.log = UI.el('div', { class: 'qsolog', role: 'group', 'aria-label': tt({ pl: 'Zapis łączności', en: 'On-air exchange' }) });
    S.prompt = UI.el('div', { class: 'prompt-card__q' });
    S.timerWrap = UI.el('div', { style: { display: 'none' } });
    S.answers = UI.el('div', { class: 'answers' });
    S.card = UI.el('div', { class: 'card' }, [S.log, S.prompt, S.timerWrap]);

    var root = UI.el('div', { class: 'mode mode-onband' }, [S.header, S.bar, S.card, S.answers]);
    UI.setScreen(root);

    if (!S.total) return empty();
    next();
  }

  function empty() {
    UI.clear(S.card); UI.clear(S.answers);
    S.card.appendChild(UI.el('div', { class: 'prompt-card__q', text: tt({ pl: 'Brak łączności do odtworzenia.', en: 'No exchanges to play.' }) }));
    S.answers.appendChild(UI.btn(t('nav.home'), { variant: 'primary', onClick: function () { App.go('home'); } }));
    setTimeout(function () { if (S && !S.dead) UI.focusFirst(S.answers); }, 0);
  }

  function stop() {
    if (S) { S.dead = true; clearTimer(); }
  }

  function clearTimer() {
    if (S && S.timer) { clearInterval(S.timer); S.timer = null; }
  }

  // ---- progress ----
  function setProgress() {
    var done = S.answered, total = Math.max(S.total, 1);
    var pr = S.header.querySelector('.modehead__progress span');
    if (pr) pr.textContent = done + ' / ' + total;
    S.bar.update(total ? done / total : 0);
  }

  // ---- render one question ----
  function next() {
    if (S.dead) return;
    UI.resetAdvance();
    clearTimer();
    if (S.idx >= S.run.length) return recap();
    S.item = S.run[S.idx];
    S.q = S.item.q;
    S.toggleOn = false;
    S.locked = false;
    S.t0 = Date.now();
    renderLog();
    renderPrompt();
    renderChoices();
    setProgress();
    startTimer();
    UI.announce(tt(S.q.prompt)); // read the question on each new card (focus lands on a choice)
  }

  // monospace log; for "fill" split context on the literal "___"
  function renderLog() {
    UI.clear(S.log);
    var ctxt = S.q.context || '';
    if (S.q.type === 'fill' && ctxt.indexOf('___') >= 0) {
      var parts = ctxt.split('___');
      parts.forEach(function (seg, i) {
        if (seg) S.log.appendChild(document.createTextNode(seg));
        if (i < parts.length - 1) S.log.appendChild(UI.el('span', { class: 'blank', text: '___', 'aria-label': tt({ pl: 'luka do uzupełnienia', en: 'blank to fill' }) }));
      });
    } else {
      S.log.appendChild(document.createTextNode(ctxt));
    }
  }

  function renderPrompt() {
    UI.clear(S.prompt);
    S.prompt.appendChild(document.createTextNode(tt(S.q.prompt)));
  }

  function keyLabel(i) { return String(i + 1); }

  function renderChoices() {
    UI.clear(S.answers);

    if (S.q.type === 'fill') {
      S.choices = SRS.shuffle(S.q.choices.slice()).map(function (code) {
        return { code: code, label: code };
      });
    } else {
      S.choices = SRS.shuffle(S.q.choices.slice()).map(function (choice) {
        return { choice: choice, label: tt(choice), correct: !!choice.correct };
      });
    }

    var list = UI.el('div', { class: 'choices' });
    S.choiceEls = [];
    S.choices.forEach(function (ch, i) {
      var txtNode = (S.q.type === 'fill')
        ? UI.el('span', { class: 'choice__txt' }, [UI.el('span', { class: 'mono', text: ch.label })])
        : UI.el('span', { class: 'choice__txt', text: ch.label });
      var b = UI.el('button', {
        type: 'button', class: 'choice',
        'aria-label': keyLabel(i) + '. ' + ch.label
      }, [
        UI.el('span', { class: 'choice__key', text: keyLabel(i) }),
        txtNode
      ]);
      b.addEventListener('click', function () { choose(i); });
      S.choiceEls.push(b);
      list.appendChild(b);
    });
    S.answers.appendChild(list);

    // the "?" switch — only for fill questions where needsQ is defined
    S.qtoggle = null;
    if (S.q.type === 'fill' && S.q.needsQ !== undefined) {
      var tog = UI.el('button', {
        type: 'button', class: 'qtoggle', role: 'switch', 'aria-checked': 'false',
        'aria-label': tt({ pl: 'Przełącznik znaku zapytania (klawisz Q)', en: 'Question-mark switch (key Q)' })
      }, [
        UI.el('span', { class: 'choice__key', text: 'Q' }),
        UI.el('span', { text: tt({ pl: 'Dodaj „?” (pytanie)', en: 'Add “?” (a question)' }) }),
        UI.el('span', { class: 'mono mono--big', text: '?' })
      ]);
      tog.addEventListener('click', function () { toggleQ(); });
      S.qtoggle = tog;
      S.answers.appendChild(tog);
      S.answers.appendChild(UI.el('div', {
        class: 'feedback__hint',
        text: tt({ pl: 'Klawisze 1–4 wybierają kod, „Q” przełącza „?”.', en: 'Keys 1–4 choose a code, “Q” toggles “?”.' })
      }));
    }

    setTimeout(function () { if (S && !S.dead) UI.focus(S.choiceEls[0]); }, 0);
  }

  function toggleQ() {
    if (S.locked || !S.qtoggle) return;
    S.toggleOn = !S.toggleOn;
    S.qtoggle.classList.toggle('is-on', S.toggleOn);
    S.qtoggle.setAttribute('aria-checked', String(S.toggleOn));
    if (Store.settings().sound) SFX.tick();
    UI.announce(S.toggleOn
      ? tt({ pl: '„?” włączone — pytanie.', en: '“?” on — a question.' })
      : tt({ pl: '„?” wyłączone — stwierdzenie.', en: '“?” off — a statement.' }));
  }

  // ---- optional per-question timer ----
  function startTimer() {
    if (!Store.settings().onBandTimer) return;
    UI.clear(S.timerWrap);
    S.timerWrap.style.display = '';
    S.timerWrap.style.marginTop = '.6rem';
    var fill = UI.el('div', { class: 'smeter__fill' });
    var meter = UI.el('div', { class: 'smeter', role: 'timer', 'aria-hidden': 'true' }, [fill]);
    S.timerWrap.appendChild(meter);
    S.deadline = Date.now() + TIMER_MS;
    fill.style.width = '100%';
    S.timer = setInterval(function () {
      if (!S || S.dead || S.locked) return;
      var left = S.deadline - Date.now();
      var frac = Math.max(0, left / TIMER_MS);
      fill.style.width = Math.round(frac * 100) + '%';
      if (left <= 0) { clearTimer(); timeout(); }
    }, TICK);
  }
  function hideTimer() { if (S) { S.timerWrap.style.display = 'none'; UI.clear(S.timerWrap); } }

  // ---- answering ----
  function choose(i) {
    if (S.locked || S.dead) return;
    grade(false, S.choices[i], i);
  }
  function timeout() {
    if (S.locked || S.dead) return;
    grade(true, null, -1);
  }

  // unified grading: timedOut means no selection was made
  function grade(timedOut, ch, chosenIdx) {
    S.locked = true;
    clearTimer();
    hideTimer();
    var ms = Date.now() - S.t0;
    var code = questionCode(S.q);
    var correct, lines = [], mnemonic = null;

    if (S.q.type === 'fill') {
      var codeRight = !timedOut && ch && ch.code === S.q.answer;
      var toggleRight = (S.q.needsQ === undefined) ? true : (S.toggleOn === !!S.q.needsQ);
      correct = !!(codeRight && toggleRight);

      paintChoices(chosenIdx, function (k) { return S.choices[k].code === S.q.answer; }, timedOut, correct);

      if (correct) {
        lines.push(tt({ pl: 'Poprawnie: ', en: 'Correct: ' }) + answerWithQ());
      } else if (timedOut) {
        lines.push(tt({ pl: 'Czas minął.', en: 'Time is up.' }));
        lines.push(tt({ pl: 'Poprawnie: ', en: 'Correct: ' }) + answerWithQ());
      } else if (codeRight && !toggleRight) {
        lines.push(qVsStatement()); // right code, wrong "?" state
      } else {
        lines.push(tt({ pl: 'Poprawnie: ', en: 'Correct: ' }) + answerWithQ());
      }
      lines.push(meaningLine(S.q.answer));
      if (S.q.explain) lines.push(tt(S.q.explain));

      if (correct) {
        SRS.recogCorrect(code, ms);
      } else {
        SRS.recogWrong(code, ms);
        if (!timedOut && ch && ch.code && ch.code !== S.q.answer) {
          SRS.recordConfusion(S.q.answer, ch.code);
          var mn = window.qcodeMnemonic(S.q.answer, ch.code);
          if (mn) mnemonic = tt(mn);
        }
      }
    } else {
      // arg
      correct = !timedOut && !!(ch && ch.correct);
      var rightIdx = -1;
      S.choices.forEach(function (c, k) { if (c.correct) rightIdx = k; });
      paintChoices(chosenIdx, function (k) { return k === rightIdx; }, timedOut, correct);

      if (timedOut) lines.push(tt({ pl: 'Czas minął.', en: 'Time is up.' }));
      if (!correct && rightIdx >= 0) {
        lines.push(tt({ pl: 'Poprawna odpowiedź: ', en: 'Correct answer: ' }) + S.choices[rightIdx].label);
      }
      if (code && window.QCODE_BY[code]) lines.push(meaningLine(code));

      if (code && window.QCODE_BY[code]) {
        if (correct) SRS.recogCorrect(code, ms);
        else SRS.recogWrong(code, ms);
      }
    }

    // stamp a green QSL on the log when nailed
    if (correct) {
      S.log.appendChild(document.createTextNode('   '));
      S.log.appendChild(UI.el('span', { class: 'qslstamp', text: 'QSL' }));
    }

    // recap tracking (only codes we actually grade)
    if (code && window.QCODE_BY[code]) {
      if (correct) { if (S.nailed.indexOf(code) < 0) S.nailed.push(code); }
      else { if (S.missed.indexOf(code) < 0) S.missed.push(code); }
    }

    if (correct) S.correct++; else S.wrongCount++;
    S.answered++;

    if (correct) { if (Store.settings().sound) SFX.correct(); flash(S.card); }
    else { if (Store.settings().sound) SFX.wrong(); shake(S.card); }

    Store.touchActivity();
    UI.announce((code ? code + ' — ' : '') + (correct ? t('fb.correct') : t('fb.wrong')));
    UI.refreshChrome();
    setProgress();

    var panel = UI.feedback({
      correct: correct,
      lines: lines,
      mnemonic: mnemonic,
      onNext: function () { S.idx++; next(); },
      nextLabel: (S.idx + 1 >= S.run.length) ? t('common.done') : t('fb.next')
    });
    S.answers.appendChild(panel);
  }

  // paint choices: correctTest(k)->bool marks the right one; chosenIdx marks a wrong pick
  function paintChoices(chosenIdx, correctTest, timedOut, correct) {
    S.choiceEls.forEach(function (el, k) {
      if (correctTest(k)) el.classList.add('is-correct');
      else if (!timedOut && k === chosenIdx) el.classList.add('is-wrong');
      else el.classList.add('is-dim');
      el.disabled = true; el.classList.add('is-disabled');
    });
    if (chosenIdx >= 0 && S.choiceEls[chosenIdx]) {
      S.choiceEls[chosenIdx].appendChild(UI.icon(correct ? 'check' : 'cross'));
    }
  }

  function answerWithQ() {
    if (S.q.needsQ === undefined) return S.q.answer;
    return S.q.answer + (S.q.needsQ ? ' ?' : '');
  }
  function qVsStatement() {
    var code = S.q.answer;
    if (S.q.needsQ) {
      return tt({
        pl: 'Kod jest dobry, ale brakuje „?”. „' + code + ' ?” pyta; „' + code + '” bez „?” stwierdza.',
        en: 'Right code, but the “?” is missing. “' + code + ' ?” asks; “' + code + '” without “?” states.'
      });
    }
    return tt({
      pl: 'Kod jest dobry, ale „?” jest zbędne. „' + code + '” stwierdza; „' + code + ' ?” pyta.',
      en: 'Right code, but the “?” doesn’t belong. “' + code + '” states; “' + code + ' ?” asks.'
    });
  }
  function meaningLine(code) {
    return UI.el('div', { class: 'feedback__line' }, [
      UI.el('span', { class: 'code', text: code }),
      document.createTextNode(' — '),
      UI.el('span', { lang: UI.lang(), text: UI.meaningShort(code) })
    ]);
  }

  // ---- motion helpers (respect reduced motion) ----
  function flash(node) {
    if (UI.reducedMotion() || !node) return;
    node.classList.remove('anim-flash');
    void node.offsetWidth;
    node.classList.add('anim-flash');
  }
  function shake(node) {
    if (UI.reducedMotion() || !node) return;
    node.classList.remove('anim-shake');
    void node.offsetWidth;
    node.classList.add('anim-shake');
  }

  // ---- recap: a log-sheet X/10 ----
  function recap() {
    clearTimer();
    var clean = S.wrongCount === 0 && S.answered > 0;
    // log the contact for this run
    Store.state.logbook.contacts++;
    if (clean) Store.state.logbook.cleanCopies++;
    Store.state.stats.sessionsCompleted++;
    Store.save();

    var root = UI.el('div', { class: 'mode mode-onband' }, [
      UI.modeHeader({ title: tt({ pl: 'Arkusz logu', en: 'Log sheet' }) })
    ]);
    var card = UI.el('div', { class: 'card recap' });
    card.appendChild(UI.el('div', {
      class: 'recap__big',
      text: S.correct + ' / ' + S.total + (clean ? ' — ' + tt({ pl: 'czysty odbiór!', en: 'clean copy!' }) : '')
    }));

    // monospace log-style summary line
    card.appendChild(UI.el('div', { class: 'qsolog', 'aria-hidden': 'true', style: { marginBottom: '.8rem' } }, [
      document.createTextNode('de ' + tt({ pl: 'Ty', en: 'you' }) + '  '),
      UI.el('span', { class: 'qslstamp', text: 'QSL ' + S.correct + '/' + S.total }),
      document.createTextNode('  73')
    ]));

    card.appendChild(recapRow(tt({ pl: 'Pewnie odebrane', en: 'Codes nailed' }), uniq(S.nailed), 'ok'));
    card.appendChild(recapRow(tt({ pl: 'Zaszumione', en: 'Noisy ones' }), uniq(S.missed), 'bad'));

    var actions = UI.el('div', { class: 'recap__actions' });
    if (S.missed.length) {
      actions.appendChild(UI.btn(tt({ pl: 'Powtórz zaszumione', en: 'Review the noisy ones' }), {
        variant: 'primary',
        onClick: function () { App.go('flow', { inject: uniq(S.missed) }); }
      }));
    }
    actions.appendChild(UI.btn(t('recap.again'), {
      variant: S.missed.length ? 'ghost' : 'primary',
      onClick: function () { App.go('onband'); }
    }));
    actions.appendChild(UI.btn(t('nav.home'), { variant: 'ghost', onClick: function () { App.go('home'); } }));
    card.appendChild(actions);

    root.appendChild(card);
    UI.setScreen(root);
    UI.announce(tt({ pl: 'Wynik: ', en: 'Score: ' }) + S.correct + ' / ' + S.total);
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
  function onKey(e) {
    if (!S || S.dead) return;
    // feedback showing -> Enter advances
    if (UI.hasAdvance()) {
      if (e.key === 'Enter') { e.preventDefault(); UI.advance(); }
      return;
    }
    if (S.locked) return;

    var k = e.key;
    if (k === 'q' || k === 'Q') {
      if (S.qtoggle) { e.preventDefault(); toggleQ(); }
      return;
    }
    if (k >= '1' && k <= '9') {
      var i = parseInt(k, 10) - 1;
      if (S.choiceEls && i < S.choiceEls.length) { e.preventDefault(); choose(i); }
      return;
    }
    if (k === 'ArrowDown' || k === 'ArrowRight') { e.preventDefault(); moveFocus(1); return; }
    if (k === 'ArrowUp' || k === 'ArrowLeft') { e.preventDefault(); moveFocus(-1); return; }
    if (k === 'Enter') {
      var idx = focusedChoiceIndex();
      if (idx >= 0) { e.preventDefault(); choose(idx); }
    }
  }

  function focusedChoiceIndex() {
    if (!S.choiceEls) return -1;
    for (var i = 0; i < S.choiceEls.length; i++) {
      if (S.choiceEls[i] === document.activeElement) return i;
    }
    return -1;
  }
  function moveFocus(dir) {
    if (!S.choiceEls || !S.choiceEls.length) return;
    var idx = focusedChoiceIndex();
    if (idx < 0) idx = dir > 0 ? -1 : S.choiceEls.length;
    var n = (idx + dir + S.choiceEls.length) % S.choiceEls.length;
    UI.focus(S.choiceEls[n]);
  }

  return { id: 'onband', start: start, stop: stop, onKey: onKey };
})();
