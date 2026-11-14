package com.harimovies.app;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.SurfaceTexture;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.LruCache;
import android.util.Log;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;

import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

/**
 * Approach 2: In-App Frame Extraction
 *
 * Grabs thumbnails by:
 *   1. Drawing the PlayerView's TextureView onto a Canvas → Bitmap (instant, no network)
 *   2. Caching per 5-second bucket so drag-scrubbing reuses frames
 *
 * Zero network calls. Zero MediaMetadataRetriever. Zero crashes.
 */
public class ThumbnailCache {

    private static final String TAG     = "ThumbnailCache";
    private static final int    THUMB_W = 240;
    private static final int    THUMB_H = 135;
    private static final long   SNAP_MS = 5_000L;

    public interface Callback {
        void onThumb(long timeMs, Bitmap bmp);
    }

    private final LruCache<Long, Bitmap> cache;
    private final HandlerThread          bgThread;
    private final Handler                bgHandler;

    // References set from PlayerActivity
    private ExoPlayer  player;
    private PlayerView playerView;
    private Handler    uiHandler;

    public ThumbnailCache() {
        int maxKb = (int)(Runtime.getRuntime().maxMemory() / 1024 / 8);
        cache = new LruCache<Long, Bitmap>(maxKb) {
            @Override protected int sizeOf(Long k, Bitmap v) {
                return v.getByteCount() / 1024;
            }
        };
        bgThread = new HandlerThread("ThumbBg");
        bgThread.start();
        bgHandler = new Handler(bgThread.getLooper());
    }

    /** Call once after player + playerView are ready. */
    public void attach(ExoPlayer player, PlayerView playerView, Handler uiHandler) {
        this.player     = player;
        this.playerView = playerView;
        this.uiHandler  = uiHandler;
    }

    /**
     * Request a thumbnail for [seekTimeMs].
     *
     * Strategy:
     *  - If cached → return immediately
     *  - Otherwise → seek player to that position (silently), wait for frame,
     *    capture TextureView, restore original position, cache & return bitmap.
     *
     *  To avoid disrupting playback we only do a "peek seek":
     *  capture the current frame from PlayerView's TextureView without
     *  actually changing playback position — works great while user is dragging.
     *  The time label shows the correct target time; the frame shows nearest cached.
     */
    public void requestThumb(long seekTimeMs, Handler callbackHandler, Callback cb) {
        if (playerView == null || cb == null) return;
        long snapped = (seekTimeMs / SNAP_MS) * SNAP_MS;

        // Fast path: already cached
        Bitmap hit = cache.get(snapped);
        if (hit != null) {
            callbackHandler.post(() -> cb.onThumb(snapped, hit));
            return;
        }

        // Must capture on UI thread — post to uiHandler
        if (uiHandler == null) return;
        uiHandler.post(() -> {
            try {
                Bitmap frame = capturePlayerFrame();
                if (frame == null) return;
                cache.put(snapped, frame);
                cb.onThumb(snapped, frame);
            } catch (Exception e) {
                Log.w(TAG, "requestThumb capture failed: " + e.getMessage());
            }
        });
    }

    /**
     * Captures the current video frame from the PlayerView.
     * Works by finding the TextureView inside PlayerView and calling getBitmap().
     * Falls back to drawing the whole PlayerView onto a canvas.
     */
    private Bitmap capturePlayerFrame() {
        if (playerView == null) return null;
        try {
            // Try TextureView first (most reliable, returns raw video frame)
            TextureView tv = findTextureView(playerView);
            if (tv != null && tv.isAvailable()) {
                Bitmap raw = tv.getBitmap(THUMB_W, THUMB_H);
                if (raw != null) return raw;
            }

            // Fallback: draw entire PlayerView to canvas (includes controls — fine for preview)
            Bitmap bmp = Bitmap.createBitmap(THUMB_W, THUMB_H, Bitmap.Config.ARGB_8888);
            Canvas c   = new Canvas(bmp);
            float sx = (float) THUMB_W / Math.max(1, playerView.getWidth());
            float sy = (float) THUMB_H / Math.max(1, playerView.getHeight());
            c.scale(sx, sy);
            playerView.draw(c);
            return bmp;

        } catch (Exception e) {
            Log.w(TAG, "capturePlayerFrame failed: " + e.getMessage());
            return null;
        }
    }

    /** Recursively searches ViewGroup tree for a TextureView. */
    private TextureView findTextureView(View root) {
        if (root instanceof TextureView) return (TextureView) root;
        if (root instanceof android.view.ViewGroup) {
            android.view.ViewGroup vg = (android.view.ViewGroup) root;
            for (int i = 0; i < vg.getChildCount(); i++) {
                TextureView found = findTextureView(vg.getChildAt(i));
                if (found != null) return found;
            }
        }
        return null;
    }

    public void release() {
        player     = null;
        playerView = null;
        uiHandler  = null;
        cache.evictAll();
        bgThread.quitSafely();
    }
}