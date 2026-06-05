package com.harimovies.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class WebPlayerActivity extends Activity {

    private WebView webView;
    private volatile boolean launchedExo = false;
    private String videoTitle = "";
    private final Handler handler = new Handler(Looper.getMainLooper());

    private static final String[] VIDEO_EXTS = {
        ".mp4", ".m3u8", ".mkv", ".webm", ".ts",
        ".avi", ".mov", ".flv", ".mpd"
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        String url = getIntent().getStringExtra("url");
        videoTitle = getIntent().getStringExtra("title");
        if (videoTitle == null) videoTitle = "";

        webView = new WebView(this);
        setContentView(webView);

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
                String reqUrl = req.getUrl().toString();
                if (isVideoUrl(reqUrl)) {
                    launchExo(reqUrl);
                    return true;
                }
                return false;
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {
                String reqUrl = request.getUrl().toString();
                if (isVideoUrl(reqUrl) || isStreamUrl(reqUrl)) {
                    handler.post(() -> launchExo(reqUrl));
                }
                return null;
            }

            @Override
            public void onPageFinished(WebView view, String pageUrl) {
                injectVideoHunter();
            }
        });

        if (url != null) webView.loadUrl(url);
    }

    private void injectVideoHunter() {
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
            "  setTimeout(findAndReport, 3000);" +
            "  setTimeout(findAndReport, 6000);" +
            "  var obs = new MutationObserver(findAndReport);" +
            "  obs.observe(document.body || document.documentElement," +
            "    { childList: true, subtree: true, attributes: true });" +
            "})();";

        webView.evaluateJavascript(js, null);
    }

    private class JsBridge {
        @JavascriptInterface
        public void onVideoFound(String url) {
            if (url == null || url.isEmpty() || launchedExo) return;
            handler.post(() -> launchExo(url));
        }
    }

    private void launchExo(String url) {
        if (launchedExo) return;
        launchedExo = true;
        Intent intent = new Intent(this, PlayerActivity.class);
        intent.putExtra(PlayerActivity.EXTRA_URL, url);
        intent.putExtra(PlayerActivity.EXTRA_TITLE, videoTitle);
        startActivity(intent);
        finish();
    }

    private boolean isVideoUrl(String url) {
        if (url == null) return false;
        String lower = url.toLowerCase().split("\\?")[0];
        for (String ext : VIDEO_EXTS) {
            if (lower.endsWith(ext)) return true;
        }
        return false;
    }

    private boolean isStreamUrl(String url) {
        if (url == null) return false;
        return url.contains("stream=1")  ||
               url.contains(".m3u8")     ||
               url.contains(".mpd")      ||
               url.contains("/manifest") ||
               url.contains("/playlist");
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else finish();
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