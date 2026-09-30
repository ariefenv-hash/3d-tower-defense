/* =====================================================
 * ui.js — HUD / 面板 / 模态框（纯 DOM overlay）
 * ===================================================== */
(function () {
  'use strict';
  window.PE = window.PE || {};
  const U = PE.utils, C = PE.CONFIG;

  const $ = id => document.getElementById(id);

  PE.UI = class {
    constructor(game) {
      this.game = game;
      this.el = {
        hudTop: $('hud-top'), relicBar: $('relic-bar'), buildBar: $('build-bar'),
        waveNum: $('wave-num'), waveDots: $('wave-dots'),
        btnNext: $('btn-next-wave'), countdown: $('wave-countdown'),
        coreFill: $('core-hp-fill'), coreNum: $('core-hp-num'),
        energy: $('energy-num'),
        buildCards: $('build-cards'),
        towerPanel: $('tower-panel'), tpName: $('tp-name'), tpStats: $('tp-stats'),
        tpUpgrade: $('tp-upgrade'), tpSell: $('tp-sell'), tpClose: $('tp-close'),
        modal: $('modal-layer'), toastWrap: $('toast-wrap')
      };
      this._renderBuildCards();
      this._bind();
      this._bindZoom();
    }

    /* 触屏 / 窄屏的视野缩放按钮 */
    _bindZoom() {
      const zin = document.getElementById('zoom-in');
      const zout = document.getElementById('zoom-out');
      if (zin) zin.addEventListener('click', () => { PE.sfx.click(); this.game.scene.zoom(-150); });
      if (zout) zout.addEventListener('click', () => { PE.sfx.click(); this.game.scene.zoom(150); });
    }

    _bind() {
      this.el.btnNext.addEventListener('click', () => {
        PE.sfx.click();
        this.game.startWave();
      });
      this.el.tpClose.addEventListener('click', () => this.game.input.deselect());
      this.el.tpUpgrade.addEventListener('click', () => {
        const t = this.game.selected;
        if (!t) return;
        if (t.upCost === null) { this.toast('已是最高等级'); return; }
        if (!this.game.upgradeTower(t)) this.toast('能量不足', 'bad');
        else this.showTowerPanel(t);
      });
      this.el.tpSell.addEventListener('click', () => {
        const t = this.game.selected;
        if (t) this.game.sellTower(t);
      });
    }

    /* ---------- 建造卡片 ---------- */
    _renderBuildCards() {
      const box = this.el.buildCards;
      box.innerHTML = '';
      const types = Object.keys(C.TOWERS);
      types.forEach((key, i) => {
        const def = C.TOWERS[key];
        const card = document.createElement('div');
        card.className = 'tower-card';
        card.style.setProperty('--tc', '#' + def.color.toString(16).padStart(6, '0'));
        card.dataset.type = key;
        card.innerHTML = `
          <div class="tc-icon" style="color:#${def.color.toString(16).padStart(6, '0')}">${def.icon}</div>
          <div class="tc-name">${def.name}</div>
          <div class="tc-desc">${def.desc}</div>
          <div class="tc-cost" data-cost>◆ ${this.game.priceOf(key)}</div>
          <div class="tc-key">${i + 1}</div>`;
        card.addEventListener('click', () => {
          PE.sfx.click();
          // 触屏没有 title 悬停：选中时以墨签形式展示要略
          if (U.isCoarse() && this.game.input && this.game.input.buildType !== key) {
            this.toast(def.tip);
          }
          this.game.input.setBuildType(
            this.game.input.buildType === key ? null : key
          );
        });
        card.title = def.tip;
        box.appendChild(card);
      });
    }

    setBuildType(type) {
      for (const card of this.el.buildCards.children) {
        card.classList.toggle('selected', card.dataset.type === type);
      }
    }

    /* ---------- HUD 刷新 ---------- */
    refresh() {
      const g = this.game;
      this.el.energy.textContent = U.fmt(g.energy);
      const total = g.endless ? '∞' : C.MAX_WAVE;
      this.el.waveNum.innerHTML =
        (g.state === 'wave' || g.state === 'relic' ? g.wave : g.wave + 1) +
        ` <span class="hud-sub">/ ${total}</span>`;
      // 建造卡价格与可负担态
      for (const card of this.el.buildCards.children) {
        const key = card.dataset.type;
        const price = g.priceOf(key);
        card.querySelector('[data-cost]').textContent = '◆ ' + price;
        card.classList.toggle('poor', g.energy < price);
      }
      this.refreshCore();
      this.refreshTowerPanel();
    }

    refreshCore() {
      const g = this.game;
      const frac = U.clamp(g.coreHp / g.coreMax, 0, 1);
      this.el.coreFill.style.width = (frac * 100) + '%';
      this.el.coreFill.classList.toggle('low', frac <= 0.35);
      this.el.coreNum.textContent = `${Math.max(0, g.coreHp)} / ${g.coreMax}`;
    }

    onRunStart(seed) {
      this.el.hudTop.classList.remove('hidden');
      this.el.relicBar.classList.remove('hidden');
      this.el.buildBar.classList.remove('hidden');
      this.el.relicBar.innerHTML = '';
      this._renderWaveDots();
      this.hideModal();
      this.refresh();
      this.toast(`新星图已展开 · 卷号 ${seed.toString(16).toUpperCase()}`);
      if (U.isCoarse()) {
        setTimeout(() => this.toast('单指拖动转卷 · 双指开合缩放 · 轻点布防'), 700);
      }
    }

    _renderWaveDots() {
      const box = this.el.waveDots;
      box.innerHTML = '';
      for (let i = 1; i <= C.MAX_WAVE; i++) {
        const d = document.createElement('div');
        const isBoss = C.WAVES[i - 1] && C.WAVES[i - 1].some(g => g.t === 'boss');
        d.className = 'wd' + (isBoss ? ' boss' : '');
        box.appendChild(d);
      }
    }

    onWaveStart() {
      this.refresh();
      const g = this.game;
      this.el.btnNext.classList.add('hidden');
      this.el.countdown.classList.add('hidden');
      const dots = this.el.waveDots.children;
      for (let i = 0; i < dots.length; i++) {
        dots[i].classList.toggle('cur', i + 1 === g.wave);
        dots[i].classList.toggle('done', i + 1 < g.wave);
      }
    }

    onBuildPhase() {
      this.refresh();
      const g = this.game;
      const next = g.wave + 1;
      const total = g.endless ? '∞' : C.MAX_WAVE;
      this.el.btnNext.textContent = `启第 ${next} 波`;
      this.el.btnNext.classList.remove('hidden');
      this.el.countdown.classList.remove('hidden');
      const dots = this.el.waveDots.children;
      for (let i = 0; i < dots.length; i++) {
        dots[i].classList.toggle('cur', i + 1 === next);
        dots[i].classList.toggle('done', i + 1 < next);
      }
      if (g.endless) {
        this.toast(`无尽模式 · 第 ${next} 波`);
      }
    }

    updateCountdown(s) {
      this.el.countdown.textContent = Math.ceil(s) + 's';
    }

    /* ---------- 塔面板 ---------- */
    showTowerPanel(t) {
      this.el.towerPanel.classList.remove('hidden');
      this.refreshTowerPanel();
    }

    hideTowerPanel() {
      this.el.towerPanel.classList.add('hidden');
    }

    refreshTowerPanel() {
      const g = this.game, t = g.selected;
      if (!t || this.el.towerPanel.classList.contains('hidden')) return;
      const lv = t.level + 1;
      this.el.tpName.textContent = `${t.def.name} Lv${lv}`;
      const lines = [`<div>${t.def.stats(t.lv)}</div>`];
      if (t.type === 'prism') {
        lines.push(`<div>当前光束总输出 <b>${g.beams.totalDps().toFixed(1)}</b> /秒</div>`);
      }
      if (t._energyTile()) lines.push(`<div class="up">⌁ 站立于能量格：建造折扣</div>`);
      const next = t.def.levels[t.level + 1];
      if (next) lines.push(`<div>升级 → ${t.def.stats(next)}</div>`);
      else lines.push(`<div class="up">✓ 已达最高等级</div>`);
      this.el.tpStats.innerHTML = lines.join('');

      if (t.upCost !== null) {
        this.el.tpUpgrade.textContent = `升级 ◆${Math.round(t.upCost * g.mods.buildCostMul)}`;
        this.el.tpUpgrade.disabled = g.energy < Math.round(t.upCost * g.mods.buildCostMul);
      } else {
        this.el.tpUpgrade.textContent = '已满级';
        this.el.tpUpgrade.disabled = true;
      }
      this.el.tpSell.textContent = `回收 +${t.sellValue}`;
    }

    /* ---------- 遗物 ---------- */
    addRelicIcon(relic) {
      const meta = PE.relics.TIER_META[relic.tier];
      const d = document.createElement('div');
      d.className = 'relic-icon';
      d.textContent = relic.icon;
      d.style.borderColor = meta.color + '66';
      d.dataset.tip = `<b style="color:${meta.color}">${relic.name}</b>（${meta.name}）\n${relic.desc}`;
      // 触屏：点按印匣展开 / 收起注解，再点其它印匣自动收起
      d.addEventListener('click', () => {
        const open = d.classList.toggle('show-tip');
        for (const el of this.el.relicBar.children) {
          if (el !== d) el.classList.remove('show-tip');
        }
      });
      this.el.relicBar.appendChild(d);
    }

    showRelicChoices(choices) {
      const meta = PE.relics.TIER_META;
      let cards = '';
      choices.forEach((r, i) => {
        cards += `
        <div class="relic-card" data-i="${i}" style="--rc:${meta[r.tier].color}">
          <div class="r-icon">${r.icon}</div>
          <div class="r-body">
            <div class="r-name">${r.name}</div>
            <div class="r-desc">${r.desc}</div>
          </div>
          <div class="r-tag">${meta[r.tier].name}</div>
        </div>`;
      });
      this.el.modal.innerHTML = `
        <div class="modal-inner">
          <div class="relic-modal-title">回 响 拾 遗</div>
          <div class="relic-modal-sub">第 ${this.game.wave} 波肃清 · 择其一，藏于袖中（本局永久生效）</div>
          <div class="relic-choices">${cards}</div>
        </div>`;
      this.el.modal.classList.remove('hidden');
      this.el.modal.querySelectorAll('.relic-card').forEach(card => {
        card.addEventListener('click', () => {
          const r = choices[Number(card.dataset.i)];
          this.hideModal();
          this.game.pickRelic(r);
        });
      });
    }

    hideModal() {
      this.el.modal.classList.add('hidden');
      this.el.modal.innerHTML = '';
    }

    /* ---------- 开始 / 结束画面 ---------- */
    showMenu() {
      this.el.hudTop.classList.add('hidden');
      this.el.relicBar.classList.add('hidden');
      this.el.buildBar.classList.add('hidden');
      this.el.towerPanel.classList.add('hidden');
      this.el.modal.innerHTML = `
        <div class="modal-inner">
          <div class="menu-frame ink-panel corner">
            <div class="menu-left">
              <h1 class="game-title">
                <span class="vt">棱镜</span>
                <span class="vt accent">回响</span>
              </h1>
              <div class="menu-side">
                <div class="menu-seal"><span>星</span><span>墨</span><span>手</span><span>卷</span></div>
                <div class="game-subtitle">PRISM ECHO</div>
              </div>
            </div>
            <div class="menu-right">
              <div class="menu-eyebrow">三 维 肉 鸽 · 塔 防 手 卷</div>
              <div class="menu-intro">
                星核会持续吐出一道<em>高能光束</em>——但它不瞄、不追、不回头。<br>
                你的棱镜在哪里，光就流经哪里。折出一张覆盖战场的<em class="cn">伤害光路</em>。
              </div>
              <div class="feature-grid">
                <div class="feature-card">
                  <div class="fc-icon">◈</div>
                  <h3>光束折射</h3>
                  <p>塔不各自开火：一座星核、一道光束，由你布设的棱镜链决定它烧穿哪里。</p>
                </div>
                <div class="feature-card">
                  <div class="fc-icon">✦</div>
                  <h3>随机星图</h3>
                  <p>入口、曲径、能量格与岩石皆由星盘掷出——没有两次相同的布防。</p>
                </div>
                <div class="feature-card">
                  <div class="fc-icon">⁑</div>
                  <h3>回响拾遗</h3>
                  <p>每波肃清后从十八种遗物中三选一：分光、超导、处决……缀成此卷星图。</p>
                </div>
                <div class="feature-card">
                  <div class="fc-icon">☠</div>
                  <h3>偏导体来袭</h3>
                  <p>某些星兽不畏光路——纯光阵会翻船，学会混编霜塔与脉冲炮。</p>
                </div>
              </div>
              <button id="btn-start-run" class="btn-primary btn-big">启 卷</button>
              <div class="menu-tip">十五波攻防 · 守住星核 · 通关后可入无尽长夜</div>
            </div>
          </div>
        </div>`;
      this.el.modal.classList.remove('hidden');
      document.getElementById('btn-start-run').addEventListener('click', () => {
        PE.sfx.unlock();
        PE.sfx.click();
        this.game.startRun();
      });
    }

    showVictory(stats) {
      this.el.modal.innerHTML = `
        <div class="modal-inner">
          <div class="end-title win">长夜将尽</div>
          <div class="end-sub">十五波攻势尽数肃清 · 星核之光仍在手卷上流转</div>
          <div class="end-stats corner">
            <span>肃清波次</span><b>${stats.waves}</b>
            <span>击杀总数</span><b>${stats.kills}</b>
            <span>建造次数</span><b>${stats.built}</b>
            <span>获得遗物</span><b>${stats.relicCount}</b>
            <span>星核完整度</span><b>${this.game.coreHp} / ${this.game.coreMax}</b>
          </div>
          <div class="end-actions">
            <button id="btn-endless" class="btn-primary btn-big">无尽长夜 ∞</button>
            <button id="btn-restart-win" class="btn-ghost">再启一卷</button>
          </div>
        </div>`;
      this.el.modal.classList.remove('hidden');
      document.getElementById('btn-endless').addEventListener('click', () => {
        PE.sfx.click();
        this.hideModal();
        this.game.continueEndless();
      });
      document.getElementById('btn-restart-win').addEventListener('click', () => {
        PE.sfx.click();
        this.game.startRun();
      });
    }

    showDefeat(stats) {
      this.el.modal.innerHTML = `
        <div class="modal-inner">
          <div class="end-title lose">星核沉眠</div>
          <div class="end-sub">第 ${this.game.wave} 波冲破了防线 · 但每一道折光都被星图记住了</div>
          <div class="end-stats corner">
            <span>坚持到</span><b>第 ${this.game.wave} 波</b>
            <span>击杀总数</span><b>${stats.kills}</b>
            <span>建造次数</span><b>${stats.built}</b>
            <span>获得遗物</span><b>${stats.relicCount}</b>
            <span>漏过敌人</span><b>${stats.leaked}</b>
          </div>
          <div class="end-actions">
            <button id="btn-restart-lose" class="btn-primary btn-big">再启一卷 ▶</button>
          </div>
        </div>`;
      this.el.modal.classList.remove('hidden');
      document.getElementById('btn-restart-lose').addEventListener('click', () => {
        PE.sfx.click();
        this.game.startRun();
      });
    }

    /* ---------- Toast ---------- */
    toast(msg, type) {
      const d = document.createElement('div');
      d.className = 'toast' + (type ? ' ' + type : '');
      d.textContent = msg;
      this.el.toastWrap.appendChild(d);
      while (this.el.toastWrap.children.length > 3) {
        this.el.toastWrap.removeChild(this.el.toastWrap.firstChild);
      }
      setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 2600);
    }
  };
})();
