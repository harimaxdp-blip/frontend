/**
 * video-detector.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Injected into iframe pages (via WebView.evaluateJavascript or a <script> tag)
 * to scan for playable video URLs and post them back to the React layer.
 *
 * Message format sent to parent window:
 *   { type: "HM_VIDEO_DETECTED", url: "<playable-url>", source: "<how-found>" }
 *
 * If no video is found after all retries:
 *   { type: "HM_VIDEO_NOT_FOUND" }
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function () {
  "use strict";

  // ── Guard: don't inject twice ─────────────────────────────────────────────
  if (window.__HM_DETECTOR_RUNNING__) {
    console.log("[HM-Detector] Already running, skipping re-injection.");
    return;
  }
  window.__HM_DETECTOR_RUNNING__ = true;

  // ── Config ────────────────────────────────────────────────────────────────
  const POLL_INTERVAL_MS  = 800;   // how often to scan while waiting
  const MAX_WAIT_MS       = 18000; // give up after 18 s
  const INITIAL_DELAY_MS  = 1200; // first scan after page settles

  // ── URL matchers ──────────────────────────────────────────────────────────
  const RE_M3U8 = /https?:\/\/[^\s"'<>]+\.m3u8([?#][^\s"'<>]*)?/gi;
  const RE_MP4  = /https?:\/\/[^\s"'<>]+\.mp4([?#][^\s"'<>]*)?/gi;
  const RE_WEBM = /https?:\/\/[^\s"'<>]+\.webm([?#][^\s"'<>]*)?/gi;
  const RE_MPD  = /https?:\/\/[^\s"'<>]+\.mpd([?#][^\s"'<>]*)?/gi;
  const RE_TS   = /https?:\/\/[^\s"'<>]+\.ts([?#][^\s"'<>]*)?/gi;

  // Stream-like patterns (e.g. download.php?stream=1&file=video.mp4)
  const RE_STREAM = /https?:\/\/[^\s"'<>]*(?:stream|video|media|play|hls)[^\s"'<>]*/gi;

  const PRIORITY_ORDER = [RE_M3U8, RE_MP4, RE_WEBM, RE_MPD, RE_TS];

  function isPlayableUrl(url) {
    if (!url || typeof url !== "string") return false;
    const u = url.trim().toLowerCase();
    return (
      u.endsWith(".m3u8") || u.includes(".m3u8?") || u.includes(".m3u8#") ||
      u.endsWith(".mp4")  || u.includes(".mp4?")  || u.includes(".mp4#")  ||
      u.endsWith(".webm") || u.includes(".webm?") ||
      u.endsWith(".mpd")  || u.includes(".mpd?")  ||
      u.endsWith(".ts")   || u.includes(".ts?")   ||
      /\/(hls|dash|stream|video|media)\//i.test(u) ||
      /[?&](url|src|file|stream|source)=/i.test(u)
    );
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let detected = false;
  let observer = null;
  let pollTimer = null;
  let giveUpTimer = null;
  let reportedUrl = null;

  // ── Reporting ─────────────────────────────────────────────────────────────
  function report(url, source) {
    if (detected) return;
    if (reportedUrl === url) return; // don't double-report same URL
    detected = true;
    reportedUrl = url;
    cleanup();

    console.log(`[HM-Detector] ✅ VIDEO FOUND via [${source}]: ${url}`);

    // Post to parent frame (React MoviePlayer listens via window.addEventListener("message"))
    try {
      window.parent.postMessage({ type: "HM_VIDEO_DETECTED", url, source }, "*");
    } catch (e) {
      console.warn("[HM-Detector] postMessage to parent failed:", e);
    }

    // Also try top-level (e.g. nested iframes)
    try {
      if (window.top !== window.parent) {
        window.top.postMessage({ type: "HM_VIDEO_DETECTED", url, source }, "*");
      }
    } catch {}

    // Android WebView bridge (if injected via evaluateJavascript)
    try {
      if (window.HMVideoDetector && typeof window.HMVideoDetector.onVideoFound === "function") {
        window.HMVideoDetector.onVideoFound(url, source);
      }
    } catch {}
  }

  function reportNotFound() {
    if (detected) return;
    cleanup();
    console.log("[HM-Detector] ❌ No video URL found after full scan.");
    try { window.parent.postMessage({ type: "HM_VIDEO_NOT_FOUND" }, "*"); } catch {}
    try {
      if (window.HMVideoDetector && typeof window.HMVideoDetector.onVideoNotFound === "function") {
        window.HMVideoDetector.onVideoNotFound();
      }
    } catch {}
  }

  function cleanup() {
    if (observer)    { observer.disconnect(); observer = null; }
    if (pollTimer)   { clearInterval(pollTimer); pollTimer = null; }
    if (giveUpTimer) { clearTimeout(giveUpTimer); giveUpTimer = null; }
  }

  // ── Scanners ──────────────────────────────────────────────────────────────

  /** 1. Native <video> / <source> elements */
  function scanVideoElements() {
    const videos = document.querySelectorAll("video");
    for (const v of videos) {
      const src = v.src || v.currentSrc || v.getAttribute("src") || "";
      if (src && isPlayableUrl(src)) {
        report(src, "video-element.src");
        return true;
      }
      // data-src / data-url lazy-load attributes
      for (const attr of ["data-src", "data-url", "data-video", "data-hls"]) {
        const ds = v.getAttribute(attr);
        if (ds && isPlayableUrl(ds)) { report(ds, `video-element.${attr}`); return true; }
      }
    }
    const sources = document.querySelectorAll("source");
    for (const s of sources) {
      const src = s.src || s.getAttribute("src") || "";
      if (src && isPlayableUrl(src)) {
        report(src, "source-element.src");
        return true;
      }
    }
    return false;
  }

  /** 2. Regex scan across all <script> tag contents and inline onclick/data attrs */
  function scanScriptContent() {
    const scripts = document.querySelectorAll("script");
    for (const s of scripts) {
      const text = s.textContent || "";
      for (const re of PRIORITY_ORDER) {
        re.lastIndex = 0;
        const m = re.exec(text);
        if (m) { report(m[0], "script-content"); return true; }
      }
    }
    return false;
  }

  /** 3. Scan all element attributes (src, data-src, data-url, etc.) */
  function scanAttributes() {
    const candidates = document.querySelectorAll("[src],[data-src],[data-url],[data-file],[data-video],[data-hls],[data-stream]");
    for (const el of candidates) {
      for (const attr of ["src", "data-src", "data-url", "data-file", "data-video", "data-hls", "data-stream"]) {
        const val = el.getAttribute(attr);
        if (val && isPlayableUrl(val)) {
          report(val, `attr:${attr}`);
          return true;
        }
      }
    }
    return false;
  }

  /** 4. Scan window/global variables for known player config patterns */
  function scanGlobalVars() {
    const KEYS = [
      "videoUrl", "video_url", "streamUrl", "stream_url", "hlsUrl", "hls_url",
      "playlistUrl", "mediaUrl", "media_url", "fileUrl", "file_url",
      "playerSrc", "player_src", "source", "sources",
    ];
    for (const key of KEYS) {
      try {
        const val = window[key];
        if (typeof val === "string" && isPlayableUrl(val)) {
          report(val, `window.${key}`);
          return true;
        }
        if (Array.isArray(val)) {
          for (const item of val) {
            const u = typeof item === "string" ? item : (item?.src || item?.file || item?.url || "");
            if (u && isPlayableUrl(u)) { report(u, `window.${key}[]`); return true; }
          }
        }
        if (val && typeof val === "object") {
          const u = val.src || val.file || val.url || val.stream || val.hls || "";
          if (u && isPlayableUrl(u)) { report(u, `window.${key}.src`); return true; }
        }
      } catch {}
    }
    return false;
  }

  /** 5. Scan JSON-LD and meta tags */
  function scanMetaAndJsonLd() {
    // JSON-LD
    const jsonLds = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of jsonLds) {
      try {
        const data = JSON.parse(s.textContent || "{}");
        const url = data?.contentUrl || data?.embedUrl || data?.url || "";
        if (url && isPlayableUrl(url)) { report(url, "json-ld"); return true; }
      } catch {}
    }
    // Open Graph video
    const ogVideo = document.querySelector('meta[property="og:video"], meta[property="og:video:url"]');
    if (ogVideo) {
      const content = ogVideo.getAttribute("content") || "";
      if (content && isPlayableUrl(content)) { report(content, "og:video"); return true; }
    }
    return false;
  }

  /** 6. Full text scan of page HTML (last resort) */
  function scanPageHtml() {
    const html = document.documentElement?.innerHTML || "";
    for (const re of PRIORITY_ORDER) {
      re.lastIndex = 0;
      const m = re.exec(html);
      if (m) {
        const url = m[0].replace(/\\u002F/g, "/").replace(/\\/g, "");
        report(url, "html-scan");
        return true;
      }
    }
    return false;
  }

  /** Run all scanners in priority order */
  function runAllScans() {
    console.log("[HM-Detector] 🔍 Running full scan...");
    return (
      scanVideoElements()  ||
      scanAttributes()     ||
      scanMetaAndJsonLd()  ||
      scanGlobalVars()     ||
      scanScriptContent()  ||
      scanPageHtml()
    );
  }

  // ── Intercept XHR / fetch responses ──────────────────────────────────────
  function patchXHR() {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._hmUrl = url;
      return origOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener("load", function () {
        if (detected) return;
        const u = this._hmUrl || "";
        if (isPlayableUrl(u)) {
          console.log("[HM-Detector] XHR request to playable URL:", u);
          report(u, "xhr-request");
          return;
        }
        // Scan response text for embedded URLs
        try {
          const text = this.responseText || "";
          if (text.length < 500000) { // skip huge responses
            for (const re of PRIORITY_ORDER) {
              re.lastIndex = 0;
              const m = re.exec(text);
              if (m) { report(m[0], "xhr-response"); return; }
            }
          }
        } catch {}
      });
      return origSend.apply(this, args);
    };
  }

  function patchFetch() {
    const origFetch = window.fetch;
    if (!origFetch) return;
    window.fetch = function (input, ...rest) {
      const url = typeof input === "string" ? input : (input?.url || "");
      if (!detected && isPlayableUrl(url)) {
        console.log("[HM-Detector] fetch() to playable URL:", url);
        report(url, "fetch-request");
      }
      const p = origFetch.call(this, input, ...rest);
      p.then(async (resp) => {
        if (detected) return;
        const ct = resp.headers.get("content-type") || "";
        if (ct.includes("application/vnd.apple.mpegurl") ||
            ct.includes("application/x-mpegURL") ||
            ct.includes("video/")) {
          const cloned = resp.clone();
          try {
            const text = await cloned.text();
            for (const re of PRIORITY_ORDER) {
              re.lastIndex = 0;
              const m = re.exec(text);
              if (m) { report(m[0], "fetch-response-body"); return; }
            }
            // If content-type is video, use the request URL itself
            const reqUrl = typeof input === "string" ? input : (input?.url || "");
            if (reqUrl && isPlayableUrl(reqUrl)) report(reqUrl, "fetch-content-type");
          } catch {}
        }
      }).catch(() => {});
      return p;
    };
  }

  // ── MutationObserver for dynamic video elements ───────────────────────────
  function startMutationObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver((mutations) => {
      if (detected) { observer.disconnect(); return; }
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue; // only elements
          // Check if it IS a video/source
          if (node.tagName === "VIDEO" || node.tagName === "SOURCE") {
            const src = node.src || node.currentSrc || node.getAttribute("src") || "";
            if (src && isPlayableUrl(src)) { report(src, "mutation-observer"); return; }
          }
          // Check children
          const vids = node.querySelectorAll ? node.querySelectorAll("video, source") : [];
          for (const v of vids) {
            const src = v.src || v.currentSrc || v.getAttribute("src") || "";
            if (src && isPlayableUrl(src)) { report(src, "mutation-observer-child"); return; }
          }
        }
        // Attribute changes on existing video elements
        if (mutation.type === "attributes" && mutation.target) {
          const el = mutation.target;
          if (el.tagName === "VIDEO" || el.tagName === "SOURCE") {
            const src = el.src || el.currentSrc || el.getAttribute("src") || "";
            if (src && isPlayableUrl(src)) { report(src, "mutation-attribute"); return; }
          }
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "data-src", "data-url", "data-video"],
    });
    console.log("[HM-Detector] MutationObserver started.");
  }

  // ── Main entry ────────────────────────────────────────────────────────────
  function start() {
    console.log("[HM-Detector] 🚀 Starting video detection on:", window.location.href);

    patchXHR();
    patchFetch();
    startMutationObserver();

    // Initial scan after page settles
    setTimeout(() => {
      if (detected) return;
      if (runAllScans()) return;

      // Poll every POLL_INTERVAL_MS until found or timeout
      let elapsed = INITIAL_DELAY_MS;
      pollTimer = setInterval(() => {
        elapsed += POLL_INTERVAL_MS;
        if (detected) { clearInterval(pollTimer); return; }
        console.log(`[HM-Detector] ⏳ Polling... (${elapsed}ms elapsed)`);
        runAllScans();
      }, POLL_INTERVAL_MS);

      // Give up after MAX_WAIT_MS
      giveUpTimer = setTimeout(() => {
        if (!detected) {
          console.log("[HM-Detector] ⏰ Timeout reached, reporting not found.");
          reportNotFound();
        }
      }, MAX_WAIT_MS - INITIAL_DELAY_MS);

    }, INITIAL_DELAY_MS);
  }

  // Run when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

})();