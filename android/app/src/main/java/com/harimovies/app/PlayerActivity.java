package com.harimovies.app;

    import androidx.activity.OnBackPressedCallback;
    import androidx.appcompat.app.AppCompatActivity;
    import androidx.media3.common.util.UnstableApi;
    import android.content.Context;
    import android.content.Intent;
    import android.content.SharedPreferences;
    import android.content.pm.ActivityInfo;
    import android.media.AudioManager;
    import android.graphics.Bitmap;
    import android.media.MediaMetadataRetriever;
    import android.net.Uri;
    import android.os.Build;
    import android.os.Bundle;
    import android.os.Handler;
    import android.os.HandlerThread;
    import android.os.Looper;
    import android.provider.Settings;
    import android.util.Log;
    import android.view.Gravity;
    import android.view.KeyEvent;
    import android.view.MotionEvent;
    import android.view.View;
    import android.view.ViewGroup;
    import android.view.WindowManager;
    import android.view.animation.AccelerateDecelerateInterpolator;
    import android.view.animation.OvershootInterpolator;
    import android.widget.Button;
    import android.widget.FrameLayout;
    import android.widget.HorizontalScrollView;
    import android.widget.ImageButton;
    import android.widget.ImageView;
    import android.widget.LinearLayout;
    import android.widget.ProgressBar;
    import android.widget.SeekBar;
    import android.widget.TextView;
    import android.widget.Toast;

    import androidx.media3.common.C;
    import androidx.media3.common.MediaItem;
    import androidx.media3.common.PlaybackException;
    import androidx.media3.common.Player;
    import androidx.media3.common.TrackSelectionParameters;
    import androidx.media3.datasource.DefaultHttpDataSource;
    import androidx.media3.exoplayer.ExoPlayer;
    import androidx.media3.exoplayer.SeekParameters;
    import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
    import androidx.media3.exoplayer.source.MediaSource;
    import androidx.media3.ui.AspectRatioFrameLayout;
    import androidx.media3.ui.DefaultTimeBar;
    import androidx.media3.ui.PlayerView;
    import androidx.media3.ui.TimeBar;

    import org.json.JSONArray;
    import org.json.JSONObject;

    import java.util.ArrayList;
    import java.util.HashMap;
    import java.util.List;
    import java.util.Locale;
    import java.util.Map;

    @UnstableApi
    public class PlayerActivity extends AppCompatActivity {

        public static final String EXTRA_URL   = "url";
        public static final String EXTRA_TITLE = "title";

        private static final String PREFS_NAME    = "hm_watch_pos";
        private static final long   SAVE_EVERY_MS = 5_000L;
        private static final long   MIN_RESUME_MS = 10_000L;

        private ExoPlayer  player;
        private PlayerView playerView;

        private String  videoTitle   = "";
        private String  seriesTitle  = "";
        private String  videoUrl     = "";
        private boolean isMuted      = false;
        private boolean isFullscreen = false;
        private int     resizeModeIndex = 0;
        private boolean resumeChecked = false;

        // ── Playlist for series ──────────────────────────────────────────────────
        private List<JSONObject> playlist = new ArrayList<>();
        private int currentIndex = 0;
        private ImageButton btnPrevEp, btnNextEp;
        private TextView tvEpBadge;
        private LinearLayout episodeContainer;
        private View episodeBar;
        private TextView tvTitle;

        // ── A/V Sync ──────────────────────────────────────────────────────────────
        private long audioOffsetUs = 0L;

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
        private boolean resumeShowing   = false;
        private boolean episodesVisible = false;

        // ── Focus tracking ────────────────────────────────────────────────────────
        private int     focusRow      = 2;
        private int     focusCol      = 2;
        private int     episodeFocusIndex = 0;
        private boolean onProgressBar = false;
        private int     resumeFocusCol = 0;

        private final Handler  autoHideHandler    = new Handler(Looper.getMainLooper());
        private final Runnable autoHideRunnable   = this::hideControls;
        private final Runnable hideLockUiRunnable = this::hideLockUI;
        private final Runnable savePositionRunnable = this::saveCurrentPosition;
        private static final long AUTO_HIDE_MS  = 4_000L;
        private static final long LOCK_UI_MS    = 3_000L;

        // ── Gesture state ─────────────────────────────────────────────────────────
        private float   downRawX = 0f, downRawY = 0f;
        private boolean downInLeft = false, downInRight = false;
        private int     gestureStartValue = 0;
        private boolean dirLocked = false, isVertical = false, isHorizontal = false;
        private static final float GESTURE_THRESHOLD = 18f;
        private static final float SEEK_PX_PER_SEC   = 8f;

        private long lastTapTime = 0L;
        private int  lastTapSide = 0;
        private static final long DOUBLE_TAP_MS = 300L;

        // ── Touch Hold ──────────────────────────────────────────────────────────
        private int touchHoldSide = 0;
        private int touchHoldCount = 0;
        private Runnable touchHoldRunnable;
        private Runnable startTouchHoldRunnable;

        // ── Audio ─────────────────────────────────────────────────────────────────
        private AudioManager audioManager;
        private int          maxVolume;

        // ── Controller views ──────────────────────────────────────────────────────
        private LinearLayout brightnessIndicator, volumeIndicator;
        private View         viewBrightnessFill, viewVolumeFill;
        private TextView     tvBrightnessValue, tvVolumeValue;
        private LinearLayout seekIndicator;
        private ImageView    seekIcon;
        private TextView     tvSeekDelta;
        private View         topBar, centerControls, bottomBar, scrimTop, scrimBottom;
        private View         exoPlayPause;
        private ImageButton  btnLock;
        private TextView     tvLockHint, tvTitleSep;

        // ── Button refs ───────────────────────────────────────────────────────────
        private ImageButton btnBack, btnMute, btnAspect, btnFullscreen, btnSync, btnEpisodes, btnTracks;
        private View        btnRew, btnFfwd, btnPP, progressBar;

        // ── Resume overlay ────────────────────────────────────────────────────────
        private View   resumeOverlay;
        private Button btnResume, btnStartOver;
        private TextView tvResumeTime;
        private long forcedResumePos = 0;
        private long currentSavedPos = 0;

        // ── Preview ──────────────────────────────────────────────────────────────
        private View         previewContainer;
        private ImageView    previewImage;
        private TextView     previewTimeText;
        private MediaMetadataRetriever retriever;
        private HandlerThread previewThread;
        private Handler       previewHandler;
        private final Map<String, String> requestHeaders = new HashMap<>();

        private boolean isPreviewLoading = false;
        private long    lastPreviewPos   = -1;

        // ══════════════════════════════════════════════════════════════════════════
        //  Helper: check if a URL is a direct streamable media file
        // ══════════════════════════════════════════════════════════════════════════
        private boolean isDirectVideoUrl(String url) {
            if (url == null || url.isEmpty()) return false;
            String lower = url.toLowerCase();
            return lower.matches(".*\\.(mp4|m3u8|mkv|webm|mpd)(\\?.*)?$")
                    || lower.contains("?stream=1")
                    || lower.contains("&stream=1")
                    || lower.contains("/hls/")
                    || lower.contains("/dash/")
                    || lower.contains("/manifest/")
                    || lower.contains(".m3u8")
                    || lower.contains(".mpd");
        }

        // ══════════════════════════════════════════════════════════════════════════
        //  onCreate
        // ══════════════════════════════════════════════════════════════════════════
        @Override
        protected void onCreate(Bundle savedInstanceState) {
            super.onCreate(savedInstanceState);
            Log.d("PLAYER", "onCreate started");
            try {
                overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);

                getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                hideSystemUI();
                setContentView(R.layout.activity_player);

                getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        if (resumeShowing) {
                            performBackAction();
                        } else if (controlsVisible) {
                            hideControls();
                        } else {
                            performBackAction();
                        }
                    }
                });

                audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                maxVolume    = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);

                playerView = findViewById(R.id.player_view);

                videoUrl   = getIntent().getStringExtra(EXTRA_URL);   if (videoUrl == null) videoUrl = "";
                videoTitle = getIntent().getStringExtra(EXTRA_TITLE);
                if (videoTitle == null) videoTitle = "";
                seriesTitle = cleanSeriesTitle(videoTitle);

                forcedResumePos = getIntent().getLongExtra("resume_pos", 0);

                Log.d("SERIES_DEBUG", "Activity: Initial URL: " + videoUrl);
                Log.d("SERIES_DEBUG", "Activity: Initial Title: " + videoTitle);

                // Parse playlist if available
                String playlistJson = getIntent().getStringExtra("playlist");
                Log.d("SERIES_DEBUG", "Activity: playlistJson extra: " + (playlistJson != null ? "Length " + playlistJson.length() : "NULL"));

                if (playlistJson != null && !playlistJson.isEmpty() && !playlistJson.equals("[]") && !playlistJson.equals("null")) {
                    try {
                        JSONArray array = new JSONArray(playlistJson);
                        playlist.clear();
                        for (int j = 0; j < array.length(); j++) {
                            playlist.add(array.getJSONObject(j));
                        }
                        currentIndex = getIntent().getIntExtra("index", 0);

                        Log.d("PLAYER", "Playlist size: " + playlist.size() + ", Start Index: " + currentIndex);

                        // Sync current video info with the index
                        if (currentIndex >= 0 && currentIndex < playlist.size()) {
                            JSONObject ep = playlist.get(currentIndex);
                            // Only override videoUrl from playlist if it wasn't already set by WebPlayerActivity
                            // WebPlayerActivity passes the REAL extracted mp4/m3u8 URL as EXTRA_URL,
                            // so we only fall back to playlist link if videoUrl is empty.
                            if (videoUrl == null || videoUrl.isEmpty()) {
                                videoUrl = ep.optString("link", "");
                                Log.d("SERIES_DEBUG", "videoUrl was empty, using playlist link: " + videoUrl);
                            } else {
                                Log.d("SERIES_DEBUG", "videoUrl already set by caller: " + videoUrl);
                            }
                            String epTitle = ep.optString("title", "");
                            if (!epTitle.isEmpty()) {
                                videoTitle = epTitle;
                            } else {
                                String epNum = ep.optString("episode", "");
                                String seasonNum = ep.optString("season", "");
                                if (!seasonNum.isEmpty() && !epNum.isEmpty()) {
                                    videoTitle = seriesTitle + " - Season " + seasonNum + " . Episode " + epNum;
                                } else if (!epNum.isEmpty()) {
                                    videoTitle = seriesTitle + " - Episode " + epNum;
                                } else {
                                    videoTitle = seriesTitle + " - Episode " + (currentIndex + 1);
                                }
                            }
                        }
                    } catch (Exception e) {
                        Log.e("PLAYER", "Playlist parse error", e);
                    }
                }

                player = new ExoPlayer.Builder(this).build();
                player.setSeekParameters(SeekParameters.EXACT);
                applySavedTrackPreferences();
                playerView.setPlayer(player);
                playerView.setControllerShowTimeoutMs(-1);
                playerView.setControllerAutoShow(false);
                playerView.setUseController(true);

                player.addListener(new Player.Listener() {
                    @Override
public void onPlayerError(PlaybackException e) {
    Log.e("PLAYER_ERROR", "CODE=" + e.errorCode);
    Log.e("PLAYER_ERROR", "NAME=" + e.getErrorCodeName());

    // ExoPlayer failed → open WebPlayer
    Intent intent = new Intent(PlayerActivity.this, WebPlayerActivity.class);

    intent.putExtra("url", videoUrl);
    intent.putExtra("title", videoTitle);

    if (!playlist.isEmpty()) {
        JSONArray arr = new JSONArray();
        for (JSONObject item : playlist) {
            arr.put(item);
        }
        intent.putExtra("playlist", arr.toString());
        intent.putExtra("index", currentIndex);
    }

    startActivity(intent);
    finish();
}

                    @Override
                    public void onPlaybackStateChanged(int state) {
                        Log.d("PLAYER", "State: " + state);
                        if (state == Player.STATE_ENDED) {
                            clearSavedPosition();
                            // Auto-play next episode
                            if (!playlist.isEmpty() && currentIndex < playlist.size() - 1) {
                                playEpisode(currentIndex + 1);
                            }
                        }
                        if (state == Player.STATE_READY && !resumeChecked) {
                            resumeChecked = true;
                            if (forcedResumePos > 0) {
                                player.seekTo(forcedResumePos);
                                player.play();
                                forcedResumePos = 0;
                                return;
                            }
                            checkResumePosition();
                        }
                    }
                });

                findControllerViews();
                updateSeriesUI();
                buildResumeOverlay();
                wireButtons();
                setupGestures();
                setupLockButton();
                setupPreviewRetriever();

                hideControls();
                Log.d("PLAYER_DEBUG", "FINAL_VIDEO_URL=" + videoUrl);
                loadCurrentEpisode();
                Log.d("PLAYER", "onCreate completed");
            } catch (Exception e) {
                Log.e("PLAYER", "CRASH IN ONCREATE", e);
                Toast.makeText(this, "Player Error: " + e.getMessage(), Toast.LENGTH_LONG).show();
                finish();
            }
        }

        private void loadCurrentEpisode() {
            Log.d("PLAYER_DEBUG", "PLAYING_URL=" + videoUrl);
            if (player == null || videoUrl == null || videoUrl.isEmpty()) {
                Log.e("PLAYER", "Aborting load: videoUrl is empty");
                return;
            }

            resumeChecked = false;

            // Reset preview retriever for the new URL
            if (previewHandler != null) {
                previewHandler.post(() -> {
                    try {
                        if (retriever != null) retriever.release();
                        retriever = new MediaMetadataRetriever();
                        retriever.setDataSource(videoUrl, requestHeaders);
                    } catch (Exception e) {
                        Log.e("PREVIEW", "Retriever update error: " + e.getMessage());
                    }
                });
            }

            DefaultHttpDataSource.Factory dsFactory =
                    new DefaultHttpDataSource.Factory()
                            .setUserAgent(
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
                                "AppleWebKit/537.36 (KHTML, like Gecko) " +
                                "Chrome/148.0.0.0 Safari/537.36");

            Map<String, String> headers = new HashMap<>();
            headers.put("Referer", "https://dub.onestream.today/");
            headers.put("Cookie",  "cache_2685d8fa2727bff6=1781032689");
            requestHeaders.putAll(headers);
            dsFactory.setDefaultRequestProperties(headers);

            MediaSource mediaSource =
                    new DefaultMediaSourceFactory(this)
                            .setDataSourceFactory(dsFactory)
                            .createMediaSource(MediaItem.fromUri(Uri.parse(videoUrl)));

            player.setMediaSource(mediaSource);
            player.prepare();
            player.play();

            updateSeriesUI();
        }

        private void updateSeriesUI() {
            Log.d("EP_DEBUG", "Current episode index = " + currentIndex);
            Log.d("SERIES_DEBUG", "updateSeriesUI: playlist size = " + playlist.size() + ", currentIndex = " + currentIndex);

            // 1. Calculate Badge (only for series)
            String badge = "";
            if (!playlist.isEmpty()) {
                try {
                    if (currentIndex >= 0 && currentIndex < playlist.size()) {
                        JSONObject current = playlist.get(currentIndex);
                        String epNum = current.optString("episode", "");
                        String seasonNum = current.optString("season", "");

                        if (!seasonNum.isEmpty() && !epNum.isEmpty()) {
                            badge = String.format(Locale.US, "Season %s . Episode %s", seasonNum, epNum);
                        } else if (!epNum.isEmpty()) {
                            try {
                                int num = Integer.parseInt(epNum);
                                badge = String.format(Locale.US, "Episode %02d", num);
                            } catch (Exception e) {
                                badge = "Episode " + epNum;
                            }
                        } else {
                            badge = String.format(Locale.US, "Episode %02d", currentIndex + 1);
                        }
                    }
                } catch (Exception ignored) {}
            }

            // 2. Update Title (Common for both)
            if (tvTitle != null) {
                // For series, we prefer the "Series Name". For movies, we want the full title.
                if (!playlist.isEmpty() && !seriesTitle.isEmpty()) {
                    tvTitle.setText(seriesTitle);
                } else {
                    tvTitle.setText(videoTitle);
                }
            }

            // 3. Update Separator and Badge visibility
            if (tvTitleSep != null) {
                tvTitleSep.setVisibility(!badge.isEmpty() ? View.VISIBLE : View.GONE);
            }

            if (tvEpBadge != null) {
                if (!badge.isEmpty()) {
                    tvEpBadge.setText(badge);
                    tvEpBadge.setVisibility(View.VISIBLE);
                    tvEpBadge.setTextColor(0xAAFFFFFF);
                } else {
                    tvEpBadge.setVisibility(View.GONE);
                }
            }

            // 4. Handle Series-only UI elements
            if (playlist.isEmpty()) {
                if (btnPrevEp != null) btnPrevEp.setVisibility(View.GONE);
                if (btnNextEp != null) btnNextEp.setVisibility(View.GONE);
                if (btnEpisodes != null) btnEpisodes.setVisibility(View.GONE);
                if (episodeBar != null) episodeBar.setVisibility(View.GONE);
                return;
            }

            if (btnPrevEp != null) btnPrevEp.setVisibility(currentIndex > 0 ? View.VISIBLE : View.GONE);
            if (btnNextEp != null) btnNextEp.setVisibility(currentIndex < playlist.size() - 1 ? View.VISIBLE : View.GONE);
            if (btnEpisodes != null) {
                btnEpisodes.setVisibility(View.VISIBLE);
                btnEpisodes.setAlpha(1.0f);
            }

            if (episodeBar != null) {
                if (episodesVisible) {
                    episodeBar.setVisibility(View.VISIBLE);
                    episodeBar.setAlpha(1.0f);
                    episodeBar.bringToFront();
                } else {
                    episodeBar.setVisibility(View.GONE);
                }
            }
            buildEpisodeList();
        }

        private void buildEpisodeList() {
            if (episodeContainer == null) return;
            episodeContainer.removeAllViews();

            for (int i = 0; i < playlist.size(); i++) {
                final int index = i;
                Button btn = new Button(this);

                String label = String.valueOf(i + 1);
                btn.setText(label);
                btn.setTextColor(0xFFFFFFFF);
                btn.setFocusable(true);
                btn.setTextSize(11);
                LinearLayout.LayoutParams lp =
                        new LinearLayout.LayoutParams(dp(56), dp(28));
                lp.setMargins(dp(2), 0, dp(2), 0);
                btn.setLayoutParams(lp);
                btn.setHeight(dp(28));
                btn.setPadding(dp(8), 0, dp(8), 0);
                btn.setAllCaps(false);

                if (i == currentIndex) {
    btn.setBackgroundResource(R.drawable.bg_episode_active);
    btn.setTextColor(0xFF000000);
    btn.setTypeface(android.graphics.Typeface.DEFAULT);
} else {
    btn.setBackgroundResource(R.drawable.bg_segmented_item);
    btn.setTextColor(0xFFFFFFFF);
}

                btn.setOnClickListener(v -> playEpisode(index));

                btn.setOnFocusChangeListener((v, hasFocus) -> {
                    if (hasFocus) {
                        btn.setTextColor(0xFF000000);
                        btn.setScaleX(1.1f); btn.setScaleY(1.1f);
                    } else {
    if (index == currentIndex) {
        btn.setBackgroundResource(R.drawable.bg_episode_active);
        btn.setTextColor(0xFF000000);
    } else {
        btn.setBackgroundResource(R.drawable.bg_segmented_item);
        btn.setTextColor(0xFFFFFFFF);
    }

    btn.setScaleX(1.0f);
    btn.setScaleY(1.0f);
}
                });

                episodeContainer.addView(btn);
            }
        }

        // ══════════════════════════════════════════════════════════════════════════
        //  FIX: playEpisode — routes iframe URLs through WebPlayerActivity,
        //       direct video URLs straight to PlayerActivity
        // ══════════════════════════════════════════════════════════════════════════
        private void playEpisode(int index) {
            if (index < 0 || index >= playlist.size()) return;

            try {
                JSONObject ep = playlist.get(index);
                String epUrl   = ep.optString("link", "");
                String epTitle = ep.optString("title", "");

                // Build episode title fallback
                if (epTitle.isEmpty()) {
                    String epNum = ep.optString("episode", "");
                    String seasonNum = ep.optString("season", "");
                    if (!seasonNum.isEmpty() && !epNum.isEmpty()) {
                        epTitle = seriesTitle + " - Season " + seasonNum + " . Episode " + epNum;
                    } else if (!epNum.isEmpty()) {
                        epTitle = seriesTitle + " - Episode " + epNum;
                    } else {
                        epTitle = seriesTitle + " - Episode " + (index + 1);
                    }
                }

                // Serialize full playlist so the next activity can navigate further
                JSONArray arr = new JSONArray();
                for (JSONObject item : playlist) arr.put(item);
                String playlistStr = arr.toString();

                Log.d("SERIES_DEBUG", "playEpisode: index=" + index + " url=" + epUrl);
                Log.d("SERIES_DEBUG", "playEpisode: isDirect=" + isDirectVideoUrl(epUrl));

                Intent intent;
                if (isDirectVideoUrl(epUrl)) {
                    // Direct mp4/m3u8/etc → go straight to PlayerActivity
                    Log.d("SERIES_DEBUG", "Route: DIRECT → PlayerActivity");
                    intent = new Intent(this, PlayerActivity.class);
                    intent.putExtra(PlayerActivity.EXTRA_URL, epUrl);
                    intent.putExtra(PlayerActivity.EXTRA_TITLE, epTitle);
                } else {
                    // Iframe/embed page → go through WebPlayerActivity to extract the real URL
                    Log.d("SERIES_DEBUG", "Route: IFRAME → WebPlayerActivity");
                    intent = new Intent(this, WebPlayerActivity.class);
                    intent.putExtra("url", epUrl);
                    intent.putExtra("title", epTitle);

                    // YouTube adblock flag
                    if (epUrl.contains("youtube.com") || epUrl.contains("youtu.be")) {
                        intent.putExtra("adblock", true);
                    }
                }

                // Always pass playlist + index so series navigation survives the round-trip
                intent.putExtra("playlist", playlistStr);
                intent.putExtra("index", index);

                startActivity(intent);
                finish();

            } catch (Exception e) {
                Log.e("SERIES_DEBUG", "Episode switch failed", e);
            }
        }

        // ══════════════════════════════════════════════════════════════════════════
        //  Resume position storage
        // ══════════════════════════════════════════════════════════════════════════
        private String posKey() {
            String base = (seriesTitle != null && !seriesTitle.isEmpty()) ? seriesTitle : videoUrl;

            if (!playlist.isEmpty() && currentIndex >= 0 && currentIndex < playlist.size()) {
                try {
                    JSONObject current = playlist.get(currentIndex);
                    String epRef = current.optString("id",
                                current.optString("link",
                                current.optString("episode", String.valueOf(currentIndex))));
                    return "pos_" + Math.abs(base.hashCode()) + "_ep_" + epRef;
                } catch (Exception ignored) {}
            }

            return "pos_" + Math.abs(base.hashCode());
        }

        private void saveCurrentPosition() {
            if (player == null || resumeShowing) return;
            long pos = player.getCurrentPosition();
            long dur = player.getDuration();
            if (dur > 0 && pos >= dur - 5_000) {
                clearSavedPosition();
            } else if (pos > MIN_RESUME_MS) {
                getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                        .edit().putLong(posKey(), pos).apply();
            }
            scheduleSavePosition();
        }

        private void scheduleSavePosition() {
            autoHideHandler.removeCallbacks(savePositionRunnable);
            autoHideHandler.postDelayed(savePositionRunnable, SAVE_EVERY_MS);
        }

        private long getSavedPosition() {
            return getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .getLong(posKey(), 0L);
        }

        private void clearSavedPosition() {
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit().remove(posKey()).apply();
        }

        private void checkResumePosition() {
            long saved = getSavedPosition();
            Log.d("RESUME", "TITLE = " + videoTitle);
            Log.d("RESUME", "URL = " + videoUrl);
            Log.d("RESUME", "SAVED = " + saved);
            if (saved > 10000) {
                player.pause();
                showResumeOverlay(saved);
            } else {
                clearSavedPosition();
                player.play();
            }
        }

        // ══════════════════════════════════════════════════════════════════════════
        //  Build resume overlay
        // ══════════════════════════════════════════════════════════════════════════
        private void buildResumeOverlay() {
            FrameLayout root = findViewById(android.R.id.content);

            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setGravity(Gravity.CENTER);
            card.setBackgroundColor(0xEE1A1A2E);
            card.setPadding(dp(32), dp(28), dp(32), dp(28));

            FrameLayout.LayoutParams cardLp = new FrameLayout.LayoutParams(
                    dp(340), FrameLayout.LayoutParams.WRAP_CONTENT);
            cardLp.gravity = Gravity.CENTER;
            card.setLayoutParams(cardLp);
            card.setElevation(dp(8));

            TextView tvTitle = new TextView(this);
            tvTitle.setText("Continue Watching?");
            tvTitle.setTextColor(0xFFFFFFFF);
            tvTitle.setTextSize(18);
            tvTitle.setTypeface(null, android.graphics.Typeface.BOLD);
            tvTitle.setGravity(Gravity.CENTER);
            card.addView(tvTitle);

            tvResumeTime = new TextView(this);
            tvResumeTime.setTextColor(0xAAFFFFFF);
            tvResumeTime.setTextSize(13);
            tvResumeTime.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams subLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT);
            subLp.setMargins(0, dp(8), 0, dp(20));
            tvResumeTime.setLayoutParams(subLp);
            card.addView(tvResumeTime);

            TextView tvHint = new TextView(this);
            tvHint.setText("◀ ▶ navigate  •  OK select");
            tvHint.setTextColor(0x88FFFFFF);
            tvHint.setTextSize(11);
            tvHint.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams hintLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT);
            hintLp.setMargins(0, 0, 0, dp(16));
            tvHint.setLayoutParams(hintLp);
            card.addView(tvHint);

            LinearLayout btnRow = new LinearLayout(this);
            btnRow.setOrientation(LinearLayout.HORIZONTAL);
            btnRow.setGravity(Gravity.CENTER);

            btnResume    = makeDialogButton("▶  Resume", true);
            btnStartOver = makeDialogButton("↺  Start Over", false);

            LinearLayout.LayoutParams btnLp = new LinearLayout.LayoutParams(0,
                    LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            btnLp.setMargins(0, 0, dp(8), 0);
            btnResume.setLayoutParams(btnLp);

            LinearLayout.LayoutParams btnLp2 = new LinearLayout.LayoutParams(0,
                    LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            btnStartOver.setLayoutParams(btnLp2);

            btnRow.addView(btnResume);
            btnRow.addView(btnStartOver);
            card.addView(btnRow);

            FrameLayout overlayContainer = new FrameLayout(this);
            overlayContainer.setBackgroundColor(0xAA000000);
            overlayContainer.setVisibility(View.GONE);
            overlayContainer.addView(card);
            resumeOverlay = overlayContainer;

            root.addView(resumeOverlay, new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT));

            btnResume.setOnClickListener(v -> doResume());
            btnStartOver.setOnClickListener(v -> doStartOver());
        }

        private Button makeDialogButton(String text, boolean primary) {
            Button btn = new Button(this);
            btn.setText(text);
            btn.setTextColor(0xFFFFFFFF);
            btn.setTextSize(13);
            btn.setPadding(dp(16), dp(12), dp(16), dp(12));
            btn.setBackgroundColor(primary ? 0xFFE50914 : 0xFF333355);
            return btn;
        }

        private void showResumeOverlay(long savedMs) {
            this.currentSavedPos = savedMs;
            resumeShowing  = true;
            resumeFocusCol = 0;
            resumeOverlay.setVisibility(View.VISIBLE);
            btnResume.setFocusable(true);
            btnResume.setFocusableInTouchMode(true);
            btnStartOver.setFocusable(true);
            btnStartOver.setFocusableInTouchMode(true);
            btnResume.requestFocus();
            if (tvResumeTime != null) tvResumeTime.setText("Paused at " + fmt(savedMs / 1000));
            updateResumeHighlight();
        }

        private void hideResumeOverlay() {
            resumeShowing = false;
            resumeOverlay.setVisibility(View.GONE);
        }

        private void updateResumeHighlight() {
            if (resumeFocusCol == 0) {
                btnResume.requestFocus();
                btnResume.setScaleX(1.1f);   btnResume.setScaleY(1.1f);
                btnStartOver.setScaleX(1f);  btnStartOver.setScaleY(1f);
            } else {
                btnStartOver.requestFocus();
                btnStartOver.setScaleX(1.1f); btnStartOver.setScaleY(1.1f);
                btnResume.setScaleX(1f);      btnResume.setScaleY(1f);
            }
        }

        private void doResume() {
            hideResumeOverlay();
            if (player != null) {
                player.seekTo(currentSavedPos);
                player.play();
            }
            showControls();
        }

        private void doStartOver() {
            clearSavedPosition();
            hideResumeOverlay();
            if (player != null) {
                player.seekTo(0);
                player.play();
            }
            showControls();
        }

        // ══════════════════════════════════════════════════════════════════════════
        //  A/V Sync Dialog
        // ══════════════════════════════════════════════════════════════════════════
        private void showSyncDialog() {
            FrameLayout root = findViewById(android.R.id.content);

            FrameLayout overlay = new FrameLayout(this);
            overlay.setBackgroundColor(0xAA000000);

            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setGravity(Gravity.CENTER_HORIZONTAL);
            card.setBackgroundColor(0xEE1A1A2E);
            card.setPadding(dp(28), dp(24), dp(28), dp(24));

            FrameLayout.LayoutParams cardLp = new FrameLayout.LayoutParams(
                    dp(320), FrameLayout.LayoutParams.WRAP_CONTENT);
            cardLp.gravity = Gravity.CENTER;
            card.setLayoutParams(cardLp);
            card.setElevation(dp(8));

            TextView tvTitle = new TextView(this);
            tvTitle.setText("A/V Sync Adjust");
            tvTitle.setTextColor(0xFFFFFFFF);
            tvTitle.setTextSize(17);
            tvTitle.setTypeface(null, android.graphics.Typeface.BOLD);
            tvTitle.setGravity(Gravity.CENTER);
            card.addView(tvTitle);

            final TextView tvOffset = new TextView(this);
            tvOffset.setTextColor(0xAAFFFFFF);
            tvOffset.setTextSize(13);
            tvOffset.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams offLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT);
            offLp.setMargins(0, dp(8), 0, dp(4));
            tvOffset.setLayoutParams(offLp);

            TextView tvHint = new TextView(this);
            tvHint.setTextColor(0x88FFFFFF);
            tvHint.setTextSize(11);
            tvHint.setGravity(Gravity.CENTER);
            tvHint.setText("Audio early → drag left (−)  •  Audio late → drag right (+)");
            LinearLayout.LayoutParams hintLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT);
            hintLp.setMargins(0, 0, 0, dp(14));
            tvHint.setLayoutParams(hintLp);

            final SeekBar seekBar = new SeekBar(this);
            seekBar.setMax(4000);
            int currentProgress = (int)(audioOffsetUs / 1000L) + 2000;
            seekBar.setProgress(currentProgress);
            seekBar.getProgressDrawable().setColorFilter(
                    0xFFE50914, android.graphics.PorterDuff.Mode.SRC_IN);
            seekBar.getThumb().setColorFilter(
                    0xFFE50914, android.graphics.PorterDuff.Mode.SRC_IN);

            LinearLayout.LayoutParams sbLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT);
            sbLp.setMargins(0, 0, 0, dp(6));
            seekBar.setLayoutParams(sbLp);

            LinearLayout rangeRow = new LinearLayout(this);
            rangeRow.setOrientation(LinearLayout.HORIZONTAL);
            rangeRow.setLayoutParams(new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT));

            TextView tvMin = new TextView(this);
            tvMin.setText("−2000ms");
            tvMin.setTextColor(0x88FFFFFF);
            tvMin.setTextSize(10);
            rangeRow.addView(tvMin, new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

            TextView tvMid = new TextView(this);
            tvMid.setText("0");
            tvMid.setTextColor(0x88FFFFFF);
            tvMid.setTextSize(10);
            tvMid.setGravity(Gravity.CENTER);
            rangeRow.addView(tvMid, new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

            TextView tvMax = new TextView(this);
            tvMax.setText("+2000ms");
            tvMax.setTextColor(0x88FFFFFF);
            tvMax.setTextSize(10);
            tvMax.setGravity(Gravity.END);
            LinearLayout.LayoutParams maxLp = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            maxLp.setMargins(0, 0, 0, dp(14));
            rangeRow.addView(tvMax, maxLp);

            Runnable updateLabel = () -> {
                long ms = seekBar.getProgress() - 2000;
                tvOffset.setText("Offset: " + (ms >= 0 ? "+" : "") + ms + " ms");
            };
            updateLabel.run();

            seekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
                @Override public void onProgressChanged(SeekBar sb, int progress, boolean fromUser) {
                    updateLabel.run();
                }
                @Override public void onStartTrackingTouch(SeekBar sb) {}
                @Override public void onStopTrackingTouch(SeekBar sb) {}
            });

            card.addView(tvOffset);
            card.addView(tvHint);
            card.addView(seekBar);
            card.addView(rangeRow);

            LinearLayout btnRow = new LinearLayout(this);
            btnRow.setOrientation(LinearLayout.HORIZONTAL);
            btnRow.setGravity(Gravity.CENTER);

            Button btnReset = makeDialogButton("↺  Reset", false);
            Button btnApply = makeDialogButton("✓  Apply", true);

            LinearLayout.LayoutParams b1 = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            b1.setMargins(0, 0, dp(8), 0);
            btnReset.setLayoutParams(b1);
            btnApply.setLayoutParams(new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

            btnRow.addView(btnReset);
            btnRow.addView(btnApply);
            card.addView(btnRow);

            overlay.addView(card);
            root.addView(overlay, new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT));

            btnApply.setOnClickListener(v -> {
                long ms = seekBar.getProgress() - 2000;
                audioOffsetUs = ms * 1000L;
                applyAudioOffset();
                root.removeView(overlay);
            });

            btnReset.setOnClickListener(v -> {
                seekBar.setProgress(2000);
                audioOffsetUs = 0L;
                applyAudioOffset();
                root.removeView(overlay);
            });

            overlay.setOnClickListener(v -> root.removeView(overlay));
            card.setOnClickListener(v -> { /* consume */ });
        }

        private void showTrackSelectionDialog() {
            if (player == null) return;
            TrackSelectionDialog dialog = TrackSelectionDialog.newInstance(player, null);
            dialog.show(getSupportFragmentManager(), "TrackSelectionDialog");
        }

        private void applyAudioOffset() {
            if (player == null) return;
            try {
                String msg = audioOffsetUs == 0
                        ? "A/V Sync reset"
                        : "A/V Sync: " + (audioOffsetUs > 0 ? "+" : "") + (audioOffsetUs / 1000) + " ms";
                Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
                Log.d("AVSYNC", "Audio offset: " + audioOffsetUs + " us");
            } catch (Exception e) {
                Log.e("AVSYNC", "applyAudioOffset failed: " + e.getMessage());
            }
        }

        private void setupPreviewRetriever() {
            touchHoldRunnable = new Runnable() {
                @Override
                public void run() {
                    if (touchHoldSide != 0) {
                        touchHoldCount++;
                        long delta = 200L;
                        if (touchHoldCount > 20) delta = 500L;
                        if (touchHoldCount > 50) delta = 2000L;
                        fastSeek(touchHoldSide * delta);
                        autoHideHandler.postDelayed(this, 100);
                    }
                }
            };
            startTouchHoldRunnable = () -> {
                if (!dirLocked && !isLocked && !resumeShowing) {
                    if (downInLeft) touchHoldSide = -1;
                    else if (downInRight) touchHoldSide = 1;
                    if (touchHoldSide != 0) {
                        touchHoldCount = 0;
                        showControls();
                        if (previewContainer != null) previewContainer.setVisibility(View.VISIBLE);
                        autoHideHandler.post(touchHoldRunnable);
                    }
                }
            };

            previewThread = new HandlerThread("PreviewFrameThread");
            previewThread.start();
            previewHandler = new Handler(previewThread.getLooper());

            previewHandler.post(() -> {
                try {
                    retriever = new MediaMetadataRetriever();
                    retriever.setDataSource(videoUrl, requestHeaders);
                } catch (Exception e) {
                    Log.e("PREVIEW", "Retriever error: " + e.getMessage());
                }
            });

            if (progressBar instanceof DefaultTimeBar) {
                ((DefaultTimeBar) progressBar).addListener(new TimeBar.OnScrubListener() {
                    @Override
                    public void onScrubStart(TimeBar timeBar, long position) {
                        autoHideHandler.removeCallbacks(autoHideRunnable);
                        if (previewContainer != null) previewContainer.setVisibility(View.VISIBLE);
                        updatePreviewFrame(position);
                    }

                    @Override
                    public void onScrubMove(TimeBar timeBar, long position) {
                        autoHideHandler.removeCallbacks(autoHideRunnable);
                        updatePreviewFrame(position);
                    }

                    @Override
                    public void onScrubStop(TimeBar timeBar, long position, boolean canceled) {
                        if (previewContainer != null) previewContainer.setVisibility(View.GONE);
                        scheduleHide();
                    }
                });
            }
        }

        private void updatePreviewFrame(long positionMs) {
            if (previewTimeText != null) previewTimeText.setText(fmt(positionMs / 1000));

            if (progressBar != null && previewContainer != null) {
                long duration = player != null ? player.getDuration() : 0;
                if (duration > 0) {
                    float progress = (float) positionMs / duration;
                    int barWidth = progressBar.getWidth();
                    float rawX = progressBar.getLeft() + (barWidth * progress) - (previewContainer.getWidth() / 2f);
                    float margin = dp(12);
                    float finalX = Math.max(margin, Math.min(rawX, playerView.getWidth() - previewContainer.getWidth() - margin));
                    previewContainer.setX(finalX);
                }
            }

            lastPreviewPos = positionMs;
            if (!isPreviewLoading && retriever != null) {
                fetchNextPreviewFrame();
            }
        }

        private void fetchNextPreviewFrame() {
            if (lastPreviewPos == -1 || retriever == null || previewHandler == null) return;

            final long posUs = lastPreviewPos * 1000L;
            isPreviewLoading = true;

            previewHandler.post(() -> {
                try {
                    Bitmap bmp;
                    // Use OPTION_CLOSEST_SYNC (2) instead of OPTION_CLOSEST (3) for speed and reliability on remote streams
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                        bmp = retriever.getScaledFrameAtTime(posUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 240, 135);
                    } else {
                        bmp = retriever.getFrameAtTime(posUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
                    }

                    if (bmp != null) {
                        runOnUiThread(() -> {
                            if (previewImage != null) {
                                previewImage.setImageBitmap(bmp);
                                previewImage.setAlpha(1.0f);
                            }
                        });
                    } else {
                        Log.w("PREVIEW", "Retrieved null frame at " + posUs + " us");
                    }
                } catch (Exception e) {
                    Log.e("PREVIEW", "Frame fetch error at " + posUs + " us: " + e.getMessage());
                } finally {
                    isPreviewLoading = false;
                    runOnUiThread(() -> {
                        // If the scrub position moved significantly while we were fetching, fetch again
                        if (Math.abs(lastPreviewPos * 1000L - posUs) > 1000000L) {
                            fetchNextPreviewFrame();
                        }
                    });
                }
            });
        }

        // ══════════════════════════════════════════════════════════════════════════
        //  Formatters / utils
        // ══════════════════════════════════════════════════════════════════════════
        private String fmt(long secs) {
            long h = secs / 3600, m = (secs % 3600) / 60, s = secs % 60;
            if (h > 0) return h + ":" + pad(m) + ":" + pad(s);
            return m + ":" + pad(s);
        }

        private String pad(long n) { return n < 10 ? "0" + n : String.valueOf(n); }

        private int dp(int val) {
            return (int)(val * getResources().getDisplayMetrics().density);
        }

        private String cleanSeriesTitle(String title) {
            if (title == null || title.isEmpty()) return "";

            // 1. Look for common metadata keywords and cut before them
            String lower = title.toLowerCase();
            int epIdx = lower.indexOf(" episode");
            int seaIdx = lower.indexOf(" season");

            int cutIdx = -1;
            if (epIdx != -1 && seaIdx != -1) cutIdx = Math.min(epIdx, seaIdx);
            else if (epIdx != -1) cutIdx = epIdx;
            else if (seaIdx != -1) cutIdx = seaIdx;

            if (cutIdx != -1) {
                String prefix = title.substring(0, cutIdx);
                // Clean trailing separators like " · ", " - ", " | " from the prefix
                return prefix.replaceAll("\\s*[\\u00B7\\u2022\\u2013\\u2014\\-|:]\\s*$", "").trim();
            }

            // 2. Fallback: split by common separators if they look like metadata dividers
            String[] separators = {" · ", " - ", " | ", " — ", " – "};
            for (String sep : separators) {
                int idx = title.indexOf(sep);
                if (idx != -1) {
                    return title.substring(0, idx).trim();
                }
            }

            return title;
        }

        // ══════════════════════════════════════════════════════════════════════════
        //  Find views
        // ══════════════════════════════════════════════════════════════════════════
        private void findControllerViews() {
            brightnessIndicator = playerView.findViewById(R.id.gesture_brightness_indicator);
            tvBrightnessValue   = playerView.findViewById(R.id.tv_brightness_value);
            volumeIndicator     = playerView.findViewById(R.id.gesture_volume_indicator);
            viewBrightnessFill  = playerView.findViewById(R.id.view_brightness_fill);
            viewVolumeFill      = playerView.findViewById(R.id.view_volume_fill);
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
            btnLock             = findViewById(R.id.btn_lock);
            tvLockHint          = findViewById(R.id.tv_lock_hint);

            btnPrevEp           = playerView.findViewById(R.id.btn_prev_ep);
            btnNextEp           = playerView.findViewById(R.id.btn_next_ep);
            btnEpisodes         = playerView.findViewById(R.id.btn_episodes);
            tvEpBadge           = playerView.findViewById(R.id.mp_ep_badge);
            episodeBar          = playerView.findViewById(R.id.episode_bar);
            episodeContainer    = playerView.findViewById(R.id.episode_container);
            tvTitle             = playerView.findViewById(R.id.tv_title);
            tvTitleSep          = playerView.findViewById(R.id.tv_title_sep);
            btnTracks           = playerView.findViewById(R.id.btn_tracks);

            progressBar         = playerView.findViewById(R.id.exo_progress);
            previewContainer    = playerView.findViewById(R.id.preview_container);
            previewImage        = playerView.findViewById(R.id.preview_image);
            previewTimeText     = playerView.findViewById(R.id.preview_time);
        }

        // ══════════════════════════════════════════════════════════════════════════
        //  Focus helpers
        // ══════════════════════════════════════════════════════════════════════════
        private void updateFocusHighlight() {
            clearHighlight(btnBack); 
            clearHighlight(btnEpisodes);
            clearHighlight(btnMute);
            clearHighlight(btnAspect); 
            clearHighlight(btnSync); 
            clearHighlight(btnFullscreen);
            clearHighlight(btnTracks);
            clearHighlight(btnRew); 
            clearHighlight(btnPP); 
            clearHighlight(btnFfwd);
            clearHighlight(btnPrevEp); 
            clearHighlight(btnNextEp);

            if (episodeContainer != null) {
                for (int i = 0; i < episodeContainer.getChildCount(); i++) {
                    View child = episodeContainer.getChildAt(i);
                    if (child instanceof Button) {
                        Button b = (Button) child;
                        boolean isCurrent = (i == currentIndex);
                        
                        if (focusRow == 1 && i == episodeFocusIndex) {
    b.setScaleX(1.1f);
    b.setScaleY(1.1f);

    if (isCurrent) {
        b.setBackgroundResource(R.drawable.bg_episode_active);
        b.setTextColor(0xFF000000);
    } else {
        b.setBackgroundResource(R.drawable.bg_segmented_item);
        b.setTextColor(0xFFFFFFFF);
    }
                        } else {
                            if (isCurrent) {
                                b.setBackgroundResource(R.drawable.bg_episode_active);
                                b.setTextColor(0xFF000000);
                            } else {
                                b.setBackgroundResource(R.drawable.bg_segmented_item);
                                b.setTextColor(0xFFFFFFFF);
                            }
                            b.setScaleX(1.0f);
                            b.setScaleY(1.0f);
                        }
                    }
                }
            }

            if (progressBar != null) {
                progressBar.setScaleY(1f);
                progressBar.setAlpha(1f);
            }

            if (onProgressBar) {
                if (progressBar != null) {
                    progressBar.setScaleY(2.5f);
                    progressBar.requestFocus();
                }
                if (previewContainer != null) previewContainer.setVisibility(View.VISIBLE);
                updatePreviewFrame(player != null ? player.getCurrentPosition() : 0);
                return;
            } else {
                if (previewContainer != null) previewContainer.setVisibility(View.GONE);
                if (progressBar != null) progressBar.setAlpha(0.7f);
            }

            if (focusRow == 0) {
                switch (focusCol) {
                    case 0: applyHighlight(btnBack);       break;
                    case 1: applyHighlight(btnEpisodes);   break;
                    case 2: applyHighlight(btnMute);       break;
                    case 3: applyHighlight(btnAspect);     break;
                    case 4: applyHighlight(btnSync);       break;
                    case 5: applyHighlight(btnFullscreen); break;
                    case 6: applyHighlight(btnTracks);     break;
                }
            } else if (focusRow == 2) {
                switch (focusCol) {
                    case 0: applyHighlight(btnPrevEp); break;
                    case 1: applyHighlight(btnRew);    break;
                    case 2: applyHighlight(btnPP);     break;
                    case 3: applyHighlight(btnFfwd);   break;
                    case 4: applyHighlight(btnNextEp); break;
                }
            }
        }

        private void applyHighlight(View v) {
            if (v == null) return;
            v.animate().scaleX(1.18f).scaleY(1.18f).alpha(1.0f).setDuration(200)
                    .setInterpolator(new OvershootInterpolator()).start();
        }

        private void clearHighlight(View v) {
            if (v == null) return;
            v.animate().scaleX(1f).scaleY(1f).alpha(0.85f).setDuration(200).start();
        }

        private void activateFocused() {
            if (onProgressBar) return;
            if (focusRow == 0) {
                switch (focusCol) {
                    case 0: performBackAction(); break;
                    case 1: if (btnEpisodes  != null) btnEpisodes.performClick();  break;
                    case 2: if (btnMute      != null) btnMute.performClick();      break;
                    case 3: if (btnAspect    != null) btnAspect.performClick();    break;
                    case 4: if (btnSync      != null) btnSync.performClick();      break;
                    case 5: if (btnFullscreen!= null) btnFullscreen.performClick();break;
                    case 6: if (btnTracks    != null) btnTracks.performClick();    break;
                }
            } else if (focusRow == 1) {
                playEpisode(episodeFocusIndex);
            } else if (focusRow == 2) {
                switch (focusCol) {
                    case 0: if (btnPrevEp != null) btnPrevEp.performClick(); break;
                    case 1: fastSeek(-10_000); break;
                    case 2:
                        if (player != null) {
                            if (player.isPlaying()) player.pause(); else player.play();
                        }
                        animatePlayPause(); break;
                    case 3: fastSeek(10_000); break;
                    case 4: if (btnNextEp != null) btnNextEp.performClick(); break;
                }
            }
            scheduleHide();
        }

        // ══════════════════════════════════════════════════════════════════════════
        //  TV Remote / D-pad
        // ══════════════════════════════════════════════════════════════════════════
        @Override
        public boolean onKeyDown(int keyCode, KeyEvent event) {
            if (player == null) return super.onKeyDown(keyCode, event);

            if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
                audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC,
                        AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI); return true;
            }
            if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
                audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC,
                        AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI); return true;
            }

            if (resumeShowing) {
                switch (keyCode) {
                    case KeyEvent.KEYCODE_DPAD_LEFT:
                        resumeFocusCol = 0; updateResumeHighlight(); return true;
                    case KeyEvent.KEYCODE_DPAD_RIGHT:
                        resumeFocusCol = 1; updateResumeHighlight(); return true;
                    case KeyEvent.KEYCODE_DPAD_CENTER:
                    case KeyEvent.KEYCODE_ENTER:
                        if (resumeFocusCol == 0) doResume(); else doStartOver();
                        return true;
                }
                return true;
            }

            if (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) {
                if (player.isPlaying()) player.pause(); else player.play();
                animatePlayPause(); return true;
            }
            if (keyCode == KeyEvent.KEYCODE_MEDIA_REWIND)        { fastSeek(-10_000); return true; }
            if (keyCode == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD)  { fastSeek(10_000);  return true; }

            if (isLocked) return super.onKeyDown(keyCode, event);

            if (!controlsVisible) {
                switch (keyCode) {
                    case KeyEvent.KEYCODE_DPAD_CENTER:
                    case KeyEvent.KEYCODE_ENTER:
                        if (player.isPlaying()) player.pause(); else player.play();
                        animatePlayPause();
                        focusRow = 2; focusCol = 2; onProgressBar = false;
                        showControls();
                        return true;
                    case KeyEvent.KEYCODE_DPAD_LEFT:
                        onProgressBar = true; showControls(); fastSeek(-10_000); return true;
                    case KeyEvent.KEYCODE_DPAD_RIGHT:
                        onProgressBar = true; showControls(); fastSeek(10_000);  return true;
                    case KeyEvent.KEYCODE_DPAD_UP:
                    case KeyEvent.KEYCODE_DPAD_DOWN:
                        focusRow = 2; focusCol = 2; onProgressBar = false; showControls(); return true;
                }
                return super.onKeyDown(keyCode, event);
            }

            scheduleHide();

            switch (keyCode) {
                case KeyEvent.KEYCODE_DPAD_CENTER:
                case KeyEvent.KEYCODE_ENTER:
                    activateFocused(); return true;

                case KeyEvent.KEYCODE_DPAD_UP:
                    if (onProgressBar) {
                        onProgressBar = false; focusRow = 2; focusCol = 2;
                    } else if (focusRow == 2) {
                        if (!playlist.isEmpty()) { focusRow = 1; episodeFocusIndex = currentIndex; }
                        else                     { focusRow = 0; focusCol = 2; }
                    } else if (focusRow == 1) {
                        focusRow = 0; focusCol = 2;
                    }
                    updateFocusHighlight(); return true;

                case KeyEvent.KEYCODE_DPAD_DOWN:
                    if (focusRow == 0) {
                        if (!playlist.isEmpty()) { focusRow = 1; episodeFocusIndex = currentIndex; }
                        else                     { focusRow = 2; focusCol = 2; }
                    } else if (focusRow == 1) {
                        focusRow = 2; focusCol = 2;
                    } else if (focusRow == 2) {
                        onProgressBar = true;
                    }
                    updateFocusHighlight(); return true;

                case KeyEvent.KEYCODE_DPAD_LEFT:
                    if (onProgressBar) {
                        int repeat = event.getRepeatCount();
                        long step = repeat > 30 ? 5000 : repeat > 10 ? 1000 : 500;
                        fastSeek(-step);
                    } else if (focusRow == 1) {
                        if (episodeFocusIndex > 0) {
                            episodeFocusIndex--;
                            scrollEpisodeIntoView(episodeFocusIndex);
                        }
                        updateFocusHighlight();
                    } else {
                        if (focusCol > 0) focusCol--;
                        updateFocusHighlight();
                    }
                    return true;

                case KeyEvent.KEYCODE_DPAD_RIGHT:
                    if (onProgressBar) {
                        int repeat = event.getRepeatCount();
                        long step = repeat > 30 ? 5000 : repeat > 10 ? 1000 : 500;
                        fastSeek(step);
                    } else if (focusRow == 1) {
                        if (episodeFocusIndex < playlist.size() - 1) {
                            episodeFocusIndex++;
                            scrollEpisodeIntoView(episodeFocusIndex);
                        }
                        updateFocusHighlight();
                    } else {
                        int max = (focusRow == 0) ? 6 : (focusRow == 2 ? 4 : 0);
                        if (focusCol < max) focusCol++;
                        updateFocusHighlight();
                    }
                    return true;
            }

            return super.onKeyDown(keyCode, event);
        }

        private void scrollEpisodeIntoView(int index) {
            if (episodeContainer == null || episodeBar == null) return;
            View child = episodeContainer.getChildAt(index);
            if (child != null && episodeBar instanceof ViewGroup) {
                View firstChild = ((ViewGroup) episodeBar).getChildAt(0);
                if (firstChild instanceof HorizontalScrollView) {
                    ((HorizontalScrollView) firstChild).smoothScrollTo(child.getLeft() - dp(100), 0);
                }
            }
        }

        // ══════════════════════════════════════════════════════════════════════════
        //  Show / Hide controls
        // ══════════════════════════════════════════════════════════════════════════
        private void showControls() {
            if (isLocked) return;
            controlsVisible = true;
            playerView.showController();
            View[] targets = { topBar, centerControls, bottomBar, scrimTop, scrimBottom, episodeBar };
            for (View v : targets) {
                if (v == null) continue;
                v.animate().cancel();
                if (v == episodeBar && (!episodesVisible || playlist.isEmpty())) {
                    v.setVisibility(View.GONE);
                    continue;
                }
                v.setVisibility(View.VISIBLE);
                v.animate().alpha(1f).setDuration(220)
                        .setInterpolator(new AccelerateDecelerateInterpolator()).start();
            }
            if (btnLock != null) {
                btnLock.animate().cancel();
                btnLock.setVisibility(View.VISIBLE);
                btnLock.animate().alpha(1f).setDuration(220).start();
            }
            updateFocusHighlight();
            scheduleHide();
        }

        private void hideControls() {
            controlsVisible = false; onProgressBar = false;
            playerView.hideController();
            clearHighlight(btnBack); clearHighlight(btnMute);
            clearHighlight(btnAspect); clearHighlight(btnSync);
            clearHighlight(btnFullscreen); clearHighlight(btnTracks);
            clearHighlight(btnRew); clearHighlight(btnPP); clearHighlight(btnFfwd);
            View[] targets = { topBar, centerControls, bottomBar, scrimTop, scrimBottom, episodeBar };
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
                btnLock.setAlpha(0f); btnLock.setVisibility(View.VISIBLE);
                btnLock.bringToFront();
                btnLock.animate().alpha(1f).setDuration(200).start();
            }
            if (tvLockHint != null) {
                tvLockHint.animate().cancel();
                tvLockHint.setAlpha(0f); tvLockHint.setVisibility(View.VISIBLE);
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
                    if (isLocked) unlock(); else lock();
                }
                return true;
            });
        }

        private void lock() {
            isLocked = true; lockUiVisible = false;
            autoHideHandler.removeCallbacks(autoHideRunnable);
            autoHideHandler.removeCallbacks(hideLockUiRunnable);
            playerView.hideController();
            View[] toHide = { topBar, centerControls, bottomBar, scrimTop, scrimBottom };
            for (View v : toHide) {
                if (v == null) continue;
                v.animate().cancel();
                v.animate().alpha(0f).setDuration(250)
                        .withEndAction(() -> v.setVisibility(View.GONE)).start();
            }
            if (btnLock != null) {
                btnLock.setImageResource(R.drawable.ic_lock_closed);
                btnLock.animate().cancel();
                btnLock.setVisibility(View.VISIBLE); btnLock.bringToFront(); btnLock.setAlpha(1f);
                btnLock.animate().scaleX(1.25f).scaleY(1.25f).setDuration(120)
                        .withEndAction(() ->
                            btnLock.animate().scaleX(1f).scaleY(1f).setDuration(120).start()).start();
                lockUiVisible = true;
            }
            if (tvLockHint != null) {
                tvLockHint.setText("Tap 🔒 to unlock");
                tvLockHint.animate().cancel();
                tvLockHint.bringToFront(); tvLockHint.setAlpha(1f); tvLockHint.setVisibility(View.VISIBLE);
            }
            autoHideHandler.postDelayed(hideLockUiRunnable, LOCK_UI_MS);
        }

        private void unlock() {
            isLocked = false; lockUiVisible = false;
            autoHideHandler.removeCallbacks(hideLockUiRunnable);
            if (tvLockHint != null) { tvLockHint.animate().cancel(); tvLockHint.setVisibility(View.GONE); }
            if (btnLock != null) {
                btnLock.animate().cancel();
                btnLock.setImageResource(R.drawable.ic_lock_open);
                btnLock.setVisibility(View.VISIBLE); btnLock.setAlpha(1f);
            }
            showControls();
        }

        // ══════════════════════════════════════════════════════════════════════════
        //  Gestures
        // ══════════════════════════════════════════════════════════════════════════
        private void setupGestures() {
            playerView.setOnTouchListener((v, e) -> { handleTouch(e); return true; });
        }

        private void handleTouch(MotionEvent e) {
            if (resumeShowing) return;
            final float rawX = e.getRawX(), rawY = e.getRawY();
            final int w = playerView.getWidth();
            switch (e.getAction()) {
                case MotionEvent.ACTION_DOWN:
                    downRawX = rawX; downRawY = rawY;
                    downInLeft = rawX < w / 3f; downInRight = rawX > w * 2f / 3f;
                    dirLocked = false; isVertical = false; isHorizontal = false;
                    if (downInLeft)  gestureStartValue = getBrightnessPct();
                    if (downInRight) gestureStartValue = getVolumePct();
                    autoHideHandler.removeCallbacks(startTouchHoldRunnable);
                    autoHideHandler.removeCallbacks(touchHoldRunnable);
                    touchHoldSide = 0;
                    autoHideHandler.postDelayed(startTouchHoldRunnable, 500);
                    break;
                case MotionEvent.ACTION_MOVE:
                    float dx = rawX - downRawX, dy = rawY - downRawY;
                    if (!dirLocked) {
                        if (Math.abs(dx) > GESTURE_THRESHOLD || Math.abs(dy) > GESTURE_THRESHOLD) {
                            dirLocked = true;
                            autoHideHandler.removeCallbacks(startTouchHoldRunnable);
                            isVertical = Math.abs(dy) >= Math.abs(dx);
                            isHorizontal = !isVertical;
                            if (!isLocked) {
                                if (isVertical && downInLeft)  showGestureIndicator(true);
                                if (isVertical && downInRight) showGestureIndicator(false);
                                showControls();
                            }
                        }
                    }
                    if (isLocked) break;
                    if (isVertical || isHorizontal) autoHideHandler.removeCallbacks(autoHideRunnable);
                    if (isVertical) {
                        int pct = Math.max(0, Math.min(100,
                                (int)(gestureStartValue - dy / playerView.getHeight() * 100)));
                        if (downInLeft) {
                            setBrightness(pct);
                            if (viewBrightnessFill != null) viewBrightnessFill.setScaleY(pct / 100f);
                            if (tvBrightnessValue  != null) tvBrightnessValue.setText(pct + "%");
                        } else if (downInRight) {
                            setVolume(pct);
                            if (viewVolumeFill != null) viewVolumeFill.setScaleY(pct / 100f);
                            if (tvVolumeValue  != null) tvVolumeValue.setText(pct + "%");
                        }
                    }
                    if (isHorizontal) {
                        long delta = (long)(dx / SEEK_PX_PER_SEC) * 1000L;
                        updateSeekIndicator(delta);
                        if (player != null && previewContainer != null) {
                            previewContainer.setVisibility(View.VISIBLE);
                            updatePreviewFrame(player.getCurrentPosition() + delta);
                        }
                    }
                    break;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    autoHideHandler.removeCallbacks(startTouchHoldRunnable);
                    autoHideHandler.removeCallbacks(touchHoldRunnable);
                    if (touchHoldSide != 0) {
                        touchHoldSide = 0;
                        if (previewContainer != null) previewContainer.setVisibility(View.GONE);
                        scheduleHide();
                        dirLocked = false; isVertical = false; isHorizontal = false;
                        break;
                    }
                    if (isLocked) {
                        if (!dirLocked) { if (lockUiVisible) hideLockUI(); else showLockUI(); }
                        dirLocked = false; isVertical = false; isHorizontal = false; break;
                    }
                    if (isVertical) {
                        hideGestureIndicator(downInLeft); scheduleHide();
                    } else if (isHorizontal) {
                        long ms = (long)((rawX - downRawX) / SEEK_PX_PER_SEC) * 1000L;
                        fastSeek(ms); hideSeekIndicator(); scheduleHide();
                    } else { handleTap(downRawX); }
                    dirLocked = false; isVertical = false; isHorizontal = false;
                    break;
            }
        }

        private void handleTap(float x) {
            long now = System.currentTimeMillis();
            int side = (x < playerView.getWidth() / 2f) ? -1 : 1;
            if (now - lastTapTime < DOUBLE_TAP_MS && side == lastTapSide) {
                long ms = side == -1 ? -10_000L : 10_000L;
                fastSeek(ms); lastTapTime = 0;
            } else {
                lastTapTime = now; lastTapSide = side;
                if (controlsVisible) hideControls();
                else { focusRow = 1; focusCol = 1; onProgressBar = false; showControls(); }
            }
        }

        // ══════════════════════════════════════════════════════════════════════════
        //  Wire buttons
        // ══════════════════════════════════════════════════════════════════════════
        private void wireButtons() {
            btnBack       = playerView.findViewById(R.id.btn_back);
            btnEpisodes   = playerView.findViewById(R.id.btn_episodes);
            btnMute       = playerView.findViewById(R.id.btn_mute);
            btnAspect     = playerView.findViewById(R.id.btn_aspect_ratio);
            btnSync       = playerView.findViewById(R.id.btn_sync);
            btnFullscreen = playerView.findViewById(R.id.btn_fullscreen);
            btnRew        = playerView.findViewById(R.id.exo_rew);
            btnFfwd       = playerView.findViewById(R.id.exo_ffwd);
            btnPP         = playerView.findViewById(R.id.exo_play_pause);

            if (btnBack != null) btnBack.setOnClickListener(v -> performBackAction());

            if (btnEpisodes != null) {
                btnEpisodes.setOnClickListener(v -> {
                    episodesVisible = !episodesVisible;
                    if (episodeBar != null) {
                        if (episodesVisible) {
                            episodeBar.setVisibility(View.VISIBLE);
                            episodeBar.setAlpha(0f);
                            episodeBar.animate().alpha(1f).setDuration(200).start();
                            episodeBar.bringToFront();
                        } else {
                            episodeBar.animate().alpha(0f).setDuration(200)
                                    .withEndAction(() -> episodeBar.setVisibility(View.GONE)).start();
                        }
                    }
                    scheduleHide();
                });
            }

            if (btnMute != null) btnMute.setOnClickListener(v -> {
                isMuted = !isMuted;
                if (player != null) player.setVolume(isMuted ? 0f : 1f);
                btnMute.setImageResource(isMuted ? R.drawable.ic_volume_off : R.drawable.ic_volume_up);
                scheduleHide();
            });

            if (btnAspect != null) btnAspect.setOnClickListener(v -> {
                resizeModeIndex = (resizeModeIndex + 1) % RESIZE_MODES.length;
                playerView.setResizeMode(RESIZE_MODES[resizeModeIndex]);
                Toast.makeText(this, RESIZE_LABELS[resizeModeIndex], Toast.LENGTH_SHORT).show();
                scheduleHide();
            });

            if (btnSync != null) btnSync.setOnClickListener(v -> {
                showSyncDialog(); scheduleHide();
            });

            if (btnTracks != null) btnTracks.setOnClickListener(v -> {
                showTrackSelectionDialog();
                scheduleHide();
            });

            if (btnFullscreen != null) btnFullscreen.setOnClickListener(v -> {
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

            if (btnRew  != null) btnRew.setOnClickListener(v ->  { fastSeek(-10_000); scheduleHide(); });
            if (btnFfwd != null) btnFfwd.setOnClickListener(v -> { fastSeek(10_000);  scheduleHide(); });
            if (btnPP   != null) btnPP.setOnClickListener(v -> {
                if (player != null) { if (player.isPlaying()) player.pause(); else player.play(); }
                animatePlayPause(); scheduleHide();
            });

            if (btnPrevEp != null) btnPrevEp.setOnClickListener(v -> {
                playEpisode(currentIndex - 1); scheduleHide();
            });
            if (btnNextEp != null) btnNextEp.setOnClickListener(v -> {
                playEpisode(currentIndex + 1); scheduleHide();
            });
        }

        // ══════════════════════════════════════════════════════════════════════════
        //  Seek / indicators
        // ══════════════════════════════════════════════════════════════════════════
        private void fastSeek(long delta) {
            if (player == null) return;
            long target = Math.max(0, Math.min(player.getDuration(), player.getCurrentPosition() + delta));
            player.seekTo(target);
            updatePreviewFrame(target);
            showSeekIndicatorTimed(delta);
            animatePlayPause();
        }

        private void updateSeekIndicator(long ms) {
            if (seekIndicator == null) return;
            if (seekIndicator.getVisibility() != View.VISIBLE) {
                seekIndicator.setAlpha(0f); seekIndicator.setVisibility(View.VISIBLE);
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

        private void animatePlayPause() {
            if (exoPlayPause == null) return;
            exoPlayPause.animate().cancel();
            exoPlayPause.setScaleX(0.85f);
            exoPlayPause.setScaleY(0.85f);
            exoPlayPause.animate()
                    .scaleX(1.18f).scaleY(1.18f).setDuration(400)
                    .setInterpolator(new OvershootInterpolator(2.5f)).start();
        }

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

        private int getBrightnessPct() {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            if (lp.screenBrightness < 0) {
                try { return Settings.System.getInt(getContentResolver(),
                        Settings.System.SCREEN_BRIGHTNESS) * 100 / 255; }
                catch (Exception e) { return 50; }
            }
            return (int)(lp.screenBrightness * 100);
        }

        private void setBrightness(int pct) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.screenBrightness = pct / 100f; getWindow().setAttributes(lp);
        }

        private int getVolumePct() {
            return audioManager.getStreamVolume(AudioManager.STREAM_MUSIC) * 100 / maxVolume;
        }

        private void setVolume(int pct) {
            int steps = Math.max(0, Math.min(maxVolume, pct * maxVolume / 100));
            audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, steps, 0);
        }

        // ══════════════════════════════════════════════════════════════════════════
        //  Lifecycle
        // ══════════════════════════════════════════════════════════════════════════
        private void performBackAction() {
            saveCurrentPosition();
            releasePlayer();
            Intent i = new Intent(this, MainActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(i);
            finish();
        }

        @Override
        protected void onResume() {
            super.onResume();
            hideSystemUI();
        }

        @Override protected void onPause() {
            super.onPause();
            saveCurrentPosition();
            if (player != null) player.pause();
            autoHideHandler.removeCallbacks(autoHideRunnable);
            autoHideHandler.removeCallbacks(hideLockUiRunnable);
            autoHideHandler.removeCallbacks(savePositionRunnable);
        }

        @Override protected void onDestroy() {
            if (previewThread != null) {
                previewThread.quitSafely();
                previewThread = null;
            }
            if (retriever != null) {
                try { retriever.release(); } catch (Exception ignored) {}
                retriever = null;
            }
            autoHideHandler.removeCallbacks(autoHideRunnable);
            autoHideHandler.removeCallbacks(hideLockUiRunnable);
            autoHideHandler.removeCallbacks(savePositionRunnable);
            releasePlayer();
            super.onDestroy();
        }

        private void releasePlayer() {
            if (player != null) { player.stop(); player.release(); player = null; }
        }

        private void applySavedTrackPreferences() {
            if (player == null) return;
            SharedPreferences prefs = getSharedPreferences("hm_player_prefs", MODE_PRIVATE);
            String audioLang = prefs.getString("pref_lang_audio", null);
            String textLang = prefs.getString("pref_lang_text", null);

            TrackSelectionParameters.Builder builder = player.getTrackSelectionParameters().buildUpon();
            
            // Explicitly ensure audio and text tracks are not disabled
            builder.setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, false);
            builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false);
            
            if (audioLang != null) builder.setPreferredAudioLanguage(audioLang);
            if (textLang != null) {
                builder.setPreferredTextLanguage(textLang);
                builder.setIgnoredTextSelectionFlags(0);
                builder.setSelectUndeterminedTextLanguage(true);
            }
            player.setTrackSelectionParameters(builder.build());
        }

        private void hideSystemUI() {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN);
        }

        private void showSystemUI() {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }