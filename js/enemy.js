/* =====================================================
 * enemy.js — 敌人实体（沿随机路径推进 / 状态视觉 / 分裂）
 * ===================================================== */
(function () {
  'use strict';
  window.PE = window.PE || {};
  const U = PE.utils, C = PE.CONFIG;

  // 共享几何体
  const GEO = {
    octa: s => new THREE.OctahedronGeometry(s),
    tetra: s => new THREE.TetrahedronGeometry(s * 1.15),
    box: s => new THREE.BoxGeometry(s * 1.75, s * 1.45, s * 1.75),
    ico: s => new THREE.IcosahedronGeometry(s, 0),
    dodeca: s => new THREE.DodecahedronGeometry(s),
    boss: s => new THREE.IcosahedronGeometry(s, 0)
  };
  const HP_BAR_W = 0.72;

  PE.Enemy = class {
    /**
     * @param game  Game 实例
     * @param type  敌人 key（CONFIG.ENEMIES）
     * @param wave  当前波数（决定 HP 缩放）
     * @param at    可选 { idx, prog } 出生在路径中途（分裂体用）
     */
    constructor(game, type, wave, at) {
      this.game = game;
      this.type = type;
      this.def = C.ENEMIES[type];
      this.wave = wave;
      this.isBoss = type === 'boss';

      const hpMul = this.isBoss
        ? this._bossHpMul(wave)
        : C.waveHpMul(wave) * (game.endless && wave > C.MAX_WAVE ? 1 + (wave - C.MAX_WAVE) * C.ENDLESS.hpGrowth : 1);
      this.maxHp = Math.round(this.def.hp * hpMul);
      this.hp = this.maxHp;
      this.speed = this.def.speed;
      this.size = this.def.size;
      this.bounty = this.def.bounty;

      this.idx = at ? at.idx : 0;
      this.prog = at ? at.prog : 0;
      this.slowPct = 0;        // 每帧由霜塔写入
      this.flashT = 0;
      this.phase = Math.random() * Math.PI * 2;
      this.dead = false;
      this.x = 0; this.z = 0;

      this._buildMesh();
      this._syncPos();
    }

    _bossHpMul(wave) {
      // Boss 血量按波次档位提升（5/10/15 波，无尽继续涨）
      const tiers = { 5: 1, 10: 3.2, 15: 9.5 };
      let mul = tiers[wave] || 1;
      if (wave > C.MAX_WAVE) mul = 9.5 * (1 + (wave - C.MAX_WAVE) * C.ENDLESS.hpGrowth);
      return mul;
    }

    _buildMesh() {
      const d = this.def;
      this.group = new THREE.Group();
      this.mat = new THREE.MeshStandardMaterial({
        color: d.color, emissive: d.color, emissiveIntensity: 0.55,
        roughness: 0.35, metalness: 0.35, flatShading: true
      });
      this.body = new THREE.Mesh(GEO[d.geo](d.size), this.mat);
      this.body.castShadow = false;
      this.group.add(this.body);

      if (this.isBoss) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(d.size * 1.5, 0.06, 8, 40),
          new THREE.MeshBasicMaterial({ color: 0xd9b06e })
        );
        ring.rotation.x = Math.PI / 2.3;
        this.group.add(ring);
        this.ring = ring;
      }
      if (this.def.beamResist) {
        // 偏导体：半透明护盾壳（视觉提示：光束抗性）
        const shell = new THREE.Mesh(
          new THREE.SphereGeometry(d.size * 1.6, 12, 10),
          new THREE.MeshBasicMaterial({
            color: 0x7fae94, transparent: true, opacity: 0.18,
            blending: THREE.AdditiveBlending, depthWrite: false
          })
        );
        this.group.add(shell);
      }

      // 双面板血条（billboard）
      this.bar = new THREE.Group();
      const bg = new THREE.Mesh(
        new THREE.PlaneGeometry(HP_BAR_W, 0.075),
        new THREE.MeshBasicMaterial({ color: 0x101820, transparent: true, opacity: 0.85, depthTest: false })
      );
      this.barFill = new THREE.Mesh(
        new THREE.PlaneGeometry(HP_BAR_W, 0.075),
        new THREE.MeshBasicMaterial({ color: 0xc8452e, depthTest: false })
      );
      this.barFill.position.z = 0.002;
      bg.renderOrder = 90; this.barFill.renderOrder = 91;
      this.bar.add(bg, this.barFill);
      this.bar.position.y = d.size + 0.55;
      this.bar.scale.setScalar(this.isBoss ? 1.6 : 1);
      this.bar.visible = false;
      this.group.add(this.bar);

      this.game.scene.scene.add(this.group);
    }

    get pathT() { return this.idx + this.prog; }

    takeDamage(amount, src) {
      if (this.dead) return;
      const m = this.game.mods;
      let dmg = amount;
      const frac = this.hp / this.maxHp;
      if (frac > 0.6) dmg *= m.huntMul;
      else if (frac < 0.3) dmg *= m.execMul;
      if (src === 'beam' && this.def.beamResist) dmg *= this.def.beamResist;
      this.hp -= dmg;
      this.flashT = 0.09;
      if (this.hp <= 0) this.die();
    }

    die() {
      if (this.dead) return;
      this.dead = true;
      const g = this.game;
      g.fx.burst(this.x, 0.5, this.z, this.def.color, this.isBoss ? 26 : 9, this.isBoss ? 5 : 2.6);
      g.onKill(this);
      // 裂生体：原地分裂出两只游袭者
      if (this.def.splitsInto) {
        const [childType, n] = this.def.splitsInto;
        for (let i = 0; i < n; i++) {
          g.spawnEnemy(childType, this.wave, { idx: this.idx, prog: this.prog });
        }
      }
      g.scene.scene.remove(this.group);
    }

    leak() {
      if (this.dead) return;
      this.dead = true;
      const g = this.game;
      g.damageCore(this.def.coreDmg);
      g.scene.scene.remove(this.group);
    }

    update(dt) {
      if (this.dead) return;
      const g = this.game, path = g.map.pathCells;
      if (!path || path.length < 2) return;

      // 移动（受减速影响）
      const speed = this.speed * (1 - this.slowPct);
      let move = speed * dt;
      while (move > 0 && this.idx < path.length - 1) {
        const segLeft = 1 - this.prog;
        if (move < segLeft) { this.prog += move; move = 0; }
        else { move -= segLeft; this.idx++; this.prog = 0; }
      }
      if (this.idx >= path.length - 1 && this.prog >= 1 - 1e-6) { this.leak(); return; }
      if (this.idx >= path.length - 1) { this.prog = Math.min(this.prog, 0.9999); }

      this._syncPos();

      // 浮动 / 旋转动画
      const t = g.time;
      this.group.position.y = 0.42 + Math.sin(t * 3 + this.phase) * 0.08;
      this.body.rotation.y += dt * (this.type === 'runner' ? 5 : 1.2);
      this.body.rotation.x += dt * 0.5;
      if (this.ring) this.ring.rotation.z += dt * 2;

      // 受击闪白
      if (this.flashT > 0) {
        this.flashT -= dt;
        this.mat.emissiveIntensity = 2.6;
      } else {
        this.mat.emissiveIntensity = 0.55 + Math.sin(t * 2.4 + this.phase) * 0.15;
      }

      // 血条
      const frac = U.clamp(this.hp / this.maxHp, 0, 1);
      this.bar.visible = frac < 0.999;
      this.barFill.scale.x = frac || 0.0001;
      this.barFill.position.x = -(1 - frac) * HP_BAR_W / 2;
      if (this.isBoss) {
        this.barFill.material.color.setHex(frac > 0.5 ? 0xc8452e : (frac > 0.25 ? 0xd08a3e : 0xa8322e));
      }
      this.bar.quaternion.copy(g.scene.camera.quaternion);
    }

    _syncPos() {
      const path = this.game.map.pathCells;
      const a = path[Math.min(this.idx, path.length - 1)];
      const b = path[Math.min(this.idx + 1, path.length - 1)];
      const wa = U.cellToWorld(a.col, a.row);
      const wb = U.cellToWorld(b.col, b.row);
      this.x = U.lerp(wa.x, wb.x, this.prog);
      this.z = U.lerp(wa.z, wb.z, this.prog);
      this.group.position.x = this.x;
      this.group.position.z = this.z;
    }

    dispose() {
      this.game.scene.scene.remove(this.group);
      this.mat.dispose();
    }
  };
})();
