import React, { useEffect, useCallback, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import DeviceControl from "../plugins/deviceControl";
import GlobalPlayer from "./GlobalPlayer";

export default function MoviePlayer() {
  const navigate   = useNavigate();
  const location   = useLocation();
  const movie      = location.state?.movie;
  const playlist   = location.state?.playlist     ?? null;
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

  // ── ALL hooks must be called before any conditional return ──────────────
  useEffect(() => {
    // Don't run native-player logic once we've already switched to fallback
    if (useFallback) return;

    console.log("PLAYER_DEBUG_VERSION_123456");
    console.log("PLAYER_DEBUG: Location State:", JSON.stringify(location.state));

    const isSeries       = Array.isArray(playlist) && playlist.length > 1;
    const currentEpisode = isSeries ? playlist[startIndex] : movie;

    const url   = currentEpisode?.link || currentEpisode?.url || currentEpisode?.episodeLink;
    const title = currentEpisode?.title || currentEpisode?.episodeTitle || "";

    console.log("PLAYER_DEBUG_URL_RESOLVED=" + url);
    console.log("PLAYER_DEBUG_TITLE_RESOLVED=" + title);

    if (!url) {
      console.log("PLAYER_DEBUG: No URL found, going back.");
      handleGoBack();
      return;
    }

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
      console.warn("PLAYER_FALLBACK: native player failed, switching to GlobalPlayer:", err);
      setFallbackPayload({
        url,
        title,
        playlist: cleanedPlaylist?.length > 0 ? cleanedPlaylist : null,
        index: startIndex
      });
      setUseFallback(true);
    };

    if (isDirectVideo) {
      DeviceControl.openExoPlayer(payload)
        .then(handleGoBack)
        .catch(launchFallback);
    } else {
      DeviceControl.openWebPlayer(payload)
        .then(handleGoBack)
        .catch(launchFallback);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Conditional render AFTER all hooks ─────────────────────────────────
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

  // ── Spinner while waiting for native player ─────────────────────────────
  return (
    <div style={{
      width: "100vw", height: "100vh", background: "#000",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        width: 48, height: 48,
        border: "4px solid #ffffff33",
        borderTop: "4px solid #e50914",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}