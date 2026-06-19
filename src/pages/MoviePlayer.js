import React, { useEffect, useCallback, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import DeviceControl from "../plugins/deviceControl";
import GlobalPlayer from "./GlobalPlayer";

export default function MoviePlayer() {
  const navigate   = useNavigate();
  const location   = useLocation();
  const movie      = location.state?.movie;
  const playlist   = location.state?.playlist      ?? null;
  const startIndex = location.state?.currentIndex ?? 0;

  const [useFallback, setUseFallback]       = useState(false);
  const [fallbackPayload, setFallbackPayload] = useState(null);

  const handleGoBack = useCallback(() => {
    try {
      window.history.length > 1
        ? navigate(-1)
        : navigate("/", { replace: true });
    } catch {
      navigate("/", { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    if (useFallback) return;

    const isSeries       = Array.isArray(playlist) && playlist.length > 1;
    const currentEpisode = isSeries ? playlist[startIndex] : movie;

    const url   = currentEpisode?.link || currentEpisode?.url || currentEpisode?.episodeLink;
    const title = currentEpisode?.title || currentEpisode?.episodeTitle || "";

    if (!url) { handleGoBack(); return; }

    // ── Magnet link → TorrentPlayerActivity ────────────────────────────────
    if (url.startsWith("magnet:")) {
      DeviceControl.openTorrentPlayer({ magnet: url, title })
        .then(handleGoBack)
        .catch((err) => {
          console.warn("Torrent player failed:", err);
          // No web fallback for magnet links — just go back
          handleGoBack();
        });
      return;
    }

    // ── Normal HTTP video flow ──────────────────────────────────────────────
    const cleanedPlaylist = Array.isArray(playlist)
      ? playlist.map(ep => ({
          link:    ep.link || ep.url || ep.episodeLink || "",
          title:   ep.title || ep.episodeTitle || ep.name || "",
          episode: ep.episode || ep.episodeNo || ep.ep || "",
          season:  ep.season || "1",
          id:      ep.id || ""
        }))
      : null;

    const isDirectVideo =
      /\.(mp4|m3u8|mkv|webm|ts|avi|mov|flv|mpd)($|\?)/i.test(url) ||
      /[?&]stream=1/i.test(url)   ||
      /\/hls\//i.test(url)        ||
      /\/dash\//i.test(url)       ||
      /\/manifest\//i.test(url)   ||
      /\/playlist\//i.test(url)   ||
      /\.m3u8/i.test(url)         ||
      /\.mpd/i.test(url);

    const payload = {
      url,
      title,
      playlist: cleanedPlaylist?.length > 0 ? JSON.stringify(cleanedPlaylist) : null,
      index: startIndex
    };

    const launchFallback = (err) => {
      console.warn("PLAYER_FALLBACK:", err);
      setFallbackPayload({
        url,
        title,
        playlist: cleanedPlaylist?.length > 0 ? cleanedPlaylist : null,
        index: startIndex
      });
      setUseFallback(true);
    };

    if (isDirectVideo) {
      DeviceControl.openExoPlayer(payload).then(handleGoBack).catch(launchFallback);
    } else {
      DeviceControl.openWebPlayer(payload).then(handleGoBack).catch(launchFallback);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (useFallback && fallbackPayload) {
    return (
      <GlobalPlayer
        url={fallbackPayload.url}
        title={fallbackPayload.title}
        playlist={fallbackPayload.playlist}
        startIndex={fallbackPayload.index ?? 0}
        onClose={handleGoBack}
      />
    );
  }

  // Pure black mask layout blocks rendering distortions while the native activity rotates landscape
  return (
    <div style={{
      width: "100vw",
      height: "100vh",
      backgroundColor: "#000000",
      position: "fixed",
      inset: 0,
      zIndex: 99999
    }} />
  );
}