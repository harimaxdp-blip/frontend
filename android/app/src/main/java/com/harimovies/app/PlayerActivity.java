package com.harimovies.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;

import java.util.HashMap;
import java.util.Map;

public class PlayerActivity extends Activity {

    public static final String EXTRA_URL   = "url";
    public static final String EXTRA_TITLE = "title";

    private ExoPlayer  player;
    private PlayerView playerView;

    private boolean isMuted         = false;
    private boolean isFullscreen    = false;
    private int     resizeModeIndex = 0;

    private static final int[] RESIZE_MODES = {
        AspectRatioFrameLayout.RESIZE_MODE_FILL,
        AspectRatioFrameLayout.RESIZE_MODE_FIT,
        AspectRatioFrameLayout.RESIZE_MODE_ZOOM,
        AspectRatioFrameLayout.RESIZE_MODE_FIXED_WIDTH
    };
    private static final String[] RESIZE_LABELS = { "Fill", "Fit", "Zoom", "Stretch" };

    // ── Controls visibility ───────────────────────────────────────────────────
    private boolean controlsVisible = false;
    private boolean isLocked        = false;
    private boolean lockUiVisible   = false;

    private final Handler  autoHideHandler    = new Handler(Looper.getMainLooper());
    private final Runnable autoHideRunnable   = this::hideControls;
    private final Runnable hideLockUiRunnable = this::hideLockUI;
    private static final long AUTO_HIDE_MS    = 4_000L;
    private static final long LOCK_UI_MS      = 3_000L;

    // ── Gesture state ─────────────────────────────────────────────────────────
    private float   downRawX          = 0f;
    private float   downRawY          = 0f;
    private boolean downInLeft        = false;
    private boolean downInRight       = false;
    private int     gestureStartValue = 0;
    private boolean dirLocked         = false;
    private boolean isVertical        = false;
    private boolean isHorizontal      = false;

    private static final float GESTURE_THRESHOLD = 18f;
    private static final float SEEK_PX_PER_SEC   = 8f;

    // Double-tap
    private long lastTapTime = 0L;
    private int  lastTapSide = 0;
    private static final long DOUBLE_TAP_MS = 300L;

    // ── Audio ─────────────────────────────────────────────────────────────────
    private AudioManager audioManager;
    private int          maxVolume;

    // ── Controller views ──────────────────────────────────────────────────────
    private LinearLayout brightnessIndicator, volumeIndicator;
    private ProgressBar  progressBrightness, progressVolume;
    private TextView     tvBrightnessValue, tvVolumeValue;
    private LinearLayout seekIndicator;
    private ImageView    seekIcon;
    private TextView     tvSeekDelta;
    private View         topBar, centerControls, bottomBar, scrimTop, scrimBottom;
    private View         exoPlayPause;
    private ImageButton  btnLock;
    private TextView     tvLockHint;

    // ══════════════════════════════════════════════════════════════════════════
    //  onCreate
    // ══════════════════════════════════════════════════════════════════════════
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemUI();
        setContentView(R.layout.activity_player);

        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        maxVolume    = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);

        playerView = findViewById(R.id.player_view);

        String url   = getIntent().getStringExtra(EXTRA_URL);
        String title = getIntent().getStringExtra(EXTRA_TITLE);

        player = new ExoPlayer.Builder(this).build();
        playerView.setPlayer(player);
        playerView.setControllerShowTimeoutMs(-1);
        playerView.setControllerAutoShow(false);
        playerView.setUseController(true);
        playerView.showController();

        findControllerViews();
        wireButtons();
        setupGestures();
        setupLockButton();

        hideControls();

        TextView tvTitle = playerView.findViewById(R.id.tv_title);
        if (tvTitle != null && title != null) tvTitle.setText(title);

        // Media source
        DefaultHttpDataSource.Factory dsFactory =
                new DefaultHttpDataSource.Factory()
                        .setUserAgent(
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
                            "AppleWebKit/537.36 (KHTML, like Gecko) " +
                            "Chrome/148.0.0.0 Safari/537.36");

        Map<String, String> headers = new HashMap<>();
        headers.put("Referer", "https://dub.onestream.today/");
        headers.put("Cookie",  "cache_2685d8fa2727bff6=1781032689");
        dsFactory.setDefaultRequestProperties(headers);

        MediaSource mediaSource =
                new ProgressiveMediaSource.Factory(dsFactory)
                        .createMediaSource(MediaItem.fromUri(Uri.parse(url)));

        player.addListener(new Player.Listener() {
            @Override public void onPlayerError(PlaybackException e) {
                Log.e("PLAYER", "Error: " + e.getMessage(), e);
            }
            @Override public void onPlaybackStateChanged(int state) {
                Log.d("PLAYER", "State: " + state);
            }
        });

        player.setMediaSource(mediaSource);
        player.prepare();
        player.play();
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Find views
    // ══════════════════════════════════════════════════════════════════════════
private void findControllerViews() {
    brightnessIndicator = playerView.findViewById(R.id.gesture_brightness_indicator);
    progressBrightness  = playerView.findViewById(R.id.progress_brightness);
    tvBrightnessValue   = playerView.findViewById(R.id.tv_brightness_value);

    volumeIndicator     = playerView.findViewById(R.id.gesture_volume_indicator);
    progressVolume      = playerView.findViewById(R.id.progress_volume);
    tvVolumeValue       = playerView.findViewById(R.id.tv_volume_value);

    seekIndicator       = playerView.findViewById(R.id.seek_indicator);
    seekIcon            = playerView.findViewById(R.id.seek_icon);
    tvSeekDelta         = playerView.findViewById(R.id.tv_seek_delta);

    topBar              = playerView.findViewById(R.id.top_bar);
    centerControls      = playerView.findViewById(R.id.center_controls);
    bottomBar           = playerView.findViewById(R.id.bottom_bar);
    scrimTop            = playerView.findViewById(R.id.scrim_top);
    scrimBottom         = playerView.findViewById(R.id.scrim_bottom);
    exoPlayPause        = playerView.findViewById(R.id.exo_play_pause);

    // ↓ These two now come from Activity layout, NOT playerView
    btnLock             = findViewById(R.id.btn_lock);
    tvLockHint          = findViewById(R.id.tv_lock_hint);
}

    // ══════════════════════════════════════════════════════════════════════════
    //  Show / Hide controls
    // ══════════════════════════════════════════════════════════════════════════
    private void showControls() {
        if (isLocked) return;
        controlsVisible = true;
        playerView.showController();

        View[] targets = { topBar, centerControls, bottomBar, scrimTop, scrimBottom };
        for (View v : targets) {
            if (v == null) continue;
            v.animate().cancel();
            v.setVisibility(View.VISIBLE);
            v.animate().alpha(1f).setDuration(220)
                    .setInterpolator(new AccelerateDecelerateInterpolator()).start();
        }
        if (btnLock != null) {
            btnLock.animate().cancel();
            btnLock.setVisibility(View.VISIBLE);
            btnLock.animate().alpha(1f).setDuration(220).start();
        }
        scheduleHide();
    }

    private void hideControls() {
        controlsVisible = false;
        playerView.hideController();

        View[] targets = { topBar, centerControls, bottomBar, scrimTop, scrimBottom };
        for (View v : targets) {
            if (v == null) continue;
            v.animate().cancel();
            v.animate().alpha(0f).setDuration(300)
                    .setInterpolator(new AccelerateDecelerateInterpolator())
                    .withEndAction(() -> v.setVisibility(View.GONE)).start();
        }
        if (btnLock != null) {
            btnLock.animate().cancel();
            btnLock.animate().alpha(0f).setDuration(300)
                    .withEndAction(() -> btnLock.setVisibility(View.GONE)).start();
        }
    }

    private void scheduleHide() {
        autoHideHandler.removeCallbacks(autoHideRunnable);
        autoHideHandler.postDelayed(autoHideRunnable, AUTO_HIDE_MS);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Lock UI
    // ══════════════════════════════════════════════════════════════════════════
    private void showLockUI() {
        lockUiVisible = true;
        autoHideHandler.removeCallbacks(hideLockUiRunnable);

        if (btnLock != null) {
            btnLock.animate().cancel();
            btnLock.setAlpha(0f);
            btnLock.setVisibility(View.VISIBLE);
            btnLock.bringToFront();
            btnLock.animate().alpha(1f).setDuration(200).start();
        }
        if (tvLockHint != null) {
            tvLockHint.animate().cancel();
            tvLockHint.setAlpha(0f);
            tvLockHint.setVisibility(View.VISIBLE);
            tvLockHint.bringToFront();
            tvLockHint.animate().alpha(1f).setDuration(200).start();
        }
        autoHideHandler.postDelayed(hideLockUiRunnable, LOCK_UI_MS);
    }

    private void hideLockUI() {
        lockUiVisible = false;
        autoHideHandler.removeCallbacks(hideLockUiRunnable);

        if (btnLock != null) {
            btnLock.animate().cancel();
            btnLock.animate().alpha(0f).setDuration(300)
                    .withEndAction(() -> btnLock.setVisibility(View.GONE)).start();
        }
        if (tvLockHint != null) {
            tvLockHint.animate().cancel();
            tvLockHint.animate().alpha(0f).setDuration(300)
                    .withEndAction(() -> tvLockHint.setVisibility(View.GONE)).start();
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Lock / Unlock
    // ══════════════════════════════════════════════════════════════════════════
    private void setupLockButton() {
        if (btnLock == null) return;

        btnLock.setOnTouchListener((v, event) -> {
            if (event.getAction() == MotionEvent.ACTION_UP) {
                if (isLocked) {
                    unlock();
                } else {
                    lock();
                }
            }
            return true; // consume all events — never propagate to playerView
        });
    }

    private void lock() {
        isLocked      = true;
        lockUiVisible = false;
        autoHideHandler.removeCallbacks(autoHideRunnable);
        autoHideHandler.removeCallbacks(hideLockUiRunnable);

        playerView.hideController();

        // Fade out all controls
        View[] toHide = { topBar, centerControls, bottomBar, scrimTop, scrimBottom };
        for (View v : toHide) {
            if (v == null) continue;
            v.animate().cancel();
            v.animate().alpha(0f).setDuration(250)
                    .withEndAction(() -> v.setVisibility(View.GONE)).start();
        }

        // Pulse the lock icon, keep visible, then auto-hide
        if (btnLock != null) {
            btnLock.setImageResource(R.drawable.ic_lock_closed);
            btnLock.animate().cancel();
            btnLock.setVisibility(View.VISIBLE);
            btnLock.bringToFront();
            btnLock.setAlpha(1f);
            btnLock.animate().scaleX(1.25f).scaleY(1.25f).setDuration(120)
                    .withEndAction(() ->
                        btnLock.animate().scaleX(1f).scaleY(1f).setDuration(120).start())
                    .start();
            lockUiVisible = true;
        }
        if (tvLockHint != null) {
            tvLockHint.setText("Tap 🔒 to unlock");
            tvLockHint.animate().cancel();
            tvLockHint.bringToFront();
            tvLockHint.setAlpha(1f);
            tvLockHint.setVisibility(View.VISIBLE);
        }
        // Auto-hide lock UI after 3s
        autoHideHandler.postDelayed(hideLockUiRunnable, LOCK_UI_MS);
    }

    private void unlock() {
        isLocked      = false;
        lockUiVisible = false;
        autoHideHandler.removeCallbacks(hideLockUiRunnable);

        if (tvLockHint != null) {
            tvLockHint.animate().cancel();
            tvLockHint.setVisibility(View.GONE);
        }
        if (btnLock != null) {
            btnLock.animate().cancel();
            btnLock.setImageResource(R.drawable.ic_lock_open);
            btnLock.setVisibility(View.VISIBLE);
            btnLock.setAlpha(1f);
        }
        showControls();
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Gestures
    // ══════════════════════════════════════════════════════════════════════════
    private void setupGestures() {
        playerView.setOnTouchListener((v, e) -> {
            handleTouch(e);
            return true;
        });
    }

    private void handleTouch(MotionEvent e) {
        final float rawX = e.getRawX();
        final float rawY = e.getRawY();
        final int   w    = playerView.getWidth();

        switch (e.getAction()) {

            case MotionEvent.ACTION_DOWN:
                downRawX     = rawX;
                downRawY     = rawY;
                downInLeft   = rawX < w / 3f;
                downInRight  = rawX > w * 2f / 3f;
                dirLocked    = false;
                isVertical   = false;
                isHorizontal = false;

                if (downInLeft)  gestureStartValue = getBrightnessPct();
                if (downInRight) gestureStartValue = getVolumePct();
                break;

            case MotionEvent.ACTION_MOVE:
                float dx = rawX - downRawX;
                float dy = rawY - downRawY;

                if (!dirLocked) {
                    if (Math.abs(dx) > GESTURE_THRESHOLD || Math.abs(dy) > GESTURE_THRESHOLD) {
                        dirLocked    = true;
                        isVertical   = Math.abs(dy) >= Math.abs(dx);
                        isHorizontal = !isVertical;

                        if (!isLocked) {
                            if (isVertical && downInLeft)  showGestureIndicator(true);
                            if (isVertical && downInRight) showGestureIndicator(false);
                            showControls();
                        }
                    }
                }

                if (isLocked) break;

                if (isVertical) {
                    int pct = Math.max(0, Math.min(100,
                            (int)(gestureStartValue - dy / playerView.getHeight() * 100)));
                    if (downInLeft) {
                        setBrightness(pct);
                        if (progressBrightness != null) progressBrightness.setProgress(pct);
                        if (tvBrightnessValue  != null) tvBrightnessValue.setText(pct + "%");
                    } else if (downInRight) {
                        setVolume(pct);
                        if (progressVolume != null) progressVolume.setProgress(pct);
                        if (tvVolumeValue   != null) tvVolumeValue.setText(pct + "%");
                    }
                }

                if (isHorizontal) {
                    long ms = (long)(dx / SEEK_PX_PER_SEC) * 1000L;
                    updateSeekIndicator(ms);
                }
                break;

            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:

                if (isLocked) {
                    // Any tap on screen (not on lock button) → toggle lock UI
                    if (!dirLocked) {
                        if (lockUiVisible) {
                            hideLockUI();
                        } else {
                            showLockUI();
                        }
                    }
                    dirLocked    = false;
                    isVertical   = false;
                    isHorizontal = false;
                    break;
                }

                if (isVertical) {
                    hideGestureIndicator(downInLeft);
                    scheduleHide();
                } else if (isHorizontal) {
                    long ms = (long)((rawX - downRawX) / SEEK_PX_PER_SEC) * 1000L;
                    seekBy(ms);
                    hideSeekIndicator();
                    scheduleHide();
                } else {
                    handleTap(downRawX);
                }

                dirLocked    = false;
                isVertical   = false;
                isHorizontal = false;
                break;
        }
    }

    // ── Single / Double tap ───────────────────────────────────────────────────
    private void handleTap(float x) {
        long now  = System.currentTimeMillis();
        int  side = (x < playerView.getWidth() / 2f) ? -1 : 1;

        if (now - lastTapTime < DOUBLE_TAP_MS && side == lastTapSide) {
            long ms = side == -1 ? -10_000L : 10_000L;
            seekBy(ms);
            showSeekIndicatorTimed(ms);
            lastTapTime = 0;
        } else {
            lastTapTime = now;
            lastTapSide = side;
            if (controlsVisible) hideControls();
            else                 showControls();
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Wire existing buttons
    // ══════════════════════════════════════════════════════════════════════════
    private void wireButtons() {
        ImageButton btnBack = playerView.findViewById(R.id.btn_back);
        if (btnBack != null) btnBack.setOnClickListener(v -> onBackPressed());

        ImageButton btnMute = playerView.findViewById(R.id.btn_mute);
        if (btnMute != null) {
            btnMute.setOnClickListener(v -> {
                isMuted = !isMuted;
                if (player != null) player.setVolume(isMuted ? 0f : 1f);
                btnMute.setImageResource(isMuted
                        ? R.drawable.ic_volume_off : R.drawable.ic_volume_up);
                scheduleHide();
            });
        }

        ImageButton btnAspect = playerView.findViewById(R.id.btn_aspect_ratio);
        if (btnAspect != null) {
            btnAspect.setOnClickListener(v -> {
                resizeModeIndex = (resizeModeIndex + 1) % RESIZE_MODES.length;
                playerView.setResizeMode(RESIZE_MODES[resizeModeIndex]);
                Toast.makeText(this, RESIZE_LABELS[resizeModeIndex], Toast.LENGTH_SHORT).show();
                scheduleHide();
            });
        }

        ImageButton btnFullscreen = playerView.findViewById(R.id.btn_fullscreen);
        if (btnFullscreen != null) {
            btnFullscreen.setOnClickListener(v -> {
                isFullscreen = !isFullscreen;
                if (isFullscreen) {
                    hideSystemUI();
                    btnFullscreen.setImageResource(R.drawable.ic_fullscreen_exit);
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
                } else {
                    showSystemUI();
                    btnFullscreen.setImageResource(R.drawable.ic_fullscreen);
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                }
                scheduleHide();
            });
        }

        View btnRew = playerView.findViewById(R.id.exo_rew);
        if (btnRew != null) btnRew.setOnClickListener(v -> {
            seekBy(-10_000); showSeekIndicatorTimed(-10_000); scheduleHide();
        });

        View btnFfwd = playerView.findViewById(R.id.exo_ffwd);
        if (btnFfwd != null) btnFfwd.setOnClickListener(v -> {
            seekBy(30_000); showSeekIndicatorTimed(30_000); scheduleHide();
        });

        View btnPP = playerView.findViewById(R.id.exo_play_pause);
        if (btnPP != null) btnPP.setOnClickListener(v -> {
            if (player != null) {
                if (player.isPlaying()) player.pause(); else player.play();
            }
            animatePlayPause();
            scheduleHide();
        });
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Seek helpers
    // ══════════════════════════════════════════════════════════════════════════
    private void seekBy(long ms) {
        if (player == null) return;
        player.seekTo(Math.max(0, player.getCurrentPosition() + ms));
        animatePlayPause();
    }

    private void updateSeekIndicator(long ms) {
        if (seekIndicator == null) return;
        if (seekIndicator.getVisibility() != View.VISIBLE) {
            seekIndicator.setAlpha(0f);
            seekIndicator.setVisibility(View.VISIBLE);
            seekIndicator.animate().alpha(1f).setDuration(150).start();
        }
        long secs = Math.abs(ms / 1000);
        if (tvSeekDelta != null) tvSeekDelta.setText((ms >= 0 ? "+" : "-") + secs + "s");
        if (seekIcon != null)
            seekIcon.setImageResource(ms >= 0 ? R.drawable.ic_forward_30 : R.drawable.ic_replay_10);
    }

    private void showSeekIndicatorTimed(long ms) {
        updateSeekIndicator(ms);
        autoHideHandler.postDelayed(this::hideSeekIndicator, 800);
    }

    private void hideSeekIndicator() {
        if (seekIndicator == null) return;
        seekIndicator.animate().alpha(0f).setDuration(200)
                .withEndAction(() -> seekIndicator.setVisibility(View.GONE)).start();
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Play/Pause pulse animation
    // ══════════════════════════════════════════════════════════════════════════
    private void animatePlayPause() {
        if (exoPlayPause == null) return;
        exoPlayPause.animate().scaleX(1.25f).scaleY(1.25f).setDuration(100)
                .withEndAction(() ->
                        exoPlayPause.animate().scaleX(1f).scaleY(1f).setDuration(150).start())
                .start();
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Gesture indicator pills
    // ══════════════════════════════════════════════════════════════════════════
    private void showGestureIndicator(boolean isBrightness) {
        LinearLayout v = isBrightness ? brightnessIndicator : volumeIndicator;
        if (v == null) return;
        v.setScaleX(0.8f); v.setAlpha(0f); v.setVisibility(View.VISIBLE);
        v.animate().scaleX(1f).alpha(1f).setDuration(180)
                .setInterpolator(new AccelerateDecelerateInterpolator()).start();
    }

    private void hideGestureIndicator(boolean isBrightness) {
        LinearLayout v = isBrightness ? brightnessIndicator : volumeIndicator;
        if (v == null) return;
        v.animate().alpha(0f).scaleX(0.8f).setDuration(200)
                .withEndAction(() -> v.setVisibility(View.GONE)).start();
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Brightness / Volume
    // ══════════════════════════════════════════════════════════════════════════
    private int getBrightnessPct() {
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        if (lp.screenBrightness < 0) {
            try {
                return Settings.System.getInt(getContentResolver(),
                        Settings.System.SCREEN_BRIGHTNESS) * 100 / 255;
            } catch (Exception e) { return 50; }
        }
        return (int)(lp.screenBrightness * 100);
    }

    private void setBrightness(int pct) {
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        lp.screenBrightness = pct / 100f;
        getWindow().setAttributes(lp);
    }

    private int getVolumePct() {
        return audioManager.getStreamVolume(AudioManager.STREAM_MUSIC) * 100 / maxVolume;
    }

    private void setVolume(int pct) {
        int steps = Math.max(0, Math.min(maxVolume, pct * maxVolume / 100));
        audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, steps, 0);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  TV Remote / D-pad
    // ══════════════════════════════════════════════════════════════════════════
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (player == null) return super.onKeyDown(keyCode, event);
        if (!isLocked) showControls();

        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
                if (player.isPlaying()) player.pause(); else player.play();
                animatePlayPause(); return true;
            case KeyEvent.KEYCODE_DPAD_LEFT:
            case KeyEvent.KEYCODE_MEDIA_REWIND:
                seekBy(-10_000); showSeekIndicatorTimed(-10_000); return true;
            case KeyEvent.KEYCODE_DPAD_RIGHT:
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
                seekBy(30_000); showSeekIndicatorTimed(30_000); return true;
            case KeyEvent.KEYCODE_VOLUME_UP:
                audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC,
                        AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI); return true;
            case KeyEvent.KEYCODE_VOLUME_DOWN:
                audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC,
                        AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI); return true;
            case KeyEvent.KEYCODE_BACK:
                onBackPressed(); return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Lifecycle
    // ══════════════════════════════════════════════════════════════════════════
    @Override public void onBackPressed() {
        releasePlayer();
        Intent i = new Intent(this, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(i);
        finish();
    }

    @Override protected void onResume() {
        super.onResume();
        hideSystemUI();
        if (player != null) player.play();
    }

    @Override protected void onPause() {
        super.onPause();
        if (player != null) player.pause();
        autoHideHandler.removeCallbacks(autoHideRunnable);
        autoHideHandler.removeCallbacks(hideLockUiRunnable);
    }

    @Override protected void onDestroy() {
        autoHideHandler.removeCallbacks(autoHideRunnable);
        autoHideHandler.removeCallbacks(hideLockUiRunnable);
        releasePlayer();
        super.onDestroy();
    }

    private void releasePlayer() {
        if (player != null) { player.stop(); player.release(); player = null; }
    }

    private void hideSystemUI() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN);
    }

    private void showSystemUI() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
}