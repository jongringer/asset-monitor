/* 자산 변동률 · 서비스 워커
   - 같은 출처(정적 파일·페이지)만 다룬다. 시세 API(naver·yahoo·hyperliquid·okx 등)는 그대로 통과.
   - network-first: 항상 최신 HTML/아이콘을 먼저 받고, 실패했을 때만 캐시로 연다.
   - GitHub Pages 는 Cache-Control: max-age=600 을 주므로, 페이지(HTML)·precache 요청은
     cache: 'no-store' 로 브라우저 HTTP 캐시를 우회한다.
   - CACHE 이름을 올리면 activate 단계에서 이전 캐시를 즉시 삭제한다(v1 → v2). */
const CACHE = 'asset-monitor-v2';
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon.svg'];

const INDEX_URL = new URL('./index.html', self.location.href).href;
const ROOT_URL = new URL('./', self.location.href).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      await Promise.all(PRECACHE.map((path) => {
        const url = new URL(path, self.location.href).href;
        return fetch(new Request(url, { cache: 'no-store' }))
          .then((res) => { if (res && res.ok) return cache.put(url, res); })
          .catch(() => {});
      }));
    } catch (e) { /* precache 실패는 설치를 막지 않는다 */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;   // 외부 시세 API는 브라우저가 직접 호출

  const isNav = req.mode === 'navigate';
  const path = url.pathname;
  /* 페이지 문서 자체(HTML)인지: navigate, document, '/', './'(루트), '*.html' */
  const isHtml = isNav || req.destination === 'document' ||
    path.endsWith('/') || path.endsWith('.html');

  event.respondWith((async () => {
    let res = null;
    try {
      if (isHtml) {
        /* HTTP 캐시(max-age=600)를 건너뛰고 항상 GitHub Pages 최신 HTML을 받는다.
           (navigate 요청은 mode를 바꿔 새로 만들 수 없으므로 URL 문자열로 fetch 한다) */
        res = isNav
          ? await fetch(req.url, { cache: 'no-store', credentials: 'same-origin' })
          : await fetch(new Request(req.url, { cache: 'no-store' }));
      } else {
        res = await fetch(req);
      }
    } catch (e) {
      res = null;
    }

    if (res && res.ok && res.type === 'basic') {
      const copy = res.clone();
      const key = isHtml ? INDEX_URL : req.url;
      caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {});
    }
    if (res) return res;

    /* 네트워크 실패(오프라인)일 때만 캐시로 연다 */
    const hit = await caches.match(isHtml ? INDEX_URL : req);
    if (hit) return hit;
    const any = await caches.match(req);
    if (any) return any;
    if (isNav) {
      const root = await caches.match(ROOT_URL);
      if (root) return root;
    }
    return Response.error();
  })());
});
