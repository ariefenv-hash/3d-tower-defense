/* =====================================================
 * sw.js — PWA 离线缓存（cache-first + 网络回填）
 * 由 main.js 在 https / localhost 环境注册；
 * file:// 双击直开时不注册，游戏照常可玩。
 * ===================================================== */
'use strict';

var CACHE = 'prism-echo-v5';
var CORE = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './vendor/three.min.js',
  './js/config.js',
  './js/utils.js',
  './js/sfx.js',
  './js/scene.js',
  './js/map.js',
  './js/beam.js',
  './js/enemy.js',
  './js/tower.js',
  './js/waves.js',
  './js/relics.js',
  './js/game.js',
  './js/input.js',
  './js/ui.js',
  './js/main.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return Promise.allSettled(CORE.map(function (u) { return c.add(u); })); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;
  var isFontCDN = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  // 其余跨源请求放行，交给浏览器默认行为
  if (!sameOrigin && !isFontCDN) return;

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        if (sameOrigin) return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});
