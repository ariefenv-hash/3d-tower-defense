/* =====================================================
 * game.js — 游戏主控（状态机 / 经济 / 特效池 / 胜负）
 *
 * 状态流：menu → build ⇄ wave → relic → build → …
 *         → over（失败 / 15波通关 → 可转入无尽模式）
 * ===================================================== */
(function () {
  'use strict';
  window.PE = window.PE || {};
  const U = PE.utils, C = PE.CONFIG;

  /* ============ 粒子特效池 ============ */
  PE.Fx = class {
    constructor(scene) {
      this.scene = scene;
      this.parts = [];
      const geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
      for (let i = 0; i < 140; i++) {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false
        }));
        m.visible = false;
        scene.add(m);
        this.parts.push({ mesh: m, life: 0, t: 0, vx: 0, vy: 0, vz: 0 });
      }
      this.rings = [];
      const rGeo = new THREE.RingGeometry(0.88, 1, 40);
      for (let i = 0; i < 16; i++) {
        const m = new THREE.Mesh(rGeo, new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0.8,
          side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
        }));
        m.rotation.x = -Math.PI / 2;
        m.visible = false;
        scene.add(m);
        this.rings.push({ mesh: m, life: 0, t: 0, maxR: 2 });
      }
    }

    burst(x, y, z, color, n, speed) {
      n = n || 8; speed = speed || 2.5;
      for (let i = 0; i < n; i++) {
        let p = null;
        for (const q of this.parts) { if (q.life <= 0) { p = q; break; } }
        if (!p) return;
        p.mesh.visible = true;
        p.mesh.position.set(x, y, z);
        p.mesh.material.color.setHex(color);
        p.mesh.material.opacity = 1;
        p.mesh.scale.setScalar(0.7 + Math.random() * 0.9);
        const a = Math.random() * Math.PI * 2;
        p.vx = Math.cos(a) * speed * (0.4 + Math.random() * 0.7);
        p.vz = Math.sin(a) * speed * (0.4 + Math.random() * 0.7);
        p.vy = 0.5 + Math.random() * 1.7;
        p.t = p.life = 0.45 + Math.random() * 0.3;
      }
    }

    flash(x, y, z, color) { this.burst(x, y, z, color, 1, 0.8); }

    ring(x, z, color, level) {
      for (const r of this.rings) {
        if (r.life <= 0) {
          r.mesh.visible = true;
          r.mesh.position.set(x, 0.12, z);
          r.mesh.material.color.setHex(color);
          r.t = r.life = 0.5;
          r.maxR = 0.9 + (level || 1) * 0.5;
          return;
        }
      }
    }

    update(dt) {
      for (const p of this.parts) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) { p.mesh.visible = false; continue; }
        p.vy -= 5.5 * dt;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        if (p.mesh.position.y < 0.05) {
          p.mesh.position.y = 0.05;
          p.vy *= -0.35; p.vx *= 0.6; p.vz *= 0.6;
        }
        p.mesh.rotation.x += dt * 7;
        p.mesh.rotation.y += dt * 5;
        p.mesh.material.opacity = Math.min(1, p.life * 2.4);
      }
      for (const r of this.rings) {
        if (r.life <= 0) continue;
        r.life -= dt;
        if (r.life <= 0) { r.mesh.visible = false; continue; }
        const t = 1 - r.life / r.t;
        r.mesh.scale.setScalar(0.15 + t * r.maxR);
        r.mesh.material.opacity = 0.75 * (1 - t);
      }
    }

    clear() {
      for (const p of this.parts) { p.life = 0; p.mesh.visible = false; }
      for (const r of this.rings) { r.life = 0; r.mesh.visible = false; }
    }
  };

  /* ============ 游戏主类 ============ */
  PE.Game = class {
    constructor(sceneMgr) {
      this.scene = sceneMgr;
      this.fx = new PE.Fx(sceneMgr.scene);
      this.beams = new PE.BeamSystem(sceneMgr.scene, this);
      this.waves = new PE.WaveManager(this);
      this.ui = null;    // main.js 注入
      this.input = null;

      this.state = 'menu';
      this.endless = false;
      this.time = 0;
      this.map = null;
      this.rng = Math.random;

      this.towers = [];
      this.towerMap = new Map();   // "col,row" -> tower
      this.enemies = [];

      this.stats = { kills: 0, waves: 0, built: 0, relicCount: 0, leaked: 0 };
      this.ownedRelics = new Set();

      this._resetRun();
    }

    _resetRun() {
      this.energy = C.BUILD.startEnergy;
      this.coreMax = C.CORE.maxHp;
      this.coreHp = this.coreMax;
      this.wave = 0;
      this.buildCountdown = null;
      this.selected = null;
      this.buildType = null;
      this.coreFlashT = 0;
      this.mods = {
        beamDmg: 1, beamChain: 0, beamSplits: 1, beamWidth: 1,
        beamNoDecay: false, prismGainBonus: 0, hasFocus: false, hasWidth: false,
        frostSlowBonus: 0, frostDpsMul: 1,
        pulseRateMul: 1, pulseDmgMul: 1,
        bountyMul: 1, interest: 0, buildCostMul: 1,
        enemySlowField: false, secondLife: false, secondLifeUsed: false,
        huntMul: 1, execMul: 1
      };
    }

    /* ---------- 开局 / 重开 ---------- */
    startRun() {
      // 清场
      if (this.map) { this.map.dispose(); this.map = null; } // 旧星图：移出场景并释放（防叠加/泄漏）
      for (const t of this.towers) t.dispose();
      this.towers = [];
      this.towerMap.clear();
      for (const e of this.enemies) e.dispose();
      this.enemies = [];
      PE.clearProjectiles(this);
      this.beams.clear();
      this.fx.clear();
      this.ownedRelics = new Set();
      this.stats = { kills: 0, waves: 0, built: 0, relicCount: 0, leaked: 0 };
      this._resetRun();

      // 每局新的随机地图（Roguelike：程序化生成）
      const seed = U.randSeed();
      this.rng = U.makeRng(seed);
      this.map = new PE.GameMap(this.scene.scene, this.rng);
      this.map.buildVisuals();

      this.endless = false;
      this.state = 'build';
      this.beams.markDirty();

      if (this.ui) this.ui.onRunStart(seed);
      PE.sfx.wave();
    }

    /* ---------- 波次流转 ---------- */
    startWave() {
      if (this.state !== 'build') return;
      this.wave++;
      this.waves.setup(this.wave);
      this.waves.start();
      this.state = 'wave';
      this.buildCountdown = null;
      const hasBoss = C.WAVES[this.wave - 1] && C.WAVES[this.wave - 1].some(g => g.t === 'boss');
      if (hasBoss || (this.endless && this.wave % 5 === 0)) {
        if (this.ui) this.ui.toast('⚠ 湮灭核心逼近！', 'bad');
        PE.sfx.boss();
      } else {
        PE.sfx.wave();
      }
      if (this.ui) this.ui.onWaveStart();
    }

    _endWave() {
      this.state = 'relic';
      this.stats.waves = this.wave;

      // 波次奖励 + 利息
      let reward = C.WAVE_REWARD.base + this.wave * C.WAVE_REWARD.per;
      if (this.mods.interest > 0) {
        reward += Math.min(Math.floor(this.energy * this.mods.interest), 40);
      }
      this.energy += reward;
      if (this.ui) {
        this.ui.toast(`波次奖励 +${reward} 能量`, 'gold');
        this.ui.refresh();
      }

      // 通关判定
      if (this.wave >= C.MAX_WAVE && !this.endless) {
        PE.sfx.win();
        if (this.ui) this.ui.showVictory(this.stats);
        this.state = 'over';
        return;
      }

      // Roguelike 三选一（无尽后期遗物拾尽时 offer 会自动补星屑残页，永不返空）
      const choices = PE.relics.offer(this, 3);
      if (this.ui) this.ui.showRelicChoices(choices);
    }

    pickRelic(relic) {
      relic.apply(this);
      this.ownedRelics.add(relic.id);
      this.stats.relicCount++;
      PE.sfx.relic();
      if (this.ui) {
        this.ui.addRelicIcon(relic);
        this.ui.toast(`获得回响 · ${relic.name}`, 'gold');
      }
      this._enterBuildPhase();
    }

    /** 防御出口：无遗物可拾时直接进入备战（与 pickRelic 同一流转，
     *  保证任何情况下 'relic' 状态都有出路，杜绝流程锁死） */
    skipRelic() {
      this._enterBuildPhase();
    }

    _enterBuildPhase() {
      // 进入下一波准备
      this.state = 'build';
      this.buildCountdown = C.BUILD_TIME;
      if (this.ui) this.ui.onBuildPhase();
    }

    continueEndless() {
      this.endless = true;
      this.state = 'build';
      this.buildCountdown = null;
      if (this.ui) this.ui.onBuildPhase();
    }

    /* ---------- 建造 ---------- */
    towerAt(col, row) { return this.towerMap.get(col + ',' + row) || null; }

    priceOf(type) {
      const def = C.TOWERS[type];
      return Math.round(def.cost * this.mods.buildCostMul);
    }

    placeTower(type, col, row) {
      if (!this.map.canBuild(col, row) || this.towerAt(col, row)) return { ok: false, why: 'blocked' };
      let cost = this.priceOf(type);
      if (this.map.isEnergy(col, row)) {
        cost = Math.round(cost * (1 - C.BUILD.energyTileDiscount));
      }
      if (this.energy < cost) return { ok: false, why: 'energy' };

      this.energy -= cost;
      const t = new PE.Tower(this, type, col, row);
      t.spent = cost;
      this.towers.push(t);
      this.towerMap.set(col + ',' + row, t);
      this.stats.built++;
      PE.sfx.place();
      this.beams.markDirty();
      if (this.ui) this.ui.refresh();
      return { ok: true, cost };
    }

    upgradeTower(t) {
      const up = t.upCost;
      if (up === null) return false;
      const cost = Math.round(up * this.mods.buildCostMul);
      if (this.energy < cost) return false;
      this.energy -= cost;
      t.upgrade();
      PE.sfx.upgrade();
      this.beams.markDirty();
      if (this.ui) this.ui.refresh();
      return true;
    }

    sellTower(t) {
      const val = t.sellValue;
      this.energy += val;
      t.dispose();
      this.towers.splice(this.towers.indexOf(t), 1);
      this.towerMap.delete(t.col + ',' + t.row);
      this.beams.markDirty();
      if (this.input) this.input.deselect();
      PE.sfx.sell();
      if (this.ui) {
        this.ui.toast(`回收 +${val} 能量`);
        this.ui.refresh();
      }
      return val;
    }

    /* ---------- 敌人 / 伤害 ---------- */
    spawnEnemy(type, wave, at) {
      if (this.enemies.length > 90) return null;
      const e = new PE.Enemy(this, type, wave, at);
      this.enemies.push(e);
      return e;
    }

    onKill(e) {
      this.stats.kills++;
      const gain = Math.round(e.bounty * this.mods.bountyMul);
      this.energy += gain;
      PE.sfx.kill();
      if (e.isBoss) {
        PE.sfx.boss();
        this.fx.ring(e.x, e.z, 0xd0492f, 4);
        if (this.ui) this.ui.toast(`湮灭核心已被摧毁！+${gain} 能量`, 'gold');
      }
      if (this.ui) this.ui.refresh();
    }

    damageCore(n) {
      this.coreHp -= n;
      this.stats.leaked++;
      this.coreFlashT = 0.5;
      this.scene.shake(0.5);
      PE.sfx.leak();
      if (this.coreHp <= 0) {
        if (this.mods.secondLife && !this.mods.secondLifeUsed) {
          this.mods.secondLifeUsed = true;
          this.coreHp = 1;
          if (this.ui) this.ui.toast('☾ 备用核心生效：星核在崩溃边缘稳住了！', 'gold');
        } else {
          this.coreHp = 0;
          this._gameOver();
          return;
        }
      }
      if (this.ui) this.ui.refreshCore();
    }

    _gameOver() {
      this.state = 'over';
      PE.sfx.lose();
      this.scene.shake(1.1);
      this.fx.burst(this.map.coreGroup.position.x, 1, this.map.coreGroup.position.z, 0xd9c489, 40, 6);
      if (this.ui) this.ui.showDefeat(this.stats);
    }

    /* ---------- 主循环 ---------- */
    update(dt) {
      this.time += dt;
      if (this.map) this.map.update(dt);
      this.scene.update(dt);
      this.fx.update(dt);

      // 星核受击闪烁
      if (this.coreFlashT > 0 && this.map && this.map.coreMesh) {
        this.coreFlashT -= dt;
        const k = Math.max(0, this.coreFlashT) / 0.5;
        this.map.coreMesh.material.emissive.setHSL(0.98, 0.9, 0.25 + 0.4 * k);
      }

      if (this.state === 'build') {
        if (this.buildCountdown !== null) {
          this.buildCountdown -= dt;
          if (this.buildCountdown <= 0) { this.startWave(); }
          else if (this.ui) this.ui.updateCountdown(this.buildCountdown);
        }
      }

      // 光束系统：建造阶段也持续渲染（放塔即时可见光路），无敌人时伤害自然为空
      if (this.map && (this.state === 'build' || this.state === 'wave')) {
        this.beams.update(dt);
      }

      if (this.state === 'wave') {
        this.waves.update(dt);

        // 重置减速标记（霜塔随后写入）
        for (const e of this.enemies) e.slowPct = 0;

        for (const t of this.towers) t.update(dt);
        for (const e of this.enemies) e.update(dt);

        // 清理死亡（分裂体已在 die() 中补入）
        for (let i = this.enemies.length - 1; i >= 0; i--) {
          if (this.enemies[i].dead) { this.enemies[i].dispose(); this.enemies.splice(i, 1); }
        }

        PE.updateProjectiles(this, dt);

        if (this.waves.done && this.enemies.length === 0 && this.state === 'wave') {
          this._endWave();
        }
      }
    }
  };
})();
