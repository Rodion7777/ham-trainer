// ============================================================
// Mode: Fading Signals — "Zaniki" (arcade catcher).
// Labelled chips fall down lanes; slide the TUNER to catch the chip matching
// the prompt and let the decoys fall past. Waves, lives, combo, high scores.
// Weak codes fall more often (SRS-weighted) so the arcade IS targeted study.
// Single rAF owns all motion; pooled DOM chips; strict teardown in stop().
// A reduced-motion CALM branch renders the same lock as a self-paced MCQ.
// ============================================================
window.ModeArcade = (function () {
  'use strict';
  var S = null;
  var raf = window.requestAnimationFrame, caf = window.cancelAnimationFrame;
  var CHIPH = 48, LOCKS_PER_WAVE = 6, START_LIVES = 3, POOL = 5;
  var FAM = { freq: 'f', offset: 'f', time: 't', wait: 't', question: 'a', callsign: 'a' };
  function fam(k) { return FAM[k] || k; }
  function kindLabel(k) { var o = window.QCODE_ARG_KINDS[k]; return UI.lang() === 'pl' ? o.pl : o.en; }
  function nowMs() { try { return performance.now(); } catch (e) { return Date.now(); } }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rangeArr(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }
  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { if (x != null && !s[x]) { s[x] = 1; o.push(x); } }); return o; }

  // ---------- lifecycle ----------
  function start(host, ctx) {
    S = {
      dead: false, state: 'ready', motion: !UI.reducedMotion(),
      score: 0, combo: 0, maxCombo: 0, lives: START_LIVES, wave: 1,
      lockInWave: 0, totalLocks: 0, correctLocks: 0, waveMisses: 0,
      recent: [], fumbled: [], chips: [], pool: [],
      lanes: 3, laneW: 0, chipW: 0, fieldW: 0, fieldH: 0, bandH: 76,
      tunerLane: 0, rafId: 0, timers: [], lastT: 0, lockResolved: false,
      fallSpeed: 120, lock: null, els: {}, ptrBound: false
    };
    var root = UI.el('div', { class: 'mode arcade' });
    // HUD
    S.els.score = UI.el('span', { class: 'hud__score', text: '0' });
    S.els.combo = UI.el('span', { class: 'hud__combo' });
    S.els.wave = UI.el('span', { class: 'arcade-wave' });
    S.els.lives = UI.el('span', { class: 'arcade-lives' });
    var hud = UI.el('div', { class: 'hud' }, [
      UI.el('span', {}, [S.els.score, S.els.combo]),
      UI.el('span', {}, [S.els.wave, document.createTextNode(' '), S.els.lives])
    ]);
    S.els.meterFill = UI.el('div', { class: 'smeter__fill', style: { transform: 'scaleX(0)' } });
    var meter = UI.el('div', { class: 'smeter', 'aria-hidden': 'true' }, [S.els.meterFill]);
    // prompt readout (the stable, full-length prompt — long strings never ride a moving chip)
    S.els.readout = UI.el('div', { class: 'arcade-readout', 'aria-live': 'off' });
    // play field
    S.els.field = UI.el('div', { class: 'arcade-field', role: 'group', 'aria-label': tt({ pl: 'Pole gry', en: 'Play field' }), tabindex: '-1' });
    S.els.header = UI.modeHeader({ title: tt({ pl: 'Zaniki (arcade)', en: 'Fading Signals (arcade)' }) });
    root.appendChild(S.els.header);
    root.appendChild(hud);
    root.appendChild(meter);
    root.appendChild(S.els.readout);
    root.appendChild(S.els.field);
    UI.setScreen(root);
    updateHUD();
    renderIntro();
  }

  function stop() {
    if (!S) return;
    S.dead = true;
    if (S.rafId) { caf(S.rafId); S.rafId = 0; }
    clearTimers();
    unbindPointer();
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('resize', onResize);
  }

  function clearTimers() { if (S) { S.timers.forEach(function (id) { clearTimeout(id); }); S.timers = []; } }
  function later(fn, ms) {
    var id = setTimeout(function () {
      if (!S) return;
      var i = S.timers.indexOf(id); if (i >= 0) S.timers.splice(i, 1);
      if (S.dead) return; fn();
    }, ms);
    S.timers.push(id); return id;
  }

  // ---------- intro ----------
  function renderIntro() {
    var f = S.els.field; UI.clear(f);
    var card = UI.el('div', { class: 'arcade-intro' }, [
      UI.el('div', { class: 'arcade-intro__title', text: tt({ pl: 'Łap sygnał', en: 'Catch the signal' }) }),
      UI.el('p', { class: 'muted', text: S.motion
        ? tt({ pl: 'Przesuwaj tuner (strzałki / mysz / dotyk), aby złapać właściwy kod. Klawisze 1–5 łapią od razu. Unikaj błędnych. Masz 3 życia.', en: 'Slide the tuner (arrows / mouse / touch) to catch the right code. Keys 1–5 catch instantly. Avoid the wrong ones. 3 lives.' })
        : tt({ pl: 'Tryb spokojny: wybierz właściwą odpowiedź (klik / 1–5). Bez ruchu i czasu.', en: 'Calm mode: pick the right answer (click / 1–5). No motion, no timer.' }) }),
      UI.btn(tt({ pl: 'Stroję — start', en: 'Tune in — start' }), { variant: 'primary', class: 'arcade-start', onClick: beginPlay })
    ]);
    if (S.motion) {
      card.appendChild(UI.el('p', { class: 'muted', style: { fontSize: '.82rem' } }, [
        document.createTextNode(tt({ pl: 'Wolisz spokojniej? ', en: 'Prefer something calmer? ' })),
        UI.btn(tt({ pl: 'Flow', en: 'Flow' }), { variant: 'ghost', onClick: function () { App.go('flow'); } })
      ]));
    }
    f.appendChild(card);
    later(function () { var b = f.querySelector('.arcade-start'); if (b) UI.focus(b); }, 0);
  }

  // ---------- geometry ----------
  function measure() {
    var f = S.els.field;
    S.fieldW = f.clientWidth || 320;
    S.fieldH = f.clientHeight || 360;
    S.lanes = clamp(Math.floor(S.fieldW / 108), 3, POOL);
    S.laneW = S.fieldW / S.lanes;
    S.chipW = Math.max(64, S.laneW - 12);
    S.tunerLane = clamp(S.tunerLane, 0, S.lanes - 1);
  }
  function laneX(lane) { return lane * S.laneW + (S.laneW - S.chipW) / 2; }
  function bandTop() { return S.fieldH - S.bandH; }

  function onResize() { if (!S || S.dead) return; measure(); positionTuner(); positionBand(); }

  // ---------- pool ----------
  function buildPool() {
    var f = S.els.field;
    for (var i = 0; i < POOL; i++) {
      var key = UI.el('span', { class: 'arcade-chip__key' });
      var txt = UI.el('span', { class: 'arcade-chip__txt' });
      var el = UI.el('button', { type: 'button', class: 'arcade-chip', style: { display: 'none' } }, [key, txt]);
      var chip = { el: el, key: key, txt: txt, lane: 0, correct: false, code: null, kind: null, resolved: true, y: 0, bornAt: 0, fallSpeed: 0, phase: 0, active: false };
      (function (c) {
        el.addEventListener('pointerdown', function (e) { e.stopPropagation(); e.preventDefault(); tryCatch(c); });
      })(chip);
      f.appendChild(el);
      S.pool.push(chip);
    }
    // tuner + band guides (motion only)
    S.els.tuner = UI.el('div', { class: 'arcade-tuner', 'aria-hidden': 'true', style: { display: S.motion ? '' : 'none', width: S.chipW + 'px', height: S.bandH + 'px' } });
    S.els.band = UI.el('div', { class: 'arcade-band', 'aria-hidden': 'true', style: { display: S.motion ? '' : 'none' } });
    f.appendChild(S.els.band);
    f.appendChild(S.els.tuner);
    positionTuner(); positionBand();
  }
  function positionTuner() { if (S.els.tuner) { S.els.tuner.style.width = S.chipW + 'px'; S.els.tuner.style.height = S.bandH + 'px'; S.els.tuner.style.transform = 'translateX(' + laneX(S.tunerLane) + 'px)'; } }
  function positionBand() { if (S.els.band) S.els.band.style.top = bandTop() + 'px'; }

  // ---------- begin ----------
  function beginPlay() {
    if (Store.settings().sound) SFX.ensure();
    UI.clear(S.els.field);
    measure();
    buildPool();
    bindPointer();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('resize', onResize);
    S.state = 'playing';
    if (S.motion) { S.lastT = nowMs(); S.rafId = raf(loop); }
    startLock();
    later(function () { UI.focus(S.els.field); }, 0);
  }

  function onVis() { if (S && !S.dead) S.lastT = nowMs(); } // resume without teleporting chips

  // ---------- lock building (shared by both branches) ----------
  function simultCount(dir) {
    var base = S.wave < 2 ? 3 : (S.wave < 4 ? 4 : 5);
    if (dir === 'code' || dir === 'format') base = Math.min(base, 4);
    return Math.max(2, Math.min(base, S.lanes));
  }
  function nextDirection() {
    if (S.wave >= 2 && (S.totalLocks % 3 === 2)) return 'format';
    return (S.totalLocks % 2 === 0) ? 'meaning' : 'code';
  }
  function buildLock() {
    var dir = nextDirection();
    var answer = SRS.pickOne(S.recent.slice(-5)) || SRS.pickOne([]) || window.QCODE_LIST[0];
    S.recent.push(answer); if (S.recent.length > 12) S.recent.shift();
    var simult = simultCount(dir);
    var options = [];
    if (dir === 'meaning') {
      var codes = uniq([answer].concat(SRS.distractors(answer, simult))).slice(0, simult);
      codes.forEach(function (code) { options.push({ label: code, code: code, kind: 'code', correct: code === answer }); });
    } else if (dir === 'code') {
      var codes2 = uniq([answer].concat(SRS.distractors(answer, simult))).slice(0, simult);
      codes2.forEach(function (code) { options.push({ label: UI.meaningShort(code), code: code, kind: 'meaning', correct: code === answer }); });
    } else {
      var ck = window.QCODE_BY[answer].arg.kind;
      var kinds = Object.keys(window.QCODE_ARG_KINDS).filter(function (k) { return k !== 'level9'; });
      var others = SRS.shuffle(kinds.filter(function (k) { return k !== ck && fam(k) !== fam(ck); })).slice(0, simult - 1);
      if (ck === 'level' && others.indexOf('level9') < 0) others[others.length - 1] = 'level9';
      uniq([ck].concat(others)).slice(0, simult).forEach(function (k) { options.push({ label: kindLabel(k), code: null, kind: 'format', correct: k === ck }); });
    }
    if (!options.some(function (o) { return o.correct; })) options[0].correct = true;
    // assign distinct lanes; correct chip to a random chosen lane
    var lanesArr = SRS.shuffle(rangeArr(S.lanes)).slice(0, options.length);
    var ci = Math.floor(Math.random() * options.length);
    var correctLane = lanesArr[ci];
    var rest = lanesArr.filter(function (l) { return l !== correctLane; }), ri = 0;
    options.forEach(function (o) { o.lane = o.correct ? correctLane : rest[ri++]; });
    return { answer: answer, dir: dir, options: options };
  }

  function renderReadout(lock, reveal) {
    var r = S.els.readout; UI.clear(r);
    var code = lock.answer;
    if (reveal) {
      r.appendChild(UI.el('span', { class: 'code', text: code }));
      r.appendChild(document.createTextNode(' = '));
      r.appendChild(UI.el('span', { lang: UI.lang(), text: UI.meaningShort(code) }));
      return;
    }
    if (lock.dir === 'meaning') {
      r.appendChild(UI.el('span', { class: 'arcade-readout__lbl', text: tt({ pl: 'Złap kod dla: ', en: 'Catch the code for: ' }) }));
      r.appendChild(UI.el('span', { class: 'arcade-readout__big', lang: UI.lang(), text: UI.meaningShort(code) }));
    } else if (lock.dir === 'code') {
      r.appendChild(UI.el('span', { class: 'arcade-readout__lbl', text: tt({ pl: 'Złap znaczenie: ', en: 'Catch the meaning of: ' }) }));
      r.appendChild(UI.codeChip(code, { big: true }));
    } else {
      r.appendChild(UI.el('span', { class: 'arcade-readout__lbl', text: tt({ pl: 'Co podaje się po: ', en: 'What follows: ' }) }));
      r.appendChild(UI.codeChip(code, { big: true }));
    }
  }

  // ---------- start one lock ----------
  function startLock() {
    if (S.dead) return;
    S.state = 'playing';
    S.lockResolved = false;
    S.lock = buildLock();
    renderReadout(S.lock, false);
    if (S.els.readout) S.els.readout.classList.remove('anim-shake');
    // assign options to pooled chips
    S.chips = [];
    hideAllChips();
    var n = S.lock.options.length;
    S.lock.options.forEach(function (opt, i) {
      var c = S.pool[i]; if (!c) return;
      c.lane = opt.lane; c.correct = opt.correct; c.code = opt.code; c.kind = opt.kind; c.resolved = false; c.active = true;
      c.bornAt = nowMs(); c.phase = Math.random() * 6.283;
      c.fallSpeed = S.fallSpeed * (0.92 + Math.random() * 0.16);
      c.key.textContent = String(opt.lane + 1);
      c.txt.textContent = opt.label;
      c.el.title = opt.label;
      c.el.className = 'arcade-chip' + (opt.kind === 'code' ? ' arcade-chip--code' : '');
      if (opt.kind === 'meaning') c.txt.setAttribute('lang', UI.lang()); else c.txt.removeAttribute('lang');
      c.el.setAttribute('aria-label', opt.label + ', ' + tt({ pl: 'tor', en: 'lane' }) + ' ' + (opt.lane + 1));
      c.el.style.width = S.chipW + 'px';
      c.el.style.display = '';
      c.el.removeAttribute('disabled');
      if (S.motion) {
        c.y = -CHIPH - i * (CHIPH * 1.7); // staggered entry, no spawn timers
        setChipXY(c);
        c.el.style.opacity = '1';
      } else {
        // calm: lay chips out statically across their lanes, mid-field, no motion
        c.y = Math.max(20, S.fieldH * 0.32);
        setChipXY(c);
        c.el.style.opacity = '1';
      }
      S.chips.push(c);
    });
    UI.announce((S.lock.dir === 'meaning'
      ? tt({ pl: 'Złap kod dla: ', en: 'Catch the code for: ' }) + UI.meaningShort(S.lock.answer)
      : (S.lock.dir === 'code' ? tt({ pl: 'Złap znaczenie ', en: 'Catch the meaning of ' }) : tt({ pl: 'Co podaje się po ', en: 'What follows ' })) + S.lock.answer));
    if (!S.motion) { later(function () { if (S.chips[0]) UI.focus(S.chips[0].el); }, 0); }
  }

  function hideAllChips() {
    S.pool.forEach(function (c) { c.active = false; c.resolved = true; c.el.style.display = 'none'; c.el.classList.remove('is-correct', 'is-wrong', 'is-dim'); var ic = c.el.querySelector('.icon'); if (ic) ic.remove(); });
  }
  function setChipXY(c) { c.el.style.transform = 'translate(' + laneX(c.lane) + 'px,' + c.y + 'px)'; }

  // ---------- main loop (motion branch) ----------
  function loop(ts) {
    S.rafId = 0;
    if (!S || S.dead) return;
    if (document.hidden) { S.lastT = ts; S.rafId = raf(loop); return; }
    var dt = clamp((ts - S.lastT) / 1000, 0, 0.05); S.lastT = ts;
    if (S.state === 'playing') step(dt, ts);
    S.rafId = raf(loop);
  }
  function step(dt, ts) {
    var bt = bandTop(), top = S.els.field; if (!top) return;
    for (var i = 0; i < S.chips.length; i++) {
      var c = S.chips[i];
      if (!c.active || c.resolved) continue;
      c.y += c.fallSpeed * dt;
      setChipXY(c);
      c.el.style.opacity = String(0.55 + 0.45 * (0.5 + 0.5 * Math.sin(ts / 1000 * 3 + c.phase))); // QSB shimmer
      var cy = c.y + CHIPH / 2;
      if (cy >= bt && cy <= S.fieldH && c.lane === S.tunerLane) { tryCatch(c); continue; }
      if (c.y > S.fieldH) { // fell past
        c.resolved = true; c.active = false; c.el.style.display = 'none';
        if (c.correct && !S.lockResolved) resolveLock(c, 'escape');
      }
    }
  }

  // ---------- resolve ----------
  function tryCatch(c) {
    if (!S || S.dead || S.lockResolved || c.resolved || !c.active) return;
    c.resolved = true;
    resolveLock(c, c.correct ? 'hit' : 'wrong');
  }
  function directCatchLane(lane) {
    for (var i = 0; i < S.chips.length; i++) { if (S.chips[i].active && !S.chips[i].resolved && S.chips[i].lane === lane) { tryCatch(S.chips[i]); return; } }
  }
  function catchQuality(c) {
    if (!S.motion) return 0.85;
    var bt = bandTop();
    return clamp(1 - (c.y - bt) / Math.max(1, (S.fieldH - bt)), 0.4, 1);
  }
  function markIcon(c, cls, icon) { c.el.classList.add(cls); c.el.insertBefore(UI.icon(icon), c.el.firstChild); }

  function resolveLock(chip, outcome) {
    if (S.lockResolved) return;
    S.lockResolved = true;
    S.state = 'beat';
    S.totalLocks++;
    var answer = S.lock.answer;
    var ms = nowMs() - chip.bornAt;

    // reveal the correct chip among the rest, dim others
    S.chips.forEach(function (c) {
      if (c === chip) return;
      if (c.correct) { if (c.active) markIcon(c, 'is-correct', 'check'); }
      else if (c.active) c.el.classList.add('is-dim');
    });

    if (outcome === 'hit') {
      S.correctLocks++;
      var pts = Math.round(100 * catchQuality(chip) * Math.min(1 + S.combo / 10, 5));
      S.score += pts; S.combo++; if (S.combo > S.maxCombo) S.maxCombo = S.combo;
      SRS.recogCorrect(answer, ms);
      markIcon(chip, 'is-correct', 'check');
      if (window.FX) { FX.burstAt(chip.el, { color: S.combo >= 3 ? 'combo' : 'ok', count: 22 + Math.min(S.combo, 10) * 4, power: 0.95 + Math.min(S.combo, 12) * 0.06, size: 10 }); if (S.combo % 5 === 0) FX.flash('amber', 0.3); }
      SFX.correct(); SFX.combo(S.combo);
      bumpMeter(Math.min(1, S.combo / 12));
      UI.announce(t('fb.correct') + ' · ' + answer + ' +' + pts + (S.combo >= 2 ? ' · ×' + S.combo : ''));
    } else {
      S.lives--; S.combo = 0; S.waveMisses++;
      SRS.recogWrong(answer, ms);
      if (outcome === 'wrong' && chip.code && chip.code !== answer) SRS.recordConfusion(answer, chip.code);
      if (S.fumbled.indexOf(answer) < 0) S.fumbled.push(answer);
      if (outcome === 'wrong') markIcon(chip, 'is-wrong', 'cross');
      if (window.FX) FX.flash([1, 0.36, 0.36], 0.22);
      SFX.wrong();
      if (S.motion && !UI.reducedMotion() && S.els.readout) S.els.readout.classList.add('anim-shake');
      renderReadout(S.lock, true); // reveal answer = meaning
      var extra = '';
      if (outcome === 'wrong' && chip.code && chip.code !== answer) { var mn = window.qcodeMnemonic(answer, chip.code); if (mn) extra = ' · ' + tt(mn); }
      bumpMeter(0);
      UI.announce((outcome === 'escape' ? tt({ pl: 'Uciekł', en: 'Escaped' }) : t('fb.wrong')) + ' · ' + answer + ' = ' + UI.meaningShort(answer) + extra);
    }
    updateHUD();
    Store.touchActivity();
    S.lockInWave++;
    later(afterBeat, outcome === 'hit' ? 650 : 1050);
  }

  function afterBeat() {
    if (S.dead) return;
    hideAllChips();
    if (S.lives <= 0) return gameOver();
    if (S.lockInWave >= LOCKS_PER_WAVE) return waveBreak();
    startLock();
  }

  function waveBreak() {
    var perfect = S.waveMisses === 0;
    if (perfect) { S.score += 250; if (window.FX) FX.celebrate(); }
    S.wave++; S.lockInWave = 0; S.waveMisses = 0;
    // escalate
    var travel = Math.max(2.6, 5.5 / Math.pow(1.12, S.wave - 1));
    S.fallSpeed = S.fieldH / travel;
    S.bandH = Math.max(56, 76 - (S.wave - 1) * 5); positionTuner(); positionBand();
    updateHUD();
    var banner = UI.el('div', { class: 'arcade-banner' }, [
      UI.el('div', { class: 'arcade-banner__big', text: 'QSY ↑' }),
      UI.el('div', { text: (perfect ? tt({ pl: 'Czysta fala! +250 · ', en: 'Clean wave! +250 · ' }) : '') + tt({ pl: 'Fala ', en: 'Wave ' }) + S.wave })
    ]);
    S.els.field.appendChild(banner);
    UI.announce(tt({ pl: 'Fala ', en: 'Wave ' }) + S.wave);
    later(function () { if (banner.parentNode) banner.parentNode.removeChild(banner); startLock(); }, perfect ? 1500 : 1200);
  }

  // ---------- HUD ----------
  function updateHUD() {
    S.els.score.textContent = String(S.score);
    S.els.combo.textContent = S.combo >= 2 ? ('×' + S.combo) : '';
    S.els.wave.textContent = tt({ pl: 'Fala ', en: 'Wave ' }) + S.wave;
    UI.clear(S.els.lives);
    for (var i = 0; i < START_LIVES; i++) S.els.lives.appendChild(UI.el('span', { class: 'arcade-life' + (i < S.lives ? ' is-on' : ''), 'aria-hidden': 'true' }));
    S.els.lives.appendChild(UI.el('span', { class: 'sr-only', text: tt({ pl: 'Życia: ', en: 'Lives: ' }) + S.lives + '/' + START_LIVES }));
  }
  function bumpMeter(frac) { if (S.els.meterFill) S.els.meterFill.style.transform = 'scaleX(' + clamp(frac, 0, 1) + ')'; }

  // ---------- game over / recap ----------
  function gameOver() {
    S.state = 'over';
    if (S.rafId) { caf(S.rafId); S.rafId = 0; }
    hideAllChips();
    Store.state.stats.sessionsCompleted++;
    Store.save(); UI.refreshChrome();
    var lang = Store.settings().lang;
    var acc = S.totalLocks ? Math.round(S.correctLocks / S.totalLocks * 100) : 0;
    var root = UI.el('div', { class: 'mode' }, [UI.modeHeader({ title: tt({ pl: 'Koniec gry', en: 'Game over' }) })]);
    var card = UI.el('div', { class: 'card recap center' });
    card.appendChild(UI.el('div', { class: 'recap__big', text: tt({ pl: 'Wynik ', en: 'Score ' }) + S.score }));
    card.appendChild(UI.el('div', { class: 'arcade-stats' }, [
      statPill(tt({ pl: 'Maks. seria', en: 'Max combo' }), '×' + S.maxCombo),
      statPill(tt({ pl: 'Celność', en: 'Accuracy' }), acc + '%'),
      statPill(tt({ pl: 'Fale', en: 'Waves' }), S.wave)
    ]));
    // high score
    if (qualifies(lang, S.score)) {
      card.appendChild(highScoreEntry(lang));
    } else {
      card.appendChild(scoreTable(lang));
    }
    // fumbled review
    if (S.fumbled.length) {
      var chips = UI.el('div', { class: 'recap__chips' });
      uniq(S.fumbled).forEach(function (c) { chips.appendChild(UI.el('span', { class: 'code code--bad', text: c })); });
      card.appendChild(UI.el('div', { class: 'recap__row' }, [UI.el('h3', { text: tt({ pl: 'Zaszumione', en: 'Noisy ones' }) }), chips]));
    }
    var actions = UI.el('div', { class: 'recap__actions' });
    if (S.fumbled.length) actions.appendChild(UI.btn(tt({ pl: 'Powtórz słabe w Flow', en: 'Review weak in Flow' }), { variant: 'primary', onClick: function () { App.go('flow', { inject: uniq(S.fumbled) }); } }));
    actions.appendChild(UI.btn(t('recap.again'), { variant: S.fumbled.length ? 'ghost' : 'primary', onClick: function () { App.go('arcade'); } }));
    actions.appendChild(UI.btn(t('nav.home'), { variant: 'ghost', onClick: function () { App.go('home'); } }));
    card.appendChild(actions);
    root.appendChild(card);
    UI.setScreen(root);
    UI.announce(tt({ pl: 'Koniec gry. Wynik ', en: 'Game over. Score ' }) + S.score);
    later(function () { UI.focusFirst(root); }, 0);
  }
  function statPill(label, value) { return UI.el('div', { class: 'pill' }, [UI.el('span', { class: 'pill__v', text: String(value) }), UI.el('span', { class: 'pill__l', text: label })]); }

  function qualifies(lang, score) {
    if (score <= 0) return false;
    var list = (Store.state.highScores[lang] || []);
    return list.length < 5 || score > list[list.length - 1].score;
  }
  function highScoreEntry(lang) {
    var box = UI.el('div', { class: 'card', style: { margin: '0 0 .8rem' } });
    box.appendChild(UI.el('p', { class: 'muted', text: tt({ pl: 'Nowy wynik! Wpisz swój znak (3 znaki):', en: 'New high score! Enter your callsign (3 chars):' }) }));
    var input = UI.el('input', { class: 'input', maxlength: '3', style: { textTransform: 'uppercase', maxWidth: '8rem', textAlign: 'center', fontFamily: 'var(--mono)' }, 'aria-label': tt({ pl: 'Znak', en: 'Callsign' }), value: 'SP' });
    var saved = false;
    function save() {
      if (saved) return; saved = true;
      var cs = (input.value || '---').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || '---';
      var place = Store.addHighScore(lang, { callsign: cs, score: S.score, maxCombo: S.maxCombo, ts: Date.now() });
      if (window.FX) FX.celebrate();
      box.parentNode.replaceChild(scoreTable(lang, place), box);
    }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    box.appendChild(UI.el('div', { class: 'io__row' }, [input, UI.btn(t('common.done'), { variant: 'primary', onClick: save })]));
    later(function () { UI.focus(input); input.select(); }, 0);
    return box;
  }
  function scoreTable(lang, place) {
    var list = Store.state.highScores[lang] || [];
    var box = UI.el('div', { class: 'card', style: { margin: '0 0 .8rem' } }, [UI.el('h3', { text: t('dash.highscores') })]);
    if (!list.length) { box.appendChild(UI.el('p', { class: 'muted', text: t('dash.highscores.empty') })); return box; }
    var tb = UI.el('tbody');
    list.forEach(function (e, i) {
      tb.appendChild(UI.el('tr', { class: i === place ? 'is-focus' : '' }, [
        UI.el('td', { text: '#' + (i + 1) }), UI.el('td', { class: 'mono', text: e.callsign || '—' }),
        UI.el('td', { class: 'mono', text: String(e.score) }), UI.el('td', { class: 'muted', text: '×' + (e.maxCombo || 0) })
      ]));
    });
    box.appendChild(UI.el('table', { class: 'abbrevs' }, [tb]));
    return box;
  }

  // ---------- pointer / tuner ----------
  function bindPointer() {
    if (S.ptrBound) return; S.ptrBound = true;
    var f = S.els.field;
    S._pm = function (e) {
      if (!S || S.dead || !S.motion || S.state !== 'playing') return;
      if (e.buttons === 0 && e.type === 'pointermove' && e.pointerType === 'mouse') { /* hover allowed */ }
      var rect = f.getBoundingClientRect();
      var lane = clamp(Math.floor((e.clientX - rect.left) / S.laneW), 0, S.lanes - 1);
      if (lane !== S.tunerLane) { S.tunerLane = lane; positionTuner(); }
    };
    f.addEventListener('pointermove', S._pm);
    f.addEventListener('pointerdown', S._pm);
  }
  function unbindPointer() {
    if (S && S.ptrBound && S.els.field && S._pm) {
      S.els.field.removeEventListener('pointermove', S._pm);
      S.els.field.removeEventListener('pointerdown', S._pm);
    }
  }
  function moveTuner(d) { S.tunerLane = clamp(S.tunerLane + d, 0, S.lanes - 1); positionTuner(); if (Store.settings().sound) SFX.tick(); }
  function assistSnap() {
    // snap tuner to the lowest live correct chip (or nearest live chip)
    var best = null;
    S.chips.forEach(function (c) { if (c.active && !c.resolved && c.correct) { if (!best || c.y > best.y) best = c; } });
    if (!best) S.chips.forEach(function (c) { if (c.active && !c.resolved) { if (!best || c.y > best.y) best = c; } });
    if (best) { S.tunerLane = best.lane; positionTuner(); }
  }

  // ---------- keyboard ----------
  function onKey(e) {
    if (!S || S.dead) return;
    if (S.state === 'ready') { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); beginPlay(); } return; }
    if (S.state !== 'playing') return;
    var k = e.key;
    if (k >= '1' && k <= '9') { e.preventDefault(); directCatchLane(parseInt(k, 10) - 1); return; }
    if (S.motion) {
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') { e.preventDefault(); moveTuner(-1); }
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') { e.preventDefault(); moveTuner(1); }
      else if (k === ' ') { e.preventDefault(); assistSnap(); }
    } else {
      // calm: arrows move focus among chips, Enter picks focused
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); moveFocus(k === 'ArrowRight' || k === 'ArrowDown' ? 1 : -1); }
      else if (k === 'Enter') {
        for (var i = 0; i < S.chips.length; i++) if (S.chips[i].el === document.activeElement) { e.preventDefault(); tryCatch(S.chips[i]); return; }
      }
    }
  }
  function moveFocus(dir) {
    var live = S.chips.filter(function (c) { return c.active && !c.resolved; });
    if (!live.length) return;
    var idx = -1; for (var i = 0; i < live.length; i++) if (live[i].el === document.activeElement) idx = i;
    if (idx < 0) idx = dir > 0 ? -1 : 0;
    UI.focus(live[(idx + dir + live.length) % live.length].el);
  }

  return { id: 'arcade', start: start, stop: stop, onKey: onKey };
})();
