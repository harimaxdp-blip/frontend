package com.harimovies.app;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.SeekParameters;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.DefaultTimeBar;
import androidx.media3.ui.PlayerView;
import androidx.media3.ui.TimeBar;

import android.content.Context;
import android.content.pm.ActivityInfo;
import android.graphics.Bitmap;
import android.media.AudioManager;
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
import android.view.WindowManager;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.view.animation.OvershootInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import org.libtorrent4j.AlertListener;
import org.libtorrent4j.Priority;
import org.libtorrent4j.SessionHandle;
import org.libtorrent4j.SessionManager;
import org.libtorrent4j.TorrentFlags;
import org.libtorrent4j.TorrentHandle;
import org.libtorrent4j.TorrentInfo;
import org.libtorrent4j.alerts.Alert;
import org.libtorrent4j.alerts.AlertType;
import org.libtorrent4j.alerts.PieceFinishedAlert;
import org.libtorrent4j.alerts.TorrentErrorAlert;

/**
 * Torrent player that REUSES activity_player.xml — the exact same controller
 * layout/views/icons as PlayerActivity (top bar, center controls, bottom
 * progress bar w/ time text, lock button, gesture indicators, preview).
 *
 * Loading screen: single 0–100% progress bar shown over the (hidden) player
 * view until enough pieces are buffered, then it's hidden and the normal
 * PlayerActivity-style controller takes over — identical buttons, identical
 * gestures, identical look.
 *
 * CACHE / STORAGE:
 *  - saveDir wiped fresh in onCreate.
 *  - While playing, piece priorities are continuously trimmed to a sliding
 *    window around the current playback position (ahead+behind), and pieces
 *    outside that window are set to IGNORE so libtorrent stops growing the
 *    file unnecessarily — this caps on-disk cache size during playback.
 *  - On exit (back / finish / onDestroy) the torrent is removed with
 *    DELETE_FILES and saveDir is recursively deleted. Nothing persists.
 *  - No SharedPreferences resume position is written for torrent playback.
 */
@UnstableApi
public class TorrentPlayerActivity extends AppCompatActivity {

    public static final String EXTRA_MAGNET      = "magnet";
    public static final String EXTRA_TITLE       = "title";
    public static final String EXTRA_TORRENT_URL = "torrent_url";

    private static final String TAG       = "TORRENT";
    private static final int    HTTP_PORT = 18905;

    private static final int HEAD_PIECES_NEEDED       = 2;
    private static final int EDGE_PIECES              = 5;
    private static final int INITIAL_LOOKAHEAD_PIECES = 6;

    // Sliding window kept on disk during playback (caps cache growth)
    private static final long BUFFER_AHEAD_BYTES  = 60L * 1024 * 1024;
    private static final long BUFFER_BEHIND_BYTES =  5L * 1024 * 1024;

    private ExoPlayer  player;
    private PlayerView playerView;

    // ── Loading overlay (own simple view, drawn over playerView) ───────────
    private LinearLayout statusContainer;
    private TextView     tvStatus, tvSpeed, tvPeers, tvPercent;
    private ProgressBar  loadingBar;

    // ── Controller views — same IDs/layout as PlayerActivity ───────────────
    private LinearLayout brightnessIndicator, volumeIndicator;
    private View         viewBrightnessFill, viewVolumeFill;
    private TextView     tvBrightnessValue, tvVolumeValue;
    private LinearLayout seekIndicator;
    private ImageView    seekIcon;
    private TextView     tvSeekDelta;
    private View         topBar, centerControls, bottomBar, scrimTop, scrimBottom;
    private ImageButton  btnLock;
    private TextView     tvLockHint;

    private ImageButton btnBack, btnPictureMode, btnFullscreen, btnSync, btnSettings;
    private View        btnRew, btnPP, btnFfwd, progressBar;
    private TextView    tvTitle;

    // ── Preview ──────────────────────────────────────────────────────────
    private View         previewContainer;
    private ImageView    previewImage;
    private TextView     previewTimeText;
    private MediaMetadataRetriever retriever;
    private HandlerThread previewThread;
    private Handler       previewHandler;
    private final Map<String, String> requestHeaders = new HashMap<>();
    private boolean isPreviewLoading = false;
    private long    lastPreviewPos   = -1;

    // ── State flags ──────────────────────────────────────────────────────
    private boolean controlsVisible = false;
    private boolean isLocked        = false;
    private boolean lockUiVisible   = false;
    private boolean isFullscreen    = false;
    private int      resizeModeIndex = 0;

    private static final int[] RESIZE_MODES = {
            AspectRatioFrameLayout.RESIZE_MODE_FILL,
            AspectRatioFrameLayout.RESIZE_MODE_FIT,
            AspectRatioFrameLayout.RESIZE_MODE_ZOOM,
            AspectRatioFrameLayout.RESIZE_MODE_FIXED_WIDTH
    };
    private static final String[] RESIZE_LABELS = { "Fill", "Fit", "Zoom", "Stretch" };

    // Row 0 = top bar, Row 1 = center controls, Row 2 = progress bar
    private int focusRow = 1;
    private int focusCol = 1;

    private long audioOffsetUs = 0L;

    private final Handler  autoHideHandler    = new Handler(Looper.getMainLooper());
    private final Runnable autoHideRunnable   = this::hideControls;
    private final Runnable hideLockUiRunnable = this::hideLockUI;
    private static final long AUTO_HIDE_MS = 4_000L;
    private static final long LOCK_UI_MS   = 3_000L;

    // ── Gesture state ───────────────────────────────────────────────────
    private float   downRawX = 0f, downRawY = 0f;
    private boolean downInLeft = false, downInRight = false;
    private int     gestureStartValue = 0;
    private boolean dirLocked = false, isVertical = false, isHorizontal = false;
    private static final float GESTURE_THRESHOLD = 18f;
    private static final float SEEK_PX_PER_SEC   = 8f;

    private long lastTapTime = 0L;
    private int  lastTapSide = 0;
    private static final long DOUBLE_TAP_MS = 300L;

    private int touchHoldSide = 0;
    private int touchHoldCount = 0;
    private Runnable touchHoldRunnable;
    private Runnable startTouchHoldRunnable;

    private AudioManager audioManager;
    private int          maxVolume;

    // ── Torrent state ───────────────────────────────────────────────────
    private SessionManager  session;
    private TorrentHandle   torrentHandle;
    private LocalHttpServer httpServer;

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final AtomicBoolean   alive    = new AtomicBoolean(true);

    private boolean playerStarted     = false;
    private boolean playbackInitiated = false;
    private int     verifiedHeadPieces = 0;
    private int     verifiedLookaheadPieces = 0;
    private int     verifiedTailPieces = 0;

    private File saveDir;
    private File videoFile;
    private long totalSize = 0;

    private int  videoFileIndex;
    private long videoFileOffset;
    private int  pieceLength;
    private int  firstPieceIndex, lastPieceIndex;
    private int  lastWindowStartPiece = -1;

    private String currentMagnet;
    private String torrentFileUrl;
    private String videoTitle = "Streaming…";

    // ══════════════════════════════════════════════════════════════════════════
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemUI();

        currentMagnet  = getIntent().getStringExtra(EXTRA_MAGNET);
        torrentFileUrl = getIntent().getStringExtra(EXTRA_TORRENT_URL);
        String title   = getIntent().getStringExtra(EXTRA_TITLE);
        if (title != null && !title.isEmpty()) videoTitle = title;

        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        maxVolume    = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);

        // ── Use the SAME layout as PlayerActivity ──────────────────────────
        setContentView(R.layout.activity_player);
        playerView = findViewById(R.id.player_view);

        // Add a loading overlay on top of the player view, inside root content.
        buildLoadingOverlay();

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (isLocked) return;
                if (controlsVisible) { hideControls(); return; }
                exitAndCleanup();
            }
        });

        player = new ExoPlayer.Builder(this).build();
        player.setSeekParameters(SeekParameters.EXACT);
        playerView.setPlayer(player);
        playerView.setControllerShowTimeoutMs(-1);
        playerView.setControllerAutoShow(false);
        playerView.setUseController(true);

        player.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY && !playerStarted) {
                    playerStarted = true;
                    handler().post(() -> {
                        statusContainer.setVisibility(View.GONE);
                        playerView.setVisibility(View.VISIBLE);
                        setupPreviewRetriever();
                    });
                }
            }
            @Override public void onPlayerError(PlaybackException e) {
                Log.e(TAG, "ExoPlayer error: " + e.getErrorCodeName());
                if (!playerStarted && alive.get()) {
                    handler().postDelayed(() -> {
                        if (!playerStarted && alive.get()) {
                            Log.d(TAG, "Re-preparing ExoPlayer after error");
                            startPlayback();
                        }
                    }, 3000);
                }
            }
        });

        // Fresh cache dir every time — nothing persists between sessions.
        saveDir = new File(getCacheDir(), "torrent_stream");
        deleteRecursive(saveDir);
        saveDir.mkdirs();

        if (currentMagnet == null || currentMagnet.isEmpty()) {
            Toast.makeText(this, "No magnet link", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        findControllerViews();
        if (tvTitle != null) tvTitle.setText(videoTitle);
        syncFullscreenIcon();
        wireButtons();
        setupGestures();
        setupLockButton();
        hideControls();

        executor.execute(this::initSession);
    }

    private Handler handler() { return autoHideHandler; }

    // ══════════════════════════════════════════════════════════════════════════
    //  Find views — IDENTICAL ids to PlayerActivity's activity_player.xml
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
        btnSync             = playerView.findViewById(R.id.btn_sync);
        btnSettings         = playerView.findViewById(R.id.btn_settings);

        btnRew              = playerView.findViewById(R.id.exo_rew);
        btnPP               = playerView.findViewById(R.id.exo_play_pause);
        btnFfwd             = playerView.findViewById(R.id.exo_ffwd);

        tvTitle             = playerView.findViewById(R.id.tv_title);

        progressBar         = playerView.findViewById(R.id.exo_progress);
        previewContainer    = playerView.findViewById(R.id.preview_container);
        previewImage        = playerView.findViewById(R.id.preview_image);
        previewTimeText     = playerView.findViewById(R.id.preview_time);

        // Series-only widgets (episode bar, next/prev) don't exist for torrents —
        // hide them defensively if present in the shared layout.
        View epBadge  = playerView.findViewById(R.id.mp_ep_badge);
        View epSep    = playerView.findViewById(R.id.tv_title_sep);
        View epBar    = playerView.findViewById(R.id.episode_bar);
        View btnNext  = playerView.findViewById(R.id.btn_next_ep);
        View btnPrev  = playerView.findViewById(R.id.btn_prev_ep);
        if (epBadge != null) epBadge.setVisibility(View.GONE);
        if (epSep   != null) epSep.setVisibility(View.GONE);
        if (epBar   != null) epBar.setVisibility(View.GONE);
        if (btnNext != null) btnNext.setVisibility(View.GONE);
        if (btnPrev != null) btnPrev.setVisibility(View.GONE);
    }

    private void syncFullscreenIcon() {
        int orientation = getResources().getConfiguration().orientation;
        isFullscreen = (orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE);
        if (btnFullscreen != null) {
            btnFullscreen.setImageResource(
                    isFullscreen ? R.drawable.ic_fullscreen_exit : R.drawable.ic_fullscreen);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Loading overlay — simple 0-100% bar drawn above the (hidden) player view
    // ══════════════════════════════════════════════════════════════════════════
    private void buildLoadingOverlay() {
        FrameLayout root = findViewById(android.R.id.content);

        LinearLayout overlay = new LinearLayout(this);
        overlay.setOrientation(LinearLayout.VERTICAL);
        overlay.setGravity(Gravity.CENTER);
        overlay.setClickable(true); // swallow touches while loading
        overlay.setBackgroundColor(0xFF000000);
        root.addView(overlay, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        overlay.bringToFront();
        statusContainer = overlay;

        TextView badge = new TextView(this);
        badge.setText("HM");
        badge.setTextColor(0xFFE50914);
        badge.setTextSize(34);
        badge.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        badge.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams badgeLp = new LinearLayout.LayoutParams(dp(92), dp(92));
        badgeLp.gravity = Gravity.CENTER_HORIZONTAL;
        badgeLp.bottomMargin = dp(20);
        badge.setLayoutParams(badgeLp);
        overlay.addView(badge);

        TextView title = new TextView(this);
        title.setText(videoTitle);
        title.setTextColor(0x99FFFFFF);
        title.setTextSize(12);
        title.setGravity(Gravity.CENTER);
        title.setMaxLines(2);
        title.setEllipsize(android.text.TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams tlLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        tlLp.setMargins(dp(32), 0, dp(32), dp(18));
        title.setLayoutParams(tlLp);
        overlay.addView(title);

        loadingBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        loadingBar.setMax(100);
        loadingBar.setProgress(0);
        loadingBar.getProgressDrawable().setColorFilter(0xFFE50914, android.graphics.PorterDuff.Mode.SRC_IN);
        LinearLayout.LayoutParams pbLp = new LinearLayout.LayoutParams(dp(240), dp(6));
        pbLp.gravity = Gravity.CENTER_HORIZONTAL;
        pbLp.bottomMargin = dp(8);
        loadingBar.setLayoutParams(pbLp);
        overlay.addView(loadingBar);

        tvPercent = new TextView(this);
        tvPercent.setText("0%");
        tvPercent.setTextColor(0xFFE50914);
        tvPercent.setTextSize(13);
        tvPercent.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        tvPercent.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams pctLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        pctLp.bottomMargin = dp(10);
        tvPercent.setLayoutParams(pctLp);
        overlay.addView(tvPercent);

        tvStatus = makeLabel(overlay, 13, 0xAAFFFFFF, 0);
        tvSpeed  = makeLabel(overlay, 11, 0x88FFFFFF, dp(6));
        tvPeers  = makeLabel(overlay, 10, 0x66FFFFFF, dp(4));
    }

    private TextView makeLabel(LinearLayout p, int sp, int color, int topMargin) {
        TextView tv = new TextView(this);
        tv.setTextColor(color);
        tv.setTextSize(sp);
        tv.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.setMargins(dp(32), topMargin, dp(32), 0);
        tv.setLayoutParams(lp);
        p.addView(tv);
        return tv;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Torrent session / metadata
    // ══════════════════════════════════════════════════════════════════════════
    private void initSession() {
        try {
            setLoadingText("Starting torrent engine…");
            session = new SessionManager();
            session.start();
            Thread.sleep(1000);

            if (torrentFileUrl != null && !torrentFileUrl.isEmpty()) {
                loadFromTorrentFile(torrentFileUrl);
            } else {
                loadFromMagnet(currentMagnet);
            }
        } catch (Exception e) {
            Log.e(TAG, "Session init error", e);
            handler().post(() -> showError("Failed to start torrent engine: " + e.getMessage()));
        }
    }

    private void loadFromTorrentFile(String url) {
        try {
            setLoadingText("Downloading torrent metadata…");
            File tmp = new File(getCacheDir(), "temp.torrent");
            downloadFile(url, tmp);
            if (!tmp.exists() || tmp.length() < 50) throw new Exception("Torrent file download failed");
            addTorrentInfo(new TorrentInfo(tmp));
        } catch (Exception e) {
            Log.e(TAG, "loadFromTorrentFile error", e);
            setLoadingText("Torrent file failed — trying magnet…");
            executor.execute(() -> loadFromMagnet(currentMagnet));
        }
    }

    private void loadFromMagnet(String magnet) {
        try {
            setLoadingText("Resolving magnet link… (may take 1–2 min)");
            byte[] data = session.fetchMagnet(magnet, 120, saveDir);
            if (data == null) {
                handler().post(() -> showError(
                        "Could not find peers for this torrent.\n" +
                        "The file may have very few seeders.\nTry again later."));
                return;
            }
            addTorrentInfo(TorrentInfo.bdecode(data));
        } catch (Exception e) {
            Log.e(TAG, "loadFromMagnet error", e);
            handler().post(() -> showError("Magnet resolve failed: " + e.getMessage()));
        }
    }

    private void addTorrentInfo(TorrentInfo ti) throws Exception {
        setLoadingText("Metadata found! Starting download…");

        int  videoIndex = 0;
        long maxSize    = 0;
        for (int i = 0; i < ti.numFiles(); i++) {
            long sz = ti.files().fileSize(i);
            if (sz > maxSize) { maxSize = sz; videoIndex = i; }
        }
        totalSize = maxSize;
        final int finalVideoIndex = videoIndex;

        session.download(ti, saveDir, null, null, null, TorrentFlags.SEQUENTIAL_DOWNLOAD);
        torrentHandle = session.find(ti.infoHash());

        if (torrentHandle == null || !torrentHandle.isValid())
            throw new Exception("Could not create torrent handle");

        torrentHandle.setFlags(
                torrentHandle.status().flags().or_(TorrentFlags.SEQUENTIAL_DOWNLOAD));

        for (int i = 0; i < ti.numFiles(); i++) {
            torrentHandle.filePriority(i,
                    i == finalVideoIndex ? Priority.DEFAULT : Priority.IGNORE);
        }

        videoFileIndex  = finalVideoIndex;
        videoFileOffset = ti.files().fileOffset(finalVideoIndex);
        pieceLength     = ti.pieceLength();
        firstPieceIndex = (int) (videoFileOffset / pieceLength);
        lastPieceIndex  = (int) ((videoFileOffset + totalSize - 1) / pieceLength);

        Log.d(TAG, "Video: " + ti.files().filePath(finalVideoIndex)
                + "  size=" + totalSize
                + "  pieceLen=" + pieceLength
                + "  pieces=[" + firstPieceIndex + ".." + lastPieceIndex + "]");

        verifiedHeadPieces      = 0;
        verifiedLookaheadPieces = 0;
        verifiedTailPieces      = 0;

        int lookaheadEnd = Math.min(lastPieceIndex,
                firstPieceIndex + EDGE_PIECES + INITIAL_LOOKAHEAD_PIECES - 1);
        for (int p = firstPieceIndex; p <= lookaheadEnd; p++) {
            torrentHandle.piecePriority(p, Priority.TOP_PRIORITY);
            torrentHandle.setPieceDeadline(p, 50);
        }
        for (int i = 0; i < EDGE_PIECES; i++) {
            int tail = lastPieceIndex - i;
            if (tail >= firstPieceIndex && tail > lookaheadEnd) {
                torrentHandle.piecePriority(tail, Priority.TOP_PRIORITY);
                torrentHandle.setPieceDeadline(tail, 50);
            }
        }

        String relPath = ti.files().filePath(finalVideoIndex);
        videoFile = new File(saveDir, relPath);
        videoFile.getParentFile().mkdirs();

        session.addListener(new AlertListener() {
            @Override public int[] types() {
                return new int[]{
                        AlertType.PIECE_FINISHED.swig(),
                        AlertType.TORRENT_ERROR.swig()
                };
            }
            @Override public void alert(Alert<?> alert) {
                if (!alive.get()) return;
                if (alert.type() == AlertType.PIECE_FINISHED) {
                    onPieceVerified(((PieceFinishedAlert) alert).pieceIndex());
                } else if (alert.type() == AlertType.TORRENT_ERROR) {
                    String msg = ((TorrentErrorAlert) alert).message();
                    handler().post(() -> showError("Torrent error: " + msg));
                }
            }
        });

        startHttpServer();
        startProgressPoller();
    }

    private void onPieceVerified(int pieceIndex) {
        if (playerStarted || playbackInitiated) return;

        int lookaheadEnd = Math.min(lastPieceIndex,
                firstPieceIndex + EDGE_PIECES + INITIAL_LOOKAHEAD_PIECES - 1);

        if (pieceIndex >= firstPieceIndex && pieceIndex < firstPieceIndex + EDGE_PIECES) {
            verifiedHeadPieces++;
        }
        if (pieceIndex >= firstPieceIndex + EDGE_PIECES && pieceIndex <= lookaheadEnd) {
            verifiedLookaheadPieces++;
        }
        if (pieceIndex > lastPieceIndex - EDGE_PIECES && pieceIndex <= lastPieceIndex) {
            verifiedTailPieces++;
        }

        updateLoadingPercent();

        int lookaheadNeeded = Math.max(0, lookaheadEnd - (firstPieceIndex + EDGE_PIECES) + 1);
        if (verifiedHeadPieces >= HEAD_PIECES_NEEDED &&
                verifiedLookaheadPieces >= lookaheadNeeded &&
                verifiedTailPieces >= EDGE_PIECES) {
            handler().post(this::startPlayback);
        }
    }

    private void updateLoadingPercent() {
        int lookaheadEnd = Math.min(lastPieceIndex,
                firstPieceIndex + EDGE_PIECES + INITIAL_LOOKAHEAD_PIECES - 1);
        int lookaheadNeeded = Math.max(0, lookaheadEnd - (firstPieceIndex + EDGE_PIECES) + 1);

        int needed = HEAD_PIECES_NEEDED + lookaheadNeeded + EDGE_PIECES;
        int have   = Math.min(verifiedHeadPieces, HEAD_PIECES_NEEDED)
                    + Math.min(verifiedLookaheadPieces, lookaheadNeeded)
                    + Math.min(verifiedTailPieces, EDGE_PIECES);

        final int pct = needed > 0 ? Math.min(100, (int) ((have * 100L) / needed)) : 0;

        handler().post(() -> {
            if (loadingBar != null) loadingBar.setProgress(pct);
            if (tvPercent  != null) tvPercent.setText(pct + "%");
        });
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  HTTP server
    // ══════════════════════════════════════════════════════════════════════════
    private void startHttpServer() {
        httpServer = new LocalHttpServer(
                HTTP_PORT, videoFile,
                () -> totalSize,
                this::isByteRangeReady,
                alive);
        executor.execute(httpServer);
        Log.d(TAG, "HTTP server started on :" + HTTP_PORT);
    }

    private boolean isByteRangeReady(long start, long end) {
        if (torrentHandle == null || !torrentHandle.isValid()) return false;
        int pStart = Math.max(firstPieceIndex,
                (int) ((videoFileOffset + start) / pieceLength));
        int pEnd   = Math.min(lastPieceIndex,
                (int) ((videoFileOffset + end)   / pieceLength));
        boolean ready = true;
        for (int p = pStart; p <= pEnd; p++) {
            if (!torrentHandle.havePiece(p)) {
                torrentHandle.piecePriority(p, Priority.TOP_PRIORITY);
                torrentHandle.setPieceDeadline(p, 50);
                ready = false;
            }
        }
        if (!ready && start % (1024 * 1024) == 0) { // Log occasionally to avoid spam
            Log.d("HTTP_SRV", "Range NOT ready: " + start + "-" + end + " (pieces " + pStart + "-" + pEnd + ")");
        }
        return ready;
    }

    private void startPlayback() {
        if (playerStarted || playbackInitiated || !alive.get()) return;
        playbackInitiated = true;
        Log.d(TAG, "▶ Starting ExoPlayer — head=" + verifiedHeadPieces
                + " lookahead=" + verifiedLookaheadPieces + " tail=" + verifiedTailPieces);

        String url = "http://127.0.0.1:" + HTTP_PORT + "/video";

        DefaultHttpDataSource.Factory dsFactory = new DefaultHttpDataSource.Factory()
                .setConnectTimeoutMs(30_000)
                .setReadTimeoutMs(60_000);

        MediaSource src = new DefaultMediaSourceFactory(this)
                .setDataSourceFactory(dsFactory)
                .createMediaSource(MediaItem.fromUri(Uri.parse(url)));

        player.setMediaSource(src);
        player.prepare();
        player.seekTo(0);
        player.play();
    }

    /**
     * Sliding window: pieces inside [current - BEHIND, current + AHEAD] keep
     * DEFAULT priority (downloaded); everything else (except the small EDGE
     * pieces needed for the moov atom / fast seeks) is set to IGNORE so
     * libtorrent stops fetching/retaining them. This is what caps cache size
     * during playback — without it sequential download just keeps growing
     * the file toward 100%.
     */
    private void updateDownloadWindow() {
        if (!playerStarted || torrentHandle == null || !torrentHandle.isValid()) return;
        long duration = player.getDuration();
        if (duration <= 0) return;

        double fraction  = (double) player.getCurrentPosition() / duration;
        long currentByte = videoFileOffset + (long) (fraction * totalSize);
        long wStart      = Math.max(videoFileOffset, currentByte - BUFFER_BEHIND_BYTES);
        long wEnd        = Math.min(videoFileOffset + totalSize - 1, currentByte + BUFFER_AHEAD_BYTES);
        int  startPiece  = (int) (wStart / pieceLength);
        int  endPiece    = (int) (wEnd   / pieceLength);

        if (startPiece == lastWindowStartPiece) return;
        lastWindowStartPiece = startPiece;

        for (int p = firstPieceIndex; p <= lastPieceIndex; p++) {
            boolean isEdge   = (p < firstPieceIndex + EDGE_PIECES)
                             || (p > lastPieceIndex - EDGE_PIECES);
            boolean inWindow = (p >= startPiece && p <= endPiece);
            torrentHandle.piecePriority(p,
                    (inWindow || isEdge) ? Priority.DEFAULT : Priority.IGNORE);
            if (inWindow && p <= startPiece + 8) {
                torrentHandle.setPieceDeadline(p, 300);
            }
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Progress poller
    // ══════════════════════════════════════════════════════════════════════════
    private void startProgressPoller() {
        handler().post(new Runnable() {
            @Override public void run() {
                if (!alive.get()) return;
                try {
                    if (torrentHandle != null && torrentHandle.isValid()) {
                        org.libtorrent4j.TorrentStatus st = torrentHandle.status();
                        float dlKBps = st.downloadRate() / 1024f;
                        int   seeds  = st.numSeeds();

                        if (tvSpeed != null) tvSpeed.setText(String.format("↓ %.0f KB/s", dlKBps));
                        if (tvPeers != null) tvPeers.setText("Seeds: " + seeds + "  Peers: " + st.numPeers());

                        if (!playerStarted) {
                            if (seeds == 0) {
                                setLoadingTextNow("Searching for peers…");
                            } else {
                                setLoadingTextNow("Buffering…");
                            }
                        } else {
                            updateDownloadWindow();
                        }
                    }
                } catch (Exception ignored) {}
                handler().postDelayed(this, 1000);
            }
        });
    }

    private void setLoadingText(String s)    { handler().post(() -> setLoadingTextNow(s)); }
    private void setLoadingTextNow(String s) { if (tvStatus != null) tvStatus.setText(s); }

    // ══════════════════════════════════════════════════════════════════════════
    //  Local HTTP byte-range server
    // ══════════════════════════════════════════════════════════════════════════
    private static class LocalHttpServer implements Runnable {
        interface LongSupplier { long    get(); }
        interface RangeChecker { boolean isReady(long start, long end); }

        private final int          port;
        private final File         file;
        private final LongSupplier totalSizeSupplier;
        private final RangeChecker rangeChecker;
        private final AtomicBoolean alive;
        private volatile boolean   running = true;
        private ServerSocket       serverSocket;

        LocalHttpServer(int port, File file,
                        LongSupplier totalSizeSupplier,
                        RangeChecker rangeChecker,
                        AtomicBoolean alive) {
            this.port              = port;
            this.file              = file;
            this.totalSizeSupplier = totalSizeSupplier;
            this.rangeChecker      = rangeChecker;
            this.alive             = alive;
        }

        void stop() {
            running = false;
            try { if (serverSocket != null) serverSocket.close(); } catch (Exception ignored) {}
        }

        @Override public void run() {
            try {
                serverSocket = new ServerSocket();
                serverSocket.setReuseAddress(true);
                serverSocket.bind(new InetSocketAddress("127.0.0.1", port));
                while (running) {
                    try {
                        Socket client = serverSocket.accept();
                        new Thread(() -> handleClient(client)).start();
                    } catch (Exception ignored) {}
                }
            } catch (Exception e) {
                Log.e("HTTP_SRV", "Server error: " + e.getMessage());
            }
        }

        private void handleClient(Socket client) {
            try (client) {
                java.io.InputStream  in  = client.getInputStream();
                java.io.OutputStream out = client.getOutputStream();

                StringBuilder req = new StringBuilder();
                int c;
                while ((c = in.read()) != -1) {
                    req.append((char) c);
                    if (req.toString().endsWith("\r\n\r\n")) break;
                }
                String request = req.toString();

                long fileSize = totalSizeSupplier.get();
                if (fileSize <= 0) { sendError(out, 503, 0); return; }

                long start = 0, end = fileSize - 1;
                boolean isRange = false;
                for (String line : request.split("\r\n")) {
                    if (line.toLowerCase().startsWith("range:")) {
                        isRange = true;
                        String rv = line.substring(line.indexOf('=') + 1).trim();
                        String[] parts = rv.split("-");
                        if (parts.length > 0 && !parts[0].isEmpty())
                            start = Long.parseLong(parts[0].trim());
                        if (parts.length > 1 && !parts[1].isEmpty())
                            end = Long.parseLong(parts[1].trim());
                        break;
                    }
                }

                if (end >= fileSize) end = fileSize - 1;
                if (start > end) { sendError(out, 416, fileSize); return; }

                long   length  = end - start + 1;
                String status  = isRange ? "206 Partial Content" : "200 OK";
                String mime    = getMime(file.getName());
                String headers =
                        "HTTP/1.1 " + status + "\r\n" +
                        "Content-Type: " + mime + "\r\n" +
                        "Content-Length: " + length + "\r\n" +
                        "Content-Range: bytes " + start + "-" + end + "/" + fileSize + "\r\n" +
                        "Accept-Ranges: bytes\r\n" +
                        "Connection: close\r\n\r\n";
                out.write(headers.getBytes());

                try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
                    raf.seek(start);
                    byte[] buf    = new byte[65536];
                    long   remain = length;
                    long   currPos = start;
                    while (remain > 0 && alive.get() && running) {
                        int toRead = (int) Math.min(buf.length, remain);

                        long chunkDeadline = System.currentTimeMillis() + 30_000;
                        while (!rangeChecker.isReady(currPos, currPos + toRead - 1)) {
                            if (!alive.get() || !running) break;
                            if (System.currentTimeMillis() > chunkDeadline) {
                                Log.e("HTTP_SRV", "Timeout waiting for range " + currPos + "-" + (currPos + toRead - 1));
                                throw new java.io.IOException("Piece download timeout");
                            }
                            Thread.sleep(100);
                        }

                        int read = raf.read(buf, 0, toRead);
                        if (read == -1) break;
                        out.write(buf, 0, read);
                        remain -= read;
                        currPos += read;
                    }
                }
            } catch (Exception e) {
                Log.w("HTTP_SRV", "Client: " + e.getMessage());
            }
        }

        private void sendError(java.io.OutputStream out, int code, long fileSize) {
            try {
                String r = (code == 416) ? "Range Not Satisfiable" : "Service Unavailable";
                out.write(("HTTP/1.1 " + code + " " + r + "\r\n" +
                        "Content-Range: bytes */" + fileSize + "\r\n\r\n").getBytes());
            } catch (Exception ignored) {}
        }

        private String getMime(String name) {
            name = name.toLowerCase();
            if (name.endsWith(".mkv"))  return "video/x-matroska";
            if (name.endsWith(".mp4"))  return "video/mp4";
            if (name.endsWith(".avi"))  return "video/x-msvideo";
            if (name.endsWith(".webm")) return "video/webm";
            return "video/octet-stream";
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Helpers
    // ══════════════════════════════════════════════════════════════════════════
    private void downloadFile(String url, File dest) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(15_000);
        conn.setReadTimeout(30_000);
        conn.setRequestProperty("User-Agent",
                "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36");
        conn.connect();
        if (conn.getResponseCode() != 200)
            throw new Exception("HTTP " + conn.getResponseCode());
        try (InputStream is = conn.getInputStream();
             FileOutputStream fos = new FileOutputStream(dest)) {
            byte[] buf = new byte[8192]; int n;
            while ((n = is.read(buf)) != -1) fos.write(buf, 0, n);
        }
    }

    private void showError(String msg) {
        if (tvStatus != null) {
            tvStatus.setText(msg);
            tvStatus.setTextColor(0xFFE50914);
        }
        handler().postDelayed(() -> { if (alive.get()) exitAndCleanup(); }, 6000);
    }

    private int dp(int val) {
        return (int)(val * getResources().getDisplayMetrics().density);
    }

    private String fmt(long secs) {
        long h = secs / 3600, m = (secs % 3600) / 60, s = secs % 60;
        if (h > 0) return h + ":" + pad(m) + ":" + pad(s);
        return m + ":" + pad(s);
    }
    private String pad(long n) { return n < 10 ? "0" + n : String.valueOf(n); }

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

    // ══════════════════════════════════════════════════════════════════════════
    //  Show / Hide controls — identical to PlayerActivity
    // ══════════════════════════════════════════════════════════════════════════
    private void showControls() {
        if (isLocked) return;
        if (!playerStarted) return;
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
        updateFocusHighlight();
        scheduleHide();
    }

    private void hideControls() {
        controlsVisible = false;
        playerView.hideController();
        clearHighlight(btnBack);
        clearHighlight(btnPictureMode);
        clearHighlight(btnFullscreen);
        clearHighlight(btnSync);
        clearHighlight(btnSettings);
        clearHighlight(btnRew);
        clearHighlight(btnPP);
        clearHighlight(btnFfwd);
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
    //  Lock UI — identical to PlayerActivity
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
    //  Gestures — identical to PlayerActivity
    // ══════════════════════════════════════════════════════════════════════════
    private void setupGestures() {
        touchHoldRunnable = new Runnable() {
            @Override public void run() {
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
            if (!dirLocked && !isLocked && playerStarted) {
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

        playerView.setOnTouchListener((v, e) -> { handleTouch(e); return true; });
    }

    private void handleTouch(MotionEvent e) {
        if (!playerStarted) return;
        final float rawX = e.getRawX(), rawY = e.getRawY();
        final int w = playerView.getWidth();
        switch (e.getAction()) {
            case MotionEvent.ACTION_DOWN:
                downRawX = rawX; downRawY = rawY;
                downInLeft  = rawX < w / 3f;
                downInRight = rawX > w * 2f / 3f;
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
            else { focusRow = 1; focusCol = 1; showControls(); }
        }
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
    //  Seek / indicators — identical to PlayerActivity
    // ══════════════════════════════════════════════════════════════════════════
    private void fastSeek(long delta) {
        if (player == null || !playerStarted) return;
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
        if (btnPP == null) return;
        btnPP.animate().cancel();
        float currentScale = btnPP.getScaleX();
        float startScale = (currentScale > 1.0f) ? currentScale * 0.9f : 0.85f;
        float endScale = (currentScale > 1.0f) ? currentScale : 1.18f;
        btnPP.setScaleX(startScale);
        btnPP.setScaleY(startScale);
        btnPP.animate()
                .scaleX(endScale).scaleY(endScale).setDuration(400)
                .setInterpolator(new OvershootInterpolator(2.0f)).start();
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Wire buttons — identical actions to PlayerActivity
    // ══════════════════════════════════════════════════════════════════════════
    private void wireButtons() {
        if (btnBack != null) btnBack.setOnClickListener(v -> exitAndCleanup());

        if (btnPictureMode != null) btnPictureMode.setOnClickListener(v -> {
            resizeModeIndex = (resizeModeIndex + 1) % RESIZE_MODES.length;
            playerView.setResizeMode(RESIZE_MODES[resizeModeIndex]);
            Toast.makeText(this, RESIZE_LABELS[resizeModeIndex], Toast.LENGTH_SHORT).show();
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

        if (btnSync != null) btnSync.setOnClickListener(v -> { showSyncDialog(); scheduleHide(); });

        if (btnSettings != null) btnSettings.setOnClickListener(v -> {
            showTrackSelectionDialog();
            scheduleHide();
        });

        if (btnRew  != null) btnRew.setOnClickListener(v ->  { fastSeek(-10_000); scheduleHide(); });
        if (btnFfwd != null) btnFfwd.setOnClickListener(v -> { fastSeek(10_000);  scheduleHide(); });
        if (btnPP   != null) btnPP.setOnClickListener(v -> {
            if (player != null) { if (player.isPlaying()) player.pause(); else player.play(); }
            animatePlayPause(); scheduleHide();
        });

        if (progressBar instanceof DefaultTimeBar) {
            ((DefaultTimeBar) progressBar).addListener(new TimeBar.OnScrubListener() {
                @Override public void onScrubStart(TimeBar timeBar, long position) {
                    autoHideHandler.removeCallbacks(autoHideRunnable);
                    if (previewContainer != null) previewContainer.setVisibility(View.VISIBLE);
                    updatePreviewFrame(position);
                }
                @Override public void onScrubMove(TimeBar timeBar, long position) {
                    autoHideHandler.removeCallbacks(autoHideRunnable);
                    updatePreviewFrame(position);
                }
                @Override public void onScrubStop(TimeBar timeBar, long position, boolean canceled) {
                    if (player != null && !canceled) player.seekTo(position);
                    if (previewContainer != null) previewContainer.setVisibility(View.GONE);
                    scheduleHide();
                }
            });
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  A/V Sync Dialog — identical to PlayerActivity
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
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        offLp.setMargins(0, dp(8), 0, dp(4));
        tvOffset.setLayoutParams(offLp);

        TextView tvHint = new TextView(this);
        tvHint.setTextColor(0x88FFFFFF);
        tvHint.setTextSize(11);
        tvHint.setGravity(Gravity.CENTER);
        tvHint.setText("Audio early → drag left (−)  •  Audio late → drag right (+)");
        LinearLayout.LayoutParams hintLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        hintLp.setMargins(0, 0, 0, dp(14));
        tvHint.setLayoutParams(hintLp);

        final android.widget.SeekBar seekBar = new android.widget.SeekBar(this);
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

        TextView tvMin = new TextView(this);
        tvMin.setText("−2000ms");
        tvMin.setTextColor(0x88FFFFFF);
        tvMin.setTextSize(10);
        rangeRow.addView(tvMin, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        TextView tvMid = new TextView(this);
        tvMid.setText("0");
        tvMid.setTextColor(0x88FFFFFF);
        tvMid.setTextSize(10);
        tvMid.setGravity(Gravity.CENTER);
        rangeRow.addView(tvMid, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        TextView tvMax = new TextView(this);
        tvMax.setText("+2000ms");
        tvMax.setTextColor(0x88FFFFFF);
        tvMax.setTextSize(10);
        tvMax.setGravity(Gravity.END);
        LinearLayout.LayoutParams maxLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        maxLp.setMargins(0, 0, 0, dp(14));
        rangeRow.addView(tvMax, maxLp);

        Runnable updateLabel = () -> {
            long ms = seekBar.getProgress() - 2000;
            tvOffset.setText("Offset: " + (ms >= 0 ? "+" : "") + ms + " ms");
        };
        updateLabel.run();

        seekBar.setOnSeekBarChangeListener(new android.widget.SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(android.widget.SeekBar sb, int progress, boolean fromUser) {
                updateLabel.run();
            }
            @Override public void onStartTrackingTouch(android.widget.SeekBar sb) {}
            @Override public void onStopTrackingTouch(android.widget.SeekBar sb) {}
        });

        card.addView(tvOffset);
        card.addView(tvHint);
        card.addView(seekBar);
        card.addView(rangeRow);

        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        btnRow.setGravity(Gravity.CENTER);

        android.widget.Button btnReset = makeDialogButton("↺  Reset", false);
        android.widget.Button btnApply = makeDialogButton("✓  Apply", true);

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

    private android.widget.Button makeDialogButton(String text, boolean primary) {
        android.widget.Button btn = new android.widget.Button(this);
        btn.setText(text);
        btn.setTextColor(0xFFFFFFFF);
        btn.setTextSize(13);
        btn.setPadding(dp(16), dp(12), dp(16), dp(12));
        btn.setBackgroundColor(primary ? 0xFFE50914 : 0xFF333355);
        return btn;
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

    private void showTrackSelectionDialog() {
        if (player == null) return;
        try {
            TrackSelectionDialog dialog = TrackSelectionDialog.newInstance(player, null);
            dialog.show(getSupportFragmentManager(), "TrackSelectionDialog");
        } catch (Exception e) {
            Log.e(TAG, "TrackSelectionDialog error: " + e.getMessage());
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Preview frame retriever — uses local HTTP server URL once playback starts
    // ══════════════════════════════════════════════════════════════════════════
    private void setupPreviewRetriever() {
        if (previewThread != null) return;
        previewThread = new HandlerThread("PreviewFrameThread");
        previewThread.start();
        previewHandler = new Handler(previewThread.getLooper());

        String url = "http://127.0.0.1:" + HTTP_PORT + "/video";
        previewHandler.post(() -> {
            try {
                retriever = new MediaMetadataRetriever();
                retriever.setDataSource(url, requestHeaders);
            } catch (Exception e) {
                Log.e("PREVIEW", "Retriever error: " + e.getMessage());
            }
        });

        if (progressBar instanceof DefaultTimeBar) {
            ((DefaultTimeBar) progressBar).addListener(new TimeBar.OnScrubListener() {
                @Override public void onScrubStart(TimeBar timeBar, long position) {
                    autoHideHandler.removeCallbacks(autoHideRunnable);
                    if (previewContainer != null) previewContainer.setVisibility(View.VISIBLE);
                    updatePreviewFrame(position);
                }
                @Override public void onScrubMove(TimeBar timeBar, long position) {
                    autoHideHandler.removeCallbacks(autoHideRunnable);
                    updatePreviewFrame(position);
                }
                @Override public void onScrubStop(TimeBar timeBar, long position, boolean canceled) {
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
                    if (Math.abs(lastPreviewPos * 1000L - posUs) > 1000000L) {
                        fetchNextPreviewFrame();
                    }
                });
            }
        });
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  TV Remote / D-pad — identical to PlayerActivity (minus episode row)
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

        if (!playerStarted) return super.onKeyDown(keyCode, event);

        if (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) {
            if (player.isPlaying()) player.pause(); else player.play();
            animatePlayPause(); return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_REWIND)       { fastSeek(-10_000); return true; }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD) { fastSeek(10_000);  return true; }

        if (isLocked) return super.onKeyDown(keyCode, event);

        if (!controlsVisible) {
            switch (keyCode) {
                case KeyEvent.KEYCODE_DPAD_CENTER:
                case KeyEvent.KEYCODE_ENTER:
                    if (player.isPlaying()) player.pause(); else player.play();
                    animatePlayPause();
                    showControls();
                    return true;
                case KeyEvent.KEYCODE_DPAD_LEFT:
                    showControls(); fastSeek(-10_000); return true;
                case KeyEvent.KEYCODE_DPAD_RIGHT:
                    showControls(); fastSeek(10_000);  return true;
                case KeyEvent.KEYCODE_DPAD_UP:
                case KeyEvent.KEYCODE_DPAD_DOWN:
                    showControls(); return true;
            }
            return super.onKeyDown(keyCode, event);
        }

        scheduleHide();

        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
                activateFocused(); return true;

            case KeyEvent.KEYCODE_DPAD_UP:
                if (focusRow == 2) {
                    focusRow = 1; focusCol = 1;
                } else if (focusRow == 1) {
                    focusRow = 0; focusCol = 0;
                }
                updateFocusHighlight(); return true;

            case KeyEvent.KEYCODE_DPAD_DOWN:
                if (focusRow == 0) {
                    focusRow = 1; focusCol = 1;
                } else if (focusRow == 1) {
                    focusRow = 2;
                }
                updateFocusHighlight(); return true;

            case KeyEvent.KEYCODE_DPAD_LEFT:
                if (focusRow == 2) {
                    int repeat = event.getRepeatCount();
                    long step = repeat > 30 ? 5000 : repeat > 10 ? 1000 : 500;
                    fastSeek(-step);
                } else {
                    if (focusCol > 0) focusCol--;
                    updateFocusHighlight();
                }
                return true;

            case KeyEvent.KEYCODE_DPAD_RIGHT:
                if (focusRow == 2) {
                    int repeat = event.getRepeatCount();
                    long step = repeat > 30 ? 5000 : repeat > 10 ? 1000 : 500;
                    fastSeek(step);
                } else {
                    int max = (focusRow == 0) ? 4 : 2;
                    if (focusCol < max) focusCol++;
                    updateFocusHighlight();
                }
                return true;
        }

        return super.onKeyDown(keyCode, event);
    }

    private void activateFocused() {
        if (focusRow == 2) return;
        if (focusRow == 0) {
            switch (focusCol) {
                case 0: exitAndCleanup(); break; // Back
                case 1: if (btnPictureMode != null) btnPictureMode.performClick(); break;
                case 2: if (btnFullscreen  != null) btnFullscreen.performClick();  break;
                case 3: if (btnSync        != null) btnSync.performClick();        break;
                case 4: if (btnSettings    != null) btnSettings.performClick();    break;
            }
        } else if (focusRow == 1) {
            switch (focusCol) {
                case 0: fastSeek(-10_000); break;
                case 1:
                    if (player != null) { if (player.isPlaying()) player.pause(); else player.play(); }
                    animatePlayPause(); break;
                case 2: fastSeek(10_000); break;
            }
        }
        scheduleHide();
    }

    private void updateFocusHighlight() {
        clearHighlight(btnBack);
        clearHighlight(btnPictureMode);
        clearHighlight(btnFullscreen);
        clearHighlight(btnSync);
        clearHighlight(btnSettings);
        clearHighlight(btnRew);
        clearHighlight(btnPP);
        clearHighlight(btnFfwd);

        if (progressBar != null) {
            if (focusRow == 2) {
                progressBar.setScaleY(2.2f);
                progressBar.setAlpha(1f);
                progressBar.requestFocus();
                if (previewContainer != null) previewContainer.setVisibility(View.VISIBLE);
                updatePreviewFrame(player != null ? player.getCurrentPosition() : 0);
            } else {
                progressBar.setScaleY(1f);
                progressBar.setAlpha(0.6f);
                if (previewContainer != null) previewContainer.setVisibility(View.GONE);
            }
        }

        if (focusRow == 0) {
            switch (focusCol) {
                case 0: applyHighlight(btnBack);        break;
                case 1: applyHighlight(btnPictureMode); break;
                case 2: applyHighlight(btnFullscreen);  break;
                case 3: applyHighlight(btnSync);        break;
                case 4: applyHighlight(btnSettings);    break;
            }
        } else if (focusRow == 1) {
            switch (focusCol) {
                case 0: applyHighlight(btnRew);  break;
                case 1: applyHighlight(btnPP);   break;
                case 2: applyHighlight(btnFfwd); break;
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

    // ══════════════════════════════════════════════════════════════════════════
    //  Lifecycle
    // ══════════════════════════════════════════════════════════════════════════
    @Override protected void onResume() {
        super.onResume();
        hideSystemUI();
        if (player != null && playerStarted) player.play();
    }

    @Override protected void onPause() {
        super.onPause();
        if (player != null) player.pause();
        autoHideHandler.removeCallbacks(autoHideRunnable);
        autoHideHandler.removeCallbacks(hideLockUiRunnable);
    }

    @Override protected void onDestroy() {
        alive.set(false);
        handler().removeCallbacksAndMessages(null);
        if (previewThread != null) {
            previewThread.quitSafely();
            previewThread = null;
        }
        if (retriever != null) {
            try { retriever.release(); } catch (Exception ignored) {}
            retriever = null;
        }
        stopEverything();
        executor.shutdownNow();
        super.onDestroy();
    }

    /**
     * Stops playback + torrent + HTTP server, then deletes the cache directory
     * so nothing from this torrent session remains on disk after exit.
     * No SharedPreferences resume position is written for torrent playback.
     */
    private void exitAndCleanup() {
        alive.set(false);
        stopEverything();
        finish();
    }

    private void stopEverything() {
        if (player != null) { player.stop(); player.release(); player = null; }
        if (httpServer != null) { httpServer.stop(); httpServer = null; }
        if (session != null) {
            try {
                if (torrentHandle != null && torrentHandle.isValid()) {
                    session.remove(torrentHandle, SessionHandle.DELETE_FILES);
                }
            } catch (Exception ignored) {}
            try { session.stop(); } catch (Exception ignored) {}
            session = null;
        }

        final File toDelete = saveDir;
        new Thread(() -> {
            try {
                Thread.sleep(1000); // let libtorrent release file handles
                deleteRecursive(toDelete);
                Log.d(TAG, "Torrent cache cleared.");

                File tmp = new File(getCacheDir(), "temp.torrent");
                if (tmp.exists()) tmp.delete();
            } catch (Exception e) {
                Log.e(TAG, "Failed to clear cache: " + e.getMessage());
            }
        }).start();
    }

    private void deleteRecursive(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] kids = f.listFiles();
            if (kids != null) for (File k : kids) deleteRecursive(k);
        }
        f.delete();
    }
}