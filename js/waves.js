/* =====================================================
 * waves.js — 波次编排（15 波剧本 + 无尽模式程序生成）
 * ===================================================== */
(function () {
  'use strict';
  window.PE = window.PE || {};
  const C = PE.CONFIG;

  PE.WaveManager = class {
    constructor(game) {
      this.game = game;
      this.queue = [];      // [{type, delay}]
      this.timer = 0;
      this.started = false;
    }

    /** 组装第 w 波的出怪队列 */
    setup(w) {
      this.queue = [];
      this.started = false;
      this.timer = 0;

      let groups;
      if (w <= C.MAX_WAVE) {
        groups = C.WAVES[w - 1].map(g => ({ t: g.t, n: g.n }));
      } else {
        // 无尽模式：按预算随机混编
        groups = this._endlessGroups(w);
      }

      const pool = [];
      for (const g of groups) {
        for (let i = 0; i < g.n; i++) pool.push(g.t);
      }
      // 打乱混排（boss 固定压轴）
      const bosses = pool.filter(t => t === 'boss');
      const normal = pool.filter(t => t !== 'boss');
      for (let i = normal.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [normal[i], normal[j]] = [normal[j], normal[i]];
      }
      const list = normal.concat(bosses);

      for (let i = 0; i < list.length; i++) {
        const type = list[i];
        const delay = type === 'boss'
          ? 3.2
          : Math.max(0.5, 0.95 - w * 0.012) * (0.75 + Math.random() * 0.5);
        this.queue.push({ type, delay });
      }
      this.total = list.length;
    }

    _endlessGroups(w) {
      let budget = C.ENDLESS.budget(w);
      const kinds = ['drone', 'runner', 'tank', 'shield', 'splitter'];
      const cost = { drone: 1, runner: 1.2, tank: 3, shield: 2.6, splitter: 2.4 };
      const groups = {};
      let guard = 99;
      while (budget > 0 && guard-- > 0) {
        const t = kinds[Math.floor(Math.random() * kinds.length)];
        groups[t] = (groups[t] || 0) + 1;
        budget -= cost[t];
      }
      if (w % 5 === 0) groups.boss = 1;
      return Object.keys(groups).map(t => ({ t, n: groups[t] }));
    }

    start() { this.started = true; this.timer = this.queue.length ? this.queue[0].delay : 0; }

    update(dt) {
      if (!this.started || !this.queue.length) return;
      this.timer -= dt;
      while (this.timer <= 0 && this.queue.length) {
        const item = this.queue.shift();
        this.game.spawnEnemy(item.type, this.game.wave);
        this.timer += item.delay;
      }
    }

    get done() { return this.started && this.queue.length === 0; }

    get remaining() { return this.queue.length; }
  };
})();
