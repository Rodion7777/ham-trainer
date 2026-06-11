// ============================================================
// SFX — WebAudio beeps (no audio files). Lazy, opt-in, silent fallback.
// NOTE: deliberately NOT named window.Audio (that's the DOM constructor).
// ============================================================
window.SFX = (function () {
  'use strict';
  var ctx = null, enabledByUser = true;

  function on() { return !!(window.Store && Store.settings().sound); }

  // create/resume the AudioContext — only safe to call from a user gesture
  function ensure() {
    if (!on()) return null;
    try {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    } catch (e) { ctx = null; }
    return ctx;
  }

  function tone(freq, dur, opts) {
    if (!on()) return;
    var c = ensure();
    if (!c) return;
    opts = opts || {};
    try {
      var t0 = c.currentTime + (opts.delay || 0);
      var osc = c.createOscillator();
      var gain = c.createGain();
      osc.type = opts.type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (opts.slideTo) osc.frequency.linearRampToValueAtTime(opts.slideTo, t0 + dur);
      var peak = opts.gain != null ? opts.gain : 0.18;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain); gain.connect(c.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.02);
    } catch (e) {}
  }

  function correct() { tone(660, 0.09); tone(990, 0.12, { delay: 0.08 }); }
  function wrong() { tone(200, 0.18, { type: 'sawtooth', gain: 0.14 }); }
  function combo(n) {
    var base = 520 + Math.min(n, 12) * 40;
    tone(base, 0.07, { type: 'square', gain: 0.12 });
    tone(base * 1.5, 0.09, { delay: 0.06, type: 'square', gain: 0.1 });
  }
  function tick() { tone(440, 0.04, { gain: 0.06 }); }

  // CW Morse for a string (codes/examples). Letters in the int'l table.
  var MORSE = {
    A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....',
    I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.',
    Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
    Y: '-.--', Z: '--..', '0': '-----', '1': '.----', '2': '..---', '3': '...--',
    '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
    '?': '..--..', '/': '-..-.'
  };
  function morse(text, wpm) {
    if (!on()) return;
    var c = ensure();
    if (!c) return;
    var unit = 1.2 / (wpm || 18); // seconds per dot
    var t = 0;
    String(text).toUpperCase().split('').forEach(function (ch) {
      if (ch === ' ') { t += unit * 4; return; }
      var m = MORSE[ch];
      if (!m) return;
      for (var i = 0; i < m.length; i++) {
        var d = (m[i] === '-') ? unit * 3 : unit;
        tone(620, d, { delay: t, gain: 0.16 });
        t += d + unit; // intra-char gap
      }
      t += unit * 2; // inter-char gap
    });
  }

  return {
    ensure: ensure, tone: tone, correct: correct, wrong: wrong,
    combo: combo, tick: tick, morse: morse,
    enabled: on
  };
})();
