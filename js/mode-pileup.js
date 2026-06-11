// ============================================================
// Mode: Pile-Up + Exam — two sub-modes in one file.
//   window.ModePileUp.start(host, ctx):
//     ctx.exam !== true  -> Pile-Up: 60s timed arcade MCQ sprint (score + combo + S-meter).
//     ctx.exam === true  -> Exam: 28 codes once each, no timer, 75% pass mark, report card.
// Both are recognition formats: SRS.recogCorrect / SRS.recogWrong (box capped at 2).
// Lifecycle mirrors mode-flow.js (start/stop/onKey, UI.* helpers, focus, aria-live,
// reduced-motion respect). All timers live on S and are cleared in stop().
// ============================================================
window.ModePileUp = (function () {
  'use strict';
  var S = null; // per-session state

  // ---- shared tiny helpers ----------------------------------------------
  function clearTimers() {
    if (!S) return;
    if (S.clockTimer) { clearInterval(S.clockTimer); S.clockTimer = null; }
    if (S.meterRaf) { cancelAnimationFrame(S.meterRaf); S.meterRaf = null; }
    if (S.advanceTimer) { clearTimeout(S.advanceTimer); S.advanceTimer = null; }
  }

  // Build a 4-choice MCQ from an answer code + 3 distractors. `render(code)`
  // produces the visible label for each option; `value(code)` is what we compare.
  function buildChoices(answer, render) {
    var codes = [answer].concat(SRS.distractors(answer, 3));
    var opts = SRS.shuffle(codes).map(function (c) {
      return { code: c, label: render(c), correct: c === answer };
    });
    return opts;
  }

  // ------------------------------------------------------------------
  // SUB-MODE A — Pile-Up (timed arcade sprint)
  // ------------------------------------------------------------------
  var ROUND_MS = 60000;     // 60-second round
  var METER_MS = 3500;      // per-trial S-meter drain time
  var NEXT_DELAY = 650;     // pause on feedback before next trial

  function startPileUp() {
    S = {
      mode: 'pileup', dead: false,
      score: 0, combo: 0, maxCombo: 0,
      answered: 0, correctCount: 0,
      recent: [],            // recently used codes (exclude from next pick)
      fumbled: [],           // codes missed/timed-out (deduped)
      fastest: null, fastestMs: Infinity,
      roundEnd: 0,
      code: null, choices: null, locked: false,
      trialStart: 0,         // perf time the meter started for current trial
      clockTimer: null, meterRaf: null, advanceTimer: null,
      els: {}
    };

    S.header = UI.modeHeader({ title: tt({ pl: 'Pile-Up (na czas)', en: 'Pile-Up (timed)' }) });

    var scoreEl = UI.el('span', { class: 'hud__score', text: '0' });
    var comboEl = UI.el('span', { class: 'hud__combo', text: '' });
    var timeEl = UI.el('span', { class: 'mono', style: { fontWeight: '700' }, text: '60.0' });
    var hud = UI.el('div', { class: 'hud' }, [
      scoreEl,
      comboEl,
      UI.el('span', { class: 'mono', 'aria-label': tt({ pl: 'Pozostały czas', en: 'Time left' }) }, [timeEl, document.createTextNode(' s')])
    ]);

    var meterFill = UI.el('div', { class: 'smeter__fill' });
    var meter = UI.el('div', { class: 'smeter', role: 'progressbar', 'aria-hidden': 'true' }, [meterFill]);

    var promptCode = UI.el('div', { class: 'prompt-card__main' });
    var promptQ = UI.el('div', { class: 'prompt-card__q', text: tt({ pl: 'Co oznacza ten kod?', en: 'What does this code mean?' }) });
    var card = UI.el('div', { class: 'card prompt-card arcade' }, [promptQ, promptCode]);

    var choicesEl = UI.el('div', { class: 'choices' });
    var answers = UI.el('div', { class: 'answers' }, [choicesEl]);

    S.els = {
      score: scoreEl, combo: comboEl, time: timeEl,
      meterFill: meterFill, promptCode: promptCode, choices: choicesEl
    };

    var root = UI.el('div', { class: 'mode mode-pileup' }, [S.header, hud, meter, card, answers]);
    UI.setScreen(root);

    S.roundEnd = Date.now() + ROUND_MS;
    S.clockTimer = setInterval(tickClock, 100);
    nextPileUp();
  }

  function tickClock() {
    if (!S || S.dead) return;
    var remain = S.roundEnd - Date.now();
    if (remain <= 0) {
      S.els.time.textContent = '0.0';
      return endPileUp();
    }
    S.els.time.textContent = (remain / 1000).toFixed(1);
  }

  function nextPileUp() {
    if (!S || S.dead) return;
    if (Date.now() >= S.roundEnd) return endPileUp();
    UI.resetAdvance();
    S.locked = false;

    // weak-first pick, avoiding the last few codes
    S.code = SRS.pickOne(S.recent.slice(-5)) || SRS.pickOne([]);
    S.recent.push(S.code);

    S.choices = buildChoices(S.code, function (c) { return UI.meaningShort(c); });

    // render prompt (the CODE, large)
    UI.clear(S.els.promptCode);
    S.els.promptCode.appendChild(UI.codeChip(S.code, { big: true }));

    renderPileUpChoices();
    startMeter();
    UI.announce(tt({ pl: 'Kod: ', en: 'Code: ' }) + S.code); // SR users hear the code to match
    setTimeout(function () {
      if (S && !S.dead) UI.focus(S.els.choices.querySelector('.choice'));
    }, 0);
  }

  function renderPileUpChoices() {
    UI.clear(S.els.choices);
    S.choices.forEach(function (opt, i) {
      var btn = UI.el('button', { class: 'choice', type: 'button', dataset: { idx: String(i) } }, [
        UI.el('span', { class: 'choice__key', text: String(i + 1) }),
        UI.el('span', { class: 'choice__txt', lang: UI.lang(), text: opt.label })
      ]);
      btn.addEventListener('click', function () { pickPileUp(i); });
      opt.el = btn;
      S.els.choices.appendChild(btn);
    });
  }

  // S-meter drains over METER_MS via rAF; fraction remaining drives points.
  function startMeter() {
    S.trialStart = (window.performance && performance.now) ? performance.now() : Date.now();
    if (S.meterRaf) { cancelAnimationFrame(S.meterRaf); S.meterRaf = null; }
    S.els.meterFill.style.transform = 'scaleX(1)';
    var step = function () {
      if (!S || S.dead || S.locked) { S.meterRaf = null; return; }
      var frac = meterFraction();
      S.els.meterFill.style.transform = 'scaleX(' + frac + ')';
      if (frac <= 0) { S.meterRaf = null; return pickPileUp(-1); } // timed out
      S.meterRaf = requestAnimationFrame(step);
    };
    S.meterRaf = requestAnimationFrame(step);
  }

  function meterFraction() {
    var nowT = (window.performance && performance.now) ? performance.now() : Date.now();
    var elapsed = nowT - S.trialStart;
    var f = 1 - (elapsed / METER_MS);
    return f < 0 ? 0 : (f > 1 ? 1 : f);
  }

  function pickPileUp(idx) {
    if (!S || S.dead || S.locked) return;
    S.locked = true;
    if (S.meterRaf) { cancelAnimationFrame(S.meterRaf); S.meterRaf = null; }

    var code = S.code;
    var ms = ((window.performance && performance.now) ? performance.now() : Date.now()) - S.trialStart;
    var remainingFraction = meterFraction();
    var picked = (idx >= 0) ? S.choices[idx] : null;
    var isCorrect = !!(picked && picked.correct);
    var timedOut = idx < 0;

    // lock all choices visually (color + icon + text marker)
    S.choices.forEach(function (opt) {
      opt.el.disabled = true;
      opt.el.classList.add('is-disabled');
      if (opt.correct) {
        opt.el.classList.add('is-correct');
        opt.el.insertBefore(UI.icon('check'), opt.el.firstChild);
      } else if (picked && opt === picked) {
        opt.el.classList.add('is-wrong');
        opt.el.insertBefore(UI.icon('cross'), opt.el.firstChild);
      } else {
        opt.el.classList.add('is-dim');
      }
    });

    S.answered++;
    if (isCorrect) {
      SFX.correct();
      SFX.combo(S.combo);
      var comboMult = Math.min(1 + S.combo / 10, 5);
      var points = Math.round(100 * remainingFraction * comboMult);
      S.score += points;
      S.combo++;
      if (S.combo > S.maxCombo) S.maxCombo = S.combo;
      S.correctCount++;
      if (ms < S.fastestMs) { S.fastestMs = ms; S.fastest = code; }
      SRS.recogCorrect(code, ms);
      if (!UI.reducedMotion()) { S.els.promptCode.classList.add('anim-flash'); }
      S.els.score.textContent = String(S.score);
      S.els.combo.textContent = S.combo >= 2 ? ('×' + S.combo) : '';
      if (window.FX) {
        FX.burstAt(picked ? picked.el : S.els.promptCode, {
          color: S.combo >= 3 ? 'combo' : 'ok',
          count: 22 + Math.min(S.combo, 10) * 4,
          power: 0.95 + Math.min(S.combo, 12) * 0.06, size: 10
        });
        if (S.combo % 5 === 0) FX.flash('a1', 0.3);
      }
      UI.announce(t('fb.correct') + ' +' + points + (S.combo >= 2 ? ' · ×' + S.combo : ''));
    } else {
      SFX.wrong();
      S.combo = 0;
      if (S.fumbled.indexOf(code) < 0) S.fumbled.push(code);
      if (picked) SRS.recordConfusion(code, picked.code);
      SRS.recogWrong(code, ms);
      if (!UI.reducedMotion()) { S.els.promptCode.classList.add('anim-shake'); }
      if (window.FX) FX.flash([1, 0.36, 0.36], 0.22); // red miss flash
      S.els.combo.textContent = '';
      UI.announce((timedOut
        ? tt({ pl: 'Czas minął', en: 'Timed out' })
        : t('fb.wrong')) + ' · ' + code + ' = ' + UI.meaningShort(code));
    }
    Store.touchActivity();

    // quick auto-advance to keep the sprint flowing (no manual Next here)
    S.advanceTimer = setTimeout(function () {
      S.advanceTimer = null;
      if (!S || S.dead) return;
      // clear animation hooks so they can re-trigger next time
      S.els.promptCode.classList.remove('anim-flash', 'anim-shake');
      nextPileUp();
    }, NEXT_DELAY);
  }

  function endPileUp() {
    if (!S || S.dead) return;
    clearTimers();
    S.locked = true;
    S.dead = true; // freeze further key handling on the sprint; recap is its own UI

    UI.refreshChrome(); // refresh band map + ring once at the end of the sprint

    var acc = S.answered ? Math.round((S.correctCount / S.answered) * 100) : 0;
    var lang = Store.settings().lang;
    var entry = { callsign: '', score: S.score, maxCombo: S.maxCombo, ts: Date.now() };
    var willPlace = qualifiesForHighScore(lang, S.score);

    var root = UI.el('div', { class: 'mode mode-pileup' }, [
      UI.modeHeader({ title: tt({ pl: 'Koniec rundy', en: 'Round over' }) })
    ]);
    var card = UI.el('div', { class: 'card recap arcade' });

    card.appendChild(UI.el('div', { class: 'recap__big', text: tt({ pl: 'Wynik', en: 'Score' }) + ': ' + S.score }));

    // summary stats
    var stats = UI.el('div', { class: 'home__stats', style: { margin: '0 0 1rem' } }, [
      statPill(tt({ pl: 'Maks. seria', en: 'Max combo' }), '×' + S.maxCombo),
      statPill(tt({ pl: 'Trafność', en: 'Accuracy' }), acc + '%'),
      statPill(tt({ pl: 'Odpowiedzi', en: 'Answers' }), S.correctCount + '/' + S.answered)
    ]);
    if (S.fastest) {
      stats.appendChild(statPill(tt({ pl: 'Najszybszy', en: 'Fastest' }),
        S.fastest + ' (' + (S.fastestMs / 1000).toFixed(1) + 's)'));
    }
    card.appendChild(stats);

    // fumbled list + Send to Flow
    var fumbledRow = UI.el('div', { class: 'recap__row' });
    fumbledRow.appendChild(UI.el('h3', { text: tt({ pl: 'Pomylone', en: 'Fumbled' }) + ' (' + S.fumbled.length + ')' }));
    var chips = UI.el('div', { class: 'recap__chips' });
    if (!S.fumbled.length) {
      chips.appendChild(UI.el('span', { class: 'muted', text: tt({ pl: 'Brak — czysto!', en: 'None — clean!' }) }));
    } else {
      S.fumbled.forEach(function (c) { chips.appendChild(UI.el('span', { class: 'code code--bad', text: c })); });
    }
    fumbledRow.appendChild(chips);
    card.appendChild(fumbledRow);

    // high-score callsign entry (only when it would place in top 5)
    var scoreSavedRef = { done: false };
    if (willPlace) {
      var hsWrap = UI.el('div', { class: 'recap__row' });
      hsWrap.appendChild(UI.el('h3', { text: tt({ pl: 'Nowy najlepszy wynik! Wpisz znak (3 znaki):', en: 'New high score! Enter your callsign (3 chars):' }) }));
      var input = UI.el('input', {
        class: 'input', type: 'text', maxlength: '3', value: '',
        style: { maxWidth: '8rem', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '2px' },
        'aria-label': tt({ pl: 'Znak wywoławczy, 3 znaki', en: 'Callsign, 3 characters' })
      });
      input.addEventListener('input', function () {
        input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
      });
      var saveBtn = UI.btn(tt({ pl: 'Zapisz wynik', en: 'Save score' }), { variant: 'primary' });
      var saveFn = function () {
        if (scoreSavedRef.done) return;
        entry.callsign = (input.value || '---').toUpperCase().slice(0, 3) || '---';
        var place = Store.addHighScore(lang, entry);
        scoreSavedRef.done = true;
        input.disabled = true; saveBtn.disabled = true;
        UI.announce(tt({ pl: 'Zapisano wynik', en: 'Score saved' }) + (place >= 0 ? ' #' + (place + 1) : ''));
        saveBtn.replaceWith(UI.el('span', { class: 'muted', text: tt({ pl: 'Zapisano ✓', en: 'Saved ✓' }) + (place >= 0 ? ' #' + (place + 1) : '') }));
      };
      saveBtn.addEventListener('click', saveFn);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); saveFn(); }
      });
      hsWrap.appendChild(UI.el('div', { class: 'io__row' }, [input, saveBtn]));
      card.appendChild(hsWrap);
    }

    // actions
    var actions = UI.el('div', { class: 'recap__actions' });
    if (S.fumbled.length) {
      var fumbledCopy = S.fumbled.slice();
      actions.appendChild(UI.btn(tt({ pl: 'Wyślij do Flow', en: 'Send to Flow' }), {
        variant: 'ghost', onClick: function () { App.go('flow', { inject: fumbledCopy }); }
      }));
    }
    actions.appendChild(UI.btn(t('recap.again'), { variant: 'primary', onClick: function () { App.go('pileup'); } }));
    actions.appendChild(UI.btn(t('nav.home'), { variant: 'ghost', onClick: function () { App.go('home'); } }));
    card.appendChild(actions);

    root.appendChild(card);
    UI.setScreen(root);
    setTimeout(function () {
      if (willPlace) { var i = root.querySelector('input'); if (i) return UI.focus(i); }
      UI.focusFirst(root);
    }, 0);
  }

  // Would `score` land in the per-language top 5? (read-only; does not mutate)
  function qualifiesForHighScore(lang, score) {
    if (score <= 0) return false;
    var list = (Store.state.highScores && Store.state.highScores[lang]) || [];
    if (list.length < 5) return true;
    var min = list.reduce(function (m, e) { return Math.min(m, e.score); }, Infinity);
    return score > min;
  }

  function statPill(label, value) {
    return UI.el('div', { class: 'pill' }, [
      UI.el('span', { class: 'pill__v', text: String(value) }),
      UI.el('span', { class: 'pill__l', text: label })
    ]);
  }

  function onKeyPileUp(e) {
    if (!S || S.dead) return;
    if (S.locked) return; // auto-advances; Enter not needed mid-sprint
    if (e.key >= '1' && e.key <= '4') {
      var idx = parseInt(e.key, 10) - 1;
      if (idx < S.choices.length) { e.preventDefault(); pickPileUp(idx); }
    }
  }

  // ------------------------------------------------------------------
  // SUB-MODE B — Exam (no timer; 28 codes once each; 75% pass mark)
  // ------------------------------------------------------------------
  function startExam() {
    S = {
      mode: 'exam', dead: false,
      queue: SRS.shuffle(window.QCODE_LIST.slice()),
      idx: 0, total: window.QCODE_LIST.length,
      correctCount: 0,
      results: {},            // code -> bool (this attempt)
      order: [],              // codes in the order asked (for the report grid)
      code: null, dir: 'meaning', choices: null, locked: false,
      t0: 0,
      clockTimer: null, meterRaf: null, advanceTimer: null,
      els: {}
    };

    S.header = UI.modeHeader({ title: tt({ pl: 'Egzamin', en: 'Exam' }), progressText: '0 / ' + S.total });
    S.bar = UI.progressBar(0);

    var promptQ = UI.el('div', { class: 'prompt-card__q' });
    var promptMain = UI.el('div', { class: 'prompt-card__main' });
    S.card = UI.el('div', { class: 'card prompt-card' }, [promptQ, promptMain]);
    S.choicesEl = UI.el('div', { class: 'choices' });
    S.answers = UI.el('div', { class: 'answers' }, [S.choicesEl]);

    S.els = { promptQ: promptQ, promptMain: promptMain };

    var root = UI.el('div', { class: 'mode mode-exam' }, [S.header, S.bar, S.card, S.answers]);
    UI.setScreen(root);
    nextExam();
  }

  function setExamProgress() {
    var pr = S.header.querySelector('.modehead__progress span');
    if (pr) pr.textContent = S.idx + ' / ' + S.total;
    S.bar.update(S.total ? S.idx / S.total : 0);
  }

  function nextExam() {
    if (!S || S.dead) return;
    UI.resetAdvance();
    if (S.idx >= S.queue.length) return endExam();
    S.locked = false;
    S.code = S.queue[S.idx];
    // randomly ask: meaning of code (1) OR which code means … (2)
    S.dir = Math.random() < 0.5 ? 'meaning' : 'code';
    S.t0 = Date.now();
    renderExamPrompt();
    setExamProgress();
    UI.announce(S.dir === 'meaning'
      ? tt({ pl: 'Co oznacza ', en: 'What does ' }) + S.code + tt({ pl: '?', en: '?' })
      : tt({ pl: 'Który kod oznacza: ', en: 'Which code means: ' }) + UI.meaningShort(S.code));
    setTimeout(function () {
      if (S && !S.dead) UI.focus(S.choicesEl.querySelector('.choice'));
    }, 0);
  }

  function renderExamPrompt() {
    UI.clear(S.els.promptMain);
    UI.clear(S.choicesEl);

    if (S.dir === 'meaning') {
      // show the CODE, ask the meaning
      S.els.promptQ.textContent = tt({ pl: 'Co oznacza ' + S.code + '?', en: 'What does ' + S.code + ' mean?' });
      S.els.promptMain.appendChild(UI.codeChip(S.code, { big: true }));
      S.choices = buildChoices(S.code, function (c) { return UI.meaningShort(c); });
      renderExamChoices(UI.lang());
    } else {
      // show a meaning, ask the CODE
      S.els.promptQ.textContent = tt({ pl: 'Który kod oznacza:', en: 'Which code means:' });
      S.els.promptMain.appendChild(UI.el('div', { class: 'prompt-card__meaning', lang: UI.lang(), text: UI.meaningShort(S.code) }));
      S.choices = buildChoices(S.code, function (c) { return c; });
      renderExamChoices(null);
    }
  }

  function renderExamChoices(labelLang) {
    S.choices.forEach(function (opt, i) {
      var txtAttrs = { class: 'choice__txt', text: opt.label };
      if (labelLang) txtAttrs.lang = labelLang;
      var btn = UI.el('button', { class: 'choice', type: 'button', dataset: { idx: String(i) } }, [
        UI.el('span', { class: 'choice__key', text: String(i + 1) }),
        UI.el('span', txtAttrs)
      ]);
      btn.addEventListener('click', function () { pickExam(i); });
      opt.el = btn;
      S.choicesEl.appendChild(btn);
    });
  }

  function pickExam(idx) {
    if (!S || S.dead || S.locked) return;
    if (idx < 0 || idx >= S.choices.length) return;
    S.locked = true;

    var code = S.code;
    var ms = Date.now() - S.t0;
    var picked = S.choices[idx];
    var isCorrect = !!picked.correct;

    // lock + mark every choice (color + icon + text)
    S.choices.forEach(function (opt) {
      opt.el.disabled = true;
      opt.el.classList.add('is-disabled');
      if (opt.correct) {
        opt.el.classList.add('is-correct');
        opt.el.insertBefore(UI.icon('check'), opt.el.firstChild);
      } else if (opt === picked) {
        opt.el.classList.add('is-wrong');
        opt.el.insertBefore(UI.icon('cross'), opt.el.firstChild);
      } else {
        opt.el.classList.add('is-dim');
      }
    });

    S.results[code] = isCorrect;
    if (S.order.indexOf(code) < 0) S.order.push(code);

    if (isCorrect) {
      S.correctCount++;
      SFX.correct();
      SRS.recogCorrect(code, ms);
    } else {
      SFX.wrong();
      if (S.dir === 'meaning' && picked.code) SRS.recordConfusion(code, picked.code);
      SRS.recogWrong(code, ms);
    }
    Store.touchActivity();
    UI.refreshChrome();

    // feedback panel with a Next button (Enter advances via UI.advance())
    var lines = [];
    var co = window.QCODE_BY[code];
    lines.push(UI.el('div', { class: 'feedback__line' }, [
      UI.codeChip(code), document.createTextNode(' — '),
      UI.el('span', { lang: UI.lang(), text: UI.meaningShort(code) })
    ]));
    if (co && co.ex) {
      lines.push(UI.el('div', { class: 'feedback__line' }, [
        UI.el('span', { class: 'reveal__label', text: t('reveal.ex') + ': ' }),
        UI.el('span', { class: 'mono', text: co.ex })
      ]));
    }
    var mnem = null;
    if (!isCorrect && picked && picked.code) {
      var m = window.qcodeMnemonic(code, picked.code);
      if (m) mnem = tt(m);
    }

    S.idx++;
    var panel = UI.feedback({
      correct: isCorrect,
      headline: isCorrect ? t('fb.correct') : t('fb.wrong'),
      lines: lines,
      mnemonic: mnem,
      onNext: nextExam,
      nextLabel: (S.idx >= S.total) ? t('common.done') : t('fb.next')
    });
    S.answers.appendChild(panel);

    UI.announce((isCorrect ? t('fb.correct') : t('fb.wrong')) + ' · ' + code + ' = ' + UI.meaningShort(code));
    setExamProgress();
  }

  function endExam() {
    if (!S || S.dead) return;
    S.dead = true;
    clearTimers();

    var score = S.correctCount, total = S.total;
    var passed = (total ? score / total : 0) >= 0.75; // >= 21/28
    var wasPassed = !!(Store.state.exam && Store.state.exam.passed);
    var prevBest = (Store.state.exam && typeof Store.state.exam.bestScore === 'number') ? Store.state.exam.bestScore : null;
    Store.state.exam = {
      bestScore: (prevBest == null) ? score : Math.max(prevBest, score),
      passed: passed || wasPassed,
      lastTs: Date.now()
    };
    Store.state.stats.sessionsCompleted++;
    Store.save();
    UI.refreshChrome();
    if (passed && window.FX) FX.celebrate();

    var root = UI.el('div', { class: 'mode mode-exam' }, [
      UI.modeHeader({ title: tt({ pl: 'Wynik egzaminu', en: 'Exam result' }) })
    ]);
    var card = UI.el('div', { class: 'card recap center' });

    card.appendChild(UI.el('div', { class: 'recap__big', text: score + ' / ' + total }));

    // pass / fail badge — icon + text + color (never color alone)
    var badge = UI.el('div', {
      class: 'feedback ' + (passed ? 'feedback--ok' : 'feedback--bad'),
      role: 'status', style: { display: 'inline-flex', margin: '0 auto .9rem' }
    }, [
      UI.el('div', { class: 'feedback__head' }, [
        UI.icon(passed ? 'check' : 'cross'),
        UI.el('span', { class: 'feedback__title', text: passed ? t('dash.exam.passed') : tt({ pl: 'NIEZALICZONE', en: 'NOT PASSED' }) })
      ])
    ]);
    card.appendChild(badge);
    card.appendChild(UI.el('p', { class: 'muted', text: tt({ pl: 'Próg zaliczenia: 21/28 (75%).', en: 'Pass mark: 21/28 (75%).' }) }));

    // 28-cell report card grid (green correct / red wrong) — icon-backed for non-color cue
    var grid = UI.el('div', {
      class: 'report',
      role: 'list',
      'aria-label': tt({ pl: 'Karta wyników', en: 'Report card' }),
      style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px', margin: '1rem 0' }
    });
    S.order.forEach(function (code) {
      var ok = !!S.results[code];
      var cell = UI.el('div', {
        class: 'code code--dot code--' + (ok ? 'ok' : 'bad'),
        role: 'listitem',
        'aria-label': code + ' — ' + (ok ? t('fb.correct') : t('fb.wrong')),
        title: code + ' — ' + UI.meaningShort(code),
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0',
          padding: '.35rem .1rem', borderRadius: 'var(--r-sm)',
          border: '1px solid var(--border)', fontSize: '.78rem'
        }
      }, [document.createTextNode(code)]);
      grid.appendChild(cell);
    });
    card.appendChild(grid);

    // actions
    var fumbled = S.order.filter(function (c) { return !S.results[c]; });
    var actions = UI.el('div', { class: 'recap__actions', style: { justifyContent: 'center' } });
    if (fumbled.length) {
      actions.appendChild(UI.btn(tt({ pl: 'Wyślij do Flow', en: 'Send to Flow' }), {
        variant: 'ghost', onClick: function () { App.go('flow', { inject: fumbled }); }
      }));
    }
    actions.appendChild(UI.btn(tt({ pl: 'Powtórz', en: 'Retry' }), { variant: 'primary', onClick: function () { App.go('exam'); } }));
    actions.appendChild(UI.btn(t('nav.home'), { variant: 'ghost', onClick: function () { App.go('home'); } }));
    card.appendChild(actions);

    root.appendChild(card);
    UI.setScreen(root);
    setTimeout(function () { UI.focusFirst(root); }, 0);
  }

  function onKeyExam(e) {
    if (!S || S.dead) return;
    if (S.locked) {
      if (e.key === 'Enter') { e.preventDefault(); UI.advance(); }
      return;
    }
    if (e.key >= '1' && e.key <= '4') {
      var idx = parseInt(e.key, 10) - 1;
      if (idx < S.choices.length) { e.preventDefault(); pickExam(idx); }
    }
  }

  // ------------------------------------------------------------------
  // Lifecycle dispatch
  // ------------------------------------------------------------------
  function start(host, ctx) {
    ctx = ctx || {};
    if (ctx.exam === true) startExam();
    else startPileUp();
  }

  function stop() {
    if (S) {
      S.dead = true;
      clearTimers();
    }
  }

  function onKey(e) {
    if (!S || S.dead) return;
    if (S.mode === 'exam') return onKeyExam(e);
    return onKeyPileUp(e);
  }

  return { id: 'pileup', start: start, stop: stop, onKey: onKey };
})();
