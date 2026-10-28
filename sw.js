// Cache simples para o app funcionar offline. Mude a versão ao alterar arquivos.
const CACHE = 'semanasp-v15';
const SHARE_CACHE = 'semanasp-share';
const ASSETS = ['./', 'index.html', 'styles.css', 'calc.js', 'receipt.js', 'app.js', 'stats.js', 'importer.js', 'import-ui.js', 'firebase-config.js', 'sync.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE && k !== SHARE_CACHE).map((k) => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// Recebe o print enviado pelo menu "Compartilhar", guarda e abre o app para lê-lo.
async function handleShare(request) {
  const form = await request.formData();
  const file = form.get('image');
  if (file && file.size) {
    const cache = await caches.open(SHARE_CACHE);
    await cache.put('shared-image', new Response(file, { headers: { 'content-type': file.type } }));
  }
  return Response.redirect(new URL('./?share=1', self.registration.scope).href, 303);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(handleShare(event.request));
    return;
  }
  if (event.request.method !== 'GET') return;
  // Rede primeiro, cache como reserva: atualizações aparecem quando há conexão.
  // 'no-cache' faz o navegador revalidar com o servidor em vez de usar a cópia
  // HTTP (o GitHub Pages permite reaproveitar por 10 min, o que atrasava as atualizações).
  const sameOrigin = url.origin === self.location.origin;
  event.respondWith(
    fetch(sameOrigin ? new Request(url.href, { cache: 'no-cache', credentials: 'same-origin' }) : event.request)
      .then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
