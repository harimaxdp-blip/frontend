package com.harimovies.app;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import android.content.Intent;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;

import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.harimovies.DeviceControlPlugin;

import java.util.ArrayList;

public class MainActivity extends BridgeActivity {

    private boolean playerOpened = false;
    private AudioManager audioManager;
@Override
public void onResume() {
    super.onResume();

    playerOpened = false;
}
    // ─────────────────────────────────────────────
    // REQUEST BRIGHTNESS PERMISSION
    // ─────────────────────────────────────────────
    private void requestBrightnessPermission() {

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (!Settings.System.canWrite(this)) {
                try {
                    Intent intent = new Intent(
                            Settings.ACTION_MANAGE_WRITE_SETTINGS,
                            Uri.parse("package:" + getPackageName())
                    );
                    startActivity(intent);
                } catch (android.content.ActivityNotFoundException e) {
                    Log.e("DeviceControl", "Setting MANAGE_WRITE_SETTINGS not found", e);
                }
            }
        }
    }

    // ─────────────────────────────────────────────
    // REAL DEVICE BRIGHTNESS
    // ─────────────────────────────────────────────
    public void setScreenBrightness(float brightness) {

        Log.d("DeviceControl", "setScreenBrightness called with: " + brightness);

        try {

            float clampedBrightness = Math.max(0.01f, Math.min(brightness, 1.0f));

            int value = (int) (clampedBrightness * 255);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {

                if (Settings.System.canWrite(this)) {

                    Log.d("DeviceControl", "Permission granted, setting global brightness to: " + value);

                    // SET MANUAL MODE
                    Settings.System.putInt(
                            getContentResolver(),
                            Settings.System.SCREEN_BRIGHTNESS_MODE,
                            Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL
                    );

                    Settings.System.putInt(
                            getContentResolver(),
                            Settings.System.SCREEN_BRIGHTNESS,
                            value
                    );
                } else {
                    Log.d("DeviceControl", "Permission NOT granted for WRITE_SETTINGS");
                }
            }

            WindowManager.LayoutParams layout =
                    getWindow().getAttributes();

            layout.screenBrightness = clampedBrightness;

            getWindow().setAttributes(layout);

            Log.d("DeviceControl", "Window brightness set to: " + clampedBrightness);

        } catch (Exception e) {

            Log.e("DeviceControl", "Error setting brightness", e);
        }
    }

    public float getScreenBrightness() {
        try {
            WindowManager.LayoutParams layout = getWindow().getAttributes();
            if (layout.screenBrightness >= 0f && layout.screenBrightness <= 1f) {
                return layout.screenBrightness;
            }

            int value = Settings.System.getInt(
                    getContentResolver(),
                    Settings.System.SCREEN_BRIGHTNESS
            );
            return Math.max(0.01f, Math.min(value / 255f, 1.0f));
        } catch (Exception e) {
            Log.e("DeviceControl", "Error getting brightness", e);
            return 1.0f;
        }
    }

    // ─────────────────────────────────────────────
    // REAL DEVICE MEDIA VOLUME
    // ─────────────────────────────────────────────
    public void setPlayerVolume(float volume) {

        Log.d("DeviceControl", "setPlayerVolume called with: " + volume);

        try {

            if (audioManager == null) {

                audioManager =
                        (AudioManager) getSystemService(AUDIO_SERVICE);
            }

            float clampedVolume = Math.max(0.0f, Math.min(volume, 1.0f));

            int maxVolume =
                    audioManager.getStreamMaxVolume(
                            AudioManager.STREAM_MUSIC
                    );

            int newVolume = Math.round(clampedVolume * maxVolume);

            Log.d("DeviceControl", "Setting media volume to: " + newVolume + " / " + maxVolume);

            audioManager.setStreamVolume(
                    AudioManager.STREAM_MUSIC,
                    newVolume,
                    0
            );

        } catch (Exception e) {

            Log.e("DeviceControl", "Error setting volume", e);
        }
    }

    public float getPlayerVolume() {
        try {
            if (audioManager == null) {
                audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
            }

            int maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            int currentVolume = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);

            if (maxVolume <= 0) return 1.0f;
            return Math.max(0.0f, Math.min(currentVolume / (float) maxVolume, 1.0f));
        } catch (Exception e) {
            Log.e("DeviceControl", "Error getting volume", e);
            return 1.0f;
        }
    }

    // ─────────────────────────────────────────────
    // FULLSCREEN IMMERSIVE
    // ─────────────────────────────────────────────
    private void hideSystemUI() {

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {

            WindowInsetsController controller =
                    getWindow().getInsetsController();

            if (controller != null) {

                controller.hide(
                        WindowInsets.Type.statusBars()
                                | WindowInsets.Type.navigationBars()
                );

                controller.setSystemBarsBehavior(
                        WindowInsetsController
                                .BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            }

        } else {

            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        }
    }

    // ─────────────────────────────────────────────
    // APP CREATE
    // ─────────────────────────────────────────────
    @Override
    protected void onCreate(Bundle savedInstanceState) {

        SplashScreen.installSplashScreen(this);

        registerPlugin(DeviceControlPlugin.class);

        super.onCreate(savedInstanceState);
WebView webView = bridge.getWebView();

webView.setWebViewClient(new WebViewClient() {
@Override
public void onPageStarted(
        WebView view,
        String url,
        android.graphics.Bitmap favicon) {

    playerOpened = false;

    super.onPageStarted(view, url, favicon);
}
    @Override
    public WebResourceResponse shouldInterceptRequest(
            WebView view,
            WebResourceRequest request) {

        String url = request.getUrl().toString();

        if (
    url.contains(".mp4") ||
    url.contains(".m3u8") ||
    url.contains(".mpd") ||
    url.contains("stream=1")
) {
    Log.e("VIDEO_MATCH", url);
}

if (playerOpened) {
    return super.shouldInterceptRequest(view, request);
}

if (url.contains(".m3u8") ||
    url.contains(".mp4") ||
    url.contains(".mpd") ||
    url.contains("stream=1")) {

    playerOpened = true;

    Log.d("VIDEO_FOUND", url);

    runOnUiThread(() -> {

        Intent intent = new Intent(
                MainActivity.this,
                PlayerActivity.class
        );

        intent.putExtra("url", url);

        startActivity(intent);
    });
}
        return super.shouldInterceptRequest(view, request);
    }
});
        requestBrightnessPermission();

        setVolumeControlStream(AudioManager.STREAM_MUSIC);

        WindowCompat.setDecorFitsSystemWindows(
                getWindow(),
                false
        );

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {

            WindowManager.LayoutParams params =
                    getWindow().getAttributes();

            params.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams
                            .LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;

            getWindow().setAttributes(params);
        }

        hideSystemUI();
    }

    // ─────────────────────────────────────────────
    // KEEP IMMERSIVE MODE
    // ─────────────────────────────────────────────
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {

        super.onWindowFocusChanged(hasFocus);

        if (hasFocus) {

            hideSystemUI();
        }
    }
}
