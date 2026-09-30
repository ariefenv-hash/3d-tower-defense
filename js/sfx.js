/* =====================================================
 * sfx.js — WebAudio 程序化音效（零资源文件）
 * ===================================================== */
(function () {
  'use strict';
  window.PE = window.PE || {};

  let ctx = null;
  let muted = false;

  function ensureCtx() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) { ctx = null; }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /**
   * 通用短音
   * @param freq 频率
   * @param dur 时长（秒）
   * @param type 波形
   * @param vol 音量 0~1
   * @param slide 结束频率（滑音）
   */
  function tone(freq, dur, type, vol, slide) {
    if (muted) return;
    const c = ensureCtx();
    if (!c) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, c.currentTime);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slide), c.currentTime + dur);
    gain.gain.setValueAtTime(vol || 0.12, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    osc.connect(gain).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + dur + 0.02);
  }

  PE.sfx = {
    unlock() { ensureCtx(); },
    toggleMute() { muted = !muted; return muted; },
    get muted() { return muted; },

    place()   { tone(420, 0.12, 'triangle', 0.14, 640); },
    upgrade() { tone(520, 0.14, 'triangle', 0.15, 1040); tone(780, 0.2, 'sine', 0.1, 1560); },
    sell()    { tone(600, 0.15, 'sine', 0.1, 240); },
    kill()    { tone(200 + Math.random() * 80, 0.08, 'square', 0.05, 90); },
    pulse()   { tone(880, 0.05, 'square', 0.03, 440); },
    leak()    { tone(160, 0.4, 'sawtooth', 0.16, 60); },
    wave()    { tone(330, 0.25, 'triangle', 0.12, 660); tone(220, 0.3, 'sine', 0.08, 440); },
    relic()   { tone(660, 0.12, 'sine', 0.1, 990); tone(990, 0.25, 'sine', 0.09, 1320); },
    boss()    { tone(110, 0.6, 'sawtooth', 0.15, 55); },
    win()     { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.35, 'triangle', 0.12), i * 130)); },
    lose()    { [330, 262, 196, 131].forEach((f, i) => setTimeout(() => tone(f, 0.4, 'sawtooth', 0.1), i * 180)); },
    click()   { tone(700, 0.04, 'sine', 0.06); }
  };
})();
