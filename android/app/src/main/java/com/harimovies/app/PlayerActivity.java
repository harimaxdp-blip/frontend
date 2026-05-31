package com.harimovies.app;

import android.net.Uri;
import android.os.Bundle;
import android.util.Log;

import androidx.appcompat.app.AppCompatActivity;

import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;

import androidx.media3.datasource.DefaultHttpDataSource;

import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;

import androidx.media3.ui.PlayerView;

import java.util.HashMap;
import java.util.Map;

public class PlayerActivity extends AppCompatActivity {

    private ExoPlayer player;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        PlayerView playerView = new PlayerView(this);
        setContentView(playerView);

        String url = getIntent().getStringExtra("url");

        Log.d("EXOPLAYER", "URL = " + url);

        player = new ExoPlayer.Builder(this).build();
        playerView.setPlayer(player);

        DefaultHttpDataSource.Factory dataSourceFactory =
                new DefaultHttpDataSource.Factory()
                        .setUserAgent(
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
                        );

        Map<String, String> headers = new HashMap<>();

        headers.put(
                "Referer",
                "https://dub.onestream.today/"
        );

        headers.put(
                "Cookie",
                "cache_2685d8fa2727bff6=1781032689"
        );

        dataSourceFactory.setDefaultRequestProperties(headers);

        MediaSource mediaSource =
                new ProgressiveMediaSource.Factory(dataSourceFactory)
                        .createMediaSource(
                                MediaItem.fromUri(Uri.parse(url))
                        );

        player.setMediaSource(mediaSource);

        player.addListener(new Player.Listener() {

            @Override
            public void onPlayerError(PlaybackException error) {
                Log.e(
                        "EXOPLAYER",
                        "ERROR = " + error.getMessage(),
                        error
                );
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                Log.d(
                        "EXOPLAYER",
                        "STATE = " + state
                );
            }
        });

        player.prepare();
        player.play();
    }

    @Override
    protected void onDestroy() {
        if (player != null) {
            player.release();
        }
        super.onDestroy();
    }
}