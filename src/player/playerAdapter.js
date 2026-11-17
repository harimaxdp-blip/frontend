import { Capacitor } from "@capacitor/core";
import DeviceControl from "../plugins/deviceControl";
import IOSPlayer from "../plugins/iosPlayer";
import { resolveMediaSource } from "../utils/mediaSourceResolver";

export function isDirectVideo(url, mediaType = "") {
  if (!url) return false;
  if (["mp4", "hls", "dash", "webm", "mkv", "avi", "mov", "ogv", "3gp", "wmv", "flv", "ts", "remux"].includes(
    String(mediaType).toLowerCase()
  )) return true;
  return /\.(mp4|m3u8|mkv|webm|ts|avi|mov|flv|mpd|ogv|3gp|wmv)(?:$|[?#])/i.test(url) ||
    /[?&]stream=1/i.test(url) || /\/(?:hls|dash|manifest|playlist)\//i.test(url);
}

export function isSupportedIOSFormat(url) {
  if (!url) return false;
  return /\.(m3u8|mp4|m4v|mov)(?:$|[?#])/i.test(url) || /\/hls\//i.test(url);
}

export function cleanPlaylist(playlist) {
  if (!Array.isArray(playlist)) return null;
  return playlist.map((ep) => ({
    link: ep.link || ep.url || ep.episodeLink || "",
    title: ep.title || ep.episodeTitle || ep.name || "",
    episode: ep.episode || ep.episodeNo || ep.ep || "",
    season: ep.season || "1",
    id: ep.id || "",
  }));
}

function asFallback(url, error) {
  return {
    status: "iframe_fallback",
    embedUrl: url,
    provider: "External source",
    fallbackReason: error?.message || "The media source could not be resolved safely.",
  };
}

export const playerAdapter = {
  getPlatform() { return Capacitor.getPlatform(); },
  isAndroid() { return this.getPlatform() === "android"; },
  isIOS() { return this.getPlatform() === "ios"; },
  isWeb() { return this.getPlatform() === "web"; },

  async play({ movie, playlist, startIndex = 0, onDone, onFallback, signal }) {
    const isSeries = Array.isArray(playlist) && playlist.length > 1;
    const sourcePlaylist = cleanPlaylist(playlist);
    const currentEpisode = isSeries ? playlist[startIndex] : movie;
    const sourceUrl = currentEpisode?.link || currentEpisode?.url || currentEpisode?.episodeLink || "";
    const title = currentEpisode?.title || currentEpisode?.episodeTitle || "";
    if (!sourceUrl) throw new Error("No playable video URL provided");

    const platform = this.getPlatform();
    const fallbackPayload = {
      url: sourceUrl,
      title,
      playlist: sourcePlaylist?.length ? sourcePlaylist : null,
      index: startIndex,
    };

    // The browser GlobalPlayer owns source discovery for web playback.
    if (platform === "web") {
      onFallback?.(null, fallbackPayload);
      return;
    }

    if (/^magnet:\?/i.test(sourceUrl)) {
      if (platform === "android") {
        try {
          await DeviceControl.openTorrentPlayer({ magnet: sourceUrl, title });
          onDone?.();
        } catch (error) {
          console.warn("[PlayerAdapter:Android] Torrent player failed:", error);
          onDone?.();
        }
      } else {
        onFallback?.(new Error("Magnet streams are not supported by iOS AVPlayer"), fallbackPayload);
      }
      return;
    }

    const sources = isSeries ? sourcePlaylist : [{ link: sourceUrl, title }];
    const resolutions = await Promise.all(sources.map(async (source) => {
      try {
        return await resolveMediaSource(source.link, { signal, preferNativeBridge: true });
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        return asFallback(source.link, error);
      }
    }));
    if (signal?.aborted) return;

    const selectedResolution = resolutions[startIndex] || resolutions[0];
    const playbackUrl = (selectedResolution?.status === "resolved" && selectedResolution?.streamUrl)
      ? selectedResolution.streamUrl
      : sourceUrl;

    const resolvedPlaylist = isSeries
      ? sourcePlaylist.map((episode, index) => ({
          ...episode,
          link: resolutions[index]?.status === "resolved" && resolutions[index]?.streamUrl
            ? resolutions[index].streamUrl
            : episode.link,
        }))
      : null;

    const resolvedFallbackPayload = {
      ...fallbackPayload,
      initialResolution: selectedResolution,
      initialResolutions: isSeries ? resolutions : null,
    };

    if (platform === "android") {
      const payload = {
        url: playbackUrl,
        originalUrl: sourceUrl,
        title,
        mediaType: selectedResolution?.mediaType,
        referer: selectedResolution?.provider === "Onestream"
          ? "https://dub.onestream.today/"
          : undefined,
        playlist: resolvedPlaylist?.length ? JSON.stringify(resolvedPlaylist) : null,
        index: startIndex,
      };
      try {
        await DeviceControl.openExoPlayer(payload);
        onDone?.();
      } catch (error) {
        console.error("[PlayerAdapter:Android] Native ExoPlayer launch failed:", error);
        onFallback?.(error, fallbackPayload);
      }
      return;
    }

    if (platform === "ios") {
      const nativePlaylistSupported = !resolvedPlaylist || resolvedPlaylist.every((episode) => isSupportedIOSFormat(episode.link));
      if (isSupportedIOSFormat(playbackUrl) && nativePlaylistSupported) {
        try {
          await IOSPlayer.openPlayer({
            url: playbackUrl,
            title,
            playlist: resolvedPlaylist,
            index: startIndex,
          });
          onDone?.();
        } catch (error) {
          console.warn("[PlayerAdapter:iOS] IOSPlayer failed, falling back to GlobalPlayer:", error);
          onFallback?.(error, resolvedFallbackPayload);
        }
      } else {
        onFallback?.(null, resolvedFallbackPayload);
      }
      return;
    }

    onFallback?.(null, fallbackPayload);
  },
};

export default playerAdapter;