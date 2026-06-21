package com.harimovies.app;

import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.util.UnstableApi;

import android.app.NotificationManager;
import android.text.TextUtils;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
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
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.SeekParameters;
import androidx.media3.exoplayer.audio.AudioSink;
import androidx.media3.exoplayer.audio.DefaultAudioSink;
import androidx.media3.exoplayer.dash.DashMediaSource;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;
import android.graphics.Typeface;
import android.util.TypedValue;
import androidx.media3.ui.CaptionStyleCompat;
import androidx.media3.ui.SubtitleView;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.DefaultTimeBar;
import androidx.media3.ui.PlayerView;
import androidx.media3.ui.TimeBar;

import com.pierfrancescosoffritti.androidyoutubeplayer.core.player.YouTubePlayer;
import com.pierfrancescosoffritti.androidyoutubeplayer.core.player.PlayerConstants;
import com.pierfrancescosoffritti.androidyoutubeplayer.core.player.options.IFramePlayerOptions;
import com.pierfrancescosoffritti.androidyoutubeplayer.core.player.listeners.AbstractYouTubePlayerListener;
import com.pierfrancescosoffritti.androidyoutubeplayer.core.player.views.YouTubePlayerView;

import kotlin.Unit;

import org.json.JSONArray;
import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.io.IOException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

@UnstableApi
public class PlayerActivity extends AppCompatActivity {

    public static final String EXTRA_URL   = "url";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_SERIES_TITLE = "series_title";

    private static final String PREFS_NAME    = "hm_watch_pos";
    private static final long   SAVE_EVERY_MS = 5_000L;
    private static final long   MIN_RESUME_MS = 10_000L;

    // ── AUTO-HIDE: 3s (idle), never hides while paused/seeking/navigating ────
    private static final long AUTO_HIDE_MS  = 3_000L;
    private static final long LOCK_UI_MS    = 3_000L;

    private ExoPlayer  player;
    private PlayerView playerView;
    private YouTubePlayerView youtubePlayerView;
    private YouTubePlayer activeYoutubePlayer;
    private boolean isYoutubePlaying = false;
    private boolean youtubeIsPlaying = false;
    private float   youtubeCurrentTime = 0f;
    private float   youtubeDuration = 0f;
    private DelayAudioProcessor delayAudioProcessor;

    private String  videoTitle   = "";
    private String  seriesTitle  = "";
    private String  videoUrl     = "";
    private boolean isFullscreen = true;
    private int     resizeModeIndex = 0;

    // ── Playlist ──────────────────────────────────────────────────────────────
    private final List<JSONObject> playlist = new ArrayList<>();
    private int currentIndex = 0;
    private TextView tvEpBadge;
    private LinearLayout episodeContainer;
    private View episodeBar;
    private TextView tvTitle;
    private TextView tvCurrentTime, tvRemainingTime;

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
    private long    lastShowTime    = 0L;
    private boolean isLocked        = false;
    private boolean lockUiVisible   = false;
    private boolean resumeShowing   = false;
    private boolean resumeChecked   = false;
    private boolean isSeeking       = false; // track seeking to pause auto-hide
    private int previousInterruptionFilter = 1; // Default to INTERRUPTION_FILTER_ALL

    // ── TV Focus tracking (rows: 0=top, 1=center, 2=seekbar, 3=episodes) ─────
    private int     focusRow          = 1;
    private int     focusCol          = 2; // default: play/pause
    private int     lastFocusRow      = 1;
    private int     lastFocusCol      = 2;
    private int     episodeFocusIndex = 0;
    private int     resumeFocusCol    = 0;

    // ── Seek acceleration for hold ────────────────────────────────────────────
    private static final long[] SEEK_HOLD_STEPS    = { 1000L, 5000L, 10000L, 30000L };
    private static final int[]  SEEK_HOLD_THRESHOLDS = { 0, 8, 20, 40 }; // repeat counts

    private final Handler  autoHideHandler    = new Handler(Looper.getMainLooper());
    private final Runnable autoHideRunnable   = this::hideControls;
    private final Runnable hideLockUiRunnable = this::hideLockUI;
    private final Runnable savePositionRunnable = this::saveCurrentPosition;

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

    // ── Touch Hold ─────────────────────────────────────────────────────────────
    private int touchHoldSide = 0;
    private int touchHoldCount = 0;
    private Runnable touchHoldRunnable;
    private Runnable startTouchHoldRunnable;

    // ── Audio ──────────────────────────────────────────────────────────────────
    private AudioManager audioManager;
    private int          maxVolume;

    // ── Controller views ───────────────────────────────────────────────────────
    private LinearLayout brightnessIndicator, volumeIndicator;
    private View         viewBrightnessFill, viewVolumeFill;
    private TextView     tvBrightnessValue, tvVolumeValue;
    private LinearLayout seekIndicator;
    private ImageView    seekIcon;
    private TextView     tvSeekDelta;
    private View         topBar, centerControls, bottomBar, scrimTop, scrimBottom;
    private ImageButton  btnLock;
    private TextView     tvLockHint, tvTitleSep;

    // ── Time labels ───────────────────────────────────────────────────────────
    private final Handler timeUpdateHandler = new Handler(Looper.getMainLooper());
    private final Runnable timeUpdateRunnable = this::updateTimestamps;

    // ── Button refs ───────────────────────────────────────────────────────────
    private ImageButton btnBack, btnPictureMode, btnFullscreen, btnSync, btnSettings, btnNextEp, btnPrevEp;
    private View        btnRew, btnPP, btnFfwd, progressBar;

    // Row button arrays for focus tracking
    private View[] topRowButtons;
    private View[] centerRowButtons;

    // ── Resume overlay ────────────────────────────────────────────────────────
    private View   resumeOverlay;
    private Button btnResume, btnStartOver;
    private TextView tvResumeTime;
    private long forcedResumePos = 0;
    private long currentSavedPos = 0;

    // ── Preview ───────────────────────────────────────────────────────────────
    private View         previewContainer;
    private ImageView    previewImage;
    private TextView     previewTimeText;
    private MediaMetadataRetriever retriever;
    private HandlerThread previewThread;
    private Handler       previewHandler;
    private final Map<String, String> requestHeaders = new HashMap<>();

    private boolean isPreviewLoading = false;
    private long    lastPreviewPos   = -1;

    // ── Intro Skip ────────────────────────────────────────────────────────────
    private long introStartMs = -1;
    private long introEndMs   = -1;
    private Button btnSkipIntro;
    private boolean isAniSkipEnabled = true;

    private final TelegramRepository telegramRepository = new TelegramRepository();
    private final OkHttpClient okHttpClient = new OkHttpClient();

    private static WeakReference<PlayerActivity> activeInstance = new WeakReference<>(null);

    public static void receiveRemoteCommand(String cmd) {
        PlayerActivity activity = activeInstance.get();
        if (activity != null) {
            activity.runOnUiThread(() -> {
                Log.d("REMOTE", "External command: " + cmd);
                switch (cmd.toLowerCase()) {
                    case "up":    activity.onKeyDown(KeyEvent.KEYCODE_DPAD_UP,    new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_UP)); break;
                    case "down":  activity.onKeyDown(KeyEvent.KEYCODE_DPAD_DOWN,  new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_DOWN)); break;
                    case "left":  activity.onKeyDown(KeyEvent.KEYCODE_DPAD_LEFT,  new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_LEFT)); break;
                    case "right": activity.onKeyDown(KeyEvent.KEYCODE_DPAD_RIGHT, new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_RIGHT)); break;
                    case "enter": activity.onKeyDown(KeyEvent.KEYCODE_DPAD_CENTER, new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER)); break;
                    case "back":  activity.onKeyDown(KeyEvent.KEYCODE_BACK,        new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_BACK)); break;
                    case "play":  if (activity.player != null) activity.player.play(); break;
                    case "pause": if (activity.player != null) activity.player.pause(); break;
                    case "next":  if (activity.btnNextEp != null) activity.btnNextEp.performClick(); break;
                    case "prev":  if (activity.btnPrevEp != null) activity.btnPrevEp.performClick(); break;
                    case "rewind": activity.fastSeek(-5000); break;
                    case "forward": activity.fastSeek(10000); break;
                    case "vol_up": activity.audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI); break;
                    case "vol_down": activity.audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI); break;
                    case "fullscreen": if (activity.btnFullscreen != null) activity.btnFullscreen.performClick(); break;
                    case "settings": if (activity.btnSettings != null) activity.btnSettings.performClick(); break;
                }
            });
        }
    }

    // ── Remote Bridge ────────────────────────────────────────────────────────
    private class RemoteBridge {
        @JavascriptInterface
        public void sendCommand(String cmd) {
            runOnUiThread(() -> {
                Log.d("REMOTE", "Received JS command: " + cmd);
                switch (cmd.toLowerCase()) {
                    case "up":    onKeyDown(KeyEvent.KEYCODE_DPAD_UP,    new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_UP)); break;
                    case "down":  onKeyDown(KeyEvent.KEYCODE_DPAD_DOWN,  new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_DOWN)); break;
                    case "left":  onKeyDown(KeyEvent.KEYCODE_DPAD_LEFT,  new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_LEFT)); break;
                    case "right": onKeyDown(KeyEvent.KEYCODE_DPAD_RIGHT, new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_RIGHT)); break;
                    case "enter": onKeyDown(KeyEvent.KEYCODE_DPAD_CENTER, new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER)); break;
                    case "back":  onKeyDown(KeyEvent.KEYCODE_BACK,        new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_BACK)); break;
                    case "play":  if (player != null) player.play(); break;
                    case "pause": if (player != null) player.pause(); break;
                    case "next":  if (btnNextEp != null) btnNextEp.performClick(); break;
                    case "prev":  if (btnPrevEp != null) btnPrevEp.performClick(); break;
                }
            });
        }
    }

    // ── Continuous Seek ───────────────────────────────────────────────────────
    private final Handler continuousSeekHandler = new Handler(Looper.getMainLooper());
    private int continuousSeekDirection = 0; // -1 for rewind, 1 for forward
    private final Runnable continuousSeekRunnable = new Runnable() {
        @Override
        public void run() {
            if (continuousSeekDirection != 0) {
                fastSeek(continuousSeekDirection * 5000L); // 5s steps during hold
                continuousSeekHandler.postDelayed(this, 200);
            }
        }
    };

    // ══════════════════════════════════════════════════════════════════════════
// ── onCreate ──────────────────────────────────────────────────────────────
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        activeInstance = new WeakReference<>(this);
        // 1. Kill window animations completely BEFORE layout initialization
        getWindow().setWindowAnimations(0);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);

        super.onCreate(savedInstanceState);
        Log.d("PLAYER", "onCreate started");
        try {
            // 2. Disable default window slide/fade transitions
            overridePendingTransition(0, 0);

            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            hideSystemUI();
            setContentView(R.layout.activity_player);

            audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            maxVolume    = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);

            try {
                String tdlibPath = getFilesDir().getAbsolutePath() + "/tdlib";
                TelegramManager.INSTANCE.init(tdlibPath);
            } catch (Exception e) {
                Log.e("PLAYER", "TelegramManager init failed", e);
            }

            playerView = findViewById(R.id.player_view);
            youtubePlayerView = findViewById(R.id.youtube_player_view);
            getLifecycle().addObserver(youtubePlayerView);

            videoUrl   = getIntent().getStringExtra(EXTRA_URL);   if (videoUrl == null) videoUrl = "";
            videoTitle = getIntent().getStringExtra(EXTRA_TITLE);
            if (videoTitle == null) videoTitle = "";
            
            seriesTitle = getIntent().getStringExtra(EXTRA_SERIES_TITLE);
            if (seriesTitle == null || seriesTitle.isEmpty()) {
                seriesTitle = cleanSeriesTitle(videoTitle);
            }

            forcedResumePos = getIntent().getLongExtra("resume_pos", 0);

            Log.d("SERIES_DEBUG", "Activity: Initial URL: " + videoUrl);
            Log.d("SERIES_DEBUG", "Activity: Initial Title: " + videoTitle);

            // Parse playlist
            String playlistJson = getIntent().getStringExtra("playlist");
            if (playlistJson != null && !playlistJson.isEmpty() && !playlistJson.equals("[]") && !playlistJson.equals("null")) {
                try {
                    JSONArray array = new JSONArray(playlistJson);
                    playlist.clear();
                    for (int j = 0; j < array.length(); j++) {
                        playlist.add(array.getJSONObject(j));
                    }
                    currentIndex = getIntent().getIntExtra("index", 0);

                    if (currentIndex >= 0 && currentIndex < playlist.size()) {
                        JSONObject ep = playlist.get(currentIndex);
                        if (videoUrl == null || videoUrl.isEmpty()) {
                            videoUrl = ep.optString("link", "");
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

            delayAudioProcessor = new DelayAudioProcessor();
            DefaultRenderersFactory renderersFactory = new DefaultRenderersFactory(this) {
                @Override
                protected AudioSink buildAudioSink(@androidx.annotation.NonNull Context context, boolean enableFloatOutput, boolean enableAudioTrackPlaybackParams) {
                    return new DefaultAudioSink.Builder(context)
                            .setAudioProcessors(new AudioProcessor[] { delayAudioProcessor })
                            .build();
                }
            };
            renderersFactory.setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER);
            player = new ExoPlayer.Builder(this, renderersFactory).build();
            player.setSeekParameters(SeekParameters.EXACT);
            applySavedTrackPreferences();
            playerView.setPlayer(player);
            playerView.setControllerShowTimeoutMs(-1);
            playerView.setControllerAutoShow(false);
            playerView.setUseController(true);

            player.addListener(new Player.Listener() {
                @Override
                public void onTracksChanged(@androidx.annotation.NonNull Tracks tracks) {
                    boolean hasAudio = false;
                    boolean hasSupportedAudio = false;
                    for (Tracks.Group group : tracks.getGroups()) {
                        if (group.getType() == C.TRACK_TYPE_AUDIO) {
                            hasAudio = true;
                            if (group.isSupported()) {
                                hasSupportedAudio = true;
                                break;
                            }
                        }
                    }
                    if (hasAudio && !hasSupportedAudio) {
                        Toast.makeText(PlayerActivity.this,
                                "Audio format not supported by this phone's hardware.",
                                Toast.LENGTH_LONG).show();
                    }
                }

                @Override
                public void onPlayerError(@androidx.annotation.NonNull PlaybackException e) {
                    Log.e("STREAM_FAILED", "CODE=" + e.errorCode + " MSG=" + e.getMessage());

                    // Recover from decoder init failures (common when selecting unsupported audio tracks)
                    if (e.errorCode == PlaybackException.ERROR_CODE_DECODER_INIT_FAILED) {
                        Toast.makeText(PlayerActivity.this, "Audio/Video track not supported", Toast.LENGTH_SHORT).show();
                        player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                                .clearOverrides()
                                .build());
                        player.prepare();
                        player.play();
                        return;
                    }

                    // Fallback: if ExoPlayer fails, try WebPlayerActivity again
                    if (videoUrl != null && !getIntent().getBooleanExtra("is_fallback", false)) {
                        Intent intent = new Intent(PlayerActivity.this, WebPlayerActivity.class);
                        intent.putExtra("url", videoUrl);
                        intent.putExtra("title", videoTitle);
                        intent.putExtra("is_fallback", true);
                        if (!playlist.isEmpty()) {
                            JSONArray arr = new JSONArray();
                            for (JSONObject item : playlist) arr.put(item);
                            intent.putExtra("playlist", arr.toString());
                            intent.putExtra("index", currentIndex);
                        }
                        saveLastWatchedEpisode(currentIndex);
                        startActivity(intent);
                        finish();
                    } else {
                        Toast.makeText(PlayerActivity.this, "Stream playback failed after all attempts.", Toast.LENGTH_LONG).show();
                        finish();
                    }
                }

                @Override
                public void onIsPlayingChanged(boolean isPlaying) {
                    updatePlayPauseAccessibility();
                }

                @Override
                public void onPlaybackStateChanged(int state) {
                    Log.d("PLAYER", "State: " + state);
                    if (state == Player.STATE_ENDED) {
                        clearSavedPosition();
                        if (!playlist.isEmpty() && currentIndex < playlist.size() - 1) {
                            playEpisode(currentIndex + 1);
                        }
                    }
                    if (state == Player.STATE_READY && !resumeChecked) {
                        saveLastWatchedEpisode(currentIndex);
                        resumeChecked = true;
                        if (forcedResumePos > 0) {
                            player.seekTo(forcedResumePos);
                            player.play();
                            forcedResumePos = 0;
                            return;
                        }
                        checkResumePosition();
                        if (controlsVisible) {
                            episodeBar.post(() -> scrollEpisodeIntoView(currentIndex));
                        }
                    }
                }
            });

            findControllerViews();
            setupSubtitles();
            buildRowArrays();
            updateSeriesUI();
            buildResumeOverlay();
            syncFullscreenIcon();
            wireButtons();
            setupGestures();
            setupLockButton();
            setupPreviewRetriever();
            startTimeUpdates();

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

    private void setupSubtitles() {
        if (playerView == null) return;
        SubtitleView subtitleView = playerView.getSubtitleView();
        if (subtitleView != null) {
            subtitleView.setApplyEmbeddedStyles(false);
            subtitleView.setApplyEmbeddedFontSizes(false);

            // Responsive size: 5% of the video height (better for both Mobile & TV)
            subtitleView.setFractionalTextSize(0.05f);

            // Professional "Soft Box" look with shadow for a curved feel
            CaptionStyleCompat style = new CaptionStyleCompat(
                    android.graphics.Color.WHITE,
                    0xB3000000,                       // 70% Black (softer)
                    android.graphics.Color.TRANSPARENT,
                    CaptionStyleCompat.EDGE_TYPE_OUTLINE,
                    android.graphics.Color.BLACK,
                    Typeface.create("sans-serif-medium", Typeface.BOLD)
            );
            subtitleView.setStyle(style);

            // Lift subtitles slightly
            subtitleView.setBottomPaddingFraction(0.08f);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Build row button arrays for focus management
    // ══════════════════════════════════════════════════════════════════════════
    private void buildRowArrays() {
        // TOP ROW: Back(0) PictureMode(1) Fullscreen(2) Sync(3) Settings(4)
        topRowButtons    = new View[]{ btnBack, btnPictureMode, btnFullscreen, btnSync, btnSettings };
        // CENTER ROW: PrevEp(0) Rew(1) PlayPause(2) Ffwd(3) NextEp(4)
        centerRowButtons = new View[]{ btnPrevEp, btnRew, btnPP, btnFfwd, btnNextEp };
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Time labels: current position + remaining
    // ══════════════════════════════════════════════════════════════════════════
    private void startTimeUpdates() {
        timeUpdateHandler.removeCallbacks(timeUpdateRunnable);
        timeUpdateHandler.post(timeUpdateRunnable);
    }

    private void updateTimestamps() {
        if (isYoutubePlaying && activeYoutubePlayer != null && tvCurrentTime != null && tvRemainingTime != null) {
            tvCurrentTime.setText(fmt((long) youtubeCurrentTime));
            if (youtubeDuration > 0) {
                long rem = (long) (youtubeDuration - youtubeCurrentTime);
                tvRemainingTime.setText(String.format(Locale.US, "-%s", fmt(rem)));
            }
        } else if (player != null && tvCurrentTime != null && tvRemainingTime != null) {
            long pos = player.getCurrentPosition();
            long dur = player.getDuration();
            tvCurrentTime.setText(fmt(pos / 1000));
            if (dur > 0) {
                long rem = dur - pos;
                tvRemainingTime.setText(String.format(Locale.US, "-%s", fmt(rem / 1000)));
            }

            // Intro Skip logic
            if (btnSkipIntro != null && introStartMs != -1 && introEndMs != -1) {
                if (pos >= introStartMs && pos < introEndMs) {
                    if (btnSkipIntro.getVisibility() != View.VISIBLE) {
                        btnSkipIntro.setVisibility(View.VISIBLE);
                        btnSkipIntro.setAlpha(0f);
                        btnSkipIntro.animate().alpha(1f).setDuration(300).start();
                    }
                } else {
                    if (btnSkipIntro.getVisibility() == View.VISIBLE) {
                        btnSkipIntro.animate().alpha(0f).setDuration(300)
                                .withEndAction(() -> btnSkipIntro.setVisibility(View.GONE)).start();
                    }
                }
            }
        }
        timeUpdateHandler.postDelayed(timeUpdateRunnable, 500);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Accessibility helpers
    // ══════════════════════════════════════════════════════════════════════════
    private void updatePlayPauseAccessibility() {
        if (btnPP == null) return;
        boolean playing = player != null && player.isPlaying();
        btnPP.setContentDescription(playing ? "Pause" : "Play");
        btnPP.announceForAccessibility(playing ? "Paused" : "Playing");
    }

    private void setButtonAccessibility(View btn, String desc) {
        if (btn == null) return;
        btn.setContentDescription(desc);
        btn.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
    }

    private void setupButtonAccessibility() {
        setButtonAccessibility(btnBack,        "Back");
        setButtonAccessibility(btnPictureMode, "Picture mode");
        setButtonAccessibility(btnSync,        "Audio sync");
        setButtonAccessibility(btnSettings,    "Settings");
        setButtonAccessibility(btnRew,         "Rewind 5 seconds");
        setButtonAccessibility(btnPP,          "Play Pause");
        setButtonAccessibility(btnFfwd,        "Fast forward 10 seconds");
        setButtonAccessibility(btnPrevEp,      "Previous episode");
        setButtonAccessibility(btnNextEp,      "Next episode");
        if (progressBar != null) {
            progressBar.setContentDescription("Seek bar");
            progressBar.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
        }
    }

    private void syncFullscreenIcon() {
        int orientation = getResources().getConfiguration().orientation;
        isFullscreen = (orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE);
        if (btnFullscreen != null) {
            btnFullscreen.setImageResource(
                    isFullscreen ? R.drawable.ic_fullscreen_exit : R.drawable.ic_fullscreen);
        }
        if (playerView != null) {
            // Detect if running on Android TV
            android.app.UiModeManager uiModeManager = (android.app.UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
            boolean isTv = uiModeManager != null && uiModeManager.getCurrentModeType() == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION;

            if (isTv) {
                // TV Default: Fit mode
                playerView.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
                resizeModeIndex = 1;
            } else if (isFullscreen) {
                // Phone Landscape Default: Fill (Netflix style)
                playerView.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FILL);
                resizeModeIndex = 0;
            } else {
                // Phone Portrait Default: Fit
                playerView.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
                resizeModeIndex = 1;
            }
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  loadCurrentEpisode (unchanged logic)
    // ══════════════════════════════════════════════════════════════════════════
    private void loadCurrentEpisode() {
        Log.d("STREAM_FOUND", "URL: " + videoUrl);
        if (player == null || videoUrl == null || videoUrl.isEmpty()) {
            Log.e("PLAYER", "Aborting: videoUrl is empty");
            return;
        }

        // Detect Telegram links
        if (videoUrl.contains("t.me/") || videoUrl.contains("telegram.me/")) {
            resolveAndPlayTelegram();
            return;
        }

        // Detect YouTube links
        if (StreamResolver.isYouTube(videoUrl)) {
            resolveAndPlayYouTube();
            return;
        }

        String resolvedUrl = StreamResolver.resolveStreamUrl(videoUrl);
        Log.d("STREAM_RESOLVED", "URL: " + resolvedUrl);
        setupPlayerWithUrl(resolvedUrl);
    }

    private void resolveAndPlayTelegram() {
        if (progressBar != null) progressBar.setVisibility(View.VISIBLE);

        // KEY INSIGHT: t.me/s/channel/postId exposes the CDN mp4 URL directly in HTML
        // Convert: https://t.me/harimovie2830/11 → https://t.me/s/harimovie2830/11
        String webPreviewUrl = videoUrl
                .replace("https://t.me/", "https://t.me/s/")
                .replace("http://t.me/", "https://t.me/s/");

        // If already has /s/ don't double-add
        if (!webPreviewUrl.contains("t.me/s/")) {
            webPreviewUrl = videoUrl.replace("t.me/", "t.me/s/");
        }

        Log.d("TELEGRAM_RESOLVE", "Fetching: " + webPreviewUrl);

        Request request = new Request.Builder()
                .url(webPreviewUrl)
                .header("User-Agent",
                        "Mozilla/5.0 (Linux; Android 12; Pixel 6) " +
                        "AppleWebKit/537.36 (KHTML, like Gecko) " +
                        "Chrome/120.0.0.0 Mobile Safari/537.36")
                .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                .header("Accept-Language", "en-US,en;q=0.5")
                .build();

        okHttpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(@androidx.annotation.NonNull Call call, @androidx.annotation.NonNull IOException e) {
                Log.e("TELEGRAM_RESOLVE", "Network error: " + e.getMessage());
                runOnUiThread(() -> {
                    if (progressBar != null) progressBar.setVisibility(View.GONE);
                    Toast.makeText(PlayerActivity.this,
                            "Network error loading video", Toast.LENGTH_SHORT).show();
                });
            }

            @Override
            public void onResponse(@androidx.annotation.NonNull Call call, @androidx.annotation.NonNull Response response) throws IOException {
                if (!response.isSuccessful()) {
                    runOnUiThread(() -> attemptFallback(videoUrl));
                    return;
                }
                okhttp3.ResponseBody body = response.body();
                if (body == null) {
                    runOnUiThread(() -> attemptFallback(videoUrl));
                    return;
                }
                String html = body.string();
                Log.d("TELEGRAM_RESOLVE", "Got HTML, length=" + html.length());

                String cdnUrl = extractTelegramCdnUrl(html);

                if (cdnUrl != null) {
                    Log.d("TELEGRAM_RESOLVE", "CDN URL found: " + cdnUrl);
                    runOnUiThread(() -> {
                        if (progressBar != null) progressBar.setVisibility(View.GONE);
                        setupTelegramCdnPlayer(cdnUrl);
                    });
                } else {
                    Log.e("TELEGRAM_RESOLVE", "No CDN URL found in HTML");
                    runOnUiThread(() -> attemptFallback(videoUrl));
                }
            }
        });
    }

    private void resolveAndPlayYouTube() {
        if (progressBar != null) progressBar.setVisibility(View.VISIBLE);
        String videoId = extractYouTubeVideoId(videoUrl);
        if (videoId == null) {
            runOnUiThread(() -> {
                if (progressBar != null) progressBar.setVisibility(View.GONE);
                Toast.makeText(PlayerActivity.this, "Invalid YouTube URL", Toast.LENGTH_SHORT).show();
            });
            return;
        }

        final String finalVideoId = videoId;
        runOnUiThread(() -> {
            isYoutubePlaying = true;
            if (player != null) player.pause();
            if (playerView != null) playerView.setVisibility(View.GONE);
            if (youtubePlayerView != null) {
                youtubePlayerView.setVisibility(View.VISIBLE);
                youtubePlayerView.bringToFront(); // Fix Z-order

                IFramePlayerOptions options = new IFramePlayerOptions.Builder(PlayerActivity.this)
                        .controls(1)
                        .rel(0)
                        .ivLoadPolicy(3)
                        .build();

                youtubePlayerView.initialize(new AbstractYouTubePlayerListener() {
                    @Override
                    public void onReady(@androidx.annotation.NonNull YouTubePlayer youTubePlayer) {
                        activeYoutubePlayer = youTubePlayer;
                        youTubePlayer.loadVideo(finalVideoId, 0);
                        if (progressBar != null) progressBar.setVisibility(View.GONE);
                        updateSeriesUI();
                    }

                    @Override
                    public void onCurrentSecond(@androidx.annotation.NonNull YouTubePlayer youTubePlayer, float second) {
                        youtubeCurrentTime = second;
                    }

                    @Override
                    public void onVideoDuration(@androidx.annotation.NonNull YouTubePlayer youTubePlayer, float duration) {
                        youtubeDuration = duration;
                    }

                    @Override
                    public void onStateChange(@androidx.annotation.NonNull YouTubePlayer youTubePlayer, @androidx.annotation.NonNull PlayerConstants.PlayerState state) {
                        youtubeIsPlaying = (state == PlayerConstants.PlayerState.PLAYING);
                    }

                    @Override
                    public void onError(@androidx.annotation.NonNull YouTubePlayer youTubePlayer, @androidx.annotation.NonNull PlayerConstants.PlayerError error) {
                        Log.e("YOUTUBE", "Player error: " + error.name());
                        // Fallback to WebPlayerActivity on any YouTube error
                        runOnUiThread(() -> {
                            if (progressBar != null) progressBar.setVisibility(View.GONE);
                            Intent intent = new Intent(PlayerActivity.this, WebPlayerActivity.class);
                            intent.putExtra("url", videoUrl);
                            intent.putExtra("title", videoTitle);
                            startActivity(intent);
                            finish();
                        });
                    }
                }, options);
            }
        });
    }

    private String extractYouTubeVideoId(String url) {
        String pattern = "(?<=watch\\?v=|/videos/|embed/|youtu.be/|/v/|/e/|watch\\?v%3D|watch\\?feature=player_embedded&v=|%2Fvideos%2F|embed%2F|youtu.be%2F|%2Fv%2F|/shorts/)[^#&?\\n]*";
        Pattern compiledPattern = Pattern.compile(pattern);
        Matcher matcher = compiledPattern.matcher(url);
        if (matcher.find()) {
            return matcher.group();
        }
        return null;
    }

    private String extractTelegramCdnUrl(String html) {
        // Pattern 1: cdn5.telesco.pe MP4 with token (YOUR CHANNEL'S EXACT FORMAT)
        // Matches: https://cdn5.telesco.pe/file/xxxxx.mp4?token=...
        Pattern p1 = Pattern.compile(
                "(https://cdn\\d*\\.telesco\\.pe/file/[^\\s\"'<>]+\\.mp4[^\\s\"'<>]*)");
        Matcher m1 = p1.matcher(html);
        if (m1.find()) {
            String url = m1.group(1);
            if (url == null) return null;
            // Unescape HTML entities like &amp; → &
            url = url.replace("&amp;", "&");
            return url;
        }

        // Pattern 2: Any video.telegram.org CDN
        Pattern p2 = Pattern.compile(
                "(https://video\\.telegram\\.org/[^\\s\"'<>]+)");
        Matcher m2 = p2.matcher(html);
        if (m2.find()) {
            String g = m2.group(1);
            return g != null ? g.replace("&amp;", "&") : null;
        }

        // Pattern 3: <video src="...">
        Pattern p3 = Pattern.compile("<video[^>]+src=[\"']([^\"']+)[\"']");
        Matcher m3 = p3.matcher(html);
        if (m3.find()) {
            String g = m3.group(1);
            return g != null ? g.replace("&amp;", "&") : null;
        }

        // Pattern 4: <source src="...">
        Pattern p4 = Pattern.compile("<source[^>]+src=[\"']([^\"']+)[\"']");
        Matcher m4 = p4.matcher(html);
        if (m4.find()) {
            String g = m4.group(1);
            return g != null ? g.replace("&amp;", "&") : null;
        }

        return null;
    }

    private void setupTelegramCdnPlayer(String cdnUrl) {
        resumeChecked = false;
        isYoutubePlaying = false;
        if (youtubePlayerView != null) youtubePlayerView.setVisibility(View.GONE);
        if (playerView != null) playerView.setVisibility(View.VISIBLE);

        // telesco.pe CDN requires Referer from t.me
        Map<String, String> headers = new HashMap<>();
        headers.put("User-Agent", "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");
        headers.put("Referer", "https://t.me/");
        headers.put("Origin", "https://t.me");
        requestHeaders.clear();
        requestHeaders.putAll(headers);

        // Update preview retriever for the resolved URL
        if (previewHandler != null) {
            previewHandler.removeCallbacksAndMessages(null);
            final String url = cdnUrl;
            final Map<String, String> finalHeaders = new HashMap<>(requestHeaders);
            previewHandler.post(() -> {
                try {
                    if (retriever != null) retriever.release();
                    retriever = new MediaMetadataRetriever();
                    retriever.setDataSource(url, finalHeaders);
                } catch (Exception e) {
                    Log.e("PREVIEW", "Retriever error: " + e.getMessage());
                }
            });
        }

        DefaultHttpDataSource.Factory dsFactory = new DefaultHttpDataSource.Factory()
                .setUserAgent(
                    "Mozilla/5.0 (Linux; Android 12; Pixel 6) " +
                    "AppleWebKit/537.36 (KHTML, like Gecko) " +
                    "Chrome/120.0.0.0 Mobile Safari/537.36")
                .setAllowCrossProtocolRedirects(true);

        dsFactory.setDefaultRequestProperties(headers);

        // telesco.pe serves plain MP4 files
        MediaSource mediaSource = new ProgressiveMediaSource.Factory(dsFactory)
                .createMediaSource(MediaItem.fromUri(Uri.parse(cdnUrl)));

        player.setMediaSource(mediaSource);
        player.prepare();
        player.play();

        updateSeriesUI();
        fetchSkipTimes();
    }

    private void attemptFallback(String url) {
        if (TelegramManager.INSTANCE.isReady()) {
            // Only use TDLib if logged in
            telegramRepository.resolveLinkToFileIdAsync(url, fileId -> {
                if (fileId != null && fileId != 0) {
                    runOnUiThread(() -> setupPlayerWithTelegram(fileId));
                } else {
                    runOnUiThread(() -> setupPlayerWithUrl(url));
                }
                return Unit.INSTANCE;
            });
        } else {
            runOnUiThread(() -> {
                if (progressBar != null) progressBar.setVisibility(View.GONE);
                Toast.makeText(PlayerActivity.this,
                        "Video is private or unavailable", Toast.LENGTH_LONG).show();
                setupPlayerWithUrl(url);
            });
        }
    }

    private void setupPlayerWithTelegram(int fileId) {
        isYoutubePlaying = false;
        if (youtubePlayerView != null) youtubePlayerView.setVisibility(View.GONE);
        if (playerView != null) playerView.setVisibility(View.VISIBLE);

        TdLibDataSource.Factory factory = new TdLibDataSource.Factory(fileId);
        ProgressiveMediaSource mediaSource = new ProgressiveMediaSource.Factory(factory)
                .createMediaSource(MediaItem.fromUri(videoUrl));
        
        player.setMediaSource(mediaSource);
        player.prepare();
        player.play();
        updateSeriesUI();
        fetchSkipTimes();
    }

    private void setupPlayerWithUrl(String resolvedUrl) {
        resumeChecked = false;
        isYoutubePlaying = false;
        if (youtubePlayerView != null) youtubePlayerView.setVisibility(View.GONE);
        if (playerView != null) playerView.setVisibility(View.VISIBLE);

        Map<String, String> headers = new HashMap<>();
        headers.put("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36");
        headers.put("Referer", "https://dub.onestream.today/");
        headers.put("Cookie",  "cache_2685d8fa2727bff6=1781032689");
        requestHeaders.clear();
        requestHeaders.putAll(headers);

        if (previewHandler != null) {
            previewHandler.removeCallbacksAndMessages(null);
            final Map<String, String> finalHeaders = new HashMap<>(requestHeaders);
            previewHandler.post(() -> {
                try {
                    if (retriever != null) retriever.release();
                    retriever = new MediaMetadataRetriever();
                    retriever.setDataSource(resolvedUrl, finalHeaders);
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
                            "Chrome/148.0.0.0 Safari/537.36")
                        .setAllowCrossProtocolRedirects(true);

        dsFactory.setDefaultRequestProperties(headers);

        MediaSource mediaSource;
        if (StreamResolver.isHls(resolvedUrl)) {
            Log.d("STREAM_TYPE", "HLS Detected");
            mediaSource = new HlsMediaSource.Factory(dsFactory)
                    .setAllowChunklessPreparation(true)
                    .createMediaSource(MediaItem.fromUri(Uri.parse(resolvedUrl)));
        } else if (StreamResolver.isDash(resolvedUrl)) {
            Log.d("STREAM_TYPE", "DASH Detected");
            mediaSource = new DashMediaSource.Factory(dsFactory)
                    .createMediaSource(MediaItem.fromUri(Uri.parse(resolvedUrl)));
        } else {
            Log.d("STREAM_TYPE", "Progressive Detected");
            mediaSource = new ProgressiveMediaSource.Factory(dsFactory)
                    .createMediaSource(MediaItem.fromUri(Uri.parse(resolvedUrl)));
        }

        player.setMediaSource(mediaSource);
        player.prepare();
        player.play();
        Log.d("STREAM_PLAYING", "URL: " + resolvedUrl);

        updateSeriesUI();
        fetchSkipTimes();
    }

    private void updateSeriesUI() {
        Log.d("EP_DEBUG", "Current episode index = " + currentIndex);

        String badge = "";
        if (!playlist.isEmpty()) {
            try {
                if (currentIndex >= 0 && currentIndex < playlist.size()) {
                    JSONObject current = playlist.get(currentIndex);
                    String epNum = current.optString("episode", "");
                    String seasonNum = current.optString("season", "");
                    if (!seasonNum.isEmpty() && !epNum.isEmpty()) {
                        badge = String.format(Locale.US, "Season %s · Episode %s", seasonNum, epNum);
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

        if (tvTitle != null) {
            if (!playlist.isEmpty() && !seriesTitle.isEmpty()) {
                tvTitle.setText(seriesTitle);
            } else {
                tvTitle.setText(videoTitle);
            }
        }

        if (tvTitleSep != null) tvTitleSep.setVisibility(!badge.isEmpty() ? View.VISIBLE : View.GONE);
        if (tvEpBadge != null) {
            if (!badge.isEmpty()) {
                tvEpBadge.setText(badge);
                tvEpBadge.setVisibility(View.VISIBLE);
                tvEpBadge.setTextColor(0xAAFFFFFF);
            } else {
                tvEpBadge.setVisibility(View.GONE);
            }
        }

        if (playlist.size() <= 1) {
            if (btnNextEp != null) btnNextEp.setVisibility(View.GONE);
            if (btnPrevEp != null) btnPrevEp.setVisibility(View.GONE);
            if (episodeBar != null) episodeBar.setVisibility(View.GONE);
            buildRowArrays();
            return;
        }

        boolean hasNext = currentIndex < playlist.size() - 1;
        boolean hasPrev = currentIndex > 0;
        if (btnNextEp != null) btnNextEp.setVisibility(hasNext ? View.VISIBLE : View.GONE);
        if (btnPrevEp != null) btnPrevEp.setVisibility(hasPrev ? View.VISIBLE : View.GONE);

        if (episodeBar != null) {
            if (controlsVisible) {
                episodeBar.setVisibility(View.VISIBLE);
                episodeBar.setAlpha(1.0f);
                episodeBar.bringToFront();
            } else {
                episodeBar.setVisibility(View.GONE);
            }
        }

        buildRowArrays();
        buildEpisodeList();
    }

    private void fetchSkipTimes() {
        if (!isAniSkipEnabled || seriesTitle == null || seriesTitle.isEmpty()) return;

        introStartMs = -1;
        introEndMs = -1;

        int episodeNumber = 1;
        if (!playlist.isEmpty() && currentIndex >= 0 && currentIndex < playlist.size()) {
            try {
                JSONObject current = playlist.get(currentIndex);
                String epNum = current.optString("episode", "");
                if (!epNum.isEmpty()) {
                    episodeNumber = Integer.parseInt(epNum);
                } else {
                    episodeNumber = currentIndex + 1;
                }
            } catch (Exception e) {
                episodeNumber = currentIndex + 1;
            }
        }

        final int finalEpisodeNumber = episodeNumber;
        final String query = "query ($search: String) { Media (search: $search, type: ANIME) { idMal } }";

        try {
            JSONObject json = new JSONObject();
            json.put("query", query);
            JSONObject variables = new JSONObject();
            variables.put("search", seriesTitle);
            json.put("variables", variables);

            okhttp3.RequestBody body = okhttp3.RequestBody.create(
                    okhttp3.MediaType.parse("application/json; charset=utf-8"),
                    json.toString());

            Request request = new Request.Builder()
                    .url("https://graphql.anilist.co")
                    .post(body)
                    .build();

            okHttpClient.newCall(request).enqueue(new Callback() {
                @Override
                public void onFailure(@androidx.annotation.NonNull Call call, @androidx.annotation.NonNull IOException e) {
                    Log.e("ANISKIP", "AniList search failed", e);
                }

                @Override
                public void onResponse(@androidx.annotation.NonNull Call call, @androidx.annotation.NonNull Response response) throws IOException {
                    if (!response.isSuccessful()) return;
                    try {
                        String respStr = response.body().string();
                        JSONObject respJson = new JSONObject(respStr);
                        JSONObject data = respJson.optJSONObject("data");
                        if (data == null) return;
                        JSONObject media = data.optJSONObject("Media");
                        if (media == null) return;
                        int malId = media.optInt("idMal", 0);
                        if (malId > 0) {
                            fetchAniSkipData(malId, finalEpisodeNumber);
                        }
                    } catch (Exception e) {
                        Log.e("ANISKIP", "AniList response parse error", e);
                    }
                }
            });
        } catch (Exception e) {
            Log.e("ANISKIP", "AniList request build error", e);
        }
    }

    private void fetchAniSkipData(int malId, int episode) {
        String url = String.format(Locale.US, "https://api.aniskip.com/v2/skip-times/%d/%d?types[]=op", malId, episode);

        Request request = new Request.Builder().url(url).build();
        okHttpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(@androidx.annotation.NonNull Call call, @androidx.annotation.NonNull IOException e) {
                Log.e("ANISKIP", "AniSkip request failed", e);
            }

            @Override
            public void onResponse(@androidx.annotation.NonNull Call call, @androidx.annotation.NonNull Response response) throws IOException {
                if (!response.isSuccessful()) return;
                try {
                    String respStr = response.body().string();
                    JSONObject respJson = new JSONObject(respStr);
                    if (respJson.optBoolean("found", false)) {
                        JSONArray results = respJson.getJSONArray("results");
                        for (int i = 0; i < results.length(); i++) {
                            JSONObject res = results.getJSONObject(i);
                            if ("op".equals(res.optString("skipType"))) {
                                JSONObject interval = res.getJSONObject("interval");
                                introStartMs = (long) (interval.getDouble("startTime") * 1000);
                                introEndMs = (long) (interval.getDouble("endTime") * 1000);
                                Log.d("ANISKIP", "Found OP: " + introStartMs + " - " + introEndMs);
                                break;
                            }
                        }
                    }
                } catch (Exception e) {
                    Log.e("ANISKIP", "AniSkip response parse error", e);
                }
            }
        });
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Episode list — uses recycler-style view pool to handle 1000+ episodes
    //  without lag. Uses fixed-size buttons in a HorizontalScrollView.
    //  For truly large lists (>200), consider switching episodeContainer to
    //  a horizontal RecyclerView with a LinearLayoutManager.
    // ══════════════════════════════════════════════════════════════════════════
    private void buildEpisodeList() {
        if (episodeContainer == null) return;
        episodeContainer.removeAllViews();

        for (int i = 0; i < playlist.size(); i++) {
            final int index = i;
            Button btn = new Button(this);
            btn.setText(String.valueOf(i + 1));
            btn.setFocusable(true);
            btn.setFocusableInTouchMode(false); // TV: no touch mode focus
            btn.setTextSize(11);
            btn.setAllCaps(false);
            btn.setContentDescription("Episode " + (i + 1));
            btn.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);

            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(56), dp(28));
            lp.setMargins(dp(2), 0, dp(2), 0);
            btn.setLayoutParams(lp);
            btn.setPadding(dp(8), 0, dp(8), 0);

            applyEpisodeBtnStyle(btn, i);

            btn.setOnClickListener(v -> {
                btn.announceForAccessibility("Playing episode " + (index + 1));
                playEpisode(index);
            });

            btn.setOnFocusChangeListener((v, hasFocus) -> {
                if (hasFocus) {
                    episodeFocusIndex = index;
                    btn.animate().scaleX(1.15f).scaleY(1.15f)
                            .setDuration(150).setInterpolator(new AccelerateDecelerateInterpolator()).start();
                    btn.setElevation(dp(4));
                    scrollEpisodeIntoView(index);
                    resetAutoHide();
                } else {
                    btn.animate().scaleX(1.0f).scaleY(1.0f)
                            .setDuration(150).setInterpolator(new AccelerateDecelerateInterpolator()).start();
                    btn.setElevation(0f);
                    applyEpisodeBtnStyle(btn, index);
                }
            });

            episodeContainer.addView(btn);
        }
    }

    private void applyEpisodeBtnStyle(Button btn, int index) {
        if (index == currentIndex) {
            btn.setBackgroundResource(R.drawable.bg_episode_active);
            btn.setTextColor(0xFF000000);
        } else {
            btn.setBackgroundResource(R.drawable.bg_segmented_item);
            btn.setTextColor(0xFFFFFFFF);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  playEpisode (unchanged logic, preserved exactly)
    // ══════════════════════════════════════════════════════════════════════════
    private void playEpisode(int index) {
        if (index < 0 || index >= playlist.size()) return;
        try {
            JSONObject ep = playlist.get(index);
            String epUrl   = ep.optString("link", "");
            String epTitle = ep.optString("title", "");

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

            JSONArray arr = new JSONArray();
            for (JSONObject item : playlist) arr.put(item);
            String playlistStr = arr.toString();

            Log.d("SERIES_DEBUG", "playEpisode: index=" + index + " url=" + epUrl);

            Intent intent;
            if (StreamResolver.isDirectStream(epUrl) || StreamResolver.isHls(epUrl) || StreamResolver.isDash(epUrl) || StreamResolver.isYouTube(epUrl)) {
                Log.d("SERIES_DEBUG", "Route: DIRECT → PlayerActivity");
                intent = new Intent(this, PlayerActivity.class);
                intent.putExtra(PlayerActivity.EXTRA_URL, epUrl);
                intent.putExtra(PlayerActivity.EXTRA_TITLE, epTitle);
                intent.putExtra(PlayerActivity.EXTRA_SERIES_TITLE, seriesTitle);
            } else {
                Log.d("SERIES_DEBUG", "Route: IFRAME → WebPlayerActivity");
                intent = new Intent(this, WebPlayerActivity.class);
                intent.putExtra("url", epUrl);
                intent.putExtra("title", epTitle);
                intent.putExtra("series_title", seriesTitle);
            }

            saveLastWatchedEpisode(index);
            intent.putExtra("playlist", playlistStr);
            intent.putExtra("index", index);
            startActivity(intent);
            finish();
        } catch (Exception e) {
            Log.e("SERIES_DEBUG", "Episode switch failed", e);
        }
    }

    private void saveLastWatchedEpisode(int index) {
        try {
            if (playlist.isEmpty() || index < 0 || index >= playlist.size()) return;
            JSONObject ep = playlist.get(index);
            String season = ep.optString("season", "").trim();
            if (season.isEmpty() || season.equals("0")) season = "1";
            
            String episode = ep.optString("episode", "").trim();
            if (episode.isEmpty()) {
                episode = String.valueOf(index + 1);
            }

            String episodeId = ep.optString("id", "");
            String normalizedTitle = seriesTitle.toLowerCase().trim();
            String key = normalizedTitle + "_s" + season;
            
            JSONObject data = new JSONObject();
            data.put("episodeNum", episode);
            data.put("episodeId", episodeId);
            
            // Log for debugging
            Log.d("LASTWATCH", "Saving for " + key + " -> " + data.toString());

            getSharedPreferences("hm_last_watched", MODE_PRIVATE)
                    .edit()
                    .putString(key, data.toString())
                    .apply();
            
            Log.d("LASTWATCH", "Saved successfully");
        } catch (Exception e) {
            Log.e("LASTWATCH", "Save failed", e);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Resume position storage (unchanged)
    // ══════════════════════════════════════════════════════════════════════════
    private String posKey() {
        if (!playlist.isEmpty() && currentIndex >= 0 && currentIndex < playlist.size()) {
            try {
                JSONObject current = playlist.get(currentIndex);
                String epRef = current.optString("id",
                            current.optString("link",
                            current.optString("episode", String.valueOf(currentIndex))));
                String base = (seriesTitle != null && !seriesTitle.isEmpty()) ? seriesTitle : videoUrl;
                return "pos_" + Math.abs(base.hashCode()) + "_ep_" + epRef;
            } catch (Exception ignored) {}
        }
        // Fallback for single videos or empty playlists: combine series and full title/URL to ensure uniqueness
        String base = (seriesTitle != null && !seriesTitle.isEmpty()) ? seriesTitle : "";
        String unique = (videoTitle != null && !videoTitle.isEmpty()) ? videoTitle : videoUrl;
        return "pos_" + Math.abs(base.hashCode()) + "_" + Math.abs(unique.hashCode());
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
        return getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getLong(posKey(), 0L);
    }

    private void clearSavedPosition() {
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().remove(posKey()).apply();
    }

    private void checkResumePosition() {
        long saved = getSavedPosition();
        if (saved > 10000) {
            player.pause();
            showResumeOverlay(saved);
        } else {
            clearSavedPosition();
            player.play();
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Resume overlay (TV-optimized focus)
    // ══════════════════════════════════════════════════════════════════════════
    private void buildResumeOverlay() {
        FrameLayout root = findViewById(android.R.id.content);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER);
        card.setBackgroundColor(0xEE1A1A2E);
        card.setPadding(dp(32), dp(28), dp(32), dp(28));
        card.setFocusable(false);

        FrameLayout.LayoutParams cardLp = new FrameLayout.LayoutParams(dp(340), FrameLayout.LayoutParams.WRAP_CONTENT);
        cardLp.gravity = Gravity.CENTER;
        card.setLayoutParams(cardLp);
        card.setElevation(dp(8));

        TextView tvDialogTitle = new TextView(this);
        tvDialogTitle.setText(R.string.continue_watching);
        tvDialogTitle.setTextColor(0xFFFFFFFF);
        tvDialogTitle.setTextSize(18);
        tvDialogTitle.setTypeface(null, android.graphics.Typeface.BOLD);
        tvDialogTitle.setGravity(Gravity.CENTER);
        card.addView(tvDialogTitle);

        tvResumeTime = new TextView(this);
        tvResumeTime.setTextColor(0xAAFFFFFF);
        tvResumeTime.setTextSize(13);
        tvResumeTime.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams subLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        subLp.setMargins(0, dp(8), 0, dp(20));
        tvResumeTime.setLayoutParams(subLp);
        card.addView(tvResumeTime);

        TextView tvHint = new TextView(this);
        tvHint.setText(R.string.resume_hint);
        tvHint.setTextColor(0x88FFFFFF);
        tvHint.setTextSize(11);
        tvHint.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams hintLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        hintLp.setMargins(0, 0, 0, dp(16));
        tvHint.setLayoutParams(hintLp);
        card.addView(tvHint);

        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        btnRow.setGravity(Gravity.CENTER);

        btnResume    = makeDialogButton("▶  Resume", true);
        btnStartOver = makeDialogButton("↺  Start Over", false);

        btnResume.setContentDescription("Resume from saved position");
        btnStartOver.setContentDescription("Start over from beginning");
        btnResume.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
        btnStartOver.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);

        LinearLayout.LayoutParams btnLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        btnLp.setMargins(0, 0, dp(8), 0);
        btnResume.setLayoutParams(btnLp);
        btnStartOver.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        btnRow.addView(btnResume);
        btnRow.addView(btnStartOver);
        card.addView(btnRow);

        FrameLayout overlayContainer = new FrameLayout(this);
        overlayContainer.setBackgroundColor(0xAA000000);
        overlayContainer.setVisibility(View.GONE);
        overlayContainer.addView(card);
        resumeOverlay = overlayContainer;

        root.addView(resumeOverlay, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

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
        btn.setFocusable(true);
        btn.setFocusableInTouchMode(true);
        return btn;
    }

    private void showResumeOverlay(long savedMs) {
        this.currentSavedPos = savedMs;
        resumeShowing  = true;
        resumeFocusCol = 0;
        resumeOverlay.setVisibility(View.VISIBLE);
        btnResume.requestFocus();
        if (tvResumeTime != null) tvResumeTime.setText(getString(R.string.paused_at, fmt(savedMs / 1000)));
        updateResumeHighlight();
        resumeOverlay.announceForAccessibility("Continue watching dialog. Paused at " + fmt(savedMs / 1000));
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
        if (player != null) { player.seekTo(currentSavedPos); player.play(); }
        showControls();
    }

    private void doStartOver() {
        clearSavedPosition();
        hideResumeOverlay();
        if (player != null) { player.seekTo(0); player.play(); }
        showControls();
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  A/V Sync Dialog (unchanged)
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

        FrameLayout.LayoutParams cardLp = new FrameLayout.LayoutParams(dp(320), FrameLayout.LayoutParams.WRAP_CONTENT);
        cardLp.gravity = Gravity.CENTER;
        card.setLayoutParams(cardLp);
        card.setElevation(dp(8));

        TextView tvDialogTitle = new TextView(this);
        tvDialogTitle.setText(R.string.sync_adjust);
        tvDialogTitle.setTextColor(0xFFFFFFFF);
        tvDialogTitle.setTextSize(17);
        tvDialogTitle.setTypeface(null, android.graphics.Typeface.BOLD);
        tvDialogTitle.setGravity(Gravity.CENTER);
        card.addView(tvDialogTitle);

        final TextView tvOffset = new TextView(this);
        tvOffset.setTextColor(0xAAFFFFFF);
        tvOffset.setTextSize(13);
        tvOffset.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams offLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        offLp.setMargins(0, dp(8), 0, dp(4));
        tvOffset.setLayoutParams(offLp);

        TextView tvHint = new TextView(this);
        tvHint.setTextColor(0x88FFFFFF);
        tvHint.setTextSize(11);
        tvHint.setGravity(Gravity.CENTER);
        tvHint.setText(R.string.sync_hint);
        LinearLayout.LayoutParams hintLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        hintLp.setMargins(0, 0, 0, dp(14));
        tvHint.setLayoutParams(hintLp);

        final SeekBar seekBar = new SeekBar(this);
        seekBar.setMax(4000);
        int currentProgress = (int)(audioOffsetUs / 1000L) + 2000;
        seekBar.setProgress(currentProgress);
        seekBar.getProgressDrawable().setColorFilter(0xFFE50914, android.graphics.PorterDuff.Mode.SRC_IN);
        seekBar.getThumb().setColorFilter(0xFFE50914, android.graphics.PorterDuff.Mode.SRC_IN);

        LinearLayout.LayoutParams sbLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        sbLp.setMargins(0, 0, 0, dp(6));
        seekBar.setLayoutParams(sbLp);

        LinearLayout rangeRow = new LinearLayout(this);
        rangeRow.setOrientation(LinearLayout.HORIZONTAL);
        rangeRow.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        TextView tvMin = new TextView(this); tvMin.setText(R.string.sync_min); tvMin.setTextColor(0x88FFFFFF); tvMin.setTextSize(10);
        TextView tvMid = new TextView(this); tvMid.setText(R.string.sync_mid);       tvMid.setTextColor(0x88FFFFFF); tvMid.setTextSize(10); tvMid.setGravity(Gravity.CENTER);
        TextView tvMax2 = new TextView(this); tvMax2.setText(R.string.sync_max); tvMax2.setTextColor(0x88FFFFFF); tvMax2.setTextSize(10); tvMax2.setGravity(Gravity.END);
        LinearLayout.LayoutParams maxLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        maxLp.setMargins(0, 0, 0, dp(14));
        rangeRow.addView(tvMin,  new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        rangeRow.addView(tvMid,  new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        rangeRow.addView(tvMax2, maxLp);

        Runnable updateLabel = () -> {
            long ms = seekBar.getProgress() - 2000;
            tvOffset.setText(getString(R.string.sync_offset, ms >= 0 ? "+" : "", ms));
        };
        updateLabel.run();
        seekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar sb, int progress, boolean fromUser) { updateLabel.run(); }
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

        LinearLayout.LayoutParams b1 = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        b1.setMargins(0, 0, dp(8), 0);
        btnReset.setLayoutParams(b1);
        btnApply.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        btnRow.addView(btnReset);
        btnRow.addView(btnApply);
        card.addView(btnRow);
        overlay.addView(card);

        root.addView(overlay, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        btnApply.setOnClickListener(v -> {
            long ms = seekBar.getProgress() - 2000;
            audioOffsetUs = ms * 1000L;
            applyAudioOffset();
            root.removeView(overlay);
            // Restore focus after dialog dismissed
            if (controlsVisible) restoreLastFocus();
        });
        btnReset.setOnClickListener(v -> {
            seekBar.setProgress(2000);
            audioOffsetUs = 0L;
            applyAudioOffset();
            root.removeView(overlay);
            if (controlsVisible) restoreLastFocus();
        });
        overlay.setOnClickListener(v -> {
            root.removeView(overlay);
            if (controlsVisible) restoreLastFocus();
        });
        card.setOnClickListener(v -> { /* consume */ });

        btnApply.requestFocus();
    }

    private void showTrackSelectionDialog() {
        if (player == null) return;
        TrackSelectionDialog dialog = TrackSelectionDialog.newInstance(player, null);
        dialog.show(getSupportFragmentManager(), "TrackSelectionDialog");
    }

    private void applyAudioOffset() {
        if (player == null || delayAudioProcessor == null) return;
        try {
            delayAudioProcessor.setDelayUs(audioOffsetUs);
            player.seekTo(player.getCurrentPosition());

            String msg = audioOffsetUs == 0
                    ? "A/V Sync reset"
                    : "A/V Sync: " + (audioOffsetUs > 0 ? "+" : "") + (audioOffsetUs / 1000) + " ms";
            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Log.e("AVSYNC", "applyAudioOffset failed: " + e.getMessage());
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Preview retriever (unchanged logic)
    // ══════════════════════════════════════════════════════════════════════════
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
                public void onScrubStart(@androidx.annotation.NonNull TimeBar timeBar, long position) {
                    isSeeking = true;
                    autoHideHandler.removeCallbacks(autoHideRunnable); // don't hide while seeking
                    if (previewContainer != null) previewContainer.setVisibility(View.VISIBLE);
                    updatePreviewFrame(position);
                }
                @Override
                public void onScrubMove(@androidx.annotation.NonNull TimeBar timeBar, long position) {
                    updatePreviewFrame(position);
                }
                @Override
                public void onScrubStop(@androidx.annotation.NonNull TimeBar timeBar, long position, boolean canceled) {
                    isSeeking = false;
                    if (previewContainer != null) previewContainer.setVisibility(View.GONE);
                    scheduleHide();
                }
            });
        }
    }

    private void updatePreviewFrame(long positionMs) {
        if (previewTimeText != null) {
            long dur = player != null ? player.getDuration() : 0;
            String current = fmt(positionMs / 1000);
            if (dur > 0) {
                previewTimeText.setText(getString(R.string.preview_time_format, current, fmt(dur / 1000)));
            } else {
                previewTimeText.setText(current);
            }
        }

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

        if (lastPreviewPos != -1 && Math.abs(lastPreviewPos - positionMs) > 2000) {
             if (previewImage != null) previewImage.setAlpha(0.5f); // Dim while searching far away
        }

        lastPreviewPos = positionMs;
        if (!isPreviewLoading && retriever != null) fetchNextPreviewFrame();
    }

    private void fetchNextPreviewFrame() {
        if (lastPreviewPos == -1 || retriever == null || previewHandler == null) return;
        final long posUs = lastPreviewPos * 1000L;
        isPreviewLoading = true;
        previewHandler.post(() -> {
            try {
                Bitmap bmp;
                // Use OPTION_CLOSEST_SYNC for speed; on some devices OPTION_PREVIOUS_SYNC is even faster for remote streams
                int option = MediaMetadataRetriever.OPTION_CLOSEST_SYNC;

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                    bmp = retriever.getScaledFrameAtTime(posUs, option, 240, 135);
                } else {
                    bmp = retriever.getFrameAtTime(posUs, option);
                }

                if (bmp != null) {
                    runOnUiThread(() -> {
                        if (previewImage != null) {
                            previewImage.setImageBitmap(bmp);
                            previewImage.setAlpha(1.0f);
                        }
                    });
                }
            } catch (Exception e) {
                // If it fails, it might be due to HLS or unsupported format for frame extraction
                Log.e("PREVIEW", "Frame fetch error at " + posUs + "us: " + e.getMessage());
            } finally {
                isPreviewLoading = false;
                runOnUiThread(() -> {
                    // If the user moved more than 500ms while we were loading, fetch again
                    if (Math.abs(lastPreviewPos * 1000L - posUs) > 500000L) {
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
        String lower = title.toLowerCase();
        int epIdx = lower.indexOf(" episode");
        int seaIdx = lower.indexOf(" season");
        int cutIdx = -1;
        if (epIdx != -1 && seaIdx != -1) cutIdx = Math.min(epIdx, seaIdx);
        else if (epIdx != -1) cutIdx = epIdx;
        else if (seaIdx != -1) cutIdx = seaIdx;
        if (cutIdx != -1) {
            return title.substring(0, cutIdx).replaceAll("\\s*[\\u00B7\\u2022\\u2013\\u2014\\-|:]\\s*$", "").trim();
        }
        String[] separators = {" · ", " - ", " | ", " — ", " – "};
        for (String sep : separators) {
            int idx = title.indexOf(sep);
            if (idx != -1) return title.substring(0, idx).trim();
        }
        return title;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Find views + accessibility setup
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
        btnLock             = findViewById(R.id.btn_lock);
        tvLockHint          = findViewById(R.id.tv_lock_hint);

        btnBack             = playerView.findViewById(R.id.btn_back);
        btnPictureMode      = playerView.findViewById(R.id.btn_picture_mode);
        btnFullscreen       = playerView.findViewById(R.id.btn_fullscreen);
        if (btnFullscreen != null) btnFullscreen.setImageResource(R.drawable.ic_fullscreen_exit);
        btnSync             = playerView.findViewById(R.id.btn_sync);
        btnSettings         = playerView.findViewById(R.id.btn_settings);

        btnRew              = playerView.findViewById(R.id.exo_rew);
        btnPP               = playerView.findViewById(R.id.exo_play_pause);
        btnFfwd             = playerView.findViewById(R.id.exo_ffwd);
        btnNextEp           = playerView.findViewById(R.id.btn_next_ep);
        btnPrevEp           = playerView.findViewById(R.id.btn_prev_ep);

        tvEpBadge           = playerView.findViewById(R.id.mp_ep_badge);
        episodeBar          = playerView.findViewById(R.id.episode_bar);
        episodeContainer    = playerView.findViewById(R.id.episode_container);
        tvTitle             = playerView.findViewById(R.id.tv_title);
        tvTitleSep          = playerView.findViewById(R.id.tv_title_sep);

        progressBar         = playerView.findViewById(R.id.exo_progress);
        previewContainer    = playerView.findViewById(R.id.preview_container);
        previewImage        = playerView.findViewById(R.id.preview_image);
        previewTimeText     = playerView.findViewById(R.id.preview_time);

        // Reset auto-hide when interacting with episodes
        if (episodeBar != null) {
            episodeBar.setOnTouchListener((v, event) -> {
                resetAutoHide();
                return false; // don't consume, allow scrolling
            });
        }

        btnSkipIntro        = playerView.findViewById(R.id.btn_skip_intro);
        if (btnSkipIntro != null) {
            btnSkipIntro.setVisibility(View.GONE);
            btnSkipIntro.setOnClickListener(v -> {
                if (player != null && introEndMs > 0) {
                    player.seekTo(introEndMs);
                    btnSkipIntro.setVisibility(View.GONE);
                }
            });
        }

        // Optional: current/remaining time labels (add to layout if desired)
        tvCurrentTime       = playerView.findViewById(R.id.tv_current_time);
        tvRemainingTime     = playerView.findViewById(R.id.tv_remaining_time);

        // Disable system focus traversal — we manage it manually for TV
        disableSystemFocusTraversal();
        setupButtonAccessibility();
    }

    /**
     * Disable Android's automatic focus traversal on all player controls.
     * We drive focus entirely through onKeyDown() so the remote never gets
     * "lost" between buttons or jumps to unexpected views.
     */
    private void disableSystemFocusTraversal() {
        View[] allButtons = { btnBack, btnPictureMode, btnFullscreen, btnSync, btnSettings,
                              btnRew, btnPP, btnFfwd, btnNextEp, btnPrevEp };
        for (View v : allButtons) {
            if (v == null) continue;
            v.setFocusable(true);
            v.setFocusableInTouchMode(false);
            // Remove next-focus IDs so system doesn't traverse; we handle it
            v.setNextFocusUpId(v.getId());
            v.setNextFocusDownId(v.getId());
            v.setNextFocusLeftId(v.getId());
            v.setNextFocusRightId(v.getId());
        }
        if (progressBar != null) {
            progressBar.setFocusable(true);
            progressBar.setFocusableInTouchMode(false);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  FOCUS MANAGEMENT — Netflix-style, no overshoot, no focus loss
    // ══════════════════════════════════════════════════════════════════════════

    /** Save current position before opening a dialog or overlay */
    private void saveLastFocus() {
        lastFocusRow = focusRow;
        lastFocusCol = focusCol;
    }

    /** Restore focus after a dialog/overlay is dismissed */
    private void restoreLastFocus() {
        focusRow = lastFocusRow;
        focusCol = lastFocusCol;
        updateFocusHighlight();
    }

    /** Reset auto-hide timer on any remote interaction */
    private void resetAutoHide() {
        if (player != null && player.isPlaying()) {
            scheduleHide();
        }
    }

    private void updateFocusHighlight() {
        // Clear all highlights first
        View[] allButtons = { btnBack, btnPictureMode, btnSync, btnSettings,
                              btnRew, btnPP, btnFfwd, btnNextEp, btnPrevEp };
        for (View v : allButtons) clearHighlight(v);

        // Seekbar state
        if (progressBar != null) {
            if (focusRow == 2) {
                progressBar.setScaleY(2.2f);
                progressBar.setAlpha(1f);
                if (previewContainer != null) previewContainer.setVisibility(View.VISIBLE);
                updatePreviewFrame(player != null ? player.getCurrentPosition() : 0);
            } else {
                progressBar.setScaleY(1f);
                progressBar.setAlpha(0.6f);
                if (!isSeeking && previewContainer != null) previewContainer.setVisibility(View.GONE);
            }
        }

        // Episode row
        if (episodeContainer != null) {
            for (int i = 0; i < episodeContainer.getChildCount(); i++) {
                View child = episodeContainer.getChildAt(i);
                if (!(child instanceof Button b)) continue;
                if (focusRow == 3 && i == episodeFocusIndex) {
                    b.animate().scaleX(1.15f).scaleY(1.15f).setDuration(150).start();
                    b.setElevation(dp(4));
                } else {
                    b.animate().scaleX(1f).scaleY(1f).setDuration(150).start();
                    b.setElevation(0f);
                    applyEpisodeBtnStyle(b, i);
                }
            }
        }

        // Apply highlight to active button
        if (focusRow == 0) {
            View target = safeGet(topRowButtons, focusCol);
            applyHighlight(target);
            if (target != null) announceButtonFocus(target);
        } else if (focusRow == 1) {
            // Clamp focusCol to visible buttons
            focusCol = clampCenterCol(focusCol);
            View target = safeGet(centerRowButtons, focusCol);
            applyHighlight(target);
            if (target != null) announceButtonFocus(target);
        }
    }

    private void announceButtonFocus(View v) {
        if (v == null) return;
        CharSequence desc = v.getContentDescription();
        if (!TextUtils.isEmpty(desc)) {
            v.announceForAccessibility(desc);
        }
    }

    /** Returns row 1 focusCol clamped to visible buttons */
    private int clampCenterCol(int col) {
        if (col == 0 && (btnPrevEp == null || btnPrevEp.getVisibility() != View.VISIBLE)) col = 1;
        if (col == 4 && (btnNextEp == null || btnNextEp.getVisibility() != View.VISIBLE)) col = 3;
        return Math.max(0, Math.min(4, col));
    }

    private View safeGet(View[] arr, int idx) {
        if (arr == null || idx < 0 || idx >= arr.length) return null;
        return arr[idx];
    }

    /**
     * Netflix-style focus feedback using TvFocusAnimator.
     */
    private void applyHighlight(View v) {
        if (v == null || v.getVisibility() != View.VISIBLE) return;
        TvFocusAnimator.animate(v, true, getResources().getDisplayMetrics().density);
    }

    private void clearHighlight(View v) {
        if (v == null) return;
        TvFocusAnimator.animate(v, false, getResources().getDisplayMetrics().density);
    }

    private void activateFocused() {
        scheduleHide();
        if (focusRow == 0) {
            switch (focusCol) {
                case 0: performBackAction(); break;
                case 1: if (btnPictureMode != null) btnPictureMode.performClick(); break;
                case 2: if (btnFullscreen  != null) btnFullscreen.performClick();  break;
                case 3: if (btnSync        != null) { saveLastFocus(); btnSync.performClick(); } break;
                case 4: if (btnSettings    != null) { saveLastFocus(); btnSettings.performClick(); } break;
            }
        } else if (focusRow == 1) {
            switch (clampCenterCol(focusCol)) {
                case 0: if (btnPrevEp != null) btnPrevEp.performClick(); break;
                case 1: fastSeek(-5_000); break;
                case 2:
                    if (isYoutubePlaying && activeYoutubePlayer != null) {
                        if (youtubeIsPlaying) activeYoutubePlayer.pause(); else activeYoutubePlayer.play();
                    } else if (player != null) {
                        if (player.isPlaying()) player.pause(); else player.play();
                    }
                    animatePlayPause();
                    updatePlayPauseAccessibility();
                    break;
                case 3: fastSeek(10_000); break;
                case 4: if (btnNextEp != null) btnNextEp.performClick(); break;
            }
        } else if (focusRow == 2) {
            // Center on seekbar: seek to preview position
            if (player != null && lastPreviewPos >= 0) player.seekTo(lastPreviewPos);
        } else if (focusRow == 3) {
            playEpisode(episodeFocusIndex);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  TV Remote / D-pad — fixed hierarchy, never loses focus
    // ══════════════════════════════════════════════════════════════════════════
    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
            continuousSeekDirection = 0;
            continuousSeekHandler.removeCallbacks(continuousSeekRunnable);
        }
        return super.onKeyUp(keyCode, event);
    }

    @Override
    public boolean onKeyLongPress(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT) {
            continuousSeekDirection = -1;
            continuousSeekHandler.post(continuousSeekRunnable);
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
            continuousSeekDirection = 1;
            continuousSeekHandler.post(continuousSeekRunnable);
            return true;
        }
        return super.onKeyLongPress(keyCode, event);
    }

    @Override
    @android.annotation.SuppressLint("GestureBackNavigation")
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (player == null) return super.onKeyDown(keyCode, event);

        // 1. Always reset auto-hide on ANY key press for remote stability
        if (controlsVisible) resetAutoHide();

        // 2. Volume keys (blocked in lock mode)
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
            if (isLocked) { showLockUI(); return true; }
            audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC,
                    AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI); return true;
        }
        if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            if (isLocked) { showLockUI(); return true; }
            audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC,
                    AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI); return true;
        }

        // 3. Back Button Management
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (resumeShowing) {
                hideResumeOverlay();
                return true;
            }
            if (controlsVisible) {
                hideControls();
                return true;
            }
            // Allow default back action (exit) if controls are already hidden
            return super.onKeyDown(keyCode, event);
        }

        // 4. Menu / Info / Settings keys
        if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_INFO || keyCode == KeyEvent.KEYCODE_M) {
            if (isLocked) { showLockUI(); return true; }
            if (!controlsVisible) {
                showControls();
                focusRow = 0; focusCol = 4; // Focus settings
                updateFocusHighlight();
            } else {
                hideControls();
            }
            return true;
        }

        // 5. Media keys
        if (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || keyCode == KeyEvent.KEYCODE_HEADSETHOOK
                || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY || keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE) {
            if (isLocked) { showLockUI(); return true; }
            if (isYoutubePlaying && activeYoutubePlayer != null) {
                if (youtubeIsPlaying) activeYoutubePlayer.pause(); else activeYoutubePlayer.play();
            } else if (player != null) {
                if (player.isPlaying()) player.pause(); else player.play();
            }
            animatePlayPause(); updatePlayPauseAccessibility(); return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_REWIND || keyCode == KeyEvent.KEYCODE_MEDIA_SKIP_BACKWARD) {
            if (isLocked) { showLockUI(); return true; } fastSeek(-5_000); return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD || keyCode == KeyEvent.KEYCODE_MEDIA_SKIP_FORWARD) {
            if (isLocked) { showLockUI(); return true; } fastSeek(10_000);  return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_NEXT) {
            if (isLocked) { showLockUI(); return true; } if (btnNextEp != null) btnNextEp.performClick(); return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_PREVIOUS) {
            if (isLocked) { showLockUI(); return true; } if (btnPrevEp != null) btnPrevEp.performClick(); return true;
        }

        // Resume overlay intercepts all nav
        if (resumeShowing) {
            switch (keyCode) {
                case KeyEvent.KEYCODE_DPAD_LEFT:  resumeFocusCol = 0; updateResumeHighlight(); return true;
                case KeyEvent.KEYCODE_DPAD_RIGHT: resumeFocusCol = 1; updateResumeHighlight(); return true;
                case KeyEvent.KEYCODE_DPAD_CENTER:
                case KeyEvent.KEYCODE_ENTER:
                    if (resumeFocusCol == 0) doResume(); else doStartOver(); return true;
            }
            return true;
        }

        if (isLocked) return super.onKeyDown(keyCode, event);

        // 6. Controls hidden: quick seek + show
        if (!controlsVisible) {
            switch (keyCode) {
                case KeyEvent.KEYCODE_DPAD_CENTER:
                case KeyEvent.KEYCODE_ENTER:
                    if (isYoutubePlaying && activeYoutubePlayer != null) {
                        if (youtubeIsPlaying) activeYoutubePlayer.pause(); else activeYoutubePlayer.play();
                    } else if (player != null) {
                        if (player.isPlaying()) player.pause(); else player.play();
                    }
                    animatePlayPause(); updatePlayPauseAccessibility();
                    return true;
                case KeyEvent.KEYCODE_DPAD_LEFT:
                    fastSeek(-5_000);
                    return true;
                case KeyEvent.KEYCODE_DPAD_RIGHT:
                    fastSeek(10_000);
                    return true;
                case KeyEvent.KEYCODE_DPAD_UP:
                    showControls();
                    focusRow = 1; focusCol = 2;
                    updateFocusHighlight();
                    return true;
                case KeyEvent.KEYCODE_DPAD_DOWN:
                    showControls();
                    if (!playlist.isEmpty()) {
                        focusRow = 3;
                        episodeFocusIndex = currentIndex;
                    } else {
                        focusRow = 2;
                    }
                    updateFocusHighlight();
                    return true;
            }
            return super.onKeyDown(keyCode, event);
        }

        // 7. Controls are visible — Navigation logic
        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
                activateFocused();
                return true;

            case KeyEvent.KEYCODE_DPAD_UP:
                if (focusRow == 3) focusRow = 2;
                else if (focusRow == 2) { focusRow = 1; focusCol = clampCenterCol(2); }
                else if (focusRow == 1) { focusRow = 0; focusCol = 2; }
                updateFocusHighlight();
                return true;

            case KeyEvent.KEYCODE_DPAD_DOWN:
                if (focusRow == 0) { focusRow = 1; focusCol = clampCenterCol(2); }
                else if (focusRow == 1) focusRow = 2;
                else if (focusRow == 2) {
                    if (!playlist.isEmpty() && episodeBar != null && episodeBar.getVisibility() == View.VISIBLE) {
                        focusRow = 3;
                        episodeFocusIndex = currentIndex;
                    }
                }
                updateFocusHighlight();
                return true;

            case KeyEvent.KEYCODE_DPAD_LEFT:
                if (focusRow == 2) {
                    long stepL = getSeekHoldStep(event.getRepeatCount());
                    fastSeek(-stepL);
                } else if (focusRow == 3) {
                    if (episodeFocusIndex > 0) {
                        episodeFocusIndex--;
                        scrollEpisodeIntoView(episodeFocusIndex);
                        updateFocusHighlight();
                    }
                } else if (focusRow == 1) {
                    int next = focusCol - 1;
                    if (next >= 0) {
                        if (next != 0 || (btnPrevEp != null && btnPrevEp.getVisibility() == View.VISIBLE)) {
                            focusCol = next;
                            updateFocusHighlight();
                        }
                    }
                } else if (focusRow == 0) {
                    if (focusCol > 0) { focusCol--; updateFocusHighlight(); }
                }
                return true;

            case KeyEvent.KEYCODE_DPAD_RIGHT:
                if (focusRow == 2) {
                    long stepR = getSeekHoldStep(event.getRepeatCount());
                    fastSeek(stepR);
                } else if (focusRow == 3) {
                    if (episodeFocusIndex < playlist.size() - 1) {
                        episodeFocusIndex++;
                        scrollEpisodeIntoView(episodeFocusIndex);
                        updateFocusHighlight();
                    }
                } else if (focusRow == 1) {
                    int next = focusCol + 1;
                    if (next <= 4) {
                        if (next != 4 || (btnNextEp != null && btnNextEp.getVisibility() == View.VISIBLE)) {
                            focusCol = next;
                            updateFocusHighlight();
                        }
                    }
                } else if (focusRow == 0) {
                    if (focusCol < topRowButtons.length - 1) { focusCol++; updateFocusHighlight(); }
                }
                return true;

            case KeyEvent.KEYCODE_PAGE_UP:
                if (btnPrevEp != null && btnPrevEp.getVisibility() == View.VISIBLE) btnPrevEp.performClick();
                return true;
            case KeyEvent.KEYCODE_PAGE_DOWN:
                if (btnNextEp != null && btnNextEp.getVisibility() == View.VISIBLE) btnNextEp.performClick();
                return true;
        }

        return super.onKeyDown(keyCode, event);
    }

    /**
     * Accelerating seek steps for D-pad hold on seekbar:
     * 0-7 repeats   → 1s steps
     * 8-19 repeats  → 5s steps
     * 20-39 repeats → 10s steps
     * 40+ repeats   → 30s steps
     */
    private long getSeekHoldStep(int repeatCount) {
        if (repeatCount >= SEEK_HOLD_THRESHOLDS[3]) return SEEK_HOLD_STEPS[3];
        if (repeatCount >= SEEK_HOLD_THRESHOLDS[2]) return SEEK_HOLD_STEPS[2];
        if (repeatCount >= SEEK_HOLD_THRESHOLDS[1]) return SEEK_HOLD_STEPS[1];
        return SEEK_HOLD_STEPS[0];
    }

    private void scrollEpisodeIntoView(int index) {
        if (episodeContainer == null || episodeBar == null) return;
        View child = episodeContainer.getChildAt(index);
        if (child != null && episodeBar instanceof HorizontalScrollView hsv) {
            int scrollX = child.getLeft() - (hsv.getWidth() / 2) + (child.getWidth() / 2);
            hsv.smoothScrollTo(scrollX, 0);
        } else if (child != null && episodeBar instanceof ViewGroup) {
            View hsvChild = ((ViewGroup) episodeBar).getChildAt(0);
            if (hsvChild instanceof HorizontalScrollView hsv) {
                int scrollX = child.getLeft() - (hsv.getWidth() / 2) + (child.getWidth() / 2);
                hsv.smoothScrollTo(scrollX, 0);
            }
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Show / Hide controls
    // ══════════════════════════════════════════════════════════════════════════
    private void showControls() {
        if (isLocked) return;
        controlsVisible = true;
        lastShowTime = System.currentTimeMillis();
        playerView.showController();
        View[] targets = { topBar, centerControls, bottomBar, scrimTop, scrimBottom, episodeBar };
        for (View v : targets) {
            if (v == null) continue;
            v.animate().cancel();
            if (v == episodeBar && playlist.size() <= 1) {
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

        // Center episode list on current episode when controls open
        if (!playlist.isEmpty()) {
            episodeFocusIndex = currentIndex;
            if (episodeBar != null) episodeBar.post(() -> scrollEpisodeIntoView(currentIndex));
        }

        // Always auto-focus play/pause when controls open, unless focus was saved
        if (focusRow < 0 || focusRow > 3) { focusRow = 1; focusCol = 2; }
        updateFocusHighlight();
        scheduleHide();
    }

    private void hideControls() {
        controlsVisible = false;
        isSeeking = false;
        playerView.hideController();

        View[] allButtons = { btnBack, btnPictureMode, btnSync, btnSettings,
                              btnRew, btnPP, btnFfwd, btnNextEp, btnPrevEp };
        for (View v : allButtons) clearHighlight(v);

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
        if (previewContainer != null) previewContainer.setVisibility(View.GONE);
    }

    private void hideMainBars() {
        View[] targets = { topBar, centerControls, bottomBar, scrimTop, scrimBottom, episodeBar, tvLockHint, seekIndicator };
        for (View v : targets) {
            if (v != null) {
                v.animate().cancel();
                v.setVisibility(View.GONE);
                v.setAlpha(0f);
            }
        }
        if (btnLock != null) {
            btnLock.animate().cancel();
            btnLock.setVisibility(View.GONE);
            btnLock.setAlpha(0f);
        }
        if (previewContainer != null) previewContainer.setVisibility(View.GONE);
    }

    private void scheduleHide() {
        autoHideHandler.removeCallbacks(autoHideRunnable);
        autoHideHandler.postDelayed(autoHideRunnable, AUTO_HIDE_MS);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Lock UI (unchanged logic)
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

    private void setupLockButton() {
        if (btnLock == null) return;
        btnLock.setOnClickListener(v -> {
            if (isLocked) unlock(); else lock();
        });
    }

    private void lock() {
        isLocked = true; lockUiVisible = false;
        autoHideHandler.removeCallbacks(autoHideRunnable);
        autoHideHandler.removeCallbacks(hideLockUiRunnable);

        // Lock orientation to current landscape position
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LOCKED);

        // Enable Do Not Disturb if permission is granted
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && nm != null && nm.isNotificationPolicyAccessGranted()) {
            previousInterruptionFilter = nm.getCurrentInterruptionFilter();
            nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY);
        }

        playerView.hideController();
        View[] toHide = { topBar, centerControls, bottomBar, scrimTop, scrimBottom };
        for (View v : toHide) {
            if (v == null) continue;
            v.animate().cancel();
            v.animate().alpha(0f).setDuration(250).withEndAction(() -> v.setVisibility(View.GONE)).start();
        }
        if (btnLock != null) {
            btnLock.setImageResource(R.drawable.ic_lock_closed);
            btnLock.animate().cancel();
            btnLock.setVisibility(View.VISIBLE); btnLock.bringToFront(); btnLock.setAlpha(1f);
            btnLock.animate().scaleX(1.25f).scaleY(1.25f).setDuration(120)
                    .withEndAction(() -> btnLock.animate().scaleX(1f).scaleY(1f).setDuration(120).start()).start();
            lockUiVisible = true;
        }
        if (tvLockHint != null) {
            tvLockHint.setText(R.string.lock_hint);
            tvLockHint.animate().cancel();
            tvLockHint.bringToFront(); tvLockHint.setAlpha(1f); tvLockHint.setVisibility(View.VISIBLE);
        }
        autoHideHandler.postDelayed(hideLockUiRunnable, LOCK_UI_MS);
    }

    private void unlock() {
        isLocked = false; lockUiVisible = false;
        autoHideHandler.removeCallbacks(hideLockUiRunnable);

        // Restore sensor-based landscape orientation
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);

        // Restore Do Not Disturb state - Explicitly set to ALL to ensure volume is restored
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && nm != null && nm.isNotificationPolicyAccessGranted()) {
            nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL);
        }

        if (tvLockHint != null) { tvLockHint.animate().cancel(); tvLockHint.setVisibility(View.GONE); }
        if (btnLock != null) {
            btnLock.animate().cancel();
            btnLock.setImageResource(R.drawable.ic_lock_open);
            btnLock.setVisibility(View.VISIBLE); btnLock.setAlpha(1f);
        }
        showControls();
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Gestures (unchanged logic)
    // ══════════════════════════════════════════════════════════════════════════
    private void setupGestures() {
        playerView.setOnTouchListener((v, e) -> {
            handleTouch(e);
            return true;
        });
    }

    private void handleTouch(MotionEvent e) {
        if (resumeShowing) return;
        final float rawX = e.getRawX(), rawY = e.getRawY();
        final int w = playerView.getWidth();
        switch (e.getAction()) {
            case MotionEvent.ACTION_DOWN:
                downRawX = rawX; downRawY = rawY;
                downInLeft = rawX < w / 2f; downInRight = rawX >= w / 2f;
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
                            if (isVertical) {
                                playerView.showController(); // Ensure the container is active
                                hideMainBars();              // Hide everything but indicators
                                if (downInLeft)  showGestureIndicator(true);
                                if (downInRight) showGestureIndicator(false);
                            } else {
                                showControls();
                            }
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
                    hideGestureIndicator(downInLeft);
                    hideControls(); // Hide everything immediately after gesture finished
                } else if (isHorizontal) {
                    long ms = (long)((rawX - downRawX) / SEEK_PX_PER_SEC) * 1000L;
                    fastSeek(ms); hideSeekIndicator(); hideControls(); // Hide immediately after drag
                    if (previewContainer != null) previewContainer.setVisibility(View.GONE);
                } else { handleTap(downRawX); }
                dirLocked = false; isVertical = false; isHorizontal = false;
                break;
        }
    }

    private void handleTap(float x) {
        long now = System.currentTimeMillis();
        int side = (x < playerView.getWidth() / 2f) ? -1 : 1;
        if (now - lastTapTime < DOUBLE_TAP_MS && side == lastTapSide) {
            long ms = side == -1 ? -5_000L : 10_000L;
            fastSeek(ms); lastTapTime = 0;
        } else {
            lastTapTime = now; lastTapSide = side;
            if (controlsVisible) {
                // Prevent immediate hide if controls were just shown (e.g. via long press release)
                if (now - lastShowTime > 450) {
                    hideControls();
                } else {
                    scheduleHide();
                }
            } else {
                focusRow = 1; focusCol = 2;
                showControls();
            }
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Wire buttons (unchanged logic, +accessibility)
    // ══════════════════════════════════════════════════════════════════════════
    private void wireButtons() {
        if (btnBack != null) btnBack.setOnClickListener(v -> performBackAction());

        if (btnPictureMode != null) btnPictureMode.setOnClickListener(v -> {
            resizeModeIndex = (resizeModeIndex + 1) % RESIZE_MODES.length;
            playerView.setResizeMode(RESIZE_MODES[resizeModeIndex]);
            Toast.makeText(this, RESIZE_LABELS[resizeModeIndex], Toast.LENGTH_SHORT).show();
            btnPictureMode.announceForAccessibility("Picture mode: " + RESIZE_LABELS[resizeModeIndex]);
            scheduleHide();
        });

        if (btnFullscreen != null) btnFullscreen.setOnClickListener(v -> {
            isFullscreen = !isFullscreen;
            if (isFullscreen) {
                hideSystemUI();
                btnFullscreen.setImageResource(R.drawable.ic_fullscreen_exit);
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
                playerView.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FILL);
                resizeModeIndex = 0;
            } else {
                showSystemUI();
                btnFullscreen.setImageResource(R.drawable.ic_fullscreen);
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                playerView.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
                resizeModeIndex = 1; // Update index to match "Fit"
            }
            btnFullscreen.announceForAccessibility(isFullscreen ? "Fullscreen enabled" : "Fullscreen disabled");
            scheduleHide();
        });

        if (btnSync != null) btnSync.setOnClickListener(v -> {
            saveLastFocus(); showSyncDialog(); scheduleHide();
        });

        if (btnSettings != null) btnSettings.setOnClickListener(v -> {
            saveLastFocus(); showTrackSelectionDialog(); scheduleHide();
        });

        if (btnRew  != null) btnRew.setOnClickListener(v ->  { fastSeek(-5_000); scheduleHide(); });
        if (btnFfwd != null) btnFfwd.setOnClickListener(v -> { fastSeek(10_000);  scheduleHide(); });
        if (btnPP   != null) btnPP.setOnClickListener(v -> {
            if (player != null) { if (player.isPlaying()) player.pause(); else player.play(); }
            animatePlayPause(); updatePlayPauseAccessibility(); scheduleHide();
        });

        if (btnPrevEp != null) btnPrevEp.setOnClickListener(v -> {
            if (currentIndex > 0) { playEpisode(currentIndex - 1); } scheduleHide();
        });
        if (btnNextEp != null) btnNextEp.setOnClickListener(v -> {
            if (currentIndex < playlist.size() - 1) { playEpisode(currentIndex + 1); } scheduleHide();
        });
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Seek + skip overlays
    // ══════════════════════════════════════════════════════════════════════════
    private void fastSeek(long delta) {
        if (isYoutubePlaying && activeYoutubePlayer != null) {
            float target = Math.max(0, Math.min(youtubeDuration, youtubeCurrentTime + (delta / 1000f)));
            activeYoutubePlayer.seekTo(target);
            showSeekIndicatorTimed(delta);
            return;
        }
        if (player == null) return;
        long target = Math.max(0, Math.min(player.getDuration(), player.getCurrentPosition() + delta));
        player.seekTo(target);
        updatePreviewFrame(target);
        // Netflix-style overlay removed as per user request (was causing emoji display)
        // showSkipOverlay(delta < 0, delta);
        // Legacy seek indicator for gesture UI
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
        if (tvSeekDelta != null) tvSeekDelta.setText(getString(R.string.seek_delta_format, ms >= 0 ? "+" : "-", secs));
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
        if (btnPP == null) return;
        btnPP.animate().cancel();
        float currentScale = btnPP.getScaleX();
        float startScale = (currentScale > 1.0f) ? currentScale * 0.9f : 0.85f;
        float endScale   = (focusRow == 1 && clampCenterCol(focusCol) == 2) ? 1.12f : 1.0f;
        btnPP.setScaleX(startScale); btnPP.setScaleY(startScale);
        btnPP.animate().scaleX(endScale).scaleY(endScale).setDuration(200)
                .setInterpolator(new AccelerateDecelerateInterpolator()).start();
    }

    private void showGestureIndicator(boolean isBrightness) {
        LinearLayout toShow = isBrightness ? brightnessIndicator : volumeIndicator;
        LinearLayout toHide = isBrightness ? volumeIndicator : brightnessIndicator;
        if (toHide != null) toHide.setVisibility(View.GONE);
        if (toShow == null) return;
        toShow.animate().cancel();
        toShow.setScaleX(0.8f); toShow.setAlpha(0f); toShow.setVisibility(View.VISIBLE);
        toShow.animate().scaleX(1f).alpha(1f).setDuration(180)
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
            try { return Settings.System.getInt(getContentResolver(), Settings.System.SCREEN_BRIGHTNESS) * 100 / 255; }
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
        overridePendingTransition(0, 0);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (isLocked) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LOCKED);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && nm != null && nm.isNotificationPolicyAccessGranted()) {
                previousInterruptionFilter = nm.getCurrentInterruptionFilter();
                nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY);
            }
        }
        hideSystemUI();
        startTimeUpdates();
    }

    @Override protected void onPause() {
        super.onPause();
        if (isLocked) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && nm != null && nm.isNotificationPolicyAccessGranted()) {
                nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL);
            }
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        }
        saveCurrentPosition();
        if (player != null) player.pause();
        autoHideHandler.removeCallbacks(autoHideRunnable);
        autoHideHandler.removeCallbacks(hideLockUiRunnable);
        autoHideHandler.removeCallbacks(savePositionRunnable);
        timeUpdateHandler.removeCallbacks(timeUpdateRunnable);
    }

    @Override protected void onDestroy() {
        timeUpdateHandler.removeCallbacks(timeUpdateRunnable);
        if (previewThread != null) { previewThread.quitSafely(); previewThread = null; }
        if (retriever != null) { try { retriever.release(); } catch (Exception ignored) {} retriever = null; }
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
        String textLang  = prefs.getString("pref_lang_text", null);
        TrackSelectionParameters.Builder builder = player.getTrackSelectionParameters().buildUpon();
        builder.setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, false);
        builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false);
        if (audioLang != null) builder.setPreferredAudioLanguage(audioLang);
        if (textLang  != null) {
            builder.setPreferredTextLanguage(textLang);
            builder.setIgnoredTextSelectionFlags(0);
            builder.setSelectUndeterminedTextLanguage(true);
        }
        player.setTrackSelectionParameters(builder.build());
    }

    @Override
    public void onConfigurationChanged(@androidx.annotation.NonNull Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        syncFullscreenIcon();
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
