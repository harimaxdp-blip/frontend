package com.harimovies.app;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.util.UnstableApi;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowManager;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;

@UnstableApi
public class WebPlayerActivity extends AppCompatActivity {
    private WebView webView;
    private volatile boolean launchedExo = false;
    private String videoTitle = "";
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

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        ProgressBar spinner = new ProgressBar(this);
        spinner.getIndeterminateDrawable().setColorFilter(
            android.graphics.Color.RED,
            android.graphics.PorterDuff.Mode.SRC_IN
        );
        spinner.setIndeterminate(true);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
        );
        lp.gravity = android.view.Gravity.CENTER;
        spinner.setLayoutParams(lp);
        root.addView(spinner);

        webView = new WebView(this);
        webView.setVisibility(View.INVISIBLE);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        setContentView(root);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                } else {
                    finish();
                }
            }
        });

        String url = getIntent().getStringExtra("url");
        Log.d("WEB_DEBUG", "WEBPLAYER_URL=" + url);
        videoTitle = getIntent().getStringExtra("title");
        playlistJson = getIntent().getStringExtra("playlist");
        currentIndex = getIntent().getIntExtra("index", 0);
        if (videoTitle == null) videoTitle = "";

        // Normalize playlist: treat empty/invalid as null
        if (playlistJson != null &&
            (playlistJson.isEmpty() || playlistJson.equals("null") || playlistJson.equals("[]"))) {
            playlistJson = null;
        }

        Log.d("WEB_DEBUG", "WEBPLAYER_TITLE=" + videoTitle);
        Log.d("WEB_DEBUG", "WEBPLAYER_PLAYLIST=" + (playlistJson != null ? "length=" + playlistJson.length() : "NULL"));
        Log.d("WEB_DEBUG", "WEBPLAYER_INDEX=" + currentIndex);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(
            "Mozilla/5.0 (Linux; Android 11; Mobile) " +
            "AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/114.0.0.0 Mobile Safari/537.36"
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
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return false;
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {

                String reqUrl = request.getUrl().toString();
                String method = request.getMethod();

                if (!"GET".equals(method)) return null;

                String lower = reqUrl.toLowerCase();

                for (String skip : SKIP_EXTS) {
                    if (lower.contains(skip)) return null;
                }

                if (lower.contains("google") || lower.contains("facebook") ||
                    lower.contains("analytics") || lower.contains("doubleclick") ||
                    lower.contains("ads") || lower.contains("tracker")) {
                    return null;
                }

                Log.d("WEB_DEBUG", "INTERCEPT=" + reqUrl);

                if (!launchedExo && isStrictVideoUrl(lower)) {
                    Log.d("WEB_DEBUG", "VIDEO_STREAM_FOUND=" + reqUrl);
                    handler.post(() -> launchExo(reqUrl));
                }

                return null;
            }

            @Override
            public void onPageFinished(WebView view, String pageUrl) {
                injectVideoHunter();
                handler.postDelayed(() -> injectVideoHunter(), 2000);
                handler.postDelayed(() -> injectVideoHunter(), 5000);
            }
        });

        if (url != null) webView.loadUrl(url);
    }

    private boolean isStrictVideoUrl(String lower) {
        if (lower.contains(".m3u8")) return true;
        if (lower.contains(".mpd")) return true;
        if (lower.endsWith(".mp4") || lower.matches(".*\\.mp4[?#].*")) return true;
        if (lower.endsWith(".mkv") || lower.endsWith(".webm")) return true;
        if (lower.endsWith(".ts") && (
            lower.contains("/seg") || lower.contains("/chunk") ||
            lower.contains("/frag") || lower.contains("/ts/") ||
            lower.contains("segment"))) return true;
        if (lower.contains("stream=1") && lower.contains("download.php")) return true;
        return false;
    }

    private void injectVideoHunter() {
        if (launchedExo) return;
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
            "  setTimeout(findAndReport, 1500);" +
            "  setTimeout(findAndReport, 3500);" +
            "  setTimeout(findAndReport, 7000);" +
            "  var obs = new MutationObserver(findAndReport);" +
            "  obs.observe(document.body || document.documentElement," +
            "    { childList: true, subtree: true, attributes: true });" +
            "})();";
        webView.evaluateJavascript(js, null);
    }

    private class JsBridge {
        @JavascriptInterface
        public void onVideoFound(String url) {
            Log.d("WEB_DEBUG", "JS_VIDEO_FOUND=" + url);
            if (url == null || url.isEmpty() || launchedExo) return;
            String lower = url.toLowerCase();
            if (!lower.contains(".m3u8") && !lower.contains(".mp4") &&
                !lower.contains(".mkv") && !lower.contains(".webm") &&
                !lower.contains(".mpd") && !lower.endsWith(".ts")) {
                Log.d("WEB_DEBUG", "JS_FOUND_BUT_NOT_VIDEO=" + url);
                return;
            }
            handler.post(() -> launchExo(url));
        }
    }

    /**
     * FIX: Always forward playlist + index so PlayerActivity never loses
     * series context after WebPlayer resolves the real stream URL.
     */
    private void launchExo(String url) {
        if (launchedExo) return;
        launchedExo = true;

        Log.d("WEB_DEBUG", "LAUNCHING_EXO_WITH=" + url);
        Log.d("WEB_DEBUG", "FORWARDING_PLAYLIST=" + (playlistJson != null ? "yes len=" + playlistJson.length() : "none"));
        Log.d("WEB_DEBUG", "FORWARDING_INDEX=" + currentIndex);

        Intent intent = new Intent(this, PlayerActivity.class);
        intent.putExtra(PlayerActivity.EXTRA_URL, url);
        intent.putExtra(PlayerActivity.EXTRA_TITLE, videoTitle);

        // KEY FIX: always pass playlist + index so series nav works
        if (playlistJson != null) {
            intent.putExtra("playlist", playlistJson);
            intent.putExtra("index", currentIndex);
        }

        startActivity(intent);
        finish();
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