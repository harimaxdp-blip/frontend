import {
  detectDirectMediaType,
  normalizeLanguageLabel,
  resolveMediaSource,
} from "./mediaSourceResolver";

describe("media source resolver", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  test("recognizes direct MP4, HLS, and DASH URLs without a network request", async () => {
    const mp4 = await resolveMediaSource("https://cdn.example/movie.mp4?token=1");
    const signedMp4 = await resolveMediaSource("https://cdn.example/download.php?stream=1&token=abc");
    const hls = await resolveMediaSource("https://cdn.example/master.m3u8?token=1");
    const dash = await resolveMediaSource("https://cdn.example/manifest.mpd");
    const webm = await resolveMediaSource("https://cdn.example/movie.webm");
    const mkv = await resolveMediaSource("https://cdn.example/movie.mkv");

    expect(mp4).toMatchObject({ status: "resolved", mediaType: "mp4" });
    expect(signedMp4).toMatchObject({
      status: "resolved",
      mediaType: "mp4",
      streamUrl: "https://cdn.example/download.php?stream=1&token=abc",
    });
    expect(hls).toMatchObject({ status: "resolved", mediaType: "hls" });
    expect(dash).toMatchObject({ status: "resolved", mediaType: "dash" });
    expect(webm).toMatchObject({ status: "resolved", mediaType: "webm" });
    expect(mkv).toMatchObject({ status: "resolved", mediaType: "remux" });
    expect(detectDirectMediaType("https://cdn.example/hls/master")).toBe("hls");
    expect(detectDirectMediaType("https://cdn.example/dash/manifest")).toBe("dash");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("returns clear results for invalid URLs and unsupported archive formats", async () => {
    const invalid = await resolveMediaSource("javascript:alert(1)");
    const unsupported = await resolveMediaSource("https://cdn.example/movie.rar");

    expect(invalid).toMatchObject({ status: "error" });
    expect(unsupported).toMatchObject({ status: "unsupported", mediaType: "archive" });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("classifies response media types and normalizes HLS track languages", () => {
    expect(detectDirectMediaType("https://cdn.example/watch", "video/mp4")).toBe("mp4");
    expect(detectDirectMediaType("https://cdn.example/watch", "application/vnd.apple.mpegurl")).toBe("hls");
    expect(detectDirectMediaType("https://cdn.example/watch", "application/dash+xml")).toBe("dash");
    expect(normalizeLanguageLabel("Audio 1", "ta", 0)).toBe("Tamil");
    expect(normalizeLanguageLabel("", "en-US", 1)).toBe("English");
  });

  test("resolves a media URL exposed by a CORS-readable provider response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      url: "https://cdn.provider.example/media",
      headers: { get: () => "video/mp4" },
    });
    const result = await resolveMediaSource("https://provider.example/watch/123");
    expect(result).toMatchObject({ status: "resolved", mediaType: "mp4", streamUrl: "https://cdn.provider.example/media" });
    expect(fetch).toHaveBeenCalledWith("https://provider.example/watch/123", expect.objectContaining({ method: "HEAD", mode: "cors", credentials: "omit" }));
  });

  test("uses the public Internet Archive metadata resolver", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "resolved",
        streamUrl: "https://archive.org/download/public-film/public-film.m3u8",
        mediaType: "hls",
        provider: "Internet Archive",
        subtitles: [{ src: "https://archive.org/download/public-film/public-film.en.vtt", lang: "en" }],
      }),
    });
    const result = await resolveMediaSource("https://archive.org/details/public-film");
    expect(result).toMatchObject({ status: "resolved", mediaType: "hls", provider: "Internet Archive" });
    expect(result.subtitles).toHaveLength(1);
    expect(fetch.mock.calls[0][0]).toContain("/api/resolve?");
  });

  test("retries a provider fallback instead of caching the failed resolution", async () => {
    fetch
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "resolved",
          streamUrl: "https://archive.org/download/retry-film/retry-film.mp4",
          mediaType: "mp4",
          provider: "Internet Archive",
        }),
      });

    const url = "https://archive.org/details/retry-film-after-failure";
    const first = await resolveMediaSource(url);
    const second = await resolveMediaSource(url);

    expect(first.status).toBe("iframe_fallback");
    expect(second).toMatchObject({ status: "resolved", mediaType: "mp4" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("falls back when a provider resolver exceeds its timeout", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("Request aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }));

    try {
      const pending = resolveMediaSource("https://archive.org/details/slow-item");
      jest.advanceTimersByTime(15000);
      const result = await pending;
      expect(result).toMatchObject({
        status: "iframe_fallback",
        fallbackReason: expect.stringContaining("timed out"),
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test("retains unsupported and cross-origin embed players without scraping", async () => {
    const isaiDub = await resolveMediaSource("https://isaidub.me/embed/movie");
    expect(isaiDub).toMatchObject({ status: "iframe_fallback", provider: "isaidub.me" });
    expect(fetch).not.toHaveBeenCalled();

    global.fetch = jest.fn().mockRejectedValue(new TypeError("CORS blocked"));
    const crossOrigin = await resolveMediaSource("https://provider.example/embed/opaque");
    expect(crossOrigin.status).toBe("iframe_fallback");
    expect(crossOrigin.embedUrl).toBe("https://provider.example/embed/opaque");
  });

  test("falls back when a direct endpoint is expired or unavailable", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      url: "https://cdn.example/expired",
      headers: { get: () => null },
    });

    const result = await resolveMediaSource("https://cdn.example/expired");
    expect(result).toMatchObject({
      status: "iframe_fallback",
      fallbackReason: expect.stringContaining("does not expose"),
    });
  });

  test("uses a supported Onestream video-element source without caching its signed URL", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "resolved",
          streamUrl: "https://dub.uptodub.ch/download.php?dl=fixture&stream=1",
          mediaType: "mp4",
          provider: "Onestream",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "resolved",
          streamUrl: "https://attacker.example/movie.mp4",
          mediaType: "mp4",
          provider: "Onestream",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "resolved",
          streamUrl: "https://dub.uptodub.ch/player.html",
          mediaType: "mp4",
          provider: "Onestream",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "iframe_fallback", reason: "Source no longer available." }),
      });

    const result = await resolveMediaSource("https://dub.onestream.today/stream/video/113861");
    expect(result).toMatchObject({
      status: "resolved",
      mediaType: "mp4",
      provider: "Onestream",
      streamUrl: "https://dub.uptodub.ch/download.php?dl=fixture&stream=1",
    });

    const untrusted = await resolveMediaSource("https://dub.onestream.today/stream/video/113862");
    expect(untrusted).toMatchObject({ status: "iframe_fallback", provider: "Onestream" });

    const pageAsVideo = await resolveMediaSource("https://dub.onestream.today/stream/video/113863");
    expect(pageAsVideo).toMatchObject({ status: "iframe_fallback", provider: "Onestream" });

    const refreshed = await resolveMediaSource("https://dub.onestream.today/stream/video/113861");
    expect(refreshed).toMatchObject({ status: "iframe_fallback", provider: "Onestream" });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  test("accepts only the publicly declared Cold Storage MP4 endpoint and allowlisted Dubshare target", async () => {
    const streamUrl = "https://download.isaidub.dad/download.php?url=https://s07.dubshare.one/isaiDub.io_-_Cold_Storage_2026_Original_1080p_HD.mp4&stream=1";
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "resolved",
          streamUrl,
          mediaType: "mp4",
          provider: "Onestream",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "resolved",
          streamUrl: "https://download.isaidub.dad/download.php?url=https://attacker.example/file.mp4&stream=1",
          mediaType: "mp4",
          provider: "Onestream",
        }),
      });

    const coldStorage = await resolveMediaSource("https://dub.onestream.today/stream/video/113861");
    expect(coldStorage).toMatchObject({
      status: "resolved",
      mediaType: "mp4",
      provider: "Onestream",
      streamUrl,
    });

    const untrustedTarget = await resolveMediaSource("https://dub.onestream.today/stream/video/113862");
    expect(untrustedTarget).toMatchObject({ status: "iframe_fallback", provider: "Onestream" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("resolves play.onestream page URLs and preserves its declared referrer policy", async () => {
    const streamUrl = "https://download.fastbytes.xyz/download.php?dl=fixtureOpaqueTokenForPublicTest&stream=1";
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "resolved",
          streamUrl,
          mediaType: "mp4",
          provider: "Onestream",
          referrerPolicy: "no-referrer",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "resolved",
          streamUrl: "https://download.fastbytes.xyz/player.html?dl=fixture&stream=1",
          mediaType: "mp4",
          provider: "Onestream",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "resolved",
          streamUrl: "https://fastly.fastbytes.xyz/open.php?dl=fixtureOpaqueTokenForPublicTest&stream=1",
          mediaType: "mp4",
          provider: "Onestream",
        }),
      });

    const result = await resolveMediaSource("https://play.onestream.today/stream/page/103474");
    expect(result).toMatchObject({
      status: "resolved",
      provider: "Onestream",
      mediaType: "mp4",
      streamUrl,
      referrerPolicy: "no-referrer",
    });

    const notMedia = await resolveMediaSource("https://play.onestream.today/stream/page/103475");
    expect(notMedia).toMatchObject({ status: "iframe_fallback", provider: "Onestream" });

    const rotatedSource = await resolveMediaSource("https://play.onestream.today/stream/page/103476");
    expect(rotatedSource).toMatchObject({
      status: "resolved",
      mediaType: "mp4",
      streamUrl: "https://fastly.fastbytes.xyz/open.php?dl=fixtureOpaqueTokenForPublicTest&stream=1",
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});