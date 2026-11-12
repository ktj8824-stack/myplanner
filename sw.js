// 마이플래너 서비스워커 — 화면 파일 캐시 (웹 전용, 앱에서는 등록하지 않음)
const CACHE = 'myplanner-v72';
const FILES = ['./', './index.html', './css/app.css', './js/defaults.js', './js/icons.js', './js/core.js', './js/pack.js', './js/planner.js', './js/recur.js', './js/parse.js', './js/routes.js', './js/weather.js', './js/live.js', './js/bus.js', './js/cloud.js', './js/share.js', './js/demo.js', './js/day.js', './js/assistant.js', './js/alarm.js', './js/home.js', './js/register.js', './js/timeline.js', './js/market.js', './js/pro.js', './js/ads.js', './js/points.js', './js/raffle.js', './js/autonav.js', './js/app.js', './autonav-guide.html', './icon.svg', './icon-192.png', './apple-touch-icon.png', './manifest.json', './img/hero-alarm.png', './img/icons/register.png', './img/icons/community.png', './img/icons/message.png', './img/icons/calendar.png', './img/icons/market.png', './img/icons/group.png', './img/icons/settings.png', './img/icons/timeline.png', './img/icons/bus.png', './img/icons/subway.png', './img/icons/car.png', './img/icons/taxi.png', './img/icons/walk.png', './img/icons/train.png', './img/icons/plane.png', './img/icons/home.png', './img/icons/pin.png', './img/icons/raffle.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // API 요청은 캐시하지 않음
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});

// 출발 알림을 누르면 → 앱을 ?go=next 로 열어 바로 길안내
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find(c => c.url.startsWith(self.registration.scope));
    if (w) { try { await w.focus(); if ('navigate' in w) { await w.navigate(url); return; } } catch (err) { } }
    await self.clients.openWindow(url);
  })());
});
