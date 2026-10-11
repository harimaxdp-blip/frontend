package com.harimovies.app;

import android.app.Dialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.DialogFragment;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * TrackSelectionDialog — Two-panel playback settings sheet.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────┐
 *   │ [LEFT SIDEBAR 140dp]  │  [RIGHT CONTENT — flex 1]   │
 *   │  ─ PLAYBACK label     │   Panel title + [✕] top-right│
 *   │  ─ Media title        │   ─────────────────────────  │
 *   │  ─ Summary            │   Scrollable option list     │
 *   │  ─ ─ ─ ─ ─ ─ ─       │                              │
 *   │  [Quality tab]        │                              │
 *   │  [Audio   tab]        │                              │
 *   │  [Subtitles tab]      │                              │
 *   └─────────────────────────────────────────────────────┘
 *
 * Close button: top-right corner of the RIGHT panel only.
 * Scrim tap: does NOT close the dialog.
 */
@UnstableApi
public class TrackSelectionDialog extends DialogFragment {

    // ─── Palette ────────────────────────────────────────────────────────────
    private static final int C_BG         = 0xFF09090C;
    private static final int C_CARD       = 0xFF101013;
    private static final int C_SIDEBAR    = 0xFF0C0C0F;
    private static final int C_SEP        = 0xFF1C1C22;
    private static final int C_TAB_IDLE   = 0xFF141417;
    private static final int C_TAB_ACT    = 0xFF1C0406;
    private static final int C_ROW_IDLE   = 0xFF161619;
    private static final int C_ROW_SEL    = 0xFF1E0507;
    private static final int C_DIV        = 0xFF1E1E24;
    private static final int C_ACCENT     = 0xFFE5141F;
    private static final int C_ACCENT_DIM = 0x2AE5141F;
    private static final int C_WHITE      = 0xFFFFFFFF;
    private static final int C_GREY       = 0xFF6E6E78;
    private static final int C_GREY_MID   = 0xFF9A9AA6;
    private static final int C_BORDER     = 0xFF222228;
    private static final int C_BORDER_SEL = 0xFFE5141F;
    private static final int C_SCRIM      = 0xBF000000;

    // ─── Tab constants ───────────────────────────────────────────────────────
    private static final int TAB_Q = 0, TAB_A = 1, TAB_S = 2;
    // Vector path data for icons — drawn as canvas paths in a custom view-like TextView overlay
    // Using clean Unicode block chars that render crisply at small sizes:
    //  Quality  → film-frame look  "▣" is too thick; use Typeface icon font chars
    // Since we cannot load Tabler in Android XML-free code, we use carefully chosen
    // Unicode symbols that are universally supported and visually distinct:
    //  Quality  ▶ film / resolution → "⬡" (hex resolution badge feel)  → actually use "◰" 
    // Final pick after visual reasoning:
    //  Quality  → "HD" concept → we draw it as a text badge row — no symbol needed at tab level
    //  Instead: use Material-style Unicode that ships on all Android 8+ devices:
    //    Quality   → U+2BC0  "⬀" nope
    // Best approach for Android without icon font: use vector drawables in res/
    // BUT since this is pure-Java no-XML approach, use these carefully:
    //  Quality   → "\u25A3"  ▣  (white square containing black small square) — resolution/quality
    //  Audio     → "\u25C9"  ◉  (fisheye) — speaker/audio feel  
    //  Subtitles → "\u2261"  ≡  (identical to) — subtitle lines feel
    // These are all in Unicode Basic Multilingual Plane, render on all Android devices.
    private static final String[] TAB_ICO  = { "\u25A3", "\u25C9", "\u2261" };
    private static final String[] TAB_LBL  = { "Quality", "Audio", "Subtitles" };
    private static final String   PREFS    = "hm_player_prefs";

    // ─── State ──────────────────────────────────────────────────────────────
    private ExoPlayer player;
    private Runnable  onDismiss;
    private String    mediaTitle = "Now Playing";
    private int       currentTab = TAB_Q;
    private boolean   wasPlaying, pauseHandled;

    @SuppressWarnings("unchecked")
    private final List<Opt>[] tabOpts = new List[3];

    private final View[]     tabBtns = new View[3];
    private final TextView[] tabIco  = new TextView[3];
    private final TextView[] tabLbl  = new TextView[3];
    private LinearLayout     optList;
    private TextView         summaryTv;
    private TextView         panelTitleTv;

    private final Player.Listener pListener = new Player.Listener() {
        @Override public void onTracksChanged(@NonNull Tracks t) { rebuildAll(); refreshOpts(); }
    };

    // ════════════════════════════════════════════════════════════════════════
    //  Opt model
    // ════════════════════════════════════════════════════════════════════════
    private static class Opt {
        String label, sub, badge, sectionTitle;
        boolean selected, isOff;
        int trackType;
        androidx.media3.common.TrackGroup group;
        int trackIndex;
        String language;
        boolean supported = true;

        static Opt track(int type, String label, String sub) {
            Opt o = new Opt(); o.trackType = type; o.label = label; o.sub = sub; return o;
        }
        static Opt section(String title) { Opt o = new Opt(); o.sectionTitle = title; return o; }
        static Opt divider()              { Opt o = new Opt(); o.sectionTitle = "---"; return o; }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Factory
    // ════════════════════════════════════════════════════════════════════════
    public static TrackSelectionDialog newInstance(ExoPlayer player,
                                                   @Nullable String title,
                                                   @Nullable Runnable onDismiss) {
        TrackSelectionDialog d = new TrackSelectionDialog();
        d.player = player; d.onDismiss = onDismiss;
        if (title != null) d.mediaTitle = title;
        return d;
    }
    public static TrackSelectionDialog newInstance(ExoPlayer p, @Nullable Runnable cb) {
        return newInstance(p, null, cb);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Lifecycle
    // ════════════════════════════════════════════════════════════════════════
    @Override public void onCreate(@Nullable Bundle s) {
        super.onCreate(s);
        setStyle(STYLE_NO_TITLE, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
    }

    @NonNull @Override public Dialog onCreateDialog(@Nullable Bundle s) {
        Dialog d = super.onCreateDialog(s);
        Window w = d.getWindow();
        if (w != null) {
            w.addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);
            w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            //noinspection deprecation
            w.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN);
        }
        return d;
    }

    @Override public void onResume() {
        super.onResume();
        if (player != null) {
            player.addListener(pListener);
            if (!pauseHandled) {
                wasPlaying = player.isPlaying() || player.getPlayWhenReady();
                if (wasPlaying) player.pause();
                pauseHandled = true;
            }
        }
    }

    @Override public void onPause() {
        if (player != null) {
            player.removeListener(pListener);
            if (pauseHandled && wasPlaying) player.play();
            pauseHandled = false;
        }
        if (onDismiss != null) onDismiss.run();
        super.onPause();
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Root — full-screen scrim (non-clickable) + centered card
    // ════════════════════════════════════════════════════════════════════════
    @Nullable @Override
    public View onCreateView(@NonNull LayoutInflater inf,
                             @Nullable ViewGroup container,
                             @Nullable Bundle s) {
        Context ctx = requireContext();
        rebuildAll();

        FrameLayout root = new FrameLayout(ctx);
        root.setLayoutParams(new ViewGroup.LayoutParams(MATCH, MATCH));

        // Scrim — does NOT close dialog on tap; only ✕ button closes it
        View scrim = new View(ctx);
        scrim.setLayoutParams(new FrameLayout.LayoutParams(MATCH, MATCH));
        scrim.setBackgroundColor(C_SCRIM);
        // deliberately no click listener
        root.addView(scrim);

        DisplayMetrics dm = ctx.getResources().getDisplayMetrics();
        int cardW = cardWidth(ctx, dm);
        int cardH = (int)(dm.heightPixels * 0.80f);

        View card = buildCard(ctx);
        FrameLayout.LayoutParams clp = new FrameLayout.LayoutParams(cardW, cardH, Gravity.CENTER);
        card.setLayoutParams(clp);
        root.addView(card);

        card.setTranslationY(dp(28)); card.setAlpha(0f);
        card.animate().translationY(0f).alpha(1f)
                .setDuration(260).setInterpolator(new DecelerateInterpolator(2f)).start();

        return root;
    }

    private int cardWidth(Context ctx, DisplayMetrics dm) {
        boolean tv = (ctx.getResources().getConfiguration().uiMode
                & android.content.res.Configuration.UI_MODE_TYPE_MASK)
                == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION;
        return tv ? dp(700) : Math.min((int)(dm.widthPixels * 0.95f), dp(530));
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Card = [LEFT sidebar] | [RIGHT panel]
    // ════════════════════════════════════════════════════════════════════════
    private View buildCard(Context ctx) {
        FrameLayout frame = new FrameLayout(ctx);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(C_CARD);
        bg.setCornerRadius(dp(20));
        bg.setStroke(dp(1), C_SEP);
        frame.setBackground(bg);
        frame.setClipToOutline(true);
        frame.setOutlineProvider(android.view.ViewOutlineProvider.BACKGROUND);
        frame.setElevation(dp(32));

        LinearLayout split = new LinearLayout(ctx);
        split.setOrientation(LinearLayout.HORIZONTAL);
        split.setLayoutParams(new FrameLayout.LayoutParams(MATCH, MATCH));
        split.addView(buildSidebar(ctx));
        split.addView(buildRightPanel(ctx));
        frame.addView(split);
        return frame;
    }

    // ────────────────────────────────────────────────────────────────────────
    //  LEFT SIDEBAR  (140dp wide)
    //  Header info → divider → tab buttons → flex spacer
    //  NO close button here.
    // ────────────────────────────────────────────────────────────────────────
    private View buildSidebar(Context ctx) {
        LinearLayout sidebar = new LinearLayout(ctx);
        sidebar.setOrientation(LinearLayout.VERTICAL);
        sidebar.setBackgroundColor(C_SIDEBAR);

        // ── Header ─────────────────────────────────────────────────────────
        LinearLayout hdr = new LinearLayout(ctx);
        hdr.setOrientation(LinearLayout.VERTICAL);
        hdr.setPadding(dp(14), dp(22), dp(12), dp(16));

        // Red eyebrow label
        TextView eyebrow = new TextView(ctx);
        eyebrow.setText("PLAYBACK");
        eyebrow.setTextColor(C_ACCENT);
        eyebrow.setTextSize(8.5f);
        eyebrow.setLetterSpacing(0.22f);
        eyebrow.setTypeface(Typeface.DEFAULT_BOLD);
        hdr.addView(eyebrow);

        // Media title
        TextView titleTv = new TextView(ctx);
        titleTv.setText(mediaTitle);
        titleTv.setTextColor(C_WHITE);
        titleTv.setTextSize(13f);
        titleTv.setTypeface(Typeface.DEFAULT_BOLD);
        titleTv.setMaxLines(2);
        titleTv.setLineSpacing(0, 1.25f);
        LinearLayout.LayoutParams tlp = new LinearLayout.LayoutParams(MATCH, WRAP);
        tlp.topMargin = dp(8);
        titleTv.setLayoutParams(tlp);
        hdr.addView(titleTv);

        // Summary (quality · audio / subtitles)
        summaryTv = new TextView(ctx);
        summaryTv.setTextColor(C_GREY_MID);
        summaryTv.setTextSize(10f);
        summaryTv.setMaxLines(3);
        summaryTv.setLineSpacing(0, 1.4f);
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(MATCH, WRAP);
        slp.topMargin = dp(9);
        summaryTv.setLayoutParams(slp);
        hdr.addView(summaryTv);

        sidebar.addView(hdr);
        sidebar.addView(hDivider(ctx, C_SEP));
        addSpacer(sidebar, dp(10));

        // ── Tab buttons ─────────────────────────────────────────────────────
        for (int i = 0; i < 3; i++) sidebar.addView(buildTabBtn(ctx, i));

        // Push remaining space down
        View flex = new View(ctx);
        flex.setLayoutParams(new LinearLayout.LayoutParams(MATCH, 0, 1f));
        sidebar.addView(flex);

        // Bottom padding so last tab doesn't hug corner
        addSpacer(sidebar, dp(16));

        // Wrap in FrameLayout to overlay the right-border divider line
        FrameLayout wrap = new FrameLayout(ctx);
        LinearLayout.LayoutParams wlp = new LinearLayout.LayoutParams(dp(140), MATCH);
        wrap.setLayoutParams(wlp);
        sidebar.setLayoutParams(new FrameLayout.LayoutParams(MATCH, MATCH));
        wrap.addView(sidebar);

        View vLine = new View(ctx);
        vLine.setBackgroundColor(C_SEP);
        FrameLayout.LayoutParams vlp = new FrameLayout.LayoutParams(dp(1), MATCH, Gravity.END);
        vLine.setLayoutParams(vlp);
        wrap.addView(vLine);

        return wrap;
    }

    /**
     * Single tab button — horizontal: [icon 28dp] [label]
     * Active state: dark-red bg, accent icon color, white label, red border.
     */
    private View buildTabBtn(Context ctx, int idx) {
        LinearLayout btn = new LinearLayout(ctx);
        btn.setOrientation(LinearLayout.HORIZONTAL);
        btn.setGravity(Gravity.CENTER_VERTICAL);
        btn.setPadding(dp(12), dp(12), dp(10), dp(12));
        btn.setMinimumHeight(dp(52));
        btn.setFocusable(true);
        btn.setClickable(true);

        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(MATCH, WRAP);
        lp.leftMargin = dp(8); lp.rightMargin = dp(8); lp.bottomMargin = dp(4);
        btn.setLayoutParams(lp);

        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(10));
        bg.setColor(C_TAB_IDLE);
        bg.setStroke(dp(1), C_BORDER);
        btn.setBackground(ripple(bg, C_ACCENT_DIM));

        // Icon  — Unicode symbols chosen for clarity at 17sp:
        //   Quality   ▣ U+25A3  — square with inner square → resolution / screen
        //   Audio     ◉ U+25C9  — bullseye → speaker cone / sound
        //   Subtitles ≡ U+2261  — triple bar → subtitle lines
        TextView ico = new TextView(ctx);
        ico.setText(TAB_ICO[idx]);
        ico.setTextSize(17f);
        ico.setGravity(Gravity.CENTER);
        ico.setTextColor(C_GREY);
        ico.setMinWidth(dp(28)); ico.setMaxWidth(dp(28));
        btn.addView(ico);
        tabIco[idx] = ico;

        // Label
        TextView lbl = new TextView(ctx);
        lbl.setText(TAB_LBL[idx]);
        lbl.setTextSize(12f);
        lbl.setTextColor(C_GREY);
        lbl.setSingleLine(true);
        LinearLayout.LayoutParams llp = new LinearLayout.LayoutParams(MATCH, WRAP);
        llp.leftMargin = dp(8);
        lbl.setLayoutParams(llp);
        btn.addView(lbl);
        tabLbl[idx] = lbl;
        tabBtns[idx] = btn;

        final int fi = idx;
        btn.setOnClickListener(v -> switchTab(fi));
        btn.setOnFocusChangeListener((v, f) -> {
                bg.setStroke(dp(f ? 1.5f : 1f),
                        f ? C_WHITE : (fi == currentTab ? C_ACCENT : C_BORDER));
                btn.animate().scaleX(f ? 1.08f : 1f).scaleY(f ? 1.08f : 1f).setDuration(150).start();
        });
        btn.setOnKeyListener((v, code, e) -> {
            if (e.getAction() != KeyEvent.ACTION_DOWN) return false;
            if (code == KeyEvent.KEYCODE_DPAD_UP   && fi > 0) { tabBtns[fi-1].requestFocus(); return true; }
            if (code == KeyEvent.KEYCODE_DPAD_DOWN && fi < 2) { tabBtns[fi+1].requestFocus(); return true; }
            if (code == KeyEvent.KEYCODE_DPAD_RIGHT)           { focusFirstOpt(); return true; }
            if (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER) {
                switchTab(fi); return true;
            }
            return false;
        });

        return btn;
    }

    /** Update visual state of all three tab buttons. */
    private void applyTabVisuals() {
        for (int i = 0; i < 3; i++) {
            boolean active = (i == currentTab);
            if (tabBtns[i] == null) continue;
            GradientDrawable bg = extractBg(tabBtns[i]);
            if (bg != null) {
                bg.setColor(active ? C_TAB_ACT : C_TAB_IDLE);
                bg.setStroke(dp(active ? 1.5f : 1f), active ? C_ACCENT : C_BORDER);
            }
            if (tabIco[i] != null) tabIco[i].setTextColor(active ? C_ACCENT : C_GREY);
            if (tabLbl[i] != null) tabLbl[i].setTextColor(active ? C_WHITE  : C_GREY);
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    //  RIGHT PANEL — header row (tab title LEFT  +  ✕ Close RIGHT) + scroll list
    // ────────────────────────────────────────────────────────────────────────
    private View buildRightPanel(Context ctx) {
        LinearLayout panel = new LinearLayout(ctx);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setBackgroundColor(C_CARD);
        panel.setLayoutParams(new LinearLayout.LayoutParams(0, MATCH, 1f));

        // ── Top header row ───────────────────────────────────────────────────
        // [  TAB TITLE (left)          ✕ (right)  ]
        FrameLayout hdr = new FrameLayout(ctx);
        LinearLayout.LayoutParams hdrLp = new LinearLayout.LayoutParams(MATCH, dp(56));
        hdr.setLayoutParams(hdrLp);
        hdr.setPadding(dp(18), 0, dp(6), 0);

        // Tab title — left-aligned, vertically centered
        panelTitleTv = new TextView(ctx);
        panelTitleTv.setTextColor(C_WHITE);
        panelTitleTv.setTextSize(14f);
        panelTitleTv.setTypeface(Typeface.DEFAULT_BOLD);
        panelTitleTv.setLetterSpacing(0.02f);
        panelTitleTv.setSingleLine(true);
        FrameLayout.LayoutParams titleLp =
                new FrameLayout.LayoutParams(WRAP, WRAP, Gravity.CENTER_VERTICAL | Gravity.START);
        panelTitleTv.setLayoutParams(titleLp);
        hdr.addView(panelTitleTv);

        // ✕ Close button — top-right corner
        hdr.addView(buildCloseBtnCompact(ctx));

        panel.addView(hdr);
        panel.addView(hDivider(ctx, C_DIV));

        // ── Scrollable option list ───────────────────────────────────────────
        ScrollView scroll = new ScrollView(ctx);
        scroll.setLayoutParams(new LinearLayout.LayoutParams(MATCH, 0, 1f));
        scroll.setFillViewport(true);
        scroll.setVerticalScrollBarEnabled(false);

        optList = new LinearLayout(ctx);
        optList.setOrientation(LinearLayout.VERTICAL);
        optList.setPadding(dp(12), dp(10), dp(12), dp(20));
        scroll.addView(optList);
        panel.addView(scroll);

        refreshOpts();
        return panel;
    }

    /**
     * Compact ✕ icon button for top-right of right panel.
     * 40×40dp hit area, no label, circular background.
     */
    private View buildCloseBtnCompact(Context ctx) {
        FrameLayout btn = new FrameLayout(ctx);
        FrameLayout.LayoutParams lp =
                new FrameLayout.LayoutParams(dp(40), dp(40), Gravity.CENTER_VERTICAL | Gravity.END);
        lp.rightMargin = dp(8);
        btn.setLayoutParams(lp);
        btn.setFocusable(true);
        btn.setClickable(true);

        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(0xFF1A1A1F);
        bg.setStroke(dp(1), C_BORDER);
        btn.setBackground(ripple(bg, C_ACCENT_DIM));

        TextView x = new TextView(ctx);
        x.setText("\u00D7");           // × multiplication sign — cleaner than ✕
        x.setTextColor(C_GREY_MID);
        x.setTextSize(20f);
        x.setGravity(Gravity.CENTER);
        x.setTypeface(Typeface.DEFAULT);
        FrameLayout.LayoutParams xlp = new FrameLayout.LayoutParams(MATCH, MATCH);
        x.setLayoutParams(xlp);
        btn.addView(x);

        btn.setOnClickListener(v -> dismiss());
        btn.setOnFocusChangeListener((v, f) -> {
            x.setTextColor(f ? C_WHITE : C_GREY_MID);
            bg.setStroke(dp(f ? 1.5f : 1f), f ? C_ACCENT : C_BORDER);
        });
        return btn;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Refresh option list in right panel
    // ════════════════════════════════════════════════════════════════════════
    private void refreshOpts() {
        if (optList == null) return;
        optList.removeAllViews();
        Context ctx = requireContext();

        // Update panel title
        if (panelTitleTv != null) panelTitleTv.setText(TAB_LBL[currentTab]);

        List<Opt> opts = tabOpts[currentTab];
        if (opts == null || opts.isEmpty()) {
            TextView empty = new TextView(ctx);
            empty.setText("No " + TAB_LBL[currentTab].toLowerCase(Locale.US) + " tracks available");
            empty.setTextColor(C_GREY);
            empty.setTextSize(13f);
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(dp(16), dp(52), dp(16), dp(52));
            optList.addView(empty);
        } else {
            for (Opt o : opts) {
                if (o.sectionTitle != null) {
                    if ("---".equals(o.sectionTitle)) optList.addView(hLineMargin(ctx));
                    else                              optList.addView(buildSectionHead(ctx, o.sectionTitle));
                } else {
                    optList.addView(buildOptRow(ctx, o));
                }
            }
        }
        refreshSummary();
    }

    private View buildSectionHead(Context ctx, String title) {
        TextView tv = new TextView(ctx);
        tv.setText(title.toUpperCase(Locale.US));
        tv.setTextColor(C_GREY);
        tv.setTextSize(9f);
        tv.setLetterSpacing(0.16f);
        tv.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(MATCH, WRAP);
        lp.topMargin = dp(10); lp.bottomMargin = dp(5); lp.leftMargin = dp(4);
        tv.setLayoutParams(lp);
        return tv;
    }

    // ─── Option row ──────────────────────────────────────────────────────────
    private View buildOptRow(Context ctx, Opt opt) {
        LinearLayout row = new LinearLayout(ctx);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(14), dp(13), dp(14), dp(13));
        row.setMinimumHeight(dp(60));
        row.setFocusable(true);
        row.setClickable(true);

        LinearLayout.LayoutParams rlp = new LinearLayout.LayoutParams(MATCH, WRAP);
        rlp.bottomMargin = dp(5);
        row.setLayoutParams(rlp);

        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(12));
        bg.setColor(opt.selected ? C_ROW_SEL : C_ROW_IDLE);
        bg.setStroke(dp(opt.selected ? 1.5f : 1f), opt.selected ? C_BORDER_SEL : C_BORDER);
        row.setBackground(ripple(bg, C_ACCENT_DIM));

        // Selection indicator — 3dp red vertical pill on left edge
        View indicator = new View(ctx);
        GradientDrawable indBg = new GradientDrawable();
        indBg.setColor(opt.selected ? C_ACCENT : Color.TRANSPARENT);
        indBg.setCornerRadius(dp(2));
        indicator.setBackground(indBg);
        LinearLayout.LayoutParams indLp = new LinearLayout.LayoutParams(dp(3), dp(24));
        indLp.rightMargin = dp(12);
        indicator.setLayoutParams(indLp);
        row.addView(indicator);

        // Text
        LinearLayout txt = new LinearLayout(ctx);
        txt.setOrientation(LinearLayout.VERTICAL);
        txt.setLayoutParams(new LinearLayout.LayoutParams(0, WRAP, 1f));

        TextView main = new TextView(ctx);
        main.setText(opt.label);
        main.setTextSize(14f);
        main.setTextColor(opt.selected ? C_WHITE : (opt.supported ? C_GREY_MID : 0xFF44444A));
        main.setTypeface(opt.selected ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
        main.setSingleLine(true);
        txt.addView(main);

        if (opt.sub != null && !opt.sub.isEmpty()) {
            TextView sub = new TextView(ctx);
            sub.setText(opt.sub);
            sub.setTextSize(11f);
            sub.setTextColor(opt.selected ? 0xFFBB4040 : (opt.supported ? C_GREY : 0xFF333338));
            LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(MATCH, WRAP);
            slp.topMargin = dp(3);
            sub.setLayoutParams(slp);
            txt.addView(sub);
        }
        row.addView(txt);

        // Badge pill
        if (opt.badge != null && !opt.badge.isEmpty()) {
            TextView badge = new TextView(ctx);
            badge.setText(opt.badge);
            boolean isUnsupp = "Unsupported".equals(opt.badge);
            badge.setTextColor(opt.selected ? C_ACCENT : (isUnsupp ? 0xFF55555A : C_GREY));
            badge.setTextSize(9.5f);
            badge.setTypeface(Typeface.DEFAULT_BOLD);
            badge.setLetterSpacing(0.05f);
            badge.setPadding(dp(8), dp(3), dp(8), dp(4));
            GradientDrawable bbg = new GradientDrawable();
            bbg.setCornerRadius(dp(5));
            bbg.setColor(Color.TRANSPARENT);
            bbg.setStroke(dp(1), opt.selected ? C_ACCENT : (isUnsupp ? 0xFF333338 : C_BORDER));
            badge.setBackground(bbg);
            LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(WRAP, WRAP);
            blp.leftMargin = dp(8);
            badge.setLayoutParams(blp);
            row.addView(badge);
        }

        row.setOnFocusChangeListener((v, f) -> {
            bg.setStroke(dp(f ? 2f : (opt.selected ? 1.5f : 1f)),
                    f ? C_WHITE : (opt.selected ? C_BORDER_SEL : C_BORDER));
            row.animate().scaleX(f ? 1.05f : 1f).scaleY(f ? 1.05f : 1f).setDuration(150).start();
        });
        row.setOnClickListener(v -> pick(opt));
        row.setOnKeyListener((v, code, e) -> {
            if (e.getAction() != KeyEvent.ACTION_DOWN) return false;
            if (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER) { pick(opt); return true; }
            if (code == KeyEvent.KEYCODE_DPAD_LEFT) { if (tabBtns[currentTab] != null) tabBtns[currentTab].requestFocus(); return true; }
            return false;
        });

        return row;
    }

    private void pick(Opt opt) {
        for (Opt o : tabOpts[currentTab])
            if (o != null && o.sectionTitle == null) o.selected = false;
        opt.selected = true;
        applyToPlayer(opt);
        refreshOpts();
    }

    private void focusFirstOpt() {
        if (optList == null) return;
        for (int i = 0; i < optList.getChildCount(); i++) {
            View c = optList.getChildAt(i);
            if (c.isFocusable() && c instanceof LinearLayout) { c.requestFocus(); return; }
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Tab switching
    // ════════════════════════════════════════════════════════════════════════
    private void switchTab(int idx) {
        currentTab = idx;
        applyTabVisuals();
        refreshOpts();
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Summary (sidebar)
    // ════════════════════════════════════════════════════════════════════════
    private void refreshSummary() {
        if (summaryTv == null) return;
        summaryTv.setText(sel(TAB_Q) + "  \u00B7  " + sel(TAB_A) + "\nSubs: " + sel(TAB_S));
    }

    private String sel(int tab) {
        if (tabOpts[tab] == null) return tab == TAB_S ? "Off" : "Auto";
        for (Opt o : tabOpts[tab])
            if (o != null && o.sectionTitle == null && o.selected) return o.label;
        return tab == TAB_S ? "Off" : "Auto";
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Data builders
    // ════════════════════════════════════════════════════════════════════════
    private void rebuildAll() {
        Tracks t = player != null ? player.getCurrentTracks() : Tracks.EMPTY;
        tabOpts[TAB_Q] = buildVideo(t);
        tabOpts[TAB_A] = buildAudio(t);
        tabOpts[TAB_S] = buildSubs(t);
    }

    private List<Opt> buildVideo(Tracks tracks) {
        List<Opt> out = new ArrayList<>();
        boolean isAuto = true;
        if (player != null) {
            for (Tracks.Group g : tracks.getGroups()) {
                if (g.getType() == C.TRACK_TYPE_VIDEO && g.isSelected()
                        && player.getTrackSelectionParameters().overrides
                                 .containsKey(g.getMediaTrackGroup())) { isAuto = false; }
            }
        }
        out.add(Opt.section("Adaptive"));
        Opt auto = Opt.track(C.TRACK_TYPE_VIDEO, "Auto", "Adapts to connection speed");
        auto.isOff = true; auto.selected = isAuto; auto.badge = "ABR";
        out.add(auto);

        List<Opt> fixed = new ArrayList<>();
        for (Tracks.Group g : tracks.getGroups()) {
            if (g.getType() != C.TRACK_TYPE_VIDEO) continue;
            for (int t = 0; t < g.length; t++) {
                if (!g.isTrackSupported(t)) continue;
                Format f = g.getTrackFormat(t);
                Opt o = Opt.track(C.TRACK_TYPE_VIDEO, f.height + "p", videoSub(f));
                o.group = g.getMediaTrackGroup(); o.trackIndex = t;
                o.selected = g.isTrackSelected(t) && !isAuto;
                o.supported = g.isTrackSupported(t);
                o.badge = f.height >= 2160 ? "4K" : f.height >= 1080 ? "FHD" : f.height >= 720 ? "HD" : "SD";
                if (!o.supported) o.badge = "Unsupported";
                fixed.add(o);
            }
        }
        if (!fixed.isEmpty()) { out.add(Opt.divider()); out.add(Opt.section("Fixed")); out.addAll(fixed); }
        return out;
    }

    private String videoSub(Format f) {
        List<String> p = new ArrayList<>();
        if (f.frameRate > 0) p.add(Math.round(f.frameRate) + " fps");
        if (f.bitrate   > 0) p.add(String.format(Locale.US, "%.1f Mbps", f.bitrate / 1_000_000f));
        String c = vCodec(f); if (c != null) p.add(c);
        return dot(p);
    }

    private List<Opt> buildAudio(Tracks tracks) {
        List<Opt> out = new ArrayList<>();
        out.add(Opt.section("Audio Tracks"));
        int idx = 0;
        for (Tracks.Group g : tracks.getGroups()) {
            if (!isAudio(g)) continue;
            for (int t = 0; t < g.length; t++) {
                Format f = g.getTrackFormat(t);
                List<String> p = new ArrayList<>();
                String ac = aCodec(f); if (ac != null) p.add(ac);
                if (f.channelCount > 0) p.add(chLabel(f.channelCount));
                Opt o = Opt.track(C.TRACK_TYPE_AUDIO, audioLabel(f, idx), dot(p));
                o.group = g.getMediaTrackGroup(); o.trackIndex = t;
                o.language = f.language; o.selected = g.isTrackSelected(t);
                o.supported = g.isTrackSupported(t);
                if (ac != null) o.badge = ac;
                if (!o.supported) o.badge = "Unsupported";
                out.add(o); idx++;
            }
        }
        if (out.size() == 1) out.clear();
        return out;
    }

    private List<Opt> buildSubs(Tracks tracks) {
        List<Opt> out = new ArrayList<>();
        boolean any = false; int idx = 0;
        List<Opt> subs = new ArrayList<>();
        for (Tracks.Group g : tracks.getGroups()) {
            if (!isText(g)) continue;
            for (int t = 0; t < g.length; t++) {
                Format f = g.getTrackFormat(t);
                boolean sel = g.isTrackSelected(t);
                if (sel) any = true;
                Opt o = Opt.track(C.TRACK_TYPE_TEXT, subLabel(f, idx), subSub(f));
                o.group = g.getMediaTrackGroup(); o.trackIndex = t;
                o.language = f.language; o.selected = sel;
                o.supported = g.isTrackSupported(t);
                if ((f.roleFlags & C.ROLE_FLAG_CAPTION) != 0) o.badge = "CC";
                if (!o.supported) o.badge = "Unsupported";
                subs.add(o); idx++;
            }
        }
        Opt off = Opt.track(C.TRACK_TYPE_TEXT, "Off", "No subtitles");
        off.isOff = true; off.selected = !any;
        out.add(off);
        if (!subs.isEmpty()) { out.add(Opt.divider()); out.add(Opt.section("Available")); out.addAll(subs); }
        return out;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Apply selection to ExoPlayer
    // ════════════════════════════════════════════════════════════════════════
    private void applyToPlayer(Opt opt) {
        if (player == null) return;
        TrackSelectionParameters.Builder b = player.getTrackSelectionParameters().buildUpon();
        SharedPreferences sp = requireContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);

        if (opt.trackType == C.TRACK_TYPE_VIDEO) {
            b.clearOverridesOfType(C.TRACK_TYPE_VIDEO);
            if (!opt.isOff && opt.group != null)
                b.addOverride(new TrackSelectionOverride(opt.group,
                        Collections.singletonList(opt.trackIndex)));

        } else if (opt.trackType == C.TRACK_TYPE_TEXT) {
            b.clearOverridesOfType(C.TRACK_TYPE_TEXT);
            if (opt.isOff) {
                b.setIgnoredTextSelectionFlags(C.SELECTION_FLAG_DEFAULT | C.SELECTION_FLAG_FORCED);
                b.setPreferredTextLanguage(null);
                sp.edit().remove("pref_lang_text").apply();
            } else if (opt.group != null) {
                b.addOverride(new TrackSelectionOverride(opt.group,
                        Collections.singletonList(opt.trackIndex)));
                if (opt.language != null) {
                    b.setPreferredTextLanguage(opt.language);
                    sp.edit().putString("pref_lang_text", opt.language).apply();
                }
            }

        } else if (opt.trackType == C.TRACK_TYPE_AUDIO && opt.group != null) {
            b.clearOverridesOfType(C.TRACK_TYPE_AUDIO);
            b.addOverride(new TrackSelectionOverride(opt.group,
                    Collections.singletonList(opt.trackIndex)));
            if (opt.language != null) {
                b.setPreferredAudioLanguage(opt.language);
                sp.edit().putString("pref_lang_audio", opt.language).apply();
            }
        }
        player.setTrackSelectionParameters(b.build());
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Helpers
    // ════════════════════════════════════════════════════════════════════════
    private boolean isAudio(Tracks.Group g) {
        return g.getType() == C.TRACK_TYPE_AUDIO
                || (g.length > 0 && g.getTrackFormat(0).sampleMimeType != null
                && MimeTypes.isAudio(g.getTrackFormat(0).sampleMimeType));
    }
    private boolean isText(Tracks.Group g) {
        return g.getType() == C.TRACK_TYPE_TEXT
                || (g.length > 0 && g.getTrackFormat(0).sampleMimeType != null
                && MimeTypes.isText(g.getTrackFormat(0).sampleMimeType));
    }
    private String vCodec(Format f) {
        if (f.sampleMimeType == null) return null;
        if (f.sampleMimeType.contains("av01"))               return "AV1";
        if (f.sampleMimeType.contains(MimeTypes.VIDEO_H265)) return "HEVC";
        if (f.sampleMimeType.contains(MimeTypes.VIDEO_H264)) return "AVC";
        return null;
    }
    private String aCodec(Format f) {
        if (f.sampleMimeType == null) return null;
        if (f.sampleMimeType.contains(MimeTypes.AUDIO_E_AC3_JOC)) return "Atmos";
        if (f.sampleMimeType.contains(MimeTypes.AUDIO_E_AC3)
         || f.sampleMimeType.contains(MimeTypes.AUDIO_AC3))        return "DD+";
        if (f.sampleMimeType.contains(MimeTypes.AUDIO_AAC))         return "AAC";
        return null;
    }
    private String chLabel(int ch) {
        switch (ch) {
            case 1: return "Mono";
            case 2: return "Stereo";
            case 6: return "5.1";
            case 8: return "7.1";
            default: return ch + " Ch";
        }
    }
    private String audioLabel(Format f, int i) {
        if (f.language != null && !f.language.equals("und"))
            return new Locale(f.language).getDisplayLanguage(Locale.ENGLISH);
        return "Track " + (i + 1);
    }
    private String subLabel(Format f, int i) {
        if (f.language != null && !f.language.equals("und"))
            return new Locale(f.language).getDisplayLanguage(Locale.ENGLISH);
        return "Track " + (i + 1);
    }
    private String subSub(Format f) {
        return (f.roleFlags & C.ROLE_FLAG_CAPTION) != 0 ? "Closed Captions" : "";
    }
    private String dot(List<String> l) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < l.size(); i++) { if (i > 0) sb.append("  \u00B7  "); sb.append(l.get(i)); }
        return sb.toString();
    }

    private View hDivider(Context ctx, int color) {
        View v = new View(ctx);
        v.setBackgroundColor(color);
        v.setLayoutParams(new LinearLayout.LayoutParams(MATCH, dp(1)));
        return v;
    }
    private View hLineMargin(Context ctx) {
        View v = new View(ctx);
        v.setBackgroundColor(C_DIV);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(MATCH, dp(1));
        lp.topMargin = dp(8); lp.bottomMargin = dp(8); lp.leftMargin = dp(4); lp.rightMargin = dp(4);
        v.setLayoutParams(lp);
        return v;
    }
    private void addSpacer(LinearLayout parent, int height) {
        View sp = new View(requireContext());
        sp.setLayoutParams(new LinearLayout.LayoutParams(MATCH, height));
        parent.addView(sp);
    }
    private GradientDrawable extractBg(View v) {
        if (v.getBackground() instanceof RippleDrawable) {
            RippleDrawable rd = (RippleDrawable) v.getBackground();
            if (rd.getNumberOfLayers() > 0) {
                android.graphics.drawable.Drawable d = rd.getDrawable(0);
                if (d instanceof GradientDrawable) return (GradientDrawable) d;
            }
        }
        return v.getBackground() instanceof GradientDrawable
                ? (GradientDrawable) v.getBackground() : null;
    }
    private int dp(float v) {
        return Math.round(v * requireContext().getResources().getDisplayMetrics().density);
    }
    private RippleDrawable ripple(GradientDrawable base, int color) {
        int[][] s = { new int[]{ android.R.attr.state_pressed } };
        return new RippleDrawable(
                new android.content.res.ColorStateList(s, new int[]{color}), base, null);
    }

    private static final int MATCH = ViewGroup.LayoutParams.MATCH_PARENT;
    private static final int WRAP  = ViewGroup.LayoutParams.WRAP_CONTENT;
}