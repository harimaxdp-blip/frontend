import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { test } from "node:test";
import resolver from "./sourceResolverRoute.js";

test("Archive.org resolver uses only its fixed public metadata API and returns listed media", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({
      metadata: { title: "Public test item" },
      files: [
        { name: "notes.txt", format: "Text", source: "original" },
        { name: "locked.mp4", format: "MPEG4", source: "original", private: "true" },
        { name: "movie.mp4", format: "MPEG4", source: "original" },
        { name: "movie.en.vtt", format: "WebVTT", source: "original", language: "en" },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const app = express();
  app.use("/api", resolver);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const request = (url) => originalFetch(`http://127.0.0.1:${port}/api/resolve?url=${encodeURIComponent(url)}`);

  try {
    const response = await request("https://archive.org/details/public-item");
    const data = await response.json();
    assert.equal(data.status, "resolved");
    assert.equal(data.mediaType, "mp4");
    assert.equal(data.provider, "Internet Archive");
    assert.equal(data.streamUrl, "https://archive.org/download/public-item/movie.mp4");
    assert.equal(data.subtitles[0].lang, "en");
    assert.deepEqual(calls.map((call) => call.url), ["https://archive.org/metadata/public-item"]);
    assert.equal(calls[0].options.redirect, "error");

    const before = calls.length;
    const blocked = await request("http://127.0.0.1/admin");
    assert.equal(blocked.status, 400);
    assert.equal(calls.length, before, "untrusted URLs must never be fetched by the backend");
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("Onestream resolver accepts only an ordinary public video source from its allowlisted page", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/stream/page/103474")) {
      return new Response(
        '<video controls referrerpolicy="no-referrer"><source src="https://download.fastbytes.xyz/download.php?dl=fixtureOpaqueTokenForPublicTest&amp;stream=1" type="video/mp4"></video>',
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }
    if (String(url).endsWith("/stream/page/103476")) {
      return new Response(
        '<video controls referrerpolicy="no-referrer"><source src="https://fastly.fastbytes.xyz/open.php?dl=fixtureOpaqueTokenForPublicTest&amp;stream=1" type="video/mp4"></video>',
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }
    if (String(url).endsWith("/stream/page/103475")) {
      return new Response(
        '<video><source src="https://download.fastbytes.xyz/player.html?dl=fixture&amp;stream=1" type="video/mp4"></video>',
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }
    if (String(url).endsWith("/113861")) {
      return new Response(
        '<video controls><source src="https://download.isaidub.dad/download.php?url=https://s07.dubshare.one/isaiDub.io_-_Cold_Storage_2026_Original_1080p_HD.mp4&amp;stream=1" type="video/mp4"></video>',
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }
    if (String(url).endsWith("/113862")) {
      return new Response(
        '<video><source src="https://download.isaidub.dad/download.php?url=https://attacker.example/file.mp4&amp;stream=1" type="video/mp4"></video>',
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }
    if (String(url).endsWith("/101473")) {
      return new Response(
        '<video controls><source src="https://dub.uptodub.ch/master.m3u8?signature=fixture&amp;token=fixture" type="application/vnd.apple.mpegurl"></video>',
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }
    return new Response(
      `<script>const decoy = '<source src="https://attacker.example/file.mp4" type="video/mp4">';</script>
       <video controls>
         <source src="https://dub.uptodub.ch/download.php?dl=fixture&amp;stream=1" type="video/mp4">
       </video>`,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
    );
  };

  const app = express();
  app.use("/api", resolver);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const request = (url) => originalFetch(`http://127.0.0.1:${port}/api/resolve?url=${encodeURIComponent(url)}`);

  try {
    const response = await request("https://dub.onestream.today/stream/video/101471");
    const data = await response.json();

    assert.equal(data.status, "resolved");
    assert.equal(data.provider, "Onestream");
    assert.equal(data.mediaType, "mp4");
    assert.equal(data.streamUrl, "https://dub.uptodub.ch/download.php?dl=fixture&stream=1");
    assert.equal(calls[0].options.redirect, "error");

    const playPageResponse = await request("https://play.onestream.today/stream/page/103474");
    const playPageData = await playPageResponse.json();
    assert.equal(playPageData.status, "resolved");
    assert.equal(playPageData.provider, "Onestream");
    assert.equal(playPageData.mediaType, "mp4");
    assert.equal(playPageData.referrerPolicy, "no-referrer");
    assert.equal(
      playPageData.streamUrl,
      "https://download.fastbytes.xyz/download.php?dl=fixtureOpaqueTokenForPublicTest&stream=1"
    );

    const rotatedPlayPageResponse = await request("https://play.onestream.today/stream/page/103476");
    const rotatedPlayPageData = await rotatedPlayPageResponse.json();
    assert.equal(rotatedPlayPageData.status, "resolved");
    assert.equal(rotatedPlayPageData.mediaType, "mp4");
    assert.equal(
      rotatedPlayPageData.streamUrl,
      "https://fastly.fastbytes.xyz/open.php?dl=fixtureOpaqueTokenForPublicTest&stream=1"
    );

    const invalidPlaySourceResponse = await request("https://play.onestream.today/stream/page/103475");
    const invalidPlaySourceData = await invalidPlaySourceResponse.json();
    assert.equal(invalidPlaySourceData.status, "iframe_fallback");

    const coldStorageResponse = await request("https://dub.onestream.today/stream/video/113861");
    const coldStorageData = await coldStorageResponse.json();
    assert.equal(coldStorageData.status, "resolved");
    assert.equal(coldStorageData.provider, "Onestream");
    assert.equal(coldStorageData.mediaType, "mp4");
    assert.equal(
      coldStorageData.streamUrl,
      "https://download.isaidub.dad/download.php?url=https://s07.dubshare.one/isaiDub.io_-_Cold_Storage_2026_Original_1080p_HD.mp4&stream=1"
    );

    const untrustedTargetResponse = await request("https://dub.onestream.today/stream/video/113862");
    const untrustedTargetData = await untrustedTargetResponse.json();
    assert.equal(untrustedTargetData.status, "iframe_fallback");

    const hlsResponse = await request("https://dub.onestream.today/stream/video/101473");
    const hlsData = await hlsResponse.json();
    assert.equal(hlsData.status, "resolved");
    assert.equal(hlsData.mediaType, "hls");
    assert.equal(
      hlsData.streamUrl,
      "https://dub.uptodub.ch/master.m3u8?signature=fixture&token=fixture"
    );

    const before = calls.length;
    const blocked = await request("https://attacker.example/stream/video/101471");
    assert.equal(blocked.status, 400);
    assert.equal(calls.length, before, "untrusted page URLs must never be fetched");
    const nonstandardPort = await request("https://dub.onestream.today:8443/stream/video/101471");
    assert.equal(nonstandardPort.status, 400);
    assert.equal(calls.length, before, "nonstandard provider ports must never be fetched");
    const nonstandardPlayPort = await request("https://play.onestream.today:8443/stream/page/103474");
    assert.equal(nonstandardPlayPort.status, 400);
    assert.equal(calls.length, before, "nonstandard Onestream ports must never be fetched");
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("Onestream resolver falls back when the page exposes no supported video source", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    '<script>const hidden = "https://dub.uptodub.ch/private.mp4";</script>' +
      '<video controls><source src="https://attacker.example/file.mp4" type="video/mp4">' +
      '<source src="https://dub.uptodub.ch/player.html" type="video/mp4">' +
      '<source src="https://dub.uptodub.ch/file.flv" type="video/x-flv"></video>',
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
  );

  const app = express();
  app.use("/api", resolver);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await originalFetch(
      `http://127.0.0.1:${port}/api/resolve?url=${encodeURIComponent("https://dub.onestream.today/stream/video/101472")}`
    );
    const data = await response.json();
    assert.equal(data.status, "iframe_fallback");
    assert.match(data.reason, /No supported public MP4, HLS, or DASH source/);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});