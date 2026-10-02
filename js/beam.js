/* =====================================================
 * beam.js — ★ 核心创意机制：星核光束折射链 ★
 *
 * 常规塔防里塔各自开火。在这里：
 *   星核持续发射一道高能光束 → 光束射向「最近的棱镜塔」
 *   → 被棱镜折射射向下一个棱镜 → …… 形成一张贯穿战场的
 *   伤害光路。棱镜摆在哪里，光就流经哪里。
 *
 *   · 光路上的敌人持续受到伤害（每段独立结算）
 *   · 每折射一段，伤害衰减 12%（棱镜增益可以反向增幅）
 *   · 棱镜等级越高，光束经过时增幅越大
 *   · 遗物可让光束「分裂为两束」「永不衰减」「更宽/更聚焦」
 * ===================================================== */
(function () {
  'use strict';
  window.PE = window.PE || {};
  const U = PE.utils, C = PE.CONFIG;

  // 共享几何：单位圆柱（半径1 高1 开口），按段缩放摆放
  const SEG_GEO = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
  const DOT_GEO = new THREE.SphereGeometry(0.085, 8, 6);
  const UP = new THREE.Vector3(0, 1, 0);

  PE.BeamSystem = class {
    constructor(scene, game) {
      this.scene = scene;
      this.game = game;
      this.dirty = true;
      this.chains = [];        // [{ pts:[Vector3...], gains:[1, g1, g2...] }]
      this.segObjs = [];       // 段可视化对象池（每次 rebuild 重建）
      this.dots = [];          // 流动光珠
      this.group = new THREE.Group();
      scene.add(this.group);
      this.time = 0;
    }

    markDirty() { this.dirty = true; }

    /** 贪心折射链：从星核出发，每次射向「最近的、未被占用的棱镜」 */
    recompute() {
      const g = this.game, m = g.mods, cfg = C.BEAM;
      const prisms = g.towers.filter(t => t.type === 'prism' && t.alive);
      const corePos = g.map.coreGroup.position.clone();
      corePos.y = cfg.height;

      const maxSeg = cfg.chain + m.beamChain;
      const used = new Set();
      this.chains = [];

      for (let s = 0; s < m.beamSplits; s++) {
        let cur = corePos;
        const visited = new Set();
        const pts = [corePos.clone()];
        const gains = [1];
        for (let i = 0; i < maxSeg; i++) {
          let best = null, bd = Infinity;
          for (const p of prisms) {
            if (used.has(p) || visited.has(p)) continue;
            const d = cur.distanceTo(p.beamAnchor);
            if (d < bd) { bd = d; best = p; }
          }
          if (!best) break;
          pts.push(best.beamAnchor.clone());
          gains.push(best.gain);         // 光离开该棱镜时的增幅
          visited.add(best); used.add(best);
          cur = best.beamAnchor;
        }
        if (pts.length >= 2) this.chains.push({ pts, gains });
      }
      this._rebuildVisuals();
      this.dirty = false;
    }

    /** 第 i 段的每秒伤害（0 = 星核→第一棱镜） */
    segDps(chain, i) {
      const cfg = C.BEAM, m = this.game.mods;
      let gain = 1;
      for (let k = 1; k <= i + 1 && k < chain.gains.length; k++) {
        gain *= chain.gains[k] * (1 + m.prismGainBonus);
      }
      const decay = m.beamNoDecay ? 0 : cfg.decay;
      return cfg.baseDps * m.beamDmg * gain * Math.pow(1 - decay, i);
    }

    _rebuildVisuals() {
      // 清旧段（材质逐段新建，须同步释放；SEG_GEO / DOT_GEO 共享不可释放）
      for (const s of this.segObjs) {
        this.group.remove(s.core, s.glow);
        s.mat.dispose(); s.glowMat.dispose();
      }
      for (const d of this.dots) {
        this.group.remove(d.mesh);
        d.mesh.material.dispose();
      }
      this.segObjs = [];
      this.dots = [];

      const cfg = C.BEAM;
      let segIdx = 0;
      for (const chain of this.chains) {
        for (let i = 0; i < chain.pts.length - 1; i++) {
          const a = chain.pts[i], b = chain.pts[i + 1];
          const len = a.distanceTo(b);
          if (len < 0.01) continue;
          const mid = a.clone().add(b).multiplyScalar(0.5);
          const dir = b.clone().sub(a).normalize();
          const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir);

          // 内芯（亮）—— 月金流光
          const coreMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(0.105 - i * 0.006, 0.8, 0.8 - i * 0.05),
            transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false
          });
          const core = new THREE.Mesh(SEG_GEO, coreMat);
          core.position.copy(mid);
          core.quaternion.copy(quat);
          core.scale.set(0.045, len, 0.045);
          this.group.add(core);

          // 辉光（宽）—— 淡金晕染
          const glowMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(0.1, 0.72, 0.52 - i * 0.04),
            transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false
          });
          const glow = new THREE.Mesh(SEG_GEO, glowMat);
          glow.position.copy(mid);
          glow.quaternion.copy(quat);
          glow.scale.set(0.16 * this.game.mods.beamWidth, len, 0.16 * this.game.mods.beamWidth);
          this.group.add(glow);

          this.segObjs.push({ core, glow, mat: coreMat, glowMat, segIdx: segIdx });

          // 流动光珠（宣纸金白）
          const dotMat = new THREE.MeshBasicMaterial({
            color: 0xf5e9c5, transparent: true, opacity: 0.9,
            blending: THREE.AdditiveBlending, depthWrite: false
          });
          const dot = new THREE.Mesh(DOT_GEO, dotMat);
          this.group.add(dot);
          this.dots.push({ mesh: dot, a, b, offset: (segIdx * 0.31) % 1, speed: 1.4 });
          segIdx++;
        }
      }
    }

    update(dt) {
      if (this.dirty) this.recompute();
      this.time += dt;
      const g = this.game, m = g.mods, cfg = C.BEAM;
      const width = cfg.width * m.beamWidth;

      /* ---- 视觉：脉动 + 光珠流动 ---- */
      for (const s of this.segObjs) {
        const pulse = 0.85 + Math.sin(this.time * 9 + s.segIdx * 1.7) * 0.15;
        s.mat.opacity = 0.9 * pulse;
        s.glowMat.opacity = 0.3 * pulse;
      }
      for (const d of this.dots) {
        const t = (this.time * d.speed + d.offset) % 1;
        d.mesh.position.lerpVectors(d.a, d.b, t);
        d.mesh.scale.setScalar(0.8 + Math.sin(t * Math.PI) * 0.7);
      }

      /* ---- 伤害结算：光路上的敌人持续掉血 ---- */
      for (const chain of this.chains) {
        for (let i = 0; i < chain.pts.length - 1; i++) {
          const dps = this.segDps(chain, i);
          const a = chain.pts[i], b = chain.pts[i + 1];
          for (const e of g.enemies) {
            if (e.dead) continue;
            const d = U.pointSegDistXZ(e.x, e.z, a.x, a.z, b.x, b.z);
            if (d < width + e.size) {
              e.takeDamage(dps * dt, 'beam');
            }
          }
        }
      }
    }

    /** 供 UI 显示当前光束总 DPS */
    totalDps() {
      let sum = 0;
      for (const chain of this.chains) {
        for (let i = 0; i < chain.pts.length - 1; i++) sum += this.segDps(chain, i);
      }
      return sum;
    }

    clear() {
      for (const s of this.segObjs) {
        this.group.remove(s.core, s.glow);
        s.mat.dispose(); s.glowMat.dispose();
      }
      for (const d of this.dots) {
        this.group.remove(d.mesh);
        d.mesh.material.dispose();
      }
      this.segObjs = [];
      this.dots = [];
      this.chains = [];
    }
  };
})();
