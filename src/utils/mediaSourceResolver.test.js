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
    const hls = await resolveMediaSource("https://cdn.example/master.m3u8?token=1");
    const dash = await resolveMediaSource("https://cdn.example/manifest.mpd");

    expect(mp4).toMatchObject({ status: "resolved", mediaType: "mp4" });
    expect(hls).toMatchObject({ status: "resolved", mediaType: "hls" });
    expect(dash).toMatchObject({ status: "resolved", mediaType: "dash" });
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

  test("retains unsupported and cross-origin embed players without scraping", async () => {
    const isaiDub = await resolveMediaSource("https://isaidub.me/embed/movie");
    expect(isaiDub).toMatchObject({ status: "iframe_fallback", provider: "isaidub.me" });
    expect(fetch).not.toHaveBeenCalled();

    global.fetch = jest.fn().mockRejectedValue(new TypeError("CORS blocked"));
    const crossOrigin = await resolveMediaSource("https://provider.example/embed/opaque");
    expect(crossOrigin.status).toBe("iframe_fallback");
    expect(crossOrigin.embedUrl).toBe("https://provider.example/embed/opaque");
  });
});