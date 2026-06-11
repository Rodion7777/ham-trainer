// ============================================================
// Store — single-key localStorage persistence (file://-safe).
// All reads/writes are wrapped in try/catch so private mode or a
// quota error never breaks the game; it just runs in memory.
// ============================================================
window.Store = (function () {
  'use strict';
  var KEY = 'naPasmie.v1';
  var SCHEMA = 1;
  var state = null;

  function defaultCodeRecord() {
    return {
      box: 0, dueAt: 0, seen: 0, correct: 0, wrong: 0,
      lastSeen: 0, avgResponseMs: 0, masteredVia: null,
      perFormat: { recognition: { seen: 0, correct: 0 }, recall: { seen: 0, correct: 0 } }
    };
  }

  function detectLang() {
    try {
      var l = (navigator.language || 'en').toLowerCase();
      return l.indexOf('pl') === 0 ? 'pl' : 'en';
    } catch (e) { return 'pl'; }
  }

  function defaults() {
    var codes = {};
    (window.QCODE_LIST || []).forEach(function (c) { codes[c] = defaultCodeRecord(); });
    return {
      schemaVersion: SCHEMA,
      settings: {
        lang: detectLang(), theme: 'dark', sound: false, motion: true,
        twinTrapTimer: false, onBandTimer: false, streakEnabled: false,
        crossLingualFlow: false, examDate: null
      },
      codes: codes,
      confusionMatrix: {},
      highScores: { pl: [], en: [] },
      exam: { bestScore: null, passed: false, lastTs: 0 },
      logbook: { contacts: 0, cleanCopies: 0 },
      streak: { current: 0, longest: 0, lastActiveDay: null },
      stats: { totalTrials: 0, sessionsCompleted: 0 }
    };
  }

  function migrate(s) {
    var d = defaults();
    if (!s || typeof s !== 'object') return d;
    function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }
    if (!isObj(s.settings)) s.settings = {};
    Object.keys(d.settings).forEach(function (k) {
      // replace a setting whose type drifted from the default (corrupt import)
      if (s.settings[k] === undefined || (d.settings[k] !== null && typeof s.settings[k] !== typeof d.settings[k])) {
        s.settings[k] = d.settings[k];
      }
    });
    if (!isObj(s.codes)) s.codes = {};
    (window.QCODE_LIST || []).forEach(function (c) {
      var dr = defaultCodeRecord();
      if (!isObj(s.codes[c])) { s.codes[c] = dr; return; }
      var r = s.codes[c];
      Object.keys(dr).forEach(function (k) { if (r[k] === undefined) r[k] = dr[k]; });
      if (!isObj(r.perFormat)) r.perFormat = { recognition: { seen: 0, correct: 0 }, recall: { seen: 0, correct: 0 } };
      if (!isObj(r.perFormat.recognition)) r.perFormat.recognition = { seen: 0, correct: 0 };
      if (!isObj(r.perFormat.recall)) r.perFormat.recall = { seen: 0, correct: 0 };
    });
    // repair any top-level container whose type drifted from the default
    ['confusionMatrix', 'highScores', 'exam', 'logbook', 'streak', 'stats'].forEach(function (k) {
      if (s[k] === undefined || typeof s[k] !== typeof d[k]) s[k] = d[k];
    });
    if (!isObj(s.highScores)) s.highScores = { pl: [], en: [] };
    if (!Array.isArray(s.highScores.pl)) s.highScores.pl = [];
    if (!Array.isArray(s.highScores.en)) s.highScores.en = [];
    s.schemaVersion = SCHEMA;
    return s;
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    if (raw) {
      try { state = migrate(JSON.parse(raw)); }
      catch (e) { state = defaults(); }
    } else {
      state = defaults();
    }
    return state;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  var saveTimer = null;
  function saveSoon() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () { saveTimer = null; save(); }, 150);
  }

  // ---- streak / daily activity ----
  function dayString(d) {
    d = d || new Date();
    // local YYYY-MM-DD
    var y = d.getFullYear(), m = ('0' + (d.getMonth() + 1)).slice(-2), day = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
  }
  function touchActivity() {
    var today = dayString();
    var st = state.streak;
    if (st.lastActiveDay === today) return;
    if (st.lastActiveDay) {
      var prev = new Date(st.lastActiveDay + 'T00:00:00');
      var diff = Math.round((new Date(today + 'T00:00:00') - prev) / 86400000);
      st.current = (diff === 1) ? st.current + 1 : 1;
    } else {
      st.current = 1;
    }
    st.lastActiveDay = today;
    if (st.current > st.longest) st.longest = st.current;
    save();
  }

  // ---- confusion matrix: when SHOWN x, user PICKED y (y wrong) ----
  function recordConfusion(shown, picked) {
    if (!shown || !picked || shown === picked) return;
    var m = state.confusionMatrix;
    if (!m[shown]) m[shown] = {};
    m[shown][picked] = (m[shown][picked] || 0) + 1;
    saveSoon();
  }

  // ---- high scores (per language, top 5) ----
  function addHighScore(lang, entry) {
    var list = state.highScores[lang] || (state.highScores[lang] = []);
    list.push(entry);
    list.sort(function (a, b) { return b.score - a.score; });
    state.highScores[lang] = list.slice(0, 5);
    save();
    return state.highScores[lang].indexOf(entry);
  }

  function exportJSON() { return JSON.stringify(state); }
  function importJSON(str) {
    try {
      var obj = JSON.parse(str);
      if (!obj || typeof obj !== 'object') return false;
      state = migrate(obj);
      save();
      return true;
    } catch (e) { return false; }
  }

  function reset() { state = defaults(); save(); }

  return {
    KEY: KEY,
    load: load,
    save: save,
    saveSoon: saveSoon,
    get state() { return state; },
    settings: function () { return state.settings; },
    setSetting: function (k, v) { state.settings[k] = v; save(); },
    code: function (c) { return state.codes[c]; },
    touchActivity: touchActivity,
    dayString: dayString,
    recordConfusion: recordConfusion,
    addHighScore: addHighScore,
    exportJSON: exportJSON,
    importJSON: importJSON,
    reset: reset
  };
})();
