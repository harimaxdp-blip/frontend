import { Capacitor } from "@capacitor/core";
import DeviceControl from "../plugins/deviceControl";
import IOSPlayer from "../plugins/iosPlayer";
import { resolveMediaSource } from "../utils/mediaSourceResolver";

export function isDirectVideo(url) {
  if (!url) return false;
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

  async play({ movie, playlist, startIndex = 0, onDone, onFallback }) {
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
        return await resolveMediaSource(source.link, { preferNativeBridge: true });
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        return asFallback(source.link, error);
      }
    }));
    const allResolved = resolutions.every((result) => result?.status === "resolved" && result.streamUrl);

    if (!allResolved) {
      // Keep each episode's resolution result so GlobalPlayer does not repeat provider requests.
      onFallback?.(null, {
        ...fallbackPayload,
        initialResolution: isSeries ? resolutions[startIndex] : resolutions[0],
        initialResolutions: isSeries ? resolutions : null,
      });
      return;
    }

    const resolvedPlaylist = isSeries
      ? sourcePlaylist.map((episode, index) => ({ ...episode, link: resolutions[index].streamUrl }))
      : null;
    const selectedResolution = resolutions[startIndex] || resolutions[0];
    const playbackUrl = selectedResolution.streamUrl;
    const resolvedFallbackPayload = {
      ...fallbackPayload,
      initialResolution: selectedResolution,
      initialResolutions: isSeries ? resolutions : null,
    };

    if (platform === "android") {
      const payload = {
        url: playbackUrl,
        title,
        playlist: resolvedPlaylist?.length ? JSON.stringify(resolvedPlaylist) : null,
        index: startIndex,
      };
      try {
        if (isDirectVideo(playbackUrl)) await DeviceControl.openExoPlayer(payload);
        else await DeviceControl.openWebPlayer(payload);
        onDone?.();
      } catch (error) {
        console.warn("[PlayerAdapter:Android] Native player failed, falling back to GlobalPlayer:", error);
        onFallback?.(error, resolvedFallbackPayload);
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