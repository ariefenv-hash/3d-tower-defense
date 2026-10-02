/* =====================================================
 * sfx.js — WebAudio 程序化音效（零资源文件）
 * ===================================================== */
(function () {
  'use strict';
  window.PE = window.PE || {};

  let ctx = null;
  let muted = false;
  let bgmBus = null;          // BGM 专用总线：音量独立于音效，静音时归零

  function ensureCtx() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) { ctx = null; }
    }
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      if (!bgmBus) {
        bgmBus = ctx.createGain();
        bgmBus.gain.value = muted ? 0 : 0.55;
        bgmBus.connect(ctx.destination);
      }
    }
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
    toggleMute() {
      muted = !muted;
      if (bgmBus) bgmBus.gain.value = muted ? 0 : 0.55;
      return muted;
    },
    setMuted(v) {
      muted = !!v;
      if (bgmBus) bgmBus.gain.value = muted ? 0 : 0.55;
    },
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

  /* =====================================================
   * BGM — 程序化五声环境乐（零资源文件，与音效同源）
   * 宫调五声音阶 · 慢速拨弦 + 低音持续 + 五度泛音垫
   * 前瞻调度（lookahead）：对标签页节流免疫，暂停游戏不停奏
   * ===================================================== */
  const BGM = {
    playing: false, seq: null,
    nextBar: 0, bar: 0,
    BAR: 2.6,                    // 每小节时长（秒）
    root: 196,                   // 宫音基频（G3）
    PENTA: [0, 2, 4, 7, 9]       // 宫商角徵羽（半音数）
  };

  function bgmFreq(deg, oct) {
    const d = ((deg % 5) + 5) % 5, o = oct + Math.floor(deg / 5);
    return BGM.root * Math.pow(2, (BGM.PENTA[d] + 12 * o) / 12);
  }

  function bgmPluck(freq, at, dur, vol, type) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g); g.connect(bgmBus);
    osc.start(at); osc.stop(at + dur + 0.1);
  }

  function bgmScheduleBar() {
    const t = BGM.nextBar, bar = BGM.bar++;
    // 低音持续：宫 / 徵交替，每小节一声
    bgmPluck(bgmFreq(bar % 4 < 2 ? 0 : 3, 0), t, BGM.BAR * 1.05, 0.05, 'sine');
    // 泛音垫：隔小节铺一个五度长音
    if (bar % 2 === 1) bgmPluck(bgmFreq(2, 1), t, BGM.BAR, 0.018, 'triangle');
    // 旋律拨弦：每小节 2~4 音，五声音阶上游走
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const at = t + (i + Math.random() * 0.5) * (BGM.BAR / n);
      const deg = Math.floor(Math.random() * 7);
      const oct = 1 + (Math.random() < 0.3 ? 1 : 0);
      bgmPluck(bgmFreq(deg, oct), at, 1.6 + Math.random(), 0.035, 'triangle');
    }
    // 偶发高音点缀（如远星闪烁）
    if (Math.random() < 0.22) {
      bgmPluck(bgmFreq(Math.floor(Math.random() * 5), 3), t + BGM.BAR * 0.5, 2.2, 0.02, 'sine');
    }
  }

  function bgmTick() {
    if (!ctx || !BGM.playing || muted) return;
    if (ctx.state === 'suspended') return;   // 音频解锁前不推进
    while (BGM.nextBar < ctx.currentTime + 1.6) {
      bgmScheduleBar();
      BGM.nextBar += BGM.BAR;
    }
  }

  PE.sfx.bgmStart = function () {
    const c = ensureCtx();
    if (!c || BGM.playing) return;
    BGM.playing = true;
    BGM.nextBar = c.currentTime + 0.1;
    BGM.bar = 0;
    BGM.seq = setInterval(bgmTick, 500);
  };

  PE.sfx.bgmStop = function () {
    BGM.playing = false;
    if (BGM.seq) { clearInterval(BGM.seq); BGM.seq = null; }
  };

  Object.defineProperty(PE.sfx, 'bgmOn', { get: () => BGM.playing });
})();
