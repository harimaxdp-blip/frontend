import { Capacitor } from "@capacitor/core";
import DeviceControl from "../plugins/deviceControl";
import { MEDIA_PROXY_BASE, resolveMediaSource } from "../utils/mediaSourceResolver";
import { playerAdapter } from "./playerAdapter";

jest.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: jest.fn() },
}));

jest.mock("../plugins/deviceControl", () => ({
  __esModule: true,
  default: {
    openExoPlayer: jest.fn(),
    openTorrentPlayer: jest.fn(),
  },
}));

jest.mock("../plugins/iosPlayer", () => ({
  __esModule: true,
  default: { openPlayer: jest.fn() },
}));

jest.mock("../utils/mediaSourceResolver", () => {
  const actual = jest.requireActual("../utils/mediaSourceResolver");
  return { ...actual, resolveMediaSource: jest.fn() };
});

describe("Android player adapter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Capacitor.getPlatform.mockReturnValue("android");
  });

  test("remuxes Matroska sources through the shared HLS proxy for ExoPlayer", async () => {
    const sourceUrl = "https://cdn.example/movie.mkv?token=sample";
    resolveMediaSource.mockResolvedValue({
      status: "resolved",
      streamUrl: sourceUrl,
      mediaType: "remux",
      provider: "Direct Stream",
    });

    await playerAdapter.play({
      movie: { link: sourceUrl, title: "Test movie" },
    });

    expect(DeviceControl.openExoPlayer).toHaveBeenCalledWith(expect.objectContaining({
      url: `${MEDIA_PROXY_BASE}/api/hls/master.m3u8?url=${encodeURIComponent(sourceUrl)}&audio=0`,
      mediaType: "hls",
    }));
  });

  test("uses GlobalPlayer for Android provider URLs that do not resolve to direct media", async () => {
    const sourceUrl = "https://provider.example/watch/movie";
    const resolution = {
      status: "iframe_fallback",
      embedUrl: sourceUrl,
      provider: "provider.example",
    };
    const onFallback = jest.fn();
    resolveMediaSource.mockResolvedValue(resolution);

    await playerAdapter.play({
      movie: { link: sourceUrl, title: "Test movie" },
      onFallback,
    });

    expect(DeviceControl.openExoPlayer).not.toHaveBeenCalled();
    expect(onFallback).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ url: sourceUrl, initialResolution: resolution })
    );
  });

  test("keeps YouTube links on the compatible embedded-player fallback on Android", async () => {
    const sourceUrl = "https://www.youtube.com/watch?v=abcdefghijk";
    const resolution = {
      status: "iframe_fallback",
      embedUrl: "https://www.youtube-nocookie.com/embed/abcdefghijk",
      provider: "YouTube",
    };
    const onFallback = jest.fn();
    resolveMediaSource.mockResolvedValue(resolution);

    await playerAdapter.play({
      movie: { link: sourceUrl, title: "Test movie" },
      onFallback,
    });

    expect(DeviceControl.openExoPlayer).not.toHaveBeenCalled();
    expect(onFallback).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ url: sourceUrl, initialResolution: resolution })
    );
  });

  test("keeps browser playback on GlobalPlayer", async () => {
    Capacitor.getPlatform.mockReturnValue("web");
    const onFallback = jest.fn();
    const sourceUrl = "https://provider.example/watch/movie";

    await playerAdapter.play({
      movie: { link: sourceUrl, title: "Test movie" },
      onFallback,
    });

    expect(DeviceControl.openExoPlayer).not.toHaveBeenCalled();
    expect(onFallback).toHaveBeenCalledWith(null, expect.objectContaining({
      url: sourceUrl,
      title: "Test movie",
    }));
  });
});
