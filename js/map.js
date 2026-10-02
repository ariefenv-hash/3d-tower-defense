/* =====================================================
 * map.js — 程序化随机地图（Roguelike 核心①）
 *  每局随机生成：
 *   · 一条从左缘入口蜿蜒到星核的路径（列严格递增折线，保证不自交）
 *   · 能量格（建造打折）/ 岩石格（不可建造）随机散布
 * ===================================================== */
(function () {
  'use strict';
  window.PE = window.PE || {};
  const U = PE.utils, C = PE.CONFIG;

  // 模块级共享几何体（跨局复用，不 dispose）
  const GEO = {
    pathTile: new THREE.BoxGeometry(1.06, 0.09, 1.06),
    energyTile: new THREE.BoxGeometry(1.06, 0.07, 1.06),
    rock: new THREE.DodecahedronGeometry(0.42),
    hoverPad: new THREE.PlaneGeometry(1.18, 1.18),
    arrow: new THREE.ConeGeometry(0.14, 0.3, 4)
  };

  PE.GameMap = class {
    constructor(scene, rng) {
      this.scene = scene;
      this.rng = rng;
      this.group = null;
      this.pathCells = [];     // 敌人行进序列 [{col,row}]
      this.pathSet = new Set();// "col,row"
      this.tiles = {};         // "col,row" -> 'rock' | 'energy'
      this.hoverPad = null;
      this.pathRunners = [];   // 路径流动光点（纯装饰）
      this.generate();
    }

    key(col, row) { return col + ',' + row; }
    isPath(col, row) { return this.pathSet.has(this.key(col, row)); }
    isRock(col, row) { return this.tiles[this.key(col, row)] === 'rock'; }
    isEnergy(col, row) { return this.tiles[this.key(col, row)] === 'energy'; }
    canBuild(col, row) {
      return col >= 0 && col < C.GRID.COLS && row >= 0 && row < C.GRID.ROWS &&
        !this.isPath(col, row) && !this.isRock(col, row);
    }
    worldPos(col, row) { return U.cellToWorld(col, row); }

    /* 释放整张星图（重开一卷时调用：旧地图若不移除会叠加显示且泄漏 GPU 资源）
       共享几何体 GEO 跨局复用，不可 dispose */
    dispose() {
      if (!this.group) return;
      this.scene.remove(this.group);
      const shared = Object.values(GEO);
      this.group.traverse(o => {
        if (o.geometry && !shared.includes(o.geometry)) o.geometry.dispose();
        if (o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
        }
      });
      this.group = null;
    }

    /* ---------- 程序化生成 ---------- */
    generate() {
      const rng = this.rng, G = C.GRID, core = C.CORE;

      // 1) 路点：入口 → 若干中间点（col 严格递增）→ 星核
      const entryRow = 1 + Math.floor(rng() * (G.ROWS - 2));
      const wps = [{ col: 0, row: entryRow }];
      let col = 2 + Math.floor(rng() * 2);
      while (col < core.col - 1) {
        wps.push({ col: col, row: Math.floor(rng() * G.ROWS) });
        col += 2 + Math.floor(rng() * 2);
      }
      wps.push({ col: core.col, row: core.row });

      // 2) 栅格化折线（交替“先垂直/先水平”，两方向均不自交）
      const cells = [];
      const push = (c, r) => {
        const last = cells[cells.length - 1];
        if (!last || last.col !== c || last.row !== r) cells.push({ col: c, row: r });
      };
      push(wps[0].col, wps[0].row);
      for (let i = 1; i < wps.length; i++) {
        const cur = wps[i - 1], tgt = wps[i];
        const vertFirst = (i % 2 === 1);
        if (vertFirst) {
          const s = Math.sign(tgt.row - cur.row) || 1;
          for (let r = cur.row + s; r !== tgt.row + s; r += s) push(cur.col, r);
          const s2 = Math.sign(tgt.col - cur.col) || 1;
          for (let c = cur.col + s2; c !== tgt.col + s2; c += s2) push(c, tgt.row);
        } else {
          const s2 = Math.sign(tgt.col - cur.col) || 1;
          for (let c = cur.col + s2; c !== tgt.col + s2; c += s2) push(c, cur.row);
          const s = Math.sign(tgt.row - cur.row) || 1;
          for (let r = cur.row + s; r !== tgt.row + s; r += s) push(tgt.col, r);
        }
      }
      this.pathCells = cells;
      this.pathSet = new Set(cells.map(c => this.key(c.col, c.row)));

      // 3) 非路径格随机刷出 岩石 / 能量格
      this.tiles = {};
      for (let cRow = 0; cRow < G.ROWS; cRow++) {
        for (let cCol = 0; cCol < G.COLS; cCol++) {
          if (this.isPath(cCol, cRow)) continue;
          const r = rng();
          if (r < 0.08) this.tiles[this.key(cCol, cRow)] = 'rock';
          else if (r < 0.21) this.tiles[this.key(cCol, cRow)] = 'energy';
        }
      }
    }

    /* ---------- 3D 可视化 ---------- */
    buildVisuals() {
      if (this.group) this.scene.remove(this.group);
      this.group = new THREE.Group();
      const G = C.GRID;

      // 建造区底板
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(G.COLS * G.CELL + 1.6, 0.14, G.ROWS * G.CELL + 1.6),
        new THREE.MeshStandardMaterial({ color: 0x11141d, roughness: 0.85, metalness: 0.25 })
      );
      base.position.y = -0.07;
      base.receiveShadow = false;
      this.group.add(base);

      // 网格线（可建区参考）
      const pts = [];
      const w = G.COLS * G.CELL, h = G.ROWS * G.CELL;
      for (let i = 0; i <= G.COLS; i++) {
        const x = -w / 2 + (i / G.COLS) * w;
        pts.push(x, 0.005, -h / 2, x, 0.005, h / 2);
      }
      for (let j = 0; j <= G.ROWS; j++) {
        const z = -h / 2 + (j / G.ROWS) * h;
        pts.push(-w / 2, 0.005, z, w / 2, 0.005, z);
      }
      const gGeo = new THREE.BufferGeometry();
      gGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
      this.group.add(new THREE.LineSegments(gGeo,
        new THREE.LineBasicMaterial({ color: 0x272b3a, transparent: true, opacity: 0.75 })));

      // 路径金尘暗道
      const pathMat = new THREE.MeshStandardMaterial({
        color: 0x1c1a12, emissive: 0x8a6d2a, emissiveIntensity: 0.5, roughness: 0.6
      });
      for (const c of this.pathCells) {
        const m = new THREE.Mesh(GEO.pathTile, pathMat);
        const p = this.worldPos(c.col, c.row);
        m.position.set(p.x, 0.045, p.z);
        this.group.add(m);
      }

      // 能量格 / 岩石
      const energyMat = new THREE.MeshStandardMaterial({
        color: 0x2a2210, emissive: 0xc9a02a, emissiveIntensity: 0.75, roughness: 0.5
      });
      const rockMat = new THREE.MeshStandardMaterial({
        color: 0x39424f, roughness: 0.95, metalness: 0.1, flatShading: true
      });
      for (const key in this.tiles) {
        const [cCol, cRow] = key.split(',').map(Number);
        const p = this.worldPos(cCol, cRow);
        if (this.tiles[key] === 'energy') {
          const m = new THREE.Mesh(GEO.energyTile, energyMat);
          m.position.set(p.x, 0.035, p.z);
          this.group.add(m);
        } else {
          const m = new THREE.Mesh(GEO.rock, rockMat);
          const s = 0.7 + this.rng() * 0.5;
          m.scale.set(s, s * 0.8, s);
          m.position.set(p.x, 0.16, p.z);
          m.rotation.set(this.rng() * 3, this.rng() * 6, this.rng() * 3);
          this.group.add(m);
        }
      }

      // 入口朱砂门（星卷裂口）
      const entry = this.worldPos(this.pathCells[0].col, this.pathCells[0].row);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.5, 0.07, 10, 32),
        new THREE.MeshBasicMaterial({ color: 0xd0492f })
      );
      ring.position.set(entry.x, 0.55, entry.z);
      ring.rotation.y = Math.PI / 2;
      this.group.add(ring);
      this.entryRing = ring;
      const gate = new THREE.Mesh(
        new THREE.CircleGeometry(0.44, 24),
        new THREE.MeshBasicMaterial({ color: 0xd0492f, transparent: true, opacity: 0.26, side: THREE.DoubleSide })
      );
      gate.position.set(entry.x, 0.55, entry.z);
      gate.rotation.y = Math.PI / 2;
      this.group.add(gate);

      // 星核（终点）—— 月白多面体 + 金环 + 暖光
      const core = this.worldPos(C.CORE.col, C.CORE.row);
      const coreGroup = new THREE.Group();
      coreGroup.position.set(core.x, 0.85, core.z);
      const coreMesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.55, 0),
        new THREE.MeshStandardMaterial({
          color: 0xd9c489, emissive: 0xc9a86a, emissiveIntensity: 1.4,
          roughness: 0.2, metalness: 0.3, flatShading: true
        })
      );
      coreGroup.add(coreMesh);
      const coreRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.85, 0.045, 10, 48),
        new THREE.MeshBasicMaterial({ color: 0xd9c489, transparent: true, opacity: 0.75 })
      );
      coreRing.rotation.x = Math.PI / 2.4;
      coreGroup.add(coreRing);
      const coreLight = new THREE.PointLight(0xc9a86a, 1.5, 8, 2);
      coreGroup.add(coreLight);
      this.group.add(coreGroup);
      this.coreGroup = coreGroup;
      this.coreMesh = coreMesh;
      this.coreRing = coreRing;

      // 悬停高亮板
      this.hoverValidMat = new THREE.MeshBasicMaterial({
        color: 0x9fc9a8, transparent: true, opacity: 0.35, side: THREE.DoubleSide
      });
      this.hoverInvalidMat = new THREE.MeshBasicMaterial({
        color: 0xe05a41, transparent: true, opacity: 0.35, side: THREE.DoubleSide
      });
      this.hoverPad = new THREE.Mesh(GEO.hoverPad, this.hoverValidMat);
      this.hoverPad.rotation.x = -Math.PI / 2;
      this.hoverPad.visible = false;
      this.group.add(this.hoverPad);

      // 路径金尘流萤（装饰，指示行进方向）
      this.pathRunners = [];
      const runnerMat = new THREE.MeshBasicMaterial({ color: 0xd8c896, transparent: true, opacity: 0.85 });
      for (let i = 0; i < 4; i++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), runnerMat);
        this.group.add(m);
        this.pathRunners.push({ mesh: m, t: i / 4, speed: 0.045 + this.rng() * 0.02 });
      }

      this.scene.add(this.group);
    }

    setHover(col, row, valid) {
      if (col === null) { this.hoverPad.visible = false; return; }
      const p = this.worldPos(col, row);
      this.hoverPad.visible = true;
      this.hoverPad.position.set(p.x, 0.1, p.z);
      this.hoverPad.material = valid ? this.hoverValidMat : this.hoverInvalidMat;
    }

    update(dt) {
      if (this.entryRing) this.entryRing.rotation.z += dt * 0.8;
      if (this.coreGroup) {
        this.coreGroup.rotation.y += dt * 0.7;
        this.coreMesh.rotation.x += dt * 0.35;
        this.coreRing.rotation.z += dt * 0.5;
        const s = 1 + Math.sin(performance.now() * 0.002) * 0.05;
        this.coreMesh.scale.setScalar(s);
      }
      // 流动光尘沿路径
      if (this.pathRunners.length && this.pathCells.length > 1) {
        for (const r of this.pathRunners) {
          r.t = (r.t + dt * r.speed) % 1;
          const f = r.t * (this.pathCells.length - 1);
          const i = Math.floor(f), frac = f - i;
          const a = this.pathCells[i], b = this.pathCells[Math.min(i + 1, this.pathCells.length - 1)];
          const pa = this.worldPos(a.col, a.row), pb = this.worldPos(b.col, b.row);
          r.mesh.position.set(
            U.lerp(pa.x, pb.x, frac), 0.22, U.lerp(pa.z, pb.z, frac)
          );
        }
      }
    }
  };
})();
