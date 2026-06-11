// ============================================================
// Music — looping lobby background music (one <audio> element).
// Plays only on the LOBBY and only when sound is enabled. Honours the browser
// autoplay policy: if play() is blocked (no user gesture yet) it retries on the
// next pointer/key gesture. Pauses off-lobby, when sound is muted, or when the
// tab is hidden. No files beyond the vendored mp3; graceful if <audio> missing.
// ============================================================
window.Music = (function () {
  'use strict';
  var audio = null, onHome = false, gestureBound = false, VOL = 0.21; // 0.32 - 35%

  function soundOn() { return !!(window.Store && Store.settings().sound); }
  function wantPlaying() { return !!(audio && onHome && soundOn() && !document.hidden); }

  function bindGesture() {
    if (gestureBound) return; gestureBound = true;
    var fn = function () {
      document.removeEventListener('pointerdown', fn, true);
      document.removeEventListener('keydown', fn, true);
      gestureBound = false; tryPlay();
    };
    document.addEventListener('pointerdown', fn, true);
    document.addEventListener('keydown', fn, true);
  }
  function tryPlay() {
    if (!wantPlaying()) return;
    try {
      var p = audio.play();
      if (p && p.catch) p.catch(function () { bindGesture(); }); // autoplay blocked -> wait for a gesture
    } catch (e) { bindGesture(); }
  }
  function update() { if (!audio) return; audio.volume = VOL; if (wantPlaying()) tryPlay(); else audio.pause(); }

  function init() {
    audio = document.getElementById('bgm');
    if (!audio) return;
    audio.loop = true; audio.volume = VOL; audio.preload = 'auto';
    document.addEventListener('visibilitychange', update);
  }
  function start() { onHome = true; update(); }   // entered the lobby
  function stop() { onHome = false; if (audio) audio.pause(); } // left the lobby
  function refresh() { update(); }                 // sound setting / theme changed

  return { init: init, start: start, stop: stop, refresh: refresh, available: function () { return !!audio; } };
})();
