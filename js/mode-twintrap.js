// ============================================================
// Mode: Twin Trap — 2-alternative forced choice on confusable pairs.
// Kills interference errors between look-alike / opposite codes.
// Mirrors mode-flow.js: start/stop/onKey lifecycle, UI.* helpers,
// SRS.* recognition grading (box capped at 2), focus management,
// aria-live announcements, reduced-motion respect, timer cleanup.
// ============================================================
window.ModeTwinTrap = (function () {
  'use strict';
  var S = null;            // per-session state
  var ROUND = 12;          // trials per round
  var TIMER_MS = 5000;     // optional per-trial timer (~5s)

  // ---- cluster weighting: weaker pairs surface more often ----
  // For each confusable cluster, build a weight from member SRS accuracy
  // (weak = high weight) plus recorded confusions among the members.
  function clusterWeight(cluster) {
    var w = 0, i, j;
    for (i = 0; i < cluster.length; i++) {
      var acc = SRS.accuracy(cluster[i]);          // 0..1
      var seen = Store.code(cluster[i]).seen;
      // unseen / never-graded codes treated as moderately weak
      var weakness = (seen > 0) ? (1 - acc) : 0.5;
      w += 0.4 + 2.2 * weakness;
    }
    // boost by confusions logged between members of this cluster
    var m = Store.state.confusionMatrix || {};
    for (i = 0; i < cluster.length; i++) {
      var row = m[cluster[i]];
      if (!row) continue;
      for (j = 0; j < cluster.length; j++) {
        if (i === j) continue;
        w += 1.5 * (row[cluster[j]] || 0);
      }
    }
    return Math.max(0.2, w);
  }

  // weighted random pick of a cluster
  function pickCluster() {
    var clusters = window.QCODE_DATA.confusables;
    var weights = clusters.map(clusterWeight);
    var total = 0, i;
    for (i = 0; i < weights.length; i++) total += weights[i];
    var r = Math.random() * total, acc = 0;
    for (i = 0; i < weights.length; i++) {
      acc += weights[i];
      if (r <= acc) return clusters[i];
    }
    return clusters[clusters.length - 1];
  }

  // choose the two candidate codes for this trial from a (2- or 3-member) cluster
  function pickPair() {
    var cluster = pickCluster();
    if (cluster.length <= 2) return cluster.slice();
    var shuffled = SRS.shuffle(cluster);
    return [shuffled[0], shuffled[1]];
  }

  // ---- lifecycle ----
  function start(host, ctx) {
    S = {
      trial: 0,                 // 0-based index of current trial
      correct: 0,               // number answered correctly
      results: [],              // [{pair:[a,b], target, picked, ok}]
      pair: null, target: null, options: null, useExample: false,
      answered: false,
      t0: 0,
      raf: null,                // requestAnimationFrame id (timer)
      timerStart: 0,
      barFill: null,
      dead: false
    };
    S.header = UI.modeHeader({
      title: tt({ pl: 'Bliźniacze pułapki', en: 'Twin Trap' }),
      progressText: '0 / ' + ROUND
    });
    S.bar = UI.progressBar(0);
    S.card = UI.el('div', { class: 'card prompt-card' });
    S.answers = UI.el('div', { class: 'answers' });
    var root = UI.el('div', { class: 'mode mode-twintrap' }, [S.header, S.bar, S.card, S.answers]);
    UI.setScreen(root);
    next();
  }

  function stop() {
    if (S) { S.dead = true; clearTimer(); }
  }

  function setProgress() {
    var done = S.trial; // trials fully answered so far
    var pr = S.header.querySelector('.modehead__progress span');
    if (pr) pr.textContent = done + ' / ' + ROUND;
    S.bar.update(done / ROUND);
  }

  // ---- per-trial render ----
  function next() {
    if (S.dead) return;
    UI.resetAdvance();
    clearTimer();
    if (S.trial >= ROUND) return recap();
    S.pair = pickPair();
    S.target = S.pair[Math.random() < 0.5 ? 0 : 1];
    S.options = SRS.shuffle(S.pair);
    S.answered = false;
    // ~40% of trials use the on-air usage example, otherwise the short meaning.
    // Guard: never use the example when it is just the bare code (e.g. ex "QRO"),
    // which would print the answer above the two code buttons.
    var ex = UI.example(S.target);
    S.useExample = Math.random() < 0.4 && !!ex && ex.trim().toUpperCase() !== S.target.toUpperCase();
    S.t0 = Date.now();
    renderPrompt();
    setProgress();
  }

  function renderPrompt() {
    UI.clear(S.card); UI.clear(S.answers);

    S.card.appendChild(UI.el('div', { class: 'prompt-card__q',
      text: tt({ pl: 'Który kod pasuje?', en: 'Which code fits?' }) }));

    if (S.useExample) {
      S.card.appendChild(UI.el('div', { class: 'prompt-card__ex' }, [
        UI.el('span', { class: 'mono mono--big', text: UI.example(S.target) })
      ]));
    } else {
      S.card.appendChild(UI.el('div', { class: 'prompt-card__meaning', lang: UI.lang(),
        text: UI.meaningShort(S.target) }));
    }

    // optional draining timer bar (functional even under reduced motion)
    if (Store.settings().twinTrapTimer) {
      S.barFill = UI.el('div', { class: 'smeter__fill', style: { width: '100%' } });
      var meter = UI.el('div', {
        class: 'smeter', role: 'timer',
        'aria-label': tt({ pl: 'Pozostały czas', en: 'Time remaining' })
      }, [S.barFill]);
      S.card.appendChild(meter);
    } else {
      S.barFill = null;
    }

    // two big code buttons in a .twin grid
    var twin = UI.el('div', { class: 'twin' });
    S.options.forEach(function (code, idx) {
      var key = String(idx + 1); // "1" left, "2" right
      var b = UI.el('button', {
        type: 'button', class: 'choice', dataset: { code: code },
        'aria-label': key + ': ' + code
      }, [
        UI.el('span', { class: 'choice__key', text: key }),
        UI.el('span', { class: 'choice__txt', text: code })
      ]);
      b.addEventListener('click', function () { answer(code); });
      twin.appendChild(b);
    });
    S.answers.appendChild(twin);

    setTimeout(function () { if (S && !S.dead) UI.focus(S.answers.querySelector('.choice')); }, 0);
    UI.announce(S.useExample
      ? tt({ pl: 'Który kod pasuje do: ', en: 'Which code fits: ' }) + UI.example(S.target)
      : tt({ pl: 'Który kod znaczy: ', en: 'Which code means: ' }) + UI.meaningShort(S.target));

    if (Store.settings().twinTrapTimer) startTimer();
  }

  // ---- timer (requestAnimationFrame; id stored on S, cleared in stop/answer) ----
  function startTimer() {
    S.timerStart = Date.now();
    var tick = function () {
      if (!S || S.dead || S.answered) return;
      var elapsed = Date.now() - S.timerStart;
      var frac = Math.max(0, 1 - elapsed / TIMER_MS);
      if (S.barFill) S.barFill.style.width = (frac * 100) + '%';
      if (elapsed >= TIMER_MS) { S.raf = null; timeout(); return; }
      S.raf = window.requestAnimationFrame(tick);
    };
    S.raf = window.requestAnimationFrame(tick);
  }
  function clearTimer() {
    if (S && S.raf != null) { window.cancelAnimationFrame(S.raf); S.raf = null; }
  }

  function timeout() {
    if (!S || S.dead || S.answered) return;
    answer(null); // no pick -> treated as wrong
  }

  // ---- answering ----
  function answer(pickedCode) {
    if (!S || S.dead || S.answered) return;
    S.answered = true;
    clearTimer();
    if (S.barFill) S.barFill.style.width = '0%';

    var ms = Date.now() - S.t0;
    var target = S.target;
    var ok = (pickedCode === target);

    // paint the two choices: chosen one ok/wrong, the answer always marked correct
    var btns = S.answers.querySelectorAll('.choice');
    Array.prototype.forEach.call(btns, function (b) {
      var c = b.dataset.code;
      b.disabled = true;
      b.classList.add('is-disabled');
      if (c === target) {
        b.classList.add('is-correct');
        b.appendChild(UI.icon('check'));
      } else if (c === pickedCode) {
        b.classList.add('is-wrong');
        b.appendChild(UI.icon('cross'));
      } else {
        b.classList.add('is-dim');
      }
    });

    // grading: recognition (box capped at 2)
    if (ok) {
      SRS.recogCorrect(target, ms);
      S.correct++;
      if (Store.settings().sound) SFX.correct();
    } else {
      SRS.recogWrong(target, ms);
      if (pickedCode) SRS.recordConfusion(target, pickedCode); // shown target, picked wrong
      if (Store.settings().sound) SFX.wrong();
    }

    // decorative animation only when full motion
    if (!UI.reducedMotion()) {
      if (ok) {
        var hit = S.answers.querySelector('.choice.is-correct');
        if (hit) hit.classList.add('anim-flash');
      } else {
        var wr = S.answers.querySelector('.choice.is-wrong') || S.answers.querySelector('.twin');
        if (wr) wr.classList.add('anim-shake');
      }
    }

    S.results.push({ pair: S.pair.slice(), target: target, picked: pickedCode, ok: ok });
    S.trial++;

    Store.touchActivity();
    UI.refreshChrome();
    UI.announce(target + ' · ' + (ok ? t('fb.correct') : t('fb.wrong')) + ' · ' + t('status.' + SRS.status(target)));

    showFeedback(ok, pickedCode);
    setProgress();
  }

  function showFeedback(ok, pickedCode) {
    var a = S.pair[0], b = S.pair[1];
    var mn = window.qcodeMnemonic(a, b);
    var lines = [];

    // always restate the prompt's answer with its meaning
    lines.push(UI.el('div', { class: 'feedback__line' }, [
      UI.codeChip(S.target), document.createTextNode(' = ' + UI.meaningShort(S.target))
    ]));

    if (!ok) {
      if (pickedCode) {
        lines.push(UI.el('div', { class: 'feedback__line muted' }, [
          UI.codeChip(pickedCode), document.createTextNode(' = ' + UI.meaningShort(pickedCode))
        ]));
      } else {
        lines.push(UI.el('div', { class: 'feedback__line muted',
          text: tt({ pl: 'Czas minął — brak odpowiedzi.', en: 'Time ran out — no answer.' }) }));
      }
    }

    var panel = UI.feedback({
      correct: ok,
      lines: lines,
      mnemonic: mn ? tt(mn) : null,
      onNext: next
    });
    S.answers.appendChild(panel);
  }

  // ---- recap ----
  function recap() {
    clearTimer();
    Store.state.stats.sessionsCompleted++;
    Store.save();

    var root = UI.el('div', { class: 'mode mode-twintrap' }, [
      UI.modeHeader({ title: tt({ pl: 'Bliźniacze pułapki', en: 'Twin Trap' }) })
    ]);
    var card = UI.el('div', { class: 'card recap' });
    card.appendChild(UI.el('div', { class: 'recap__big', text: S.correct + ' / ' + ROUND }));
    card.appendChild(UI.el('div', { class: 'center muted',
      style: { marginBottom: '.8rem' },
      text: tt({ pl: 'Rozegrane pułapki:', en: 'Pairs drilled:' }) }));

    var list = UI.el('div', { class: 'recap__row' });
    S.results.forEach(function (r) {
      var kind = r.ok ? 'ok' : 'bad';
      var row = UI.el('div', {
        class: 'choice is-' + (r.ok ? 'correct' : 'wrong') + ' is-disabled',
        style: { cursor: 'default' }
      }, [
        UI.icon(r.ok ? 'check' : 'cross'),
        UI.el('span', { class: 'choice__txt' }, [
          UI.el('span', { class: 'mono', text: r.pair[0] + ' / ' + r.pair[1] }),
          document.createTextNode('  ·  '),
          UI.el('span', { class: 'code code--' + kind, text: r.target }),
          document.createTextNode(
            r.ok ? '' : (r.picked
              ? '  ' + tt({ pl: 'wybrano', en: 'picked' }) + ' ' + r.picked
              : '  ' + tt({ pl: '(brak)', en: '(none)' }))
          )
        ])
      ]);
      list.appendChild(row);
    });
    card.appendChild(list);

    card.appendChild(UI.el('div', { class: 'recap__actions' }, [
      UI.btn(t('recap.again'), { variant: 'primary', onClick: function () { start(UI.screen(), {}); } }),
      UI.btn(t('nav.home'), { variant: 'ghost', onClick: function () { App.go('home'); } })
    ]));
    root.appendChild(card);
    UI.setScreen(root);
    UI.announce(t('recap.title') + ' · ' + S.correct + ' / ' + ROUND);
    setTimeout(function () { if (S && !S.dead) UI.focusFirst(root); }, 0);
  }

  // ---- keyboard ----
  function onKey(e) {
    if (!S || S.dead) return;
    // after an answer, Enter advances to the next trial
    if (S.answered) {
      if (e.key === 'Enter') { e.preventDefault(); UI.advance(); }
      return;
    }
    var btns = S.answers ? S.answers.querySelectorAll('.choice') : [];
    if (e.key === '1' || e.key === 'ArrowLeft') {
      if (btns[0]) { e.preventDefault(); answer(btns[0].dataset.code); }
    } else if (e.key === '2' || e.key === 'ArrowRight') {
      if (btns[1]) { e.preventDefault(); answer(btns[1].dataset.code); }
    }
  }

  return { id: 'twintrap', start: start, stop: stop, onKey: onKey };
})();
