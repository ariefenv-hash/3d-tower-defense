/* =====================================================
 * main.js — 启动器：组装各模块并驱动主循环
 * ===================================================== */
(function () {
  'use strict';

  function boot() {
    const holder = document.getElementById('scene-holder');
    const scene = new PE.SceneMgr(holder);
    const game = new PE.Game(scene);
    const ui = new PE.UI(game);
    const input = new PE.Input(game, ui, scene);
    game.ui = ui;
    game.input = input;

    ui.showMenu();

    // PWA：注册 service worker（仅 https / localhost 环境生效；file:// 双击直开时静默跳过）
    if ('serviceWorker' in navigator) {
      var loc = window.location;
      var swOk = loc.protocol === 'https:' || loc.hostname === 'localhost' || loc.hostname === '127.0.0.1';
      if (swOk) {
        try {
          navigator.serviceWorker.register('./sw.js').catch(function () { /* 注册失败不影响游玩 */ });
        } catch (e) { /* 静默 */ }
      }
    }

    // 浏览器手势策略：首次交互解锁音频
    window.addEventListener('pointerdown', () => PE.sfx.unlock(), { once: true });

    // 主循环
    let last = performance.now();
    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      game.update(dt);
      scene.render();
    }
    requestAnimationFrame(frame);

    window.PE.game = game; // 调试入口

    // 卷首启动屏淡出（boot 兑底脚本已在 8s 后自动移除）
    const bootEl = document.getElementById('boot');
    if (bootEl) {
      bootEl.classList.add('hide');
      setTimeout(() => bootEl.remove(), 500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
