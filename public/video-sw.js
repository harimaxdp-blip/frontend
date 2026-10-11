/*
 * video-sw.js  —  /public/video-sw.js
 * Dual-purpose:
 *   1. Detect video URLs from iframes → message the React app to upgrade
 *   2. Proxy cross-origin video requests → inject CORS headers for <video>
 */

const VIDEO_RE = /\.(mkv|mp4|webm|avi|mov|flv|ts|m3u8|mpd)(\?|$)/i;

self.addEventListener("install",  () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  if (!VIDEO_RE.test(url)) return;

  let isCrossOrigin = false;
  try { isCrossOrigin = new URL(url).origin !== self.location.origin; } catch { return; }

  // ── Step 1: notify the React app about any video URL seen (for iframe→direct upgrade)
  self.clients.matchAll({ includeUncontrolled: true, type: "window" }).then(clients => {
    clients.forEach(client => client.postMessage({ type: "VIDEO_DETECTED", url }));
  });

  // ── Step 2: proxy only cross-origin requests (adds CORS headers)
  if (isCrossOrigin) {
    event.respondWith(proxyVideoRequest(event.request));
  }
});

async function proxyVideoRequest(originalRequest) {
  const headers = new Headers();

  const range = originalRequest.headers.get("Range");
  if (range) headers.set("Range", range);

  headers.set(
    "User-Agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  );
  headers.set("Referer", self.location.origin + "/");

  try {
    const response = await fetch(originalRequest.url, {
      method: originalRequest.method,
      headers,
      credentials: "omit",
      redirect: "follow",
    });

    const newHeaders = new Headers(response.headers);
    newHeaders.set("Access-Control-Allow-Origin", "*");
    newHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    newHeaders.set("Access-Control-Allow-Headers", "*");
    newHeaders.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Type");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  } catch (err) {
    return new Response(`Video proxy error: ${err.message}`, {
      status: 502,
      headers: { "Content-Type": "text/plain" },
    });
  }
}