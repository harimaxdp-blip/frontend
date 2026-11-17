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
import android.net.Uri;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.view.animation.DecelerateInterpolator;
import android.util.Log;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

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
    private int sourceCheckAttempts = 0;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private static final int MAX_SOURCE_CHECK_ATTEMPTS = 120;
    private static final String VIDEO_ELEMENT_SOURCE_SCRIPT =
        "(function(){" +
        "try{" +
        "var videos=document.querySelectorAll('video');" +
        "for(var i=0;i<videos.length;i++){" +
        "var video=videos[i];" +
        "var rect=video.getBoundingClientRect();" +
        "if(rect.width<2||rect.height<2)continue;" +
        "if(video.paused)continue;" +
        "var candidates=[{url:video.currentSrc,type:video.type},{url:video.src,type:video.type}];" +
        "var sources=video.querySelectorAll('source');" +
        "for(var j=0;j<sources.length;j++)candidates.push({url:sources[j].src,type:sources[j].type});" +
        "for(var k=0;k<candidates.length;k++){" +
        "if(!candidates[k].url)continue;" +
        "try{" +
        "var media=new URL(candidates[k].url,document.baseURI);" +
        "if(media.protocol!=='https:'&&media.protocol!=='http:')continue;" +
        "var path=media.pathname.toLowerCase();" +
        "if(/\\.(html?|json|txt)$/i.test(path))continue;" +
        "var mime=(candidates[k].type||'').split(';')[0].toLowerCase();" +
        "var type=/\\.m3u8$/i.test(path)?'hls':/\\.mpd$/i.test(path)?'dash':" +
        "/\\.mp4$/i.test(path)?'mp4':/\\.webm$/i.test(path)?'webm':" +
        "/\\.(mkv|avi|mov|ogv|3gp|wmv|flv)$/i.test(path)?'remux':" +
        "/mpegurl/i.test(mime)?'hls':mime==='application/dash+xml'?'dash':" +
        "mime==='video/mp4'?'mp4':mime==='video/webm'?'webm':" +
        "mime==='video/x-matroska'?'remux':'';" +
        "if(type)return JSON.stringify({url:media.href,type:type,position:video.currentTime||0});" +
        "}catch(e){}" +
        "}" +
        "}" +
        "}catch(e){}" +
        "return '';" +
        "})()";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // ── Root: pure black canvas ───────────────────────────────────────────
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        // Keep the provider's page available whenever no direct video element is exposed.
        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        webView.setVisibility(View.VISIBLE);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
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
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setUserAgentString(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebChromeClient(new WebChromeClient());

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedSslError(WebView view, android.webkit.SslErrorHandler handler, android.net.http.SslError error) {
                handler.cancel();
                runOnUiThread(() -> {
                    if (brandedLoader != null) brandedLoader.setVisibility(View.GONE);
                    Toast.makeText(WebPlayerActivity.this,
                            "Provider connection failed certificate validation.",
                            Toast.LENGTH_LONG).show();
                });
            }

            @Override
            public void onPageFinished(WebView view, String pageUrl) {
                if (userExited || launchedExo || !Uri.parse(pageUrl).equals(Uri.parse(view.getUrl()))) return;
                brandedLoader.setVisibility(View.GONE);
                sourceCheckAttempts = 0;
                checkForDirectVideoElement();
            }
        });

        if (url == null || !StreamResolver.isHttpUrl(url)) {
            brandedLoader.setVisibility(View.GONE);
            Toast.makeText(this, "A valid HTTP/HTTPS provider URL is required.", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        webView.loadUrl(url);
        handler.postDelayed(() -> {
            if (!launchedExo && !userExited && !isFinishing() &&
                    brandedLoader.getVisibility() == View.VISIBLE) {
                showNotFoundHint();
            }
        }, 20000);
    }

    private void checkForDirectVideoElement() {
        if (launchedExo || userExited || isFinishing() ||
                webView == null || sourceCheckAttempts >= MAX_SOURCE_CHECK_ATTEMPTS) return;

        sourceCheckAttempts++;
        webView.evaluateJavascript(VIDEO_ELEMENT_SOURCE_SCRIPT, value -> {
            if (launchedExo || userExited || isFinishing()) return;
            JSONObject media = decodeJavascriptObject(value);
            String mediaUrl = media.optString("url", "");
            String mediaType = media.optString("type", "");
            long resumePosition = (long) (media.optDouble("position", 0) * 1000);
            if (StreamResolver.isSupportedMediaUrl(mediaUrl) ||
                    StreamResolver.isSupportedMediaTypeForUrl(mediaUrl, mediaType)) {
                launchExo(mediaUrl, mediaType, resumePosition);
            } else {
                handler.postDelayed(this::checkForDirectVideoElement, 1000);
            }
        });
    }

    private JSONObject decodeJavascriptObject(String value) {
        try {
            String encoded = new JSONArray("[" + value + "]").optString(0, "");
            return new JSONObject(encoded);
        } catch (Exception error) {
            return new JSONObject();
        }
    }

    private void launchExo(String url, String mediaType, long resumePosition) {
        if (launchedExo || userExited || isFinishing() ||
                !StreamResolver.isSupportedMediaUrl(url) &&
                        !StreamResolver.isSupportedMediaTypeForUrl(url, mediaType)) return;
        launchedExo = true;

        Intent intent = new Intent(this, PlayerActivity.class);
        intent.putExtra(PlayerActivity.EXTRA_URL, url);
        intent.putExtra(PlayerActivity.EXTRA_MEDIA_TYPE, mediaType);
        intent.putExtra(PlayerActivity.EXTRA_TITLE, videoTitle);
        intent.putExtra(PlayerActivity.EXTRA_SERIES_TITLE, seriesTitle);
        intent.putExtra("resume_pos", Math.max(0, resumePosition));
        String referer = webView == null ? null : webView.getUrl();
        if (StreamResolver.isHttpUrl(referer)) {
            intent.putExtra(PlayerActivity.EXTRA_REFERER, referer);
        }
        if (playlistJson != null) {
            intent.putExtra("playlist", playlistJson);
            intent.putExtra("index", currentIndex);
        }
        try {
            startActivity(intent);
            overridePendingTransition(0, 0);
            finish();
        } catch (RuntimeException error) {
            launchedExo = false;
            Log.e("WEB_PLAYER", "Native playback could not be opened.", error);
            Toast.makeText(this, "Unable to open the direct video. Use the provider player.",
                    Toast.LENGTH_LONG).show();
        }
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
        if (brandedLoader != null) brandedLoader.setVisibility(View.GONE);
        Toast.makeText(this, "Provider is taking longer to load. You can use its player here.",
                Toast.LENGTH_LONG).show();
    }

    private int dp(int val) {
        return (int)(val * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}
