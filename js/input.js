/* =====================================================
 * input.js — 指针交互（建造 / 选中 / 相机控制 / 快捷键）
 *  拖拽 = 旋转视角（移动超过阈值判定）
 *  点击 = 建造或选中；Shift = 连续建造
 * ===================================================== */
(function () {
  'use strict';
  window.PE = window.PE || {};
  const U = PE.utils, C = PE.CONFIG;

  PE.Input = class {
    constructor(game, ui, scene) {
      this.game = game;
      this.ui = ui;
      this.scene = scene;
      this.canvas = scene.canvas;

      this.buildType = null;
      this.ghost = null;
      this.down = null;         // { x, y, moved }
      this.shift = false;

      this._bind();
    }

    _bind() {
      const cv = this.canvas;

      cv.addEventListener('contextmenu', e => e.preventDefault());

      cv.addEventListener('pointerdown', e => {
        this.down = { x: e.clientX, y: e.clientY, moved: 0 };
      });

      window.addEventListener('pointermove', e => {
        if (this.down) {
          const dx = e.clientX - this.down.x;
          const dy = e.clientY - this.down.y;
          this.down.moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
          if (this.down.moved > 6) {
            this.scene.orbitFromDrag(e.movementX || dx * 0.1, e.movementY || dy * 0.1);
          }
          this.down.x = e.clientX; this.down.y = e.clientY;
        }
        this._hover(e.clientX, e.clientY);
      });

      window.addEventListener('pointerup', e => {
        const wasDown = this.down;
        this.down = null;
        if (wasDown && wasDown.moved <= 6 && e.button === 0) {
          this._click(e.clientX, e.clientY, e.shiftKey);
        }
      });

      cv.addEventListener('wheel', e => {
        e.preventDefault();
        this.scene.zoom(e.deltaY);
      }, { passive: false });

      window.addEventListener('keydown', e => {
        if (e.key === 'Shift') this.shift = true;
        const s = this.game.state;
        if (e.key === 'Escape') {
          this.setBuildType(null);
          this.deselect();
        } else if (e.key === '1' || e.key === '2' || e.key === '3') {
          if (s === 'build' || s === 'wave') {
            const types = Object.keys(C.TOWERS);
            this.setBuildType(types[Number(e.key) - 1]);
          }
        } else if (e.code === 'Space') {
          e.preventDefault();
          if (s === 'build') { this.game.startWave(); this.setBuildType(this.buildType); }
        }
      });

      window.addEventListener('keyup', e => {
        if (e.key === 'Shift') this.shift = false;
      });
    }

    setBuildType(type) {
      this.buildType = type;
      if (this.ghost) { this.scene.scene.remove(this.ghost); this.ghost = null; }
      if (this.game.map) this.game.map.setHover(null, true);
      if (type) {
        this.ghost = PE.makeGhost(type);
        this.ghost.visible = false;
        this.scene.scene.add(this.ghost);
      }
      this.ui.setBuildType(type);
    }

    deselect() {
      this.game.selected = null;
      this.ui.hideTowerPanel();
      if (this.game.map) this.game.map.setHover(null, true);
    }

    select(tower) {
      this.game.selected = tower;
      this.ui.showTowerPanel(tower);
    }

    _cellFromScreen(x, y) {
      const pt = this.scene.groundPoint(x, y);
      if (!pt) return null;
      const c = U.worldToCell(pt.x, pt.z);
      const G = C.GRID;
      if (c.col < 0 || c.col >= G.COLS || c.row < 0 || c.row >= G.ROWS) return null;
      return c;
    }

    _hover(x, y) {
      const g = this.game;
      if (!g.map) return;
      if (!this.buildType) {
        g.map.setHover(null, true);
        if (this.ghost) this.ghost.visible = false;
        return;
      }
      const c = this._cellFromScreen(x, y);
      if (!c) {
        g.map.setHover(null, true);
        if (this.ghost) this.ghost.visible = false;
        return;
      }
      const occupied = !!g.towerAt(c.col, c.row);
      const valid = g.map.canBuild(c.col, c.row) && !occupied;
      g.map.setHover(c.col, c.row, valid);
      if (this.ghost) {
        const w = U.cellToWorld(c.col, c.row);
        this.ghost.visible = true;
        this.ghost.position.set(w.x, 0.6, w.z);
        this.ghost.material.color.setHex(valid ? 0x6affc4 : 0xff5577);
      }
    }

    _click(x, y, shiftKey) {
      const g = this.game;
      if (g.state !== 'build' && g.state !== 'wave') return;
      const c = this._cellFromScreen(x, y);
      if (!c) { this.deselect(); return; }

      // 1) 点到塔 → 选中
      const t = g.towerAt(c.col, c.row);
      if (t) { this.select(t); return; }

      // 2) 建造模式 → 放置
      if (this.buildType) {
        const res = g.placeTower(this.buildType, c.col, c.row);
        if (!res.ok) {
          if (res.why === 'energy') this.ui.toast('能量不足', 'bad');
          else this.ui.toast('此处无法建造', 'bad');
        } else if (!shiftKey) {
          this.setBuildType(null);
        }
        return;
      }

      // 3) 空地 → 取消选中
      this.deselect();
    }
  };
})();
