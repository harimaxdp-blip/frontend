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
    const isSeries       = Array.isArray(playlist) && playlist.length > 1;
    const currentEpisode = isSeries ? playlist[startIndex] : movie;
    const url            = currentEpisode?.link;
    const title          = currentEpisode?.title || "";

    if (!url) { handleGoBack(); return; }

    const isDirectVideo =
      /\.(mp4|m3u8|mkv|webm|ts|avi|mov|flv)($|\?)/i.test(url) ||
      /download\.php.*stream=1/i.test(url);

    if (isDirectVideo) {
      // Direct video → straight to ExoPlayer
      DeviceControl.openExoPlayer({ url, title })
        .then(handleGoBack)
        .catch(handleGoBack);
    } else {
      // iframe/webpage → WebView finds video → ExoPlayer
      DeviceControl.openWebPlayer({ url, title })
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