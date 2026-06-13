package com.harimovies.app;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;


import com.github.se_bastiaan.torrentstream.StreamStatus;
import com.github.se_bastiaan.torrentstream.Torrent;
import com.github.se_bastiaan.torrentstream.TorrentOptions;
import com.github.se_bastiaan.torrentstream.TorrentStream;
import com.github.se_bastiaan.torrentstream.listeners.TorrentListener;

@UnstableApi
public class TorrentPlayerActivity extends AppCompatActivity {

    public static final String EXTRA_MAGNET = "magnet";
    public static final String EXTRA_TITLE  = "title";

    private static final String TAG = "TORRENT";

    private TorrentStream torrentStream;
    private ExoPlayer     player;
    private PlayerView    playerView;

    private ProgressBar   spinner;
    private LinearLayout  statusContainer;
    private TextView      tvStatus;
    private TextView      tvProgress;
    private TextView      tvSpeed;

    private boolean playerStarted = false;
    private final Handler handler = new Handler(Looper.getMainLooper());

    // ── Piece buffer threshold before we start playback (0–1)
    // 0.02 = start as soon as 2% is buffered, ExoPlayer handles the rest
    private static final float START_THRESHOLD = 0.02f;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemUI();

        String magnetUrl = getIntent().getStringExtra(EXTRA_MAGNET);
        String title     = getIntent().getStringExtra(EXTRA_TITLE);
        if (title == null) title = "Streaming…";

        // ── Build layout programmatically ────────────────────────────────────
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF000000);

        // PlayerView (hidden until stream is ready)
        playerView = new PlayerView(this);
        playerView.setVisibility(View.INVISIBLE);
        root.addView(playerView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        // Loading overlay
        LinearLayout overlay = new LinearLayout(this);
        overlay.setOrientation(LinearLayout.VERTICAL);
        overlay.setGravity(Gravity.CENTER);
        overlay.setBackgroundColor(0xFF000000);
        FrameLayout.LayoutParams overlayLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT);
        root.addView(overlay, overlayLp);
        statusContainer = overlay;

        spinner = new ProgressBar(this);
        spinner.setIndeterminate(true);
        spinner.getIndeterminateDrawable().setColorFilter(
                0xFFE50914, android.graphics.PorterDuff.Mode.SRC_IN);
        LinearLayout.LayoutParams spLp = new LinearLayout.LayoutParams(dp(48), dp(48));
        spLp.setMargins(0, 0, 0, dp(24));
        spinner.setLayoutParams(spLp);
        overlay.addView(spinner);

        tvStatus = new TextView(this);
        tvStatus.setText("Connecting to peers…");
        tvStatus.setTextColor(0xFFFFFFFF);
        tvStatus.setTextSize(15);
        tvStatus.setGravity(Gravity.CENTER);
        overlay.addView(tvStatus);

        tvProgress = new TextView(this);
        tvProgress.setTextColor(0xAAFFFFFF);
        tvProgress.setTextSize(13);
        tvProgress.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams pLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        pLp.setMargins(0, dp(8), 0, 0);
        tvProgress.setLayoutParams(pLp);
        overlay.addView(tvProgress);

        tvSpeed = new TextView(this);
        tvSpeed.setTextColor(0x88FFFFFF);
        tvSpeed.setTextSize(11);
        tvSpeed.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams sLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        sLp.setMargins(0, dp(4), 0, 0);
        tvSpeed.setLayoutParams(sLp);
        overlay.addView(tvSpeed);

        setContentView(root);

        // ── Back press ───────────────────────────────────────────────────────
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                stopEverything();
                finish();
            }
        });

        // ── ExoPlayer ────────────────────────────────────────────────────────
        player = new ExoPlayer.Builder(this).build();
        playerView.setPlayer(player);
        playerView.setControllerShowTimeoutMs(4000);
        playerView.setUseController(true);

        player.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(PlaybackException e) {
                Log.e(TAG, "ExoPlayer error: " + e.getMessage());
                handler.post(() ->
                    Toast.makeText(TorrentPlayerActivity.this,
                            "Playback error — try again", Toast.LENGTH_SHORT).show());
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY && !playerStarted) {
                    playerStarted = true;
                    handler.post(() -> {
                        statusContainer.setVisibility(View.GONE);
                        playerView.setVisibility(View.VISIBLE);
                    });
                }
            }
        });

        // ── TorrentStream ────────────────────────────────────────────────────
        if (magnetUrl == null || magnetUrl.isEmpty()) {
            Toast.makeText(this, "No magnet link provided", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        TorrentOptions options = new TorrentOptions.Builder()
                .saveLocation(getCacheDir().getAbsolutePath()) // temp cache only
                .removeFilesAfterStop(true)                    // auto-delete on stop
                .maxConnections(200)
                .maxDownloadSpeed(0)   // unlimited
                .maxUploadSpeed(10)    // limit seeding to save bandwidth
                .anonymousMode(false)
                .build();

        torrentStream = TorrentStream.init(options);

        torrentStream.addListener(new TorrentListener() {

            @Override
            public void onStreamReady(Torrent torrent) {
                String streamUrl = "http://127.0.0.1:8080/" +
                        Uri.encode(torrent.getVideoFile().getName());
                Log.d(TAG, "Stream ready: " + streamUrl);

                handler.post(() -> {
                    tvStatus.setText("Buffering…");
                    player.setMediaItem(MediaItem.fromUri(Uri.parse(streamUrl)));
                    player.prepare();
                    player.play();
                });
            }

            @Override
            public void onStreamProgress(Torrent torrent, StreamStatus status) {
                handler.post(() -> {
                    float pct     = status.bufferProgress * 100f;
                    float dlKbps  = status.downloadSpeed / 1024f;
                    int   peers   = status.seeds;

                    tvProgress.setText(String.format("Buffer: %.1f%%  •  Peers: %d", pct, peers));
                    tvSpeed.setText(String.format("↓ %.0f KB/s", dlKbps));

                    if (pct < 1f) {
                        tvStatus.setText("Connecting to peers…");
                    } else if (!playerStarted) {
                        tvStatus.setText("Buffering stream…");
                    } else {
                        tvStatus.setText("Streaming");
                    }
                });
            }

            @Override
            public void onStreamPrepared(Torrent torrent) {
                Log.d(TAG, "Torrent prepared, selecting largest video file");
                handler.post(() -> tvStatus.setText("Preparing torrent…"));
            }

            @Override
            public void onStreamStarted(Torrent torrent) {
                Log.d(TAG, "Stream started");
                handler.post(() -> tvStatus.setText("Starting stream…"));
            }

            @Override
            public void onStreamStopped() {
                Log.d(TAG, "Stream stopped");
            }

            @Override
            public void onStreamError(Torrent torrent, Exception e) {
                Log.e(TAG, "Stream error: " + e.getMessage());
                handler.post(() -> {
                    Toast.makeText(TorrentPlayerActivity.this,
                            "Stream error: " + e.getMessage(), Toast.LENGTH_LONG).show();
                    finish();
                });
            }
        });

        Log.d(TAG, "Starting stream: " + magnetUrl);
        torrentStream.startStream(magnetUrl);
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemUI();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (player != null) player.pause();
    }

    @Override
    protected void onDestroy() {
        stopEverything();
        super.onDestroy();
    }

    private void stopEverything() {
        if (player != null) {
            player.stop();
            player.release();
            player = null;
        }
        if (torrentStream != null) {
            try {
                torrentStream.stopStream(); // also triggers removeFilesAfterStop
            } catch (Exception e) {
                Log.e(TAG, "stopStream error: " + e.getMessage());
            }
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private int dp(int val) {
        return (int)(val * getResources().getDisplayMetrics().density);
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
}