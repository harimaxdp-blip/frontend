package com.harimovies.app;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.util.UnstableApi;
import android.animation.AnimatorSet;
import android.animation.ObjectAnimator;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.view.animation.DecelerateInterpolator;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

@UnstableApi
public class WebPlayerActivity extends AppCompatActivity {
    private WebView webView;
    private View    brandedLoader;       // ── full-screen branded loading UI
    private volatile boolean launchedExo = false;

    // ── NEW: true the instant the user backs out / quits during loading.
    // Once this flips, NO pending callback is allowed to launch ExoPlayer.
    private volatile boolean userExited = false;

    private String videoTitle = "";
    private String seriesTitle = "";
    private String playlistJson = null;
    private int currentIndex = 0;
    private final Handler handler = new Handler(Looper.getMainLooper());

    // These are page/asset extensions — never video
    private static final String[] SKIP_EXTS = {
        ".js", ".css", ".html", ".htm", ".php", ".json",
        ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
        ".woff", ".woff2", ".ttf", ".eot", ".map",
        ".xml", ".txt"
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // ── Root: pure black canvas ───────────────────────────────────────────
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        // ── WebView: INVISIBLE — user NEVER sees the embed page ───────────────
        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        webView.setVisibility(View.INVISIBLE);   // ← KEY FIX: hidden always
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        // ── Branded loading screen (sits on top of hidden WebView) ────────────
        brandedLoader = buildBrandedLoader();
        root.addView(brandedLoader, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        setContentView(root);

        // ── FIXED: back press / gesture-quit while on the loader ───────────────
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                userExited = true;
                launchedExo = true; // belt-and-suspenders: blocks any launchExo() check too
                handler.removeCallbacksAndMessages(null);
                if (webView != null) {
                    webView.stopLoading();
                    webView.loadUrl("about:blank");
                }
                finish();
            }
        });

        String url = getIntent().getStringExtra("url");
        if (url != null && !url.isEmpty() && !url.startsWith("http") && !url.startsWith("magnet:")) {
            url = "https://" + url;
        }
        Log.d("WEB_DEBUG", "WEBPLAYER_URL=" + url);
        videoTitle    = getIntent().getStringExtra("title");
        seriesTitle   = getIntent().getStringExtra("series_title");
        playlistJson  = getIntent().getStringExtra("playlist");
        currentIndex  = getIntent().getIntExtra("index", 0);
        if (videoTitle == null) videoTitle = "";
        if (seriesTitle == null) seriesTitle = "";

        // Normalize playlist
        if (playlistJson != null &&
            (playlistJson.isEmpty() || playlistJson.equals("null") || playlistJson.equals("[]"))) {
            playlistJson = null;
        }

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        webView.addJavascriptInterface(new JsBridge(), "Android");
        webView.setWebChromeClient(new WebChromeClient());

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedSslError(WebView view, android.webkit.SslErrorHandler handler, android.net.http.SslError error) {
                handler.proceed();
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (userExited || launchedExo) return null;
                String reqUrl  = request.getUrl().toString();
                if (!"GET".equals(request.getMethod())) return null;
                
                if (isVideoResource(reqUrl)) {
                    Log.d("STREAM_FOUND", "URL: " + reqUrl);
                    handler.post(() -> launchExo(reqUrl));
                }
                return null;
            }

            @Override
            public void onPageFinished(WebView view, String pageUrl) {
                if (userExited || launchedExo) return;
                injectVideoHunter();
            }
        });

        if (url != null) {
            webView.loadUrl(url);
            handler.postDelayed(() -> {
                if (!launchedExo && !userExited && !isFinishing()) {
                    showNotFoundHint();
                    handler.postDelayed(this::finish, 2500);
                }
            }, 30000);
        }
    }

    private boolean isVideoResource(String url) {
        if (url == null) return false;
        String lower = url.toLowerCase();
        return lower.contains(".m3u8") || lower.contains(".mpd") || lower.contains(".mp4") 
                || lower.contains(".mkv") || lower.contains(".webm") || lower.contains(".ts")
                || lower.contains("blob:") || lower.contains("manifest") || lower.contains("playlist.m3u8")
                || lower.contains("/hls/") || lower.contains("/dash/");
    }

    private void injectVideoHunter() {
        if (launchedExo || userExited) return;
        String js =
            "(function() {" +
            "  if (window.__hmHunterRunning) return;" +
            "  window.__hmHunterRunning = true;" +
            "  function findAndReport() {" +
            "    var videos = document.querySelectorAll('video');" +
            "    for (var i = 0; i < videos.length; i++) {" +
            "      var src = videos[i].src || videos[i].currentSrc;" +
            "      if (src && src.indexOf('http') === 0) {" +
            "        Android.onVideoFound(src); return;" +
            "      }" +
            "      var sources = videos[i].querySelectorAll('source');" +
            "      for (var j = 0; j < sources.length; j++) {" +
            "        if (sources[j].src && sources[j].src.indexOf('http') === 0) {" +
            "          Android.onVideoFound(sources[j].src); return;" +
            "        }" +
            "      }" +
            "    }" +
            "    if (window.jwplayer && typeof window.jwplayer === 'function') {" +
            "       try {" +
            "           var playlist = window.jwplayer().getPlaylist();" +
            "           if (playlist && playlist[0] && playlist[0].file) {" +
            "               Android.onVideoFound(playlist[0].file); return;" +
            "           }" +
            "       } catch(e) {}" +
            "    }" +
            "    if (window.videojs) {" +
            "       try {" +
            "           var players = window.videojs.players;" +
            "           for (var p in players) {" +
            "               var src = players[p].src();" +
            "               if (src) { Android.onVideoFound(src); return; }" +
            "           }" +
            "       } catch(e) {}" +
            "    }" +
            "    var iframes = document.querySelectorAll('iframe');" +
            "    for (var k = 0; k < iframes.length; k++) {" +
            "       var isrc = iframes[k].src;" +
            "       if (isrc && (isrc.includes('.m3u8') || isrc.includes('.mp4'))) {" +
            "           Android.onVideoFound(isrc); return;" +
            "       }" +
            "    }" +
            "    var html = document.documentElement.innerHTML;" +
            "    var patterns = [" +
            "      /[\"'`](https?:\\/\\/[^\"'`\\s]+\\.m3u8[^\"'`\\s]*?)[\"'`]/i," +
            "      /[\"'`](https?:\\/\\/[^\"'`\\s]+\\.mp4[^\"'`\\s]*?)[\"'`]/i," +
            "      /[\"'`](https?:\\/\\/[^\"'`\\s]+\\.mkv[^\"'`\\s]*?)[\"'`]/i," +
            "      /[\"'`](https?:\\/\\/[^\"'`\\s]+\\.mpd[^\"'`\\s]*?)[\"'`]/i" +
            "    ];" +
            "    for (var p = 0; p < patterns.length; p++) {" +
            "      var m = html.match(patterns[p]);" +
            "      if (m && m[1]) { Android.onVideoFound(m[1]); return; }" +
            "    }" +
            "  }" +
            "  findAndReport();" +
            "  var obs = new MutationObserver(findAndReport);" +
            "  obs.observe(document.body || document.documentElement," +
            "    { childList: true, subtree: true, attributes: true });" +
            "})();";
        webView.evaluateJavascript(js, null);
    }

    private class JsBridge {
        @JavascriptInterface
        public void onVideoFound(String url) {
            if (url == null || url.isEmpty() || launchedExo || userExited) return;
            handler.post(() -> launchExo(url));
        }
    }

    private void launchExo(String url) {
        if (launchedExo || userExited || isFinishing()) return;
        launchedExo = true;
        Log.d("STREAM_PLAYING", "URL: " + url);

        Intent intent = new Intent(this, PlayerActivity.class);
        intent.putExtra(PlayerActivity.EXTRA_URL, url);
        intent.putExtra(PlayerActivity.EXTRA_TITLE, videoTitle);
        intent.putExtra(PlayerActivity.EXTRA_SERIES_TITLE, seriesTitle);
        if (playlistJson != null) {
            intent.putExtra("playlist", playlistJson);
            intent.putExtra("index", currentIndex);
        }
        startActivity(intent);
        overridePendingTransition(0, 0);
        finish();
    }

    private View buildBrandedLoader() {
        FrameLayout container = new FrameLayout(this);
        container.setBackgroundColor(0xFF000000);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER);
        FrameLayout.LayoutParams colLp = new FrameLayout.LayoutParams(-2, -2);
        colLp.gravity = Gravity.CENTER;
        col.setLayoutParams(colLp);
        
        ProgressBar spinner = new ProgressBar(this);
        spinner.getIndeterminateDrawable().setColorFilter(0xFFE50914, android.graphics.PorterDuff.Mode.SRC_IN);
        col.addView(spinner);

        TextView tvLabel = new TextView(this);
        tvLabel.setTag("status_label");
        tvLabel.setText("Preparing your stream...");
        tvLabel.setTextColor(0xAAFFFFFF);
        tvLabel.setPadding(0, dp(20), 0, 0);
        col.addView(tvLabel);

        container.addView(col);
        return container;
    }

    private void showNotFoundHint() {
        try {
            TextView label = brandedLoader.findViewWithTag("status_label");
            if (label != null) label.setText("No stream found. Try another provider.");
        } catch(Exception e) {}
    }

    private int dp(int val) {
        return (int)(val * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}
