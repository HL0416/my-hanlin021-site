/* service-worker.js - 我的站点离线缓存 */
var CACHE_NAME = 'my-site-v1';
var CORE_ASSETS = [
  './',
  './index.html',
  './profile.html',
  './profile_view.html',
  './admin.html',
  './help.html',
  './about.html',
  './privacy.html',
  './styles.css',
  './auth.js',
  './manifest.json'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(CORE_ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);
  if (event.request.method !== 'GET') { return; }
  // 仅缓存同源请求，外部资源（图片 CDN 等）走网络
  if (url.origin !== location.origin) { return; }

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) { return cached; }
      return fetch(event.request).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, copy);
          });
        }
        return response;
      }).catch(function () {
        // 离线时对导航请求回退到首页缓存
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return undefined;
      });
    })
  );
});
