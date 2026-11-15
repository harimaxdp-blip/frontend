import React, { useEffect, useCallback, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import playerAdapter from "../player/playerAdapter";
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

    // Prevent double-launching or launching if we already have a timeout pending
    if (window._mp_launching) return;
    window._mp_launching = true;

    const cleanup = () => {
      window._mp_launching = false;
    };

    // Safety timeout: if still on this page after 12 seconds on native platforms, force go back
    const isNativePlatform = playerAdapter.isAndroid();
    let safetyTimer = null;
    if (isNativePlatform) {
      safetyTimer = setTimeout(() => {
        console.warn("MoviePlayer safety timeout triggered - forcing go back");
        cleanup();
        handleGoBack();
      }, 12000);
    }

    const onPlayerDone = () => {
      if (safetyTimer) clearTimeout(safetyTimer);
      cleanup();
      handleGoBack();
    };

    const launchFallback = (err, payload) => {
      if (err) console.warn("PLAYER_FALLBACK:", err);
      if (safetyTimer) clearTimeout(safetyTimer);
      cleanup();
      setFallbackPayload(payload || {
        url: movie?.link || movie?.url || "",
        title: movie?.title || "",
        playlist,
        index: startIndex
      });
      setUseFallback(true);
    };

    playerAdapter
      .play({
        movie,
        playlist,
        startIndex,
        onDone: onPlayerDone,
        onFallback: launchFallback
      })
      .catch((err) => {
        console.error("PlayerAdapter play error:", err);
        cleanup();
        handleGoBack();
      });

    return () => {
      if (safetyTimer) clearTimeout(safetyTimer);
      cleanup();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (useFallback && fallbackPayload) {
    return (
      <GlobalPlayer
        url={fallbackPayload.url}
        title={fallbackPayload.title}
        playlist={fallbackPayload.playlist}
        startIndex={fallbackPayload.index ?? 0}
        initialResolution={fallbackPayload.initialResolution}
        initialResolutions={fallbackPayload.initialResolutions}
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
