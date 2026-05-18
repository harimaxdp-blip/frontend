/*
 * video-sw.js  —  place this file in /public/video-sw.js
 *
 * This Service Worker intercepts fetch requests for video files
 * and re-fetches them without CORS restrictions.
 * Service Workers run in a separate context and are NOT subject
 * to the same CORS rules as page scripts.
 */

const VIDEO_EXTS = /\.(mkv|mp4|webm|avi|mov|flv|ts|m3u8|mpd)(\?|$)/i;

self.addEventListener("install",  () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // Only intercept cross-origin video file requests
  if (!VIDEO_EXTS.test(url)) return;

  // Same-origin requests don't need proxying
  try {
    if (new URL(url).origin === self.location.origin) return;
  } catch { return; }

  event.respondWith(proxyVideoRequest(event.request));
});

async function proxyVideoRequest(originalRequest) {
  const headers = new Headers();

  // Forward Range header — critical for video seeking
  const range = originalRequest.headers.get("Range");
  if (range) headers.set("Range", range);

  // Some CDNs require a browser-like User-Agent
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

    // Clone and inject CORS headers so the page's <video> element AND
    // the Web Audio API (createMediaElementSource) both accept the response.
    const newHeaders = new Headers(response.headers);
    newHeaders.set("Access-Control-Allow-Origin", "*");
    newHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    newHeaders.set("Access-Control-Allow-Headers", "*");
    newHeaders.set(
      "Access-Control-Expose-Headers",
      "Content-Length, Content-Range, Content-Type"
    );

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