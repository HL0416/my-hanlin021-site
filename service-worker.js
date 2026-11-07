/* service-worker.js - 我的站点离线缓存（v3：导航网络优先 + 预缓存 + 离线兜底） */
var CACHE_NAME = 'my-site-v3';
var RUNTIME_CACHE = 'my-site-runtime-v3';

var CORE_ASSETS = [
  './',
  './index.html',
  './login.html',
  './register.html',
  './forgot.html',
  './profile.html',
  './profile_view.html',
  './admin.html',
  './files.html',
  './posts.html',
  './help.html',
  './about.html',
  './privacy.html',
  './404.html',
  './styles.css',
  './auth.js',
  './enhance.js',
  './manifest.json'
];

// 安装：逐个预热核心资源，单个失败不影响整体安装（网络抖动时不至于整站缓存失败）
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(CORE_ASSETS.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () { return null; });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME && key !== RUNTIME_CACHE) {
          return caches.delete(key);
        }
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// 归一化请求键：把 /x 与 /x.html 视作同一个页面，便于离线命中
function pageKey(request) {
  var url = new URL(request.url);
  var p = url.pathname;
  if (p === '/' || p === '') { return url.origin + '/index.html'; }
  if (/\/$/.test(p)) { return url.origin + p + 'index.html'; }
  if (!/\.[a-z0-9]+$/i.test(p)) { return url.origin + p + '.html'; }
  return url.origin + p;
}

function cacheFirstAsset(request) {
  return caches.match(request).then(function (cached) {
    if (cached) {
      // 后台静默更新，保证下次拿到新版
      fetch(request).then(function (res) {
        if (res && res.ok) {
          caches.open(RUNTIME_CACHE).then(function (c) { c.put(request, res.clone()); });
        }
      }).catch(function () {});
      return cached;
    }
    return fetch(request).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(RUNTIME_CACHE).then(function (c) { c.put(request, copy); });
      }
      return res;
    });
  });
}

function networkFirstPage(request) {
  return fetch(request).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(RUNTIME_CACHE).then(function (c) { c.put(pageKey(request), copy); });
    }
    return res;
  }).catch(function () {
    // 网络失败：优先当前页缓存，再退到首页，最后给离线提示
    return caches.match(pageKey(request)).then(function (cached) {
      if (cached) { return cached; }
      return caches.match(request).then(function (c2) {
        if (c2) { return c2; }
        return caches.match('./index.html').then(function (home) {
          if (home) { return home; }
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>离线</title>' +
            '<div style="font-family:system-ui;padding:40px;text-align:center">' +
            '<h2>当前网络不可用</h2><p>页面已离线，网络恢复后刷新即可。</p>' +
            '<p><button onclick="location.reload()">重试</button></p></div>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        });
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') { return; }

  var url = new URL(request.url);

  // 数据接口（/api/*，含跨域备用入口）：绝不缓存，保证跨设备同步读到最新值
  if (url.pathname.indexOf('/api/') === 0) { return; }

  // 跨域资源走网络，不拦截
  if (url.origin !== location.origin) { return; }

  // 页面导航：网络优先，失败回退缓存
  if (request.mode === 'navigate' || (request.headers.get('accept') || '').indexOf('text/html') !== -1) {
    event.respondWith(networkFirstPage(request));
    return;
  }

  // 静态资源（css/js/图片/字体）：缓存优先 + 后台更新
  event.respondWith(cacheFirstAsset(request));
});
