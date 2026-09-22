/* 极简 Service Worker：只为让站点可被安装，采用网络优先，绝不返回过期页面 */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(req).catch(function () {
      return caches.match(req).then(function (r) {
        return r || new Response('离线', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      });
    })
  );
});
