/* KasUsaha Lite PWA service worker. Only caches the app shell and its banner; never caches Supabase, checkout, or payment API responses. */
'use strict';
const CACHE_PREFIX = 'kasusaha-lite-shell-';
const CACHE_NAME = CACHE_PREFIX + 'v34';
const appRoot = new URL('./', self.registration.scope);
const manifestUrl = new URL('manifest.webmanifest', self.registration.scope);
const iconUrl = new URL('icons/kasusaha-icon.svg', self.registration.scope);
const bannerUrl = new URL('assets/kasusaha-banner-baru-3.webp?v=20261031', self.registration.scope);
// Cache pustaka Supabase yang dimuat sebagai script klasik dari CDN agar shell kasir
// tetap dapat dijalankan saat perangkat offline setelah pernah dibuka online.
const supabaseScriptUrl = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll([appRoot.href, manifestUrl.href, iconUrl.href, bannerUrl.href]);
    // Script CDN menggunakan request no-cors; respons opaque tetap dapat disimpan
    // dan dipakai ulang oleh browser untuk memuat script klasik.
    try {
      const request = new Request(supabaseScriptUrl, { mode: 'no-cors', cache: 'reload' });
      const response = await fetch(request);
      if (response && (response.ok || response.type === 'opaque')) {
        await cache.put(request, response.clone());
      }
    } catch (error) {
      // Jangan gagalkan instalasi PWA hanya karena CDN sementara tidak tersedia.
      console.warn('Supabase CDN belum dapat dicache; fitur online perlu koneksi.', error);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.url === supabaseScriptUrl) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response && (response.ok || response.type === 'opaque')) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(appRoot.href, response.clone());
        }
        return response;
      } catch (_) {
        const cached = await caches.match(appRoot.href);
        if (cached) return cached;
        return new Response('KasUsaha Lite perlu koneksi internet untuk pertama kali dibuka. Sambungkan internet lalu coba lagi.', {
          status: 503,
          headers: {'Content-Type':'text/plain; charset=utf-8'}
        });
      }
    })());
    return;
  }

  if (url.href === manifestUrl.href || url.href === iconUrl.href || url.href === bannerUrl.href) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    })());
  }
});
