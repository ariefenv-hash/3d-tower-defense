/* =====================================================
 * tower.js — 三系防御塔 + 弹丸
 *  ◈ 棱镜：折射星核光束（核心机制载体，本身不攻击）
 *  ❄ 霜塔：范围减速力场
 *  ✦ 脉冲炮：单体弹丸（可靠补刀）
 * ===================================================== */
(function () {
  'use strict';
  window.PE = window.PE || {};
  const U = PE.utils, C = PE.CONFIG;

  const BASE_GEO = new THREE.BoxGeometry(0.92, 0.2, 0.92);
  const LV_RING_GEO = new THREE.TorusGeometry(0.55, 0.035, 8, 28);
  const PROJ_GEO = new THREE.SphereGeometry(0.11, 8, 6);

  PE.Tower = class {
    constructor(game, type, col, row) {
      this.game = game;
      this.type = type;
      this.def = C.TOWERS[type];
      this.col = col; this.row = row;
      this.level = 0;                 // levels 数组下标
      this.spent = this.costPaid;     // 累计投入（回收计算）
      this.cd = 0;
      this.alive = true;
      this.phase = Math.random() * Math.PI * 2;
      const w = U.cellToWorld(col, row);
      this.x = w.x; this.z = w.z;
      this.beamAnchor = new THREE.Vector3(this.x, C.BEAM.height, this.z);
      this._buildMesh();
    }

    get costPaid() {
      const base = this._energyTile()
        ? Math.round(this.def.cost * (1 - C.BUILD.energyTileDiscount))
        : this.def.cost;
      return base;
    }
    _energyTile() { return this.game.map.isEnergy(this.col, this.row); }

    get lv() { return this.def.levels[this.level]; }
    get gain() { return this.type === 'prism' ? this.lv.gain : 1; }
    get upCost() { return this.def.levels[this.level + 1] ? this.def.levels[this.level + 1].upCost : null; }
    get sellValue() { return Math.round(this.spent * C.BUILD.sellRefund); }

    _buildMesh() {
      if (this.group) this._disposeMesh(); // 升级重建：旧 mesh 移出并释放（防 GPU 泄漏）
      this.group = new THREE.Group();
      this.group.position.set(this.x, 0, this.z);

      const color = this.def.color;
      // 底座
      const s = 1 + this.level * 0.12;
      const base = new THREE.Mesh(BASE_GEO, new THREE.MeshStandardMaterial({
        color: 0x1a2438, roughness: 0.7, metalness: 0.55
      }));
      base.scale.setScalar(s);
      base.position.y = 0.1;
      this.group.add(base);

      // 等级环（Lv2/Lv3 底座叠环）
      const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
      for (let i = 0; i < this.level; i++) {
        const r = new THREE.Mesh(LV_RING_GEO, ringMat);
        r.rotation.x = Math.PI / 2;
        r.position.y = 0.06 + i * 0.07;
        r.scale.setScalar(0.95 + this.level * 0.06);
        this.group.add(r);
      }

      const lvS = 1 + this.level * 0.18;

      if (this.type === 'prism') {
        // 悬浮八面体棱镜（线框 + 内芯）
        const core = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.34 * lvS, 0),
          new THREE.MeshStandardMaterial({
            color: 0x2c3a36, emissive: color, emissiveIntensity: 0.5 + this.level * 0.22,
            roughness: 0.15, metalness: 0.6, transparent: true, opacity: 0.85, flatShading: true
          })
        );
        core.position.y = 0.85;
        this.group.add(core);
        this.spin = core;
        const wire = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.42 * lvS, 0),
          new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.55 })
        );
        wire.position.y = 0.85;
        core.add(wire);
        // 支柱
        const pillar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.09, 0.7, 6),
          new THREE.MeshStandardMaterial({ color: 0x22304a, metalness: 0.7, roughness: 0.4 })
        );
        pillar.position.y = 0.42;
        this.group.add(pillar);
      } else if (this.type === 'frost') {
        const crystal = new THREE.Mesh(
          new THREE.CylinderGeometry(0.26 * lvS, 0.34 * lvS, 0.72 * lvS, 6),
          new THREE.MeshStandardMaterial({
            color: 0x2a3448, emissive: color, emissiveIntensity: 0.45 + this.level * 0.2,
            roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.8, flatShading: true
          })
        );
        crystal.position.y = 0.55;
        this.group.add(crystal);
        this.spin = crystal;
        // 力场指示环（呼吸）
        this.auraRing = new THREE.Mesh(
          new THREE.RingGeometry(this.lv.radius - 0.12, this.lv.radius, 48),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
        );
        this.auraRing.rotation.x = -Math.PI / 2;
        this.auraRing.position.y = 0.09;
        this.group.add(this.auraRing);
      } else {
        // 脉冲炮：可旋转炮塔
        const turret = new THREE.Group();
        const housing = new THREE.Mesh(
          new THREE.CylinderGeometry(0.3 * lvS, 0.38 * lvS, 0.3, 8),
          new THREE.MeshStandardMaterial({ color: 0x2a2f24, metalness: 0.6, roughness: 0.5 })
        );
        turret.add(housing);
        const barrel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.07, 0.1, 0.75 * lvS, 8),
          new THREE.MeshStandardMaterial({
            color: 0x333a2a, emissive: color, emissiveIntensity: 0.35, metalness: 0.75, roughness: 0.35
          })
        );
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.14, 0.4 * lvS);
        turret.add(barrel);
        const muzzle = new THREE.Mesh(
          new THREE.SphereGeometry(0.1 * lvS, 8, 6),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 })
        );
        muzzle.position.set(0, 0.14, 0.78 * lvS);
        turret.add(muzzle);
        turret.position.y = 0.36;
        this.group.add(turret);
        this.turret = turret;
      }

      // 建造/升级闪光
      this.game.fx.ring(this.x, this.z, color, this.level + 1);
      this.game.scene.scene.add(this.group);
      this.game.beams.markDirty();
    }

    upgrade() {
      if (this.upCost === null) return false;
      this.spent += this.upCost;
      this.level++;
      this._buildMesh();
      return true;
    }

    update(dt) {
      const g = this.game;

      if (this.type === 'prism') {
        if (this.spin) {
          this.spin.rotation.y += dt * (1.1 + this.level * 0.5);
          this.spin.position.y = 0.85 + Math.sin(g.time * 2 + this.phase) * 0.07;
        }
        return;
      }

      if (this.type === 'frost') {
        const lv = this.lv, m = g.mods;
        const slow = Math.min(0.85, lv.slow + m.frostSlowBonus);
        const dps = lv.dps * m.frostDpsMul;
        let any = false;
        for (const e of g.enemies) {
          if (e.dead) continue;
          if (U.dist2D(this.x, this.z, e.x, e.z) <= lv.radius + e.size) {
            e.slowPct = Math.max(e.slowPct, slow);
            e.takeDamage(dps * dt, 'frost');
            any = true;
          }
        }
        if (this.auraRing) {
          const pulse = any ? 0.32 + Math.sin(g.time * 5) * 0.12 : 0.18;
          this.auraRing.material.opacity = pulse;
        }
        return;
      }

      // pulse
      if (this.turret) {
        const lv = this.lv, m = g.mods;
        const range = lv.range;
        let target = null, bestT = -1;
        for (const e of g.enemies) {
          if (e.dead) continue;
          if (U.dist2D(this.x, this.z, e.x, e.z) <= range + e.size) {
            if (e.pathT > bestT) { bestT = e.pathT; target = e; }
          }
        }
        if (target) {
          // 炮塔朝向目标
          const ang = Math.atan2(target.x - this.x, target.z - this.z);
          this.turret.rotation.y = ang;
        }
        this.cd -= dt;
        if (this.cd <= 0 && target) {
          this.cd = lv.cd / m.pulseRateMul;
          PE.spawnProjectile(this, target, lv.dmg * m.pulseDmgMul);
          g.fx.flash(this.x, 0.55, this.z, 0xffe9a0);
          PE.sfx.pulse();
        }
      }
    }

    dispose() {
      this._disposeMesh();
    }

    /* 移出场景并释放本塔独占的几何体/材质；
       BASE_GEO / LV_RING_GEO / PROJ_GEO 为模块级共享，跨塔复用不可释放 */
    _disposeMesh() {
      if (!this.group) return;
      this.game.scene.scene.remove(this.group);
      const shared = [BASE_GEO, LV_RING_GEO, PROJ_GEO];
      this.group.traverse(o => {
        if (o.geometry && !shared.includes(o.geometry)) o.geometry.dispose();
        if (o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
        }
      });
      this.group = null;
    }
  };

  /* ---------------- 弹丸 ---------------- */
  PE.projectiles = [];

  PE.spawnProjectile = function (tower, target, dmg) {
    const geo = PROJ_GEO;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xd9b06e, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(tower.x, 0.6, tower.z);
    tower.game.scene.scene.add(mesh);
    PE.projectiles.push({
      mesh, target, dmg,
      speed: 15, life: 2.2,
      vx: 0, vz: 0
    });
  };

  PE.updateProjectiles = function (game, dt) {
    for (let i = PE.projectiles.length - 1; i >= 0; i--) {
      const p = PE.projectiles[i];
      p.life -= dt;
      let hit = false;

      if (p.target && !p.target.dead) {
        const dx = p.target.x - p.mesh.position.x;
        const dz = p.target.z - p.mesh.position.z;
        const dy = 0.5 - p.mesh.position.y;
        const d = Math.sqrt(dx * dx + dz * dz + dy * dy) || 1e-6;
        // 记录当前飞行方向：目标中途死亡时按此方向直飞
        p.vx = (dx / d) * p.speed;
        p.vz = (dz / d) * p.speed;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += (dy / d) * p.speed * dt;
        p.mesh.position.z += p.vz * dt;
        if (d < 0.35) hit = true;
      } else {
        // 目标已死：沿最后方向直飞直至 life 耗尽自毁
        //（原实现为空操作，弹丸会冻结悬在空中直到超时）
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.z += p.vz * dt;
      }

      if (hit || p.life <= 0) {
        if (hit && p.target && !p.target.dead) {
          p.target.takeDamage(p.dmg, 'pulse');
          game.fx.burst(p.mesh.position.x, p.mesh.position.y, p.mesh.position.z, 0xd9b06e, 4, 1.6);
        }
        game.scene.scene.remove(p.mesh);
        p.mesh.material.dispose();
        PE.projectiles.splice(i, 1);
      }
    }
  };

  PE.clearProjectiles = function (game) {
    for (const p of PE.projectiles) {
      game.scene.scene.remove(p.mesh);
      p.mesh.material.dispose();
    }
    PE.projectiles = [];
  };

  /* ---------------- 建造幽灵（预览） ---------------- */
  PE.makeGhost = function (type) {
    const def = C.TOWERS[type];
    const mat = new THREE.MeshBasicMaterial({
      color: def.color, transparent: true, opacity: 0.4, depthWrite: false
    });
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.36, 0), mat);
    mesh.position.y = 0.6;
    return mesh;
  };
})();
