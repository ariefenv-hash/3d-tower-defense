/* =====================================================
 * input.js — 指针交互（建造 / 选中 / 相机 / 手势）
 *  鼠标：拖拽 = 旋转视角 · 滚轮 = 缩放 · 点击 = 建造/选中
 *  触屏：单指拖动 = 转卷 · 双指捏合 = 缩放视野 · 轻点 = 布防/选中
 *  Shift = 连续建造
 * ===================================================== */
(function () {
  'use strict';
  window.PE = window.PE || {};
  const U = PE.utils, C = PE.CONFIG;

  const TAP_SLACK = 10;      // 判定为“轻点”的最大位移（px）
  const TAP_MS = 600;        // 判定为“轻点”的最长时长
  const PINCH_K = 2.0;       // 捏合 → 视野距离灵敏度

  PE.Input = class {
    constructor(game, ui, scene) {
      this.game = game;
      this.ui = ui;
      this.scene = scene;
      this.canvas = scene.canvas;

      this.buildType = null;
      this.ghost = null;
      this.shift = false;

      this.pointers = new Map();  // pointerId -> { x, y }（活跃指针）
      this.down = null;           // 主指针 { x, y, moved, t, id }
      this.pinchDist = null;      // 双指捏合的上一帧间距

      this._bind();
    }

    _bind() {
      const cv = this.canvas;

      cv.addEventListener('contextmenu', e => e.preventDefault());

      /* ---- 按下 ---- */
      cv.addEventListener('pointerdown', e => {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (this.pointers.size === 1) {
          this.down = { x: e.clientX, y: e.clientY, moved: 0, t: performance.now(), id: e.pointerId };
          // 触屏没有 hover：按下即预览建造位置（幽灵 + 高亮）
          if (e.pointerType !== 'mouse') this._hover(e.clientX, e.clientY);
        } else if (this.pointers.size === 2) {
          // 进入双指缩放：撤销单击判定，记录基准间距
          const [p1, p2] = [...this.pointers.values()];
          this.pinchDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
          this.down = null;
          this._hideGhost();
        }
      });

      /* ---- 移动 ---- */
      window.addEventListener('pointermove', e => {
        const rec = this.pointers.get(e.pointerId);
        if (rec) { rec.x = e.clientX; rec.y = e.clientY; }

        // 双指捏合 → 视野缩放
        if (this.pointers.size >= 2 && this.pinchDist !== null) {
          const [p1, p2] = [...this.pointers.values()];
          const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
          if (d > 1) {
            this.scene.zoom((this.pinchDist - d) * PINCH_K); // 张开 → 拉近
            this.pinchDist = d;
          }
          return;
        }

        // 单指/鼠标拖动 → 转卷（用逐帧位移，兼容触屏无 movementX）
        if (this.down && e.pointerId === this.down.id) {
          const dx = e.clientX - this.down.x;
          const dy = e.clientY - this.down.y;
          this.down.moved += Math.abs(dx) + Math.abs(dy);
          if (this.down.moved > TAP_SLACK) {
            this.scene.orbitFromDrag(dx, dy);
            // 触屏拖动转卷时收起建造预览，避免误导
            if (e.pointerType !== 'mouse') this._hideGhost();
          }
          this.down.x = e.clientX;
          this.down.y = e.clientY;
        }

        // 鼠标才有悬停预览
        if (e.pointerType === 'mouse') this._hover(e.clientX, e.clientY);
      });

      /* ---- 抬起 / 中断 ---- */
      const release = e => {
        this.pointers.delete(e.pointerId);
        if (this.pointers.size < 2) this.pinchDist = null;

        const wasDown = this.down;
        if (this.down && this.down.id === e.pointerId) this.down = null;

        // 轻点 → 建造 / 选中（触屏 pointerup 的 button 恒为 0）
        if (wasDown && wasDown.id === e.pointerId && wasDown.moved <= TAP_SLACK) {
          const dur = performance.now() - wasDown.t;
          const isTap = dur <= TAP_MS &&
            (e.button === 0 || e.pointerType !== 'mouse');
          if (isTap) this._click(e.clientX, e.clientY, e.shiftKey);
        }
      };
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);

      /* ---- 滚轮缩放 ---- */
      cv.addEventListener('wheel', e => {
        e.preventDefault();
        this.scene.zoom(e.deltaY);
      }, { passive: false });

      /* ---- 键盘（桌面） ---- */
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

    _hideGhost() {
      if (this.ghost) this.ghost.visible = false;
      if (this.game.map) this.game.map.setHover(null, true);
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
        this.ghost.material.color.setHex(valid ? 0x9fc9a8 : 0xe05a41);
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
