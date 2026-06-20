package com.harimovies.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.media3.common.util.UnstableApi;

import com.getcapacitor.BridgeActivity;
import com.harimovies.DeviceControlPlugin;

import org.json.JSONObject;

import java.io.File;
import java.util.Map;

@UnstableApi
public class MainActivity extends BridgeActivity {

    private AudioManager audioManager;

    // ─────────────────────────────────────────────
    // JS BRIDGE — exposed to Capacitor WebView as window.HariMovies
    // ─────────────────────────────────────────────

    public class HariMoviesBridge {

        // Returns ALL key→value pairs from a SharedPreferences file as a JSON string.
        // Home.js calls: window.HariMovies.getSharedPrefAll("hm_last_watched")
        @JavascriptInterface
        public String getSharedPrefAll(String prefsName) {
            try {
                SharedPreferences prefs = getSharedPreferences(prefsName, MODE_PRIVATE);
                Map<String, ?> all = prefs.getAll();
                JSONObject json = new JSONObject();
                for (Map.Entry<String, ?> entry : all.entrySet()) {
                    json.put(entry.getKey(), String.valueOf(entry.getValue()));
                }
                return json.toString();
            } catch (Exception e) {
                Log.e("HariMoviesBridge", "getSharedPrefAll failed: " + e.getMessage());
                return "{}";
            }
        }

        // Returns a single value from a SharedPreferences file.
        @JavascriptInterface
        public String getSharedPref(String prefsName, String key) {
            try {
                return getSharedPreferences(prefsName, MODE_PRIVATE)
                        .getString(key, null);
            } catch (Exception e) {
                Log.e("HariMoviesBridge", "getSharedPref failed: " + e.getMessage());
                return null;
            }
        }

        @JavascriptInterface
        public void quitApp() {
            try {
                finishAffinity();
                System.exit(0);
            } catch (Exception e) {
                Log.e("HariMoviesBridge", "quitApp failed: " + e.getMessage());
            }
        }
    }

    // ─────────────────────────────────────────────
    // LIFECYCLE
    // ─────────────────────────────────────────────

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        androidx.core.splashscreen.SplashScreen splashScreen = androidx.core.splashscreen.SplashScreen.installSplashScreen(this);
        registerPlugin(DeviceControlPlugin.class);
        super.onCreate(savedInstanceState);

        // Keep splash screen until WebView is ready
        splashScreen.setKeepOnScreenCondition(() -> this.bridge == null || this.bridge.getWebView() == null);

        // Fix white flash: set WebView background to black immediately
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().setBackgroundColor(android.graphics.Color.BLACK);
        }

        // Global Torrent Cache Cleanup
        // Ensures that if TorrentPlayerActivity crashed or was killed,
        // we clean up the storage when the user opens the app again.
        new Thread(this::cleanTorrentCache).start();

        // Register HariMoviesBridge on the Capacitor WebView AFTER super.onCreate()
        // so that bridge.getWebView() is ready.
        registerHariMoviesBridge();

        requestBrightnessPermission();
        setVolumeControlStream(AudioManager.STREAM_MUSIC);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams params = getWindow().getAttributes();
            params.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(params);
        }

        hideSystemUI();
    }

    private void registerHariMoviesBridge() {
        try {
            WebView webView = this.bridge.getWebView();
            webView.addJavascriptInterface(new HariMoviesBridge(), "HariMovies");
            Log.d("HariMoviesBridge", "Registered successfully on Capacitor WebView");
        } catch (Exception e) {
            Log.e("HariMoviesBridge", "Failed to register bridge: " + e.getMessage());
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        hideSystemUI();

        // Small delay to ensure WebView is ready for JS execution
        new Handler(Looper.getMainLooper()).postDelayed(this::syncLastWatchedToLocalStorage, 500);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUI();
    }

    // ─────────────────────────────────────────────
    // SYNC SharedPrefs → WebView localStorage
    // Called on every onResume so returning from PlayerActivity
    // always gives Home.js the latest last-watched data.
    // ─────────────────────────────────────────────

    private void syncLastWatchedToLocalStorage() {
        try {
            SharedPreferences prefs = getSharedPreferences("hm_last_watched", MODE_PRIVATE);
            Map<String, ?> all = prefs.getAll();
            if (all == null || all.isEmpty()) return;

            // Build the flat map that Home.js stores under "ott_last_watched":
            // { "normalizedTitle_s1": { episodeNum: "3", episodeId: "abc" }, ... }
            JSONObject fullMap = new JSONObject();
            for (Map.Entry<String, ?> entry : all.entrySet()) {
                try {
                    // Each value is a JSON string like '{"episodeNum":"3","episodeId":"xyz"}'
                    JSONObject epData = new JSONObject(String.valueOf(entry.getValue()));
                    fullMap.put(entry.getKey(), epData);
                } catch (Exception parseEx) {
                    Log.w("HariMoviesBridge", "Skipping malformed entry: " + entry.getKey());
                }
            }

            // Escape for injection into a JS string literal
            String jsonStr = fullMap.toString().replace("\\", "\\\\").replace("'", "\\'");

            Log.d("LASTWATCH", "Syncing to JS: " + jsonStr);

            String js =
                "(function() {" +
                "  try {" +
                "    var incoming = JSON.parse('" + jsonStr + "');" +
                "    var existing = {};" +
                "    try { existing = JSON.parse(localStorage.getItem('ott_last_watched') || '{}'); } catch(e) {}" +
                "    var merged = Object.assign({}, existing, incoming);" +
                "    localStorage.setItem('ott_last_watched', JSON.stringify(merged));" +
                "    console.log('[HariMovies] Synced last_watched to localStorage');" +
                "    if (window.dispatchEvent) {" +
                "        window.dispatchEvent(new Event('storage'));" +
                "        window.dispatchEvent(new CustomEvent('lastWatchedUpdated'));" +
                "    }" +
                "  } catch(e) {" +
                "    console.warn('[HariMovies] sync failed', e);" +
                "  }" +
                "})();";

            this.bridge.getWebView().post(() ->
                this.bridge.getWebView().evaluateJavascript(js, null)
            );

        } catch (Exception e) {
            Log.e("HariMoviesBridge", "syncLastWatchedToLocalStorage failed: " + e.getMessage());
        }
    }

    // ─────────────────────────────────────────────
    // BRIGHTNESS PERMISSION
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
                    Log.e("DeviceControl", "MANAGE_WRITE_SETTINGS not found", e);
                }
            }
        }
    }

    // ─────────────────────────────────────────────
    // BRIGHTNESS
    // ─────────────────────────────────────────────

    public void setScreenBrightness(float brightness) {
        Log.d("DeviceControl", "setScreenBrightness: " + brightness);
        try {
            float clamped = Math.max(0.01f, Math.min(brightness, 1.0f));
            int value = (int) (clamped * 255);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                if (Settings.System.canWrite(this)) {
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
                }
            }

            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.screenBrightness = clamped;
            getWindow().setAttributes(lp);

        } catch (Exception e) {
            Log.e("DeviceControl", "Error setting brightness", e);
        }
    }

    public float getScreenBrightness() {
        try {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            if (lp.screenBrightness >= 0f && lp.screenBrightness <= 1f) {
                return lp.screenBrightness;
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
    // VOLUME
    // ─────────────────────────────────────────────

    public void setPlayerVolume(float volume) {
        Log.d("DeviceControl", "setPlayerVolume: " + volume);
        try {
            if (audioManager == null) {
                audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
            }
            float clamped = Math.max(0.0f, Math.min(volume, 1.0f));
            int max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            int newVol = Math.round(clamped * max);
            audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, newVol, 0);
        } catch (Exception e) {
            Log.e("DeviceControl", "Error setting volume", e);
        }
    }

    public float getPlayerVolume() {
        try {
            if (audioManager == null) {
                audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
            }
            int max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            int current = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
            if (max <= 0) return 1.0f;
            return Math.max(0.0f, Math.min(current / (float) max, 1.0f));
        } catch (Exception e) {
            Log.e("DeviceControl", "Error getting volume", e);
            return 1.0f;
        }
    }

    // ─────────────────────────────────────────────
    // IMMERSIVE FULLSCREEN
    // ─────────────────────────────────────────────

    private void hideSystemUI() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(
                        WindowInsets.Type.statusBars() |
                        WindowInsets.Type.navigationBars()
                );
                controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
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

    private void cleanTorrentCache() {
        try {
            File cacheDir = new File(getCacheDir(), "torrent_stream");
            if (cacheDir.exists()) {
                Log.d("HariMovies", "Cleaning global torrent cache...");
                deleteRecursive(cacheDir);
            }
        } catch (Exception e) {
            Log.e("HariMovies", "Error cleaning cache", e);
        }
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