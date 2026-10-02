/* =====================================================
 * input.js — 指针交互（建造 / 选中 / 相机 / 手势）
 *  鼠标：拖拽 = 旋转视角 · 滚轮 = 缩放 · 点击 = 建造/选中
 *  触屏：单指拖动 = 转卷 · 双指捏合 = 缩放视野 · 轻点 = 布防/选中
 *        建造模式下单指拖动 = 精调放置点（幽灵跟随），抬手落子
 *  Shift = 连续建造
 *  —— 轻点判定用「距按下点的净位移」而非累计路径：真实手指在
 *     玻璃上天然抖动（来回摆动会重复计数），累计路径极易误判为拖拽
 * ===================================================== */
(function () {
  'use strict';
  window.PE = window.PE || {};
  const U = PE.utils, C = PE.CONFIG;

  const TAP_MS = 750;            // 轻点最长时长（放宽慢速点按）
  const TAP_SLACK_MOUSE = 8;     // 鼠标轻点净位移容差（px）
  const TAP_SLACK_TOUCH = 16;    // 触屏轻点净位移容差（手指抖动天然更大）
  const DRAG_START_MOUSE = 6;    // 鼠标进入转卷的迟滞（px）
  const DRAG_START_TOUCH = 12;   // 触屏进入转卷的迟滞（px）
  const PINCH_K = 2.0;           // 捏合 → 视野距离灵敏度

  PE.Input = class {
    constructor(game, ui, scene) {
      this.game = game;
      this.ui = ui;
      this.scene = scene;
      this.canvas = scene.canvas;

      this.buildType = null;
      this.ghost = null;
      this.shift = false;

      this.pointers = new Map();  // pointerId -> { x, y, type }
      this.down = null;           // 主指针 { x, y, sx, sy, t, id, touch, dragging }
      this.pinchDist = null;      // 双指捏合的上一帧间距

      this._bind();
    }

    _bind() {
      const cv = this.canvas;

      cv.addEventListener('contextmenu', e => e.preventDefault());

      /* ---- 按下 ---- */
      cv.addEventListener('pointerdown', e => {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

        if (this.pointers.size === 1) {
          this.down = {
            x: e.clientX, y: e.clientY,   // 当前位置（增量拖拽用）
            sx: e.clientX, sy: e.clientY, // 起始位置（净位移判定用）
            t: performance.now(),
            id: e.pointerId,
            touch: e.pointerType !== 'mouse',
            dragging: false                // 是否已进入转卷状态
          };
          // 触屏没有 hover：按下即预览建造位置（幽灵 + 高亮）
          if (this.down.touch) this._hover(e.clientX, e.clientY);
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

        // 单指 / 鼠标
        const dn = this.down;
        if (dn && e.pointerId === dn.id) {
          const dx = e.clientX - dn.x;
          const dy = e.clientY - dn.y;
          dn.x = e.clientX; dn.y = e.clientY;

          if (dn.touch && this.buildType) {
            // 触屏建造模式：手指拖动 = 精调放置点（幽灵跟随，不转卷）
            this._hover(e.clientX, e.clientY);
          } else {
            // 转卷：超过迟滞净位移才启动（防手抖误旋转）
            const off = Math.hypot(e.clientX - dn.sx, e.clientY - dn.sy);
            if (!dn.dragging && off > (dn.touch ? DRAG_START_TOUCH : DRAG_START_MOUSE)) {
              dn.dragging = true;
              if (dn.touch) this._hideGhost(); // 拖动转卷时收起预览，避免误导
            }
            if (dn.dragging) this.scene.orbitFromDrag(dx, dy);
          }
        }

        // 鼠标才有悬停预览
        if (e.pointerType === 'mouse') this._hover(e.clientX, e.clientY);
      });

      /* ---- 抬起 / 中断 ---- */
      const release = e => {
        this.pointers.delete(e.pointerId);
        if (this.pointers.size < 2) this.pinchDist = null;

        const dn = this.down;
        const wasMain = !!(dn && dn.id === e.pointerId);
        if (wasMain) this.down = null;

        // 捏合后余指继续转卷：重挂主指针（dragging 预置，绝不误判轻点）
        if (!this.down && this.pointers.size === 1) {
          const [id] = [...this.pointers.keys()];
          const [p] = [...this.pointers.values()];
          this.down = {
            x: p.x, y: p.y, sx: p.x, sy: p.y,
            t: performance.now(), id,
            touch: p.type !== 'mouse',
            dragging: true
          };
        }

        if (!wasMain || !dn || e.type !== 'pointerup') return; // pointercancel = 系统接管，不算轻点

        // 触屏建造模式：拖动即精调，抬手一律落子（不设位移门槛）
        const touchBuild = dn.touch && this.buildType;
        if (touchBuild) {
          this._click(e.clientX, e.clientY, e.shiftKey);
          return;
        }

        // 轻点判定：净位移（非累计路径）+ 时长；触屏 pointerup 的 button 恒为 0
        const off = Math.hypot(e.clientX - dn.sx, e.clientY - dn.sy);
        const slack = dn.touch ? TAP_SLACK_TOUCH : TAP_SLACK_MOUSE;
        const dur = performance.now() - dn.t;
        const okBtn = e.button === 0 || dn.touch;
        if (dur <= TAP_MS && off <= slack && okBtn && !dn.dragging) {
          this._click(dn.sx, dn.sy, e.shiftKey); // 用按下位置：那是用户的瞄准点
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
          if (this.game.paused) { this.ui.togglePauseFlow(); }  // 暂停中 Esc = 继续游戏
          else { this.setBuildType(null); this.deselect(); }
        } else if (e.key === 'p' || e.key === 'P') {
          this.ui.togglePauseFlow();                              // P = 暂停 / 继续
        } else if (e.key === 'f' || e.key === 'F') {
          this.ui.cycleSpeed();                                   // F = 倍速循环
        } else if (e.key === '1' || e.key === '2' || e.key === '3') {
          if (s === 'build' || s === 'wave') {
            const types = Object.keys(C.TOWERS);
            this.setBuildType(types[Number(e.key) - 1]);
          }
        } else if (e.code === 'Space') {
          e.preventDefault();
          if (s === 'build' && !this.game.paused) { this.game.startWave(); this.setBuildType(this.buildType); }
        }
      });

      window.addEventListener('keyup', e => {
        if (e.key === 'Shift') this.shift = false;
      });
    }

    setBuildType(type) {
      this.buildType = type;
      if (this.ghost) {
        this.scene.scene.remove(this.ghost);
        this.ghost.geometry.dispose(); // 预览几何/材质逐次新建，切换时释放
        this.ghost.material.dispose();
        this.ghost = null;
      }
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
        } else {
          U.haptic(12); // 触屏轻触反馈（无振动 API 的设备静默跳过）
          if (!shiftKey) this.setBuildType(null);
        }
        return;
      }

      // 3) 空地 → 取消选中
      this.deselect();
    }
  };
})();
