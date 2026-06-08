import React, { useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import DeviceControl from "../plugins/deviceControl";

export default function MoviePlayer() {
  const navigate   = useNavigate();
  const location   = useLocation();
  const movie      = location.state?.movie;
  const playlist   = location.state?.playlist     ?? null;
  const startIndex = location.state?.currentIndex ?? 0;

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
    console.log("PLAYER_DEBUG_VERSION_123456");
    console.log("PLAYER_DEBUG: Location State:", JSON.stringify(location.state));
    const isSeries       = Array.isArray(playlist) && playlist.length > 1;
    const currentEpisode = isSeries ? playlist[startIndex] : movie;

    const url = currentEpisode?.link || currentEpisode?.url || currentEpisode?.episodeLink;
    const title = currentEpisode?.title || currentEpisode?.episodeTitle || "";

    console.log("PLAYER_DEBUG_URL_RESOLVED=" + url);
    console.log("PLAYER_DEBUG_TITLE_RESOLVED=" + title);

    if (!url) {
      console.log("PLAYER_DEBUG: No URL found, going back. currentEpisode:", JSON.stringify(currentEpisode));
      handleGoBack();
      return;
    }
      const cleanedPlaylist = (playlist && Array.isArray(playlist))
        ? playlist.map(ep => {
            console.log("PLAYER_DEBUG: Raw Episode Object:", ep);
            return {
              link: ep.link || ep.url || ep.episodeLink || "",
              title: ep.title || ep.episodeTitle || ep.name || "",
              episode: ep.episode || ep.episodeNo || ep.ep || "",
              season: ep.season || "1",
              id: ep.id || ""
            };
          })
        : null;
const isDirectVideo =
  /\.(mp4|m3u8|mkv|webm|ts|avi|mov|flv|mpd)($|\?)/i.test(url) ||
  /[?&]stream=1/i.test(url)       ||
  /\/hls\//i.test(url)            ||   // HLS path segment
  /\/dash\//i.test(url)           ||   // DASH path segment
  /\/manifest\//i.test(url)       ||   // manifest path
  /\/playlist\//i.test(url)       ||   // playlist path
  /\.m3u8/i.test(url)             ||   // m3u8 anywhere in URL
  /\.mpd/i.test(url);                  // mpd anywhere in URL
    if (isDirectVideo) {
      // Clean and stringify the playlist to ensure it passes the bridge safely.
      // Firestore objects (like Timestamps) can cause serialization errors in Capacitor.


      const payload = {
        url,
        title,
        playlist: (cleanedPlaylist && cleanedPlaylist.length > 0) ? JSON.stringify(cleanedPlaylist) : null,
        index: startIndex
      };

      console.log("PLAYER_DEBUG_PAYLOAD_JSON=" + JSON.stringify(payload));
      console.log("PLAYER_DEBUG_PLAYLIST_JSON=" + JSON.stringify(cleanedPlaylist));

      console.log("PLAYER_DEBUG: Cleaned Playlist Array:", cleanedPlaylist);
      console.log("PLAYER_DEBUG: Final Payload Object:", payload);
      console.log("PLAYER_DEBUG MOVIE =", movie);
      console.log("PLAYER_DEBUG PLAYLIST =", playlist);
      console.log("PLAYER_DEBUG STARTINDEX =", startIndex);
      console.log("PLAYER_DEBUG PAYLOAD =", JSON.stringify(payload, null, 2));
      DeviceControl.openExoPlayer(payload)
        .then(handleGoBack)
        .catch(handleGoBack);
    } else {
      DeviceControl.openWebPlayer({
  url,
  title,
  playlist: cleanedPlaylist && cleanedPlaylist.length > 0
    ? JSON.stringify(cleanedPlaylist)
    : null,
  index: startIndex
})
  .then(handleGoBack)
  .catch(handleGoBack);
    }
  }, []); // eslint-disable-line

  return (
    <div style={{
      width: "100vw", height: "100vh", background: "#000",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        width: 48, height: 48,
        border: "4px solid #ffffff33",
        borderTop: "4px solid #fff",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}