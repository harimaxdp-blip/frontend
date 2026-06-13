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
        // 1) Mark userExited so any in-flight handler.post(...) -> launchExo(...)
        //    is rejected even if it was already queued.
        // 2) Wipe every pending Runnable on this handler (timeout checks,
        //    delayed injectVideoHunter calls, queued launchExo calls, etc).
        // 3) Stop the WebView so it can't fire any more callbacks.
        // 4) Finish immediately — never starts PlayerActivity.
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
        playlistJson  = getIntent().getStringExtra("playlist");
        currentIndex  = getIntent().getIntExtra("index", 0);
        if (videoTitle == null) videoTitle = "";

        // Normalize playlist
        if (playlistJson != null &&
            (playlistJson.isEmpty() || playlistJson.equals("null") || playlistJson.equals("[]"))) {
            playlistJson = null;
        }

        Log.d("WEB_DEBUG", "WEBPLAYER_TITLE="    + videoTitle);
        Log.d("WEB_DEBUG", "WEBPLAYER_PLAYLIST=" + (playlistJson != null ? "length=" + playlistJson.length() : "NULL"));
        Log.d("WEB_DEBUG", "WEBPLAYER_INDEX="    + currentIndex);

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
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                Log.d("WEB_DEBUG", "Progress: " + newProgress + "%");
                // Do NOT show webview here — stay on branded loader
            }
        });

        webView.setWebViewClient(new WebViewClient() {

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                Log.d("WEB_DEBUG", "Page started: " + url);
            }

            @Override
            public void onReceivedSslError(WebView view, android.webkit.SslErrorHandler handler, android.net.http.SslError error) {
                handler.proceed();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                // Silently handle errors — never show the broken page to user
                Log.e("WEB_DEBUG", "Page error on: " + request.getUrl().toString());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if (userExited) return true; // swallow navigation, user already left

                String url = req.getUrl().toString();
                if (url.startsWith("magnet:")) {
                    Intent intent = new Intent(WebPlayerActivity.this, TorrentPlayerActivity.class);
                    intent.putExtra(TorrentPlayerActivity.EXTRA_MAGNET, url);
                    intent.putExtra(TorrentPlayerActivity.EXTRA_TITLE, videoTitle);
                    startActivity(intent);
                    return true;
                }
                return false;
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {

                if (userExited || launchedExo) return null; // ── FIXED: stop hunting once user left

                String reqUrl  = request.getUrl().toString();
                String method  = request.getMethod();
                if (!"GET".equals(method)) return null;
                String lower   = reqUrl.toLowerCase();

                for (String skip : SKIP_EXTS) {
                    if (lower.contains(skip)) return null;
                }
                if (lower.contains("google")      || lower.contains("facebook") ||
                    lower.contains("analytics")   || lower.contains("doubleclick") ||
                    lower.contains("ads")         || lower.contains("tracker")) {
                    return null;
                }

                Log.d("WEB_DEBUG", "INTERCEPT=" + reqUrl);
                if (!launchedExo && isStrictVideoUrl(reqUrl)) {
                    Log.d("WEB_DEBUG", "VIDEO_STREAM_FOUND=" + reqUrl);
                    handler.post(() -> launchExo(reqUrl));
                }
                return null;
            }

            @Override
            public void onPageFinished(WebView view, String pageUrl) {
                if (userExited || launchedExo) return; // ── FIXED: don't keep injecting after exit
                injectVideoHunter();
                handler.postDelayed(() -> injectVideoHunter(), 2000);
                handler.postDelayed(() -> injectVideoHunter(), 5000);
            }
        });

        if (url != null) {
            webView.loadUrl(url);
            // Safety timeout: if no video found in 20s, still stay on branded screen
            // (do NOT fall back to showing the webview — finish instead)
            handler.postDelayed(() -> {
                if (!launchedExo && !userExited && !isFinishing()) {
                    Log.w("WEB_DEBUG", "Timeout: no video found, finishing");
                    // Show a brief "not found" hint on the branded loader then go back
                    showNotFoundHint();
                    handler.postDelayed(this::finish, 2500);
                }
            }, 20000);
        }
    }

    // ── Branded loading screen ────────────────────────────────────────────────
    private View buildBrandedLoader() {
        // Outer container: black with subtle radial gradient feel
        FrameLayout container = new FrameLayout(this);
        container.setBackgroundColor(0xFF000000);

        // Center column
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER);

        FrameLayout.LayoutParams colLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT);
        colLp.gravity = Gravity.CENTER;
        col.setLayoutParams(colLp);
        col.setPadding(dp(32), 0, dp(32), 0);

        // ── HM monogram badge ───────────────────────────────────────────────
        // 92dp rounded-square, dark fill with a red-tinted border.
        FrameLayout badge = new FrameLayout(this);
        LinearLayout.LayoutParams badgeLp = new LinearLayout.LayoutParams(dp(92), dp(92));
        badgeLp.gravity = Gravity.CENTER_HORIZONTAL;
        badgeLp.bottomMargin = dp(22);
        badge.setLayoutParams(badgeLp);

        GradientDrawable badgeBg = new GradientDrawable();
        badgeBg.setShape(GradientDrawable.RECTANGLE);
        badgeBg.setCornerRadius(dp(18));
        badgeBg.setColor(0x1AE50914);                 // faint red-tinted fill
        int initialStroke = (int) (1.5f * getResources().getDisplayMetrics().density);
        badgeBg.setStroke(initialStroke, 0x8CE50914); // ~55% alpha red border
        badge.setBackground(badgeBg);

        // "HM" letters with a white → red vertical gradient fill
        TextView badgeLetters = new TextView(this);
        badgeLetters.setText("HM");
        badgeLetters.setTypeface(Typeface.DEFAULT_BOLD);
        badgeLetters.setTextSize(34);
        badgeLetters.setLetterSpacing(0.04f);
        badgeLetters.setGravity(Gravity.CENTER);
        badgeLetters.setTextColor(0xFFFFFFFF); // fallback color before shader is applied
        badge.addView(badgeLetters, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        // Apply the gradient once the view has a measured height
        badgeLetters.getViewTreeObserver().addOnGlobalLayoutListener(
                new android.view.ViewTreeObserver.OnGlobalLayoutListener() {
                    @Override
                    public void onGlobalLayout() {
                        int h = badgeLetters.getHeight();
                        if (h > 0) {
                            Shader shader = new LinearGradient(
                                    0f, 0f, 0f, h * 1.3f,
                                    0xFFFFFFFF, 0xFFE50914,
                                    Shader.TileMode.CLAMP);
                            badgeLetters.getPaint().setShader(shader);
                            badgeLetters.invalidate();
                            badgeLetters.getViewTreeObserver().removeOnGlobalLayoutListener(this);
                        }
                    }
                });

        col.addView(badge);

        // Red accent line
        View line = new View(this);
        LinearLayout.LayoutParams lineLp = new LinearLayout.LayoutParams(dp(46), dp(3));
        lineLp.gravity  = Gravity.CENTER_HORIZONTAL;
        lineLp.bottomMargin = dp(26);
        line.setLayoutParams(lineLp);
        GradientDrawable lineGd = new GradientDrawable(
                GradientDrawable.Orientation.LEFT_RIGHT,
                new int[]{0xFFE50914, 0xFFFF4D4D});
        lineGd.setCornerRadius(dp(4));
        line.setBackground(lineGd);
        col.addView(line);

        // Spinner (red) — thin ring, matches preview sizing
        ProgressBar spinner = new ProgressBar(this);
        spinner.getIndeterminateDrawable().setColorFilter(
                0xFFE50914, android.graphics.PorterDuff.Mode.SRC_IN);
        spinner.setIndeterminate(true);
        LinearLayout.LayoutParams spLp = new LinearLayout.LayoutParams(dp(38), dp(38));
        spLp.gravity     = Gravity.CENTER_HORIZONTAL;
        spLp.bottomMargin = dp(22);
        spinner.setLayoutParams(spLp);
        col.addView(spinner);

        // "Preparing your stream…" label
        TextView tvLabel = new TextView(this);
        tvLabel.setTag("status_label");
        tvLabel.setText("Preparing your stream…");
        tvLabel.setTextColor(0xAAFFFFFF);
        tvLabel.setTextSize(13);
        tvLabel.setGravity(Gravity.CENTER);
        tvLabel.setLetterSpacing(0.04f);
        col.addView(tvLabel);

        // Title of what's being loaded
        if (videoTitle != null && !videoTitle.isEmpty()) {
            TextView tvTitle = new TextView(this);
            tvTitle.setText(videoTitle);
            tvTitle.setTextColor(0x66FFFFFF);
            tvTitle.setTextSize(11);
            tvTitle.setGravity(Gravity.CENTER);
            tvTitle.setMaxLines(2);
            tvTitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
            LinearLayout.LayoutParams tLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT);
            tLp.topMargin = dp(6);
            tvTitle.setLayoutParams(tLp);
            col.addView(tvTitle);
        }

        container.addView(col);

        // Scanline overlay for cinematic feel
        View scanlines = new View(this);
        GradientDrawable scanGd = new GradientDrawable();
        scanlines.setBackground(scanGd);
        scanlines.setAlpha(0.03f);
        container.addView(scanlines, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        // Fade-in entrance animation
        container.setAlpha(0f);
        container.animate().alpha(1f).setDuration(350)
                .setInterpolator(new DecelerateInterpolator()).start();

        // Pulse the HM badge (subtle glow via scale + border alpha breathing)
        pulseBadge(badge, badgeBg);

        return container;
    }

    /**
     * Mimics the CSS "badgePulse" glow from the preview: the badge scales up
     * very slightly while its red border ramps to full opacity, then eases
     * back — giving a soft breathing glow effect without a real box-shadow.
     */
    private void pulseBadge(View badge, GradientDrawable badgeBg) {
        ObjectAnimator scaleUpX = ObjectAnimator.ofFloat(badge, "scaleX", 1f, 1.03f);
        ObjectAnimator scaleUpY = ObjectAnimator.ofFloat(badge, "scaleY", 1f, 1.03f);
        ObjectAnimator scaleDownX = ObjectAnimator.ofFloat(badge, "scaleX", 1.03f, 1f);
        ObjectAnimator scaleDownY = ObjectAnimator.ofFloat(badge, "scaleY", 1.03f, 1f);

        AnimatorSet grow = new AnimatorSet();
        grow.playTogether(scaleUpX, scaleUpY);
        grow.setDuration(1300);

        AnimatorSet shrink = new AnimatorSet();
        shrink.playTogether(scaleDownX, scaleDownY);
        shrink.setDuration(1300);

        AnimatorSet set = new AnimatorSet();
        set.playSequentially(grow, shrink);
        set.setInterpolator(new AccelerateDecelerateInterpolator());

        // Border alpha breathing: 0x8C (≈55%) -> 0xFF (full) -> 0x8C
        int strokeWidth = (int) (1.5f * getResources().getDisplayMetrics().density);
        scaleUpX.addUpdateListener(anim -> {
            float fraction = anim.getAnimatedFraction();
            int alpha = (int) (0x8C + (0xFF - 0x8C) * fraction);
            badgeBg.setStroke(strokeWidth, (alpha << 24) | 0x00E50914);
        });

        set.addListener(new android.animation.AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(android.animation.Animator animation) {
                if (!launchedExo && !userExited && !isFinishing()) pulseBadge(badge, badgeBg);
            }
        });
        set.start();
    }

    private void showNotFoundHint() {
        if (brandedLoader instanceof FrameLayout) {
            FrameLayout fl = (FrameLayout) brandedLoader;
            // Find the status label and update it
            for (int i = 0; i < fl.getChildCount(); i++) {
                View child = fl.getChildAt(i);
                if (child instanceof LinearLayout) {
                    LinearLayout col = (LinearLayout) child;
                    for (int j = 0; j < col.getChildCount(); j++) {
                        View v = col.getChildAt(j);
                        if (v instanceof TextView && "status_label".equals(v.getTag())) {
                            ((TextView) v).setText("Could not find a stream. Going back…");
                            ((TextView) v).setTextColor(0xFFE50914);
                        }
                    }
                }
            }
        }
    }

    private boolean isStrictVideoUrl(String url) {
        if (url == null || url.isEmpty()) return false;
        if (url.contains(" ")) return false;
        String lower = url.toLowerCase();
        if (lower.contains("tamilmv") || lower.contains("1tamilmv")) {
            if (!lower.contains("/proxy.php") && !lower.contains("stream=1")) return false;
        }
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
        if (launchedExo || userExited) return;
        String js =
            "(function() {" +
            "  if (window.__hmHunterRunning) return;" +
            "  window.__hmHunterRunning = true;" +
            "  function findAndReport() {" +
            "    var videos = document.querySelectorAll('video');" +
            "    for (var i = 0; i < videos.length; i++) {" +
            "      var src = videos[i].src || videos[i].currentSrc;" +
            "      if (src && src.indexOf('http') === 0 && src.indexOf(' ') === -1) {" +
            "        Android.onVideoFound(src); return;" +
            "      }" +
            "      var sources = videos[i].querySelectorAll('source');" +
            "      for (var j = 0; j < sources.length; j++) {" +
            "        if (sources[j].src && sources[j].src.indexOf('http') === 0 && sources[j].src.indexOf(' ') === -1) {" +
            "          Android.onVideoFound(sources[j].src); return;" +
            "        }" +
            "      }" +
            "    }" +
            "    var html = document.documentElement.innerHTML;" +
            "    var patterns = [" +
            "      /[\"'`](https?:\\/\\/[^\"'`\\s]+\\.m3u8[^\"'`\\s]*?)[\"'`]/i," +
            "      /[\"'`](https?:\\/\\/[^\"'`\\s]+\\.mp4[^\"'`\\s]*?)[\"'`]/i," +
            "      /[\"'`](https?:\\/\\/[^\"'`\\s]+\\.mkv[^\"'`\\s]*?)[\"'`]/i," +
            "      /[\"'`](https?:\\/\\/[^\"'`\\s]+\\.mpd[^\"'`\\s]*?)[\"'`]/i," +
            "      /[\"'`](magnet:\\?[^\"'`\\s]+)[\"'`]/i" +
            "    ];" +
            "    for (var p = 0; p < patterns.length; p++) {" +
            "      var m = html.match(patterns[p]);" +
            "      if (m && m[1]) { Android.onVideoFound(m[1]); return; }" +
            "    }" +
            "    var links = document.querySelectorAll('a[href^=\"magnet:\"]');" +
            "    if (links.length > 0) { Android.onVideoFound(links[0].href); return; }" +
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

            // ── FIXED: ignore anything reported after the user already exited
            if (url == null || url.isEmpty() || launchedExo || userExited) return;

            if (url.startsWith("magnet:")) {
                launchedExo = true;
                handler.post(() -> {
                    if (userExited || isFinishing()) return; // ── FIXED: double-check on main thread
                    Intent intent = new Intent(WebPlayerActivity.this, TorrentPlayerActivity.class);
                    intent.putExtra(TorrentPlayerActivity.EXTRA_MAGNET, url);
                    intent.putExtra(TorrentPlayerActivity.EXTRA_TITLE, videoTitle);
                    startActivity(intent);
                    finish();
                });
                return;
            }

            if (!isStrictVideoUrl(url)) {
                Log.d("WEB_DEBUG", "JS_FOUND_BUT_NOT_STRICT_VIDEO=" + url);
                return;
            }
            handler.post(() -> launchExo(url));
        }
    }

    /**
     * Launches PlayerActivity with a cinematic black-to-player transition.
     * WebView stays hidden — user sees: branded loader → black wipe → player.
     */
    private void launchExo(String url) {
        // ── FIXED: bail out if the user already backed out / quit, or if
        // this activity is on its way down, or if we already launched.
        if (launchedExo || userExited || isFinishing()) return;
        launchedExo = true;

        Log.d("WEB_DEBUG", "LAUNCHING_EXO_WITH="   + url);
        Log.d("WEB_DEBUG", "FORWARDING_PLAYLIST="  + (playlistJson != null ? "yes len=" + playlistJson.length() : "none"));
        Log.d("WEB_DEBUG", "FORWARDING_INDEX="     + currentIndex);

        // Fade branded loader to black before switching activities
        if (brandedLoader != null) {
            brandedLoader.animate()
                    .alpha(0f)
                    .setDuration(250)
                    .setInterpolator(new AccelerateDecelerateInterpolator())
                    .withEndAction(() -> {
                        // ── FIXED: final guard right before startActivity —
                        // covers the case where back was pressed *during* this 250ms fade.
                        if (userExited || isFinishing()) return;
                        Intent intent = new Intent(this, PlayerActivity.class);
                        intent.putExtra(PlayerActivity.EXTRA_URL, url);
                        intent.putExtra(PlayerActivity.EXTRA_TITLE, videoTitle);
                        if (playlistJson != null) {
                            intent.putExtra("playlist", playlistJson);
                            intent.putExtra("index", currentIndex);
                        }
                        startActivity(intent);
                        // No slide animation — pure black transition
                        overridePendingTransition(0, 0);
                        finish();
                    })
                    .start();
        } else {
            if (userExited || isFinishing()) return;
            Intent intent = new Intent(this, PlayerActivity.class);
            intent.putExtra(PlayerActivity.EXTRA_URL, url);
            intent.putExtra(PlayerActivity.EXTRA_TITLE, videoTitle);
            if (playlistJson != null) {
                intent.putExtra("playlist", playlistJson);
                intent.putExtra("index", currentIndex);
            }
            startActivity(intent);
            overridePendingTransition(0, 0);
            finish();
        }
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