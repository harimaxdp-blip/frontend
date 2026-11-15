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