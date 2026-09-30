/* =====================================================
 * utils.js — 数学 / 随机数 / 坐标换算 工具集
 * ===================================================== */
(function () {
  'use strict';
  window.PE = window.PE || {};

  PE.utils = {
    /** mulberry32 — 可复现的种子随机数（Roguelike 精神：每局一个 seed） */
    makeRng(seed) {
      let a = seed >>> 0;
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    randSeed() { return (Math.random() * 0xFFFFFFFF) >>> 0; },

    clamp(v, min, max) { return v < min ? min : (v > max ? max : v); },
    lerp(a, b, t) { return a + (b - a) * t; },
    dist2D(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); },

    /** 点到线段的 XZ 平面距离（光束命中判定用） */
    pointSegDistXZ(px, pz, ax, az, bx, bz) {
      const abx = bx - ax, abz = bz - az;
      const len2 = abx * abx + abz * abz;
      let t = len2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / len2 : 0;
      t = PE.utils.clamp(t, 0, 1);
      const cx = ax + abx * t, cz = az + abz * t;
      return Math.sqrt((px - cx) * (px - cx) + (pz - cz) * (pz - cz));
    },

    /** 格子坐标 → 世界坐标（网格居中） */
    cellToWorld(col, row) {
      const G = PE.CONFIG.GRID;
      return {
        x: (col - (G.COLS - 1) / 2) * G.CELL,
        z: (row - (G.ROWS - 1) / 2) * G.CELL
      };
    },

    /** 世界坐标 → 格子坐标（若在网格内） */
    worldToCell(wx, wz) {
      const G = PE.CONFIG.GRID;
      return {
        col: Math.floor(wx / G.CELL + (G.COLS - 1) / 2 + 0.5),
        row: Math.floor(wz / G.CELL + (G.ROWS - 1) / 2 + 0.5)
      };
    },

    fmt(n) { return Math.round(n).toString(); }
  };
})();
