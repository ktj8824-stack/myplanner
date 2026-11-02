// 마이플래너 서비스워커 — 화면 파일 캐시 (웹 전용, 앱에서는 등록하지 않음)
const CACHE = 'myplanner-v1';
const FILES = ['./', './index.html', './css/app.css', './js/core.js', './js/planner.js', './js/routes.js', './js/alarm.js', './js/home.js', './js/register.js', './js/timeline.js', './js/app.js', './icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // API 요청은 캐시하지 않음
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
