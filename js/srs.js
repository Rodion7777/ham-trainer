// ============================================================
// SRS — one shared 5-box Leitner engine used by EVERY mode.
// Box 0..4. Mastery = box 4 reached via a typed (Send It) success.
// Recognition modes (Twin Trap / MCQ / cloze) are capped at box 2.
// ============================================================
window.SRS = (function () {
  'use strict';
  var DAY = 86400000;
  // interval[box] = how long until the code is due again after landing in that box
  var INTERVALS = [0, 1 * DAY, 3 * DAY, 7 * DAY, 16 * DAY];

  function now() { return Date.now(); }
  function rec(c) { return Store.code(c); }
  function list() { return window.QCODE_LIST; }

  // ---- status / counters ----
  function status(c) {
    var r = rec(c);
    if (!r) return 'noisy';
    if (r.box >= 4 && r.masteredVia === 'sendit') return 'mastered';
    if (r.box >= 1 || r.seen > 0) return 'shaky';
    return 'noisy';
  }
  function isDue(c) { var r = rec(c); return r && r.dueAt <= now(); }
  function dueList() { return list().filter(isDue); }
  function dueCount() { return dueList().length; }
  function masteredCount() { return list().filter(function (c) { return status(c) === 'mastered'; }).length; }
  function seenCount() { return list().filter(function (c) { return rec(c).seen > 0; }).length; }
  function accuracy(c) {
    var r = rec(c), t = r.correct + r.wrong;
    return t ? r.correct / t : 0;
  }

  // ---- internal: schedule a record's dueAt from its box ----
  function reschedule(r, scale) {
    r.dueAt = now() + INTERVALS[r.box] * (scale || 1);
  }
  function updateAvg(r, ms) {
    if (!ms || ms < 0) return;
    r.avgResponseMs = r.avgResponseMs ? Math.round(r.avgResponseMs * 0.7 + ms * 0.3) : ms;
  }

  // ---- the single transition function every mode funnels into ----
  // o = { result:'promote'|'keep'|'fail', format:'recognition'|'recall',
  //       ceiling:Number(0..4), sendItMastery:Bool, ms:Number, scale:Number }
  function record(c, o) {
    var r = rec(c);
    if (!r) return;
    o = o || {};
    r.seen++;
    r.lastSeen = now();
    if (o.format && r.perFormat[o.format]) r.perFormat[o.format].seen++;
    updateAvg(r, o.ms);

    if (o.result === 'fail') {
      r.wrong++;
      r.box = 0;
      r.dueAt = now(); // resurfaces this session; modes add the re-queue lag
    } else {
      r.correct++;
      if (o.format && r.perFormat[o.format]) r.perFormat[o.format].correct++;
      if (o.result === 'promote') {
        var cap = (typeof o.ceiling === 'number') ? o.ceiling : 4;
        // never demote below current box; promote one box but respect the recognition ceiling
        r.box = Math.max(r.box, Math.min(r.box + 1, cap));
      }
      // 'keep' leaves box unchanged
      reschedule(r, o.scale);
      if (o.sendItMastery && r.box >= 4) r.masteredVia = 'sendit';
    }
    Store.saveSoon();
    return r;
  }

  // ---- convenience wrappers per mode ----
  function gradeFlow(c, grade, ms) {
    if (grade === 'again') return record(c, { result: 'fail', format: 'recognition', ms: ms });
    if (grade === 'hard') return record(c, { result: 'keep', format: 'recognition', ms: ms, scale: 0.5 });
    return record(c, { result: 'promote', format: 'recognition', ceiling: 4, ms: ms }); // good
  }
  // recognition correct (Twin Trap, MCQ, cloze) — capped at box 2
  function recogCorrect(c, ms) { return record(c, { result: 'promote', format: 'recognition', ceiling: 2, ms: ms }); }
  function recogWrong(c, ms) { return record(c, { result: 'fail', format: 'recognition', ms: ms }); }
  // typed production (Send It)
  function sendItFirstTry(c, ms) { return record(c, { result: 'promote', format: 'recall', ceiling: 4, sendItMastery: true, ms: ms }); }
  function sendItSecondTry(c, ms) { return record(c, { result: 'keep', format: 'recall', ms: ms }); }
  function sendItReveal(c, ms) { return record(c, { result: 'fail', format: 'recall', ms: ms }); }

  // ---- scheduler ----
  function hoursSince(ts) { return ts ? (now() - ts) / 3600000 : 9999; }
  function priority(c) {
    var r = rec(c);
    var wrongRate = (r.correct + r.wrong) ? r.wrong / (r.correct + r.wrong) : 0.4; // unseen treated as moderately weak
    var unseenBoost = r.seen === 0 ? 1.2 : 0;
    return 2.2 * (4 - r.box) + 3.0 * wrongRate + 0.04 * Math.min(hoursSince(r.lastSeen), 720) + unseenBoost;
  }

  // round-robin interleave a list of codes across their families
  function interleaveByFamily(codes) {
    var buckets = {};
    codes.forEach(function (c) {
      var f = window.QCODE_FAMILY_OF[c] || 'other';
      (buckets[f] || (buckets[f] = [])).push(c);
    });
    var keys = Object.keys(buckets), out = [], added = true;
    while (added) {
      added = false;
      for (var i = 0; i < keys.length; i++) {
        var b = buckets[keys[i]];
        if (b.length) { out.push(b.shift()); added = true; }
      }
    }
    return out;
  }

  // Build an ordered study queue. opts: {size, onlyDue, includeUnseen}
  function buildQueue(opts) {
    opts = opts || {};
    var size = opts.size || 20;
    var pool = opts.onlyDue ? dueList() : list().slice();
    if (opts.onlyDue && pool.length < Math.min(size, 6)) {
      // not enough due: top up with the weakest not-yet-mastered codes
      var extra = list().filter(function (c) { return status(c) !== 'mastered' && pool.indexOf(c) < 0; });
      pool = pool.concat(extra);
    }
    if (!pool.length) pool = list().slice();
    pool.sort(function (a, b) { return priority(b) - priority(a); });

    // guarantee a couple of unseen codes get interleaved in
    var want = (opts.includeUnseen != null) ? opts.includeUnseen : 3;
    var unseen = list().filter(function (c) { return rec(c).seen === 0; });
    for (var i = 0; i < unseen.length && want > 0; i++) {
      if (pool.indexOf(unseen[i]) < 0) { pool.push(unseen[i]); }
      want--;
    }
    var ordered = interleaveByFamily(pool.slice(0, Math.max(size, 8)));
    return ordered.slice(0, size);
  }

  // Weighted random pick of n codes (for arcade / cloze spawns). exclude = array.
  function pickWeighted(n, exclude) {
    exclude = exclude || [];
    var pool = list().filter(function (c) { return exclude.indexOf(c) < 0; });
    var out = [];
    while (out.length < n && pool.length) {
      var total = 0, i;
      for (i = 0; i < pool.length; i++) total += Math.max(0.1, priority(pool[i]));
      var pick = Math.random() * total, acc = 0, idx = 0;
      for (i = 0; i < pool.length; i++) { acc += Math.max(0.1, priority(pool[i])); if (pick <= acc) { idx = i; break; } }
      out.push(pool[idx]);
      pool.splice(idx, 1);
    }
    return out;
  }
  function pickOne(exclude) { return pickWeighted(1, exclude)[0]; }

  // ---- distractor selection (confusables first, then family, then random) ----
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function distractors(answer, n) {
    var picked = [];
    var add = function (arr) {
      shuffle(arr).forEach(function (c) {
        if (c !== answer && picked.indexOf(c) < 0 && picked.length < n) picked.push(c);
      });
    };
    add(window.QCODE_CONFUSABLES_OF[answer] || []);
    var fam = window.QCODE_FAMILIES[window.QCODE_FAMILY_OF[answer]] || [];
    add(fam);
    add(list());
    return picked;
  }
  function confusablePartners(c) { return (window.QCODE_CONFUSABLES_OF[c] || []).slice(); }

  function recordConfusion(shown, picked) { Store.recordConfusion(shown, picked); }

  return {
    INTERVALS: INTERVALS,
    now: now,
    status: status,
    isDue: isDue,
    dueList: dueList,
    dueCount: dueCount,
    masteredCount: masteredCount,
    seenCount: seenCount,
    accuracy: accuracy,
    record: record,
    gradeFlow: gradeFlow,
    recogCorrect: recogCorrect,
    recogWrong: recogWrong,
    sendItFirstTry: sendItFirstTry,
    sendItSecondTry: sendItSecondTry,
    sendItReveal: sendItReveal,
    buildQueue: buildQueue,
    pickWeighted: pickWeighted,
    pickOne: pickOne,
    distractors: distractors,
    confusablePartners: confusablePartners,
    recordConfusion: recordConfusion,
    shuffle: shuffle,
    priority: priority
  };
})();
