import { Capacitor } from "@capacitor/core";
import DeviceControl from "../plugins/deviceControl";
import IOSPlayer from "../plugins/iosPlayer";

/**
 * Checks if the video URL is a direct media file / stream
 */
export function isDirectVideo(url) {
  if (!url) return false;
  return (
    /\.(mp4|m3u8|mkv|webm|ts|avi|mov|flv|mpd)($|\?)/i.test(url) ||
    /[?&]stream=1/i.test(url) ||
    /\/hls\//i.test(url) ||
    /\/dash\//i.test(url) ||
    /\/manifest\//i.test(url) ||
    /\/playlist\//i.test(url) ||
    /\.m3u8/i.test(url) ||
    /\.mpd/i.test(url)
  );
}

/**
 * Checks if the video URL is natively supported by Apple AVPlayer (MP4, HLS, MOV, M4V)
 */
export function isSupportedIOSFormat(url) {
  if (!url) return false;
  const isHls = /\.m3u8($|\?)/i.test(url) || /\/hls\//i.test(url);
  const isMp4 = /\.(mp4|m4v|mov)($|\?)/i.test(url);
  return isHls || isMp4;
}

/**
 * Normalizes playlist entries for consistent cross-platform use
 */
export function cleanPlaylist(playlist) {
  if (!Array.isArray(playlist)) return null;
  return playlist.map((ep) => ({
    link:    ep.link || ep.url || ep.episodeLink || "",
    title:   ep.title || ep.episodeTitle || ep.name || "",
    episode: ep.episode || ep.episodeNo || ep.ep || "",
    season:  ep.season || "1",
    id:      ep.id || ""
  }));
}

/**
 * Platform-Aware Player Adapter
 * - Android: Uses existing native DeviceControl (ExoPlayer, TorrentPlayer, WebPlayer)
 * - iOS: Uses dedicated native IOSPlayer (AVPlayerViewController) for MP4/HLS,
 *        with graceful GlobalPlayer fallback for MKV, AVI, FLV, web & magnet links.
 * - Web: Falls back to GlobalPlayer
 */
export const playerAdapter = {
  getPlatform() {
    return Capacitor.getPlatform(); // 'android' | 'ios' | 'web'
  },

  isAndroid() {
    return this.getPlatform() === "android";
  },

  isIOS() {
    return this.getPlatform() === "ios";
  },

  isWeb() {
    return this.getPlatform() === "web";
  },

  /**
   * Dispatches playback based on the platform
   * @param {Object} params
   * @param {Object} params.movie - Selected movie or video item
   * @param {Array}  params.playlist - Array of episodes if series
   * @param {number} params.startIndex - Current episode index
   * @param {Function} params.onDone - Callback when native player finishes
   * @param {Function} params.onFallback - Callback to render GlobalPlayer fallback
   */
  async play({ movie, playlist, startIndex = 0, onDone, onFallback }) {
    const isSeries = Array.isArray(playlist) && playlist.length > 1;
    const currentEpisode = isSeries ? playlist[startIndex] : movie;
    const url = currentEpisode?.link || currentEpisode?.url || currentEpisode?.episodeLink;
    const title = currentEpisode?.title || currentEpisode?.episodeTitle || "";

    if (!url) {
      throw new Error("No playable video URL provided");
    }

    const cleanedPlaylist = cleanPlaylist(playlist);
    const fallbackPayload = {
      url,
      title,
      playlist: cleanedPlaylist?.length > 0 ? cleanedPlaylist : null,
      index: startIndex
    };

    const platform = this.getPlatform();

    // ─── 1. ANDROID: 100% untouched native integration ───
    if (platform === "android") {
      // 1.1. Magnet links -> TorrentPlayerActivity
      if (url.startsWith("magnet:")) {
        try {
          await DeviceControl.openTorrentPlayer({ magnet: url, title });
          onDone?.();
          return;
        } catch (err) {
          console.warn("[PlayerAdapter:Android] Torrent player failed:", err);
          onDone?.();
          return;
        }
      }

      // 1.2. Normal HTTP/HLS/direct or web flow
      const payload = {
        url,
        title,
        playlist: cleanedPlaylist?.length > 0 ? JSON.stringify(cleanedPlaylist) : null,
        index: startIndex
      };

      try {
        if (isDirectVideo(url)) {
          await DeviceControl.openExoPlayer(payload);
        } else {
          await DeviceControl.openWebPlayer(payload);
        }
        onDone?.();
      } catch (err) {
        console.warn("[PlayerAdapter:Android] Native player failed, falling back to GlobalPlayer:", err);
        onFallback?.(err, fallbackPayload);
      }
      return;
    }

    // ─── 2. IOS: Dedicated IOSPlayer plugin with AVPlayerViewController ───
    if (platform === "ios") {
      // 2.1. Magnet links: Not supported natively by AVPlayer -> GlobalPlayer fallback
      if (url.startsWith("magnet:")) {
        console.warn("[PlayerAdapter:iOS] Magnet links not supported natively by AVPlayer, routing to fallback");
        onFallback?.(new Error("Magnet streams not supported natively on iOS"), fallbackPayload);
        return;
      }

      // 2.2. MKV, AVI, FLV, WMV: Unsupported container formats for AVPlayer -> graceful fallback to GlobalPlayer
      if (/\.(mkv|avi|flv|wmv)($|\?)/i.test(url)) {
        console.warn("[PlayerAdapter:iOS] Format not supported natively by AVPlayer, routing to GlobalPlayer fallback");
        onFallback?.(new Error("Format not supported natively by iOS AVPlayer"), fallbackPayload);
        return;
      }

      // 2.3. Supported native formats: MP4 and HLS (M3U8)
      if (isSupportedIOSFormat(url)) {
        const payload = {
          url,
          title,
          playlist: cleanedPlaylist?.length > 0 ? cleanedPlaylist : null,
          index: startIndex
        };

        try {
          await IOSPlayer.openPlayer(payload);
          onDone?.();
        } catch (err) {
          console.warn("[PlayerAdapter:iOS] IOSPlayer failed, falling back to GlobalPlayer:", err);
          onFallback?.(err, fallbackPayload);
        }
        return;
      }

      // 2.4. Other web / embed video links -> fallback to GlobalPlayer
      console.log("[PlayerAdapter:iOS] Routing web video link to GlobalPlayer fallback");
      onFallback?.(null, fallbackPayload);
      return;
    }

    // ─── 3. WEB / DESKTOP: In-browser GlobalPlayer ───
    console.log("[PlayerAdapter:Web] Using GlobalPlayer for Web platform");
    onFallback?.(null, fallbackPayload);
  }
};

export default playerAdapter;
