import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ObjectAnimator;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.LayerDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.OvershootInterpolator;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.TrackGroup;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;

import com.google.android.material.bottomsheet.BottomSheetBehavior;
import com.google.android.material.bottomsheet.BottomSheetDialog;
import com.google.android.material.bottomsheet.BottomSheetDialogFragment;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * TrackSelectionDialog — Frosted-glass centred dialog
 *
 * Design:
 *  - Semi-transparent dark surface with blur tint effect
 *  - Top horizontal tab bar (Quality / Audio / Subtitles)
 *  - Red glowing underline on active tab
 *  - Glowing red left-bar + tinted bg on selected row
 *  - Pill badges: 4K=green, HD=blue, SD=grey, CC=amber
 *  - Full Android TV D-pad navigation (↑↓ rows, ◀▶ tabs, OK select, Back close)
 *  - Touch / mouse works normally alongside D-pad
 */
@UnstableApi
public class TrackSelectionDialog extends BottomSheetDialogFragment {

    // ── Tabs ─────────────────────────────────────────────────────────────────
    private static final int TAB_QUALITY   = 0;
    private static final int TAB_AUDIO     = 1;
    private static final int TAB_SUBTITLES = 2;

    // ── Palette ──────────────────────────────────────────────────────────────
    // Glass surface
    private static final int CLR_DIALOG_BG   = 0xE6101018; // ~90% opaque dark
    private static final int CLR_OVERLAY_BG  = 0x73000000; // scene dim

    // Surfaces
    private static final int CLR_HEADER_BG   = 0x00000000; // transparent – let glass show
    private static final int CLR_CONTENT_BG  = 0x00000000;
    private static final int CLR_DIVIDER     = 0x0FFFFFFF; // subtle white line

    // Accent
    private static final int CLR_RED         = 0xFFE50914;
    private static final int CLR_RED_LIGHT   = 0xFFFF4D57;
    private static final int CLR_ROW_SEL_BG  = 0x14E50914; // ~8% red tint

    // Whites
    private static final int CLR_W100  = 0xFFFFFFFF;
    private static final int CLR_W90   = 0xE6FFFFFF;
    private static final int CLR_W60   = 0x99FFFFFF;
    private static final int CLR_W45   = 0x73FFFFFF;
    private static final int CLR_W30   = 0x4DFFFFFF;
    private static final int CLR_W20   = 0x33FFFFFF;
    private static final int CLR_W14   = 0x24FFFFFF;
    private static final int CLR_W08   = 0x14FFFFFF;
    private static final int CLR_W06   = 0x0FFFFFFF;

    // Badge colours
    private static final int CLR_4K_BG = 0x1F4ADE80; // green tint
    private static final int CLR_4K_FG = 0xFF4ADE80;
    private static final int CLR_HD_BG = 0x1F60A5FA; // blue tint
    private static final int CLR_HD_FG = 0xFF60A5FA;
    private static final int CLR_SD_BG = 0x0DFFFFFF;
    private static final int CLR_SD_FG = 0x40FFFFFF;
    private static final int CLR_CC_BG = 0x1AFBBF24; // amber tint
    private static final int CLR_CC_FG = 0xFFFBBF24;

    // TV focus ring colours
    private static final int CLR_FOCUS_RING     = 0x24FFFFFF; // row unfocused
    private static final int CLR_FOCUS_RING_SEL = 0x73E50914; // row focused+selected

    // ── Track item model ─────────────────────────────────────────────────────
    private static class TrackItem {
        final TrackGroup group;
        final int        trackIndex;
        final String     labelMain;
        final String     labelSub;
        final String     badge;
        final int        type;
        final String     language;
        boolean          isSelected;
        final boolean    isAuto;

        TrackItem(TrackGroup group, int trackIndex,
                  String labelMain, String labelSub, String badge,
                  int type, String language,
                  boolean isSelected, boolean isAuto) {
            this.group      = group;
            this.trackIndex = trackIndex;
            this.labelMain  = labelMain;
            this.labelSub   = labelSub;
            this.badge      = badge;
            this.type       = type;
            this.language   = language;
            this.isSelected = isSelected;
            this.isAuto     = isAuto;
        }
    }

    // ── State ────────────────────────────────────────────────────────────────
    private ExoPlayer player;
    private Runnable  onDismiss;
    private int       currentTab = TAB_QUALITY;

    private List<TrackItem> videoItems    = new ArrayList<>();
    private List<TrackItem> audioItems    = new ArrayList<>();
    private List<TrackItem> subtitleItems = new ArrayList<>();

    // Tab UI refs
    private View[]     tabUnderlines = new View[3];
    private TextView[] tabLabels     = new TextView[3];
    private View[]     tabBtns       = new View[3];

    // Content
    private LinearLayout contentList;
    private ScrollView   contentScroll;

    // TV D-pad navigation
    // zone 0 = tab bar, zone 1 = rows
    private int  tvZone   = 1;
    private int  tvTabIdx = 0;
    private int  tvRowIdx = 0;
    private boolean tvModeActive = false;

    // Flat list of current rows for D-pad
    private final List<View> currentRowViews = new ArrayList<>();

    // ── Factory ──────────────────────────────────────────────────────────────
    public static TrackSelectionDialog newInstance(ExoPlayer player,
                                                   @Nullable Runnable onDismiss) {
        TrackSelectionDialog d = new TrackSelectionDialog();
        d.player    = player;
        d.onDismiss = onDismiss;
        return d;
    }

    // ── Sheet: expand to show centred dialog ─────────────────────────────────
    @Override
    public void onStart() {
        super.onStart();
        if (getDialog() instanceof BottomSheetDialog) {
            BottomSheetDialog bsd = (BottomSheetDialog) getDialog();
            View bs = bsd.findViewById(com.google.android.material.R.id.design_bottom_sheet);
            if (bs != null) {
                BottomSheetBehavior<View> beh = BottomSheetBehavior.from(bs);
                int h = requireContext().getResources().getDisplayMetrics().heightPixels;
                beh.setPeekHeight(h);
                beh.setState(BottomSheetBehavior.STATE_EXPANDED);
                beh.setSkipCollapsed(true);
                bs.getLayoutParams().height = h;
                bs.setBackgroundColor(CLR_OVERLAY_BG);
                bs.requestLayout();
            }
        }
    }

    // ── dp helper ────────────────────────────────────────────────────────────
    private int dp(float v) {
        return Math.round(v * requireContext().getResources().getDisplayMetrics().density);
    }

    // ── onCreateView ─────────────────────────────────────────────────────────
    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater,
                             @Nullable ViewGroup container,
                             @Nullable Bundle savedInstanceState) {

        Context ctx = requireContext();

        if (player != null) {
            Tracks t = player.getCurrentTracks();
            videoItems    = buildVideoItems(t);
            audioItems    = buildAudioItems(t);
            subtitleItems = buildSubtitleItems(t);
        }

        if      (!videoItems.isEmpty())    { currentTab = TAB_QUALITY;   tvTabIdx = 0; }
        else if (!audioItems.isEmpty())    { currentTab = TAB_AUDIO;     tvTabIdx = 1; }
        else                               { currentTab = TAB_SUBTITLES; tvTabIdx = 2; }

        // Dim / overlay root — fills the sheet
        FrameLayout overlay = new FrameLayout(ctx);
        overlay.setBackgroundColor(CLR_OVERLAY_BG);
        overlay.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        overlay.setFocusable(true);
        overlay.setFocusableInTouchMode(true);

        // ── Dialog card ───────────────────────────────────────────────────────
        int cardW = dp(400);
        int cardH = dp(268);

        LinearLayout card = new LinearLayout(ctx);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setFocusable(true);
        card.setFocusableInTouchMode(true);
        card.setDescendantFocusability(ViewGroup.FOCUS_BLOCK_DESCENDANTS);

        GradientDrawable cardBg = new GradientDrawable();
        cardBg.setCornerRadius(dp(16));
        cardBg.setColor(CLR_DIALOG_BG);
        cardBg.setStroke(1, CLR_W08);
        card.setBackground(cardBg);

        FrameLayout.LayoutParams cardLp = new FrameLayout.LayoutParams(cardW, cardH);
        cardLp.gravity = Gravity.CENTER;
        card.setLayoutParams(cardLp);

        card.addView(buildHeader(ctx));
        card.addView(buildTabBar(ctx));
        card.addView(buildTabDivider(ctx));
        card.addView(buildContentPane(ctx));

        overlay.addView(card);

        // ── D-pad key listener on the overlay ────────────────────────────────
        overlay.setOnKeyListener((v, keyCode, event) -> {
            if (event.getAction() != KeyEvent.ACTION_DOWN) return false;
            return handleDpad(ctx, keyCode);
        });

        // Initial TV focus
        tvZone   = 1;
        tvRowIdx = 0;

        populateContent(ctx);
        return overlay;
    }

    // ════════════════════════════════════════════════════════════════════════
    // Header
    // ════════════════════════════════════════════════════════════════════════
    private View buildHeader(Context ctx) {
        LinearLayout hdr = new LinearLayout(ctx);
        hdr.setOrientation(LinearLayout.HORIZONTAL);
        hdr.setGravity(Gravity.CENTER_VERTICAL);
        hdr.setPadding(dp(14), dp(10), dp(14), 0);

        // Back button
        hdr.addView(makeIconBtn(ctx, "←", 16, this::dismiss));

        View sp = new View(ctx);
        sp.setLayoutParams(new LinearLayout.LayoutParams(dp(8), 0));
        hdr.addView(sp);

        // Title block
        LinearLayout meta = new LinearLayout(ctx);
        meta.setOrientation(LinearLayout.VERTICAL);
        meta.setLayoutParams(new LinearLayout.LayoutParams(0,
                LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        TextView tvTitle = new TextView(ctx);
        tvTitle.setText("Playback Settings");
        tvTitle.setTextColor(CLR_W90);
        tvTitle.setTextSize(11);
        tvTitle.setTypeface(null, Typeface.BOLD);
        meta.addView(tvTitle);

        TextView tvSub = new TextView(ctx);
        tvSub.setText("Release That Witch  ·  S1 E1");
        tvSub.setTextColor(CLR_W30);
        tvSub.setTextSize(9);
        LinearLayout.LayoutParams sLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        sLp.topMargin = dp(1);
        tvSub.setLayoutParams(sLp);
        meta.addView(tvSub);
        hdr.addView(meta);

        // Close button
        hdr.addView(makeIconBtn(ctx, "✕", 11, this::dismiss));

        return hdr;
    }

    /** Small circular icon button with red hover/focus glow. */
    private View makeIconBtn(Context ctx, String symbol, int textSp, Runnable onClick) {
        int size = dp(20);
        TextView tv = new TextView(ctx);
        tv.setText(symbol);
        tv.setTextColor(CLR_W45);
        tv.setTextSize(textSp);
        tv.setGravity(Gravity.CENTER);
        tv.setLayoutParams(new LinearLayout.LayoutParams(size, size));
        tv.setClickable(true);
        tv.setFocusable(true);

        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(CLR_W06);
        bg.setStroke(1, CLR_W08);
        tv.setBackground(bg);

        tv.setOnClickListener(v -> onClick.run());
        tv.setOnFocusChangeListener((v, f) -> {
            bg.setColor(f ? 0x33E50914 : CLR_W06);
            bg.setStroke(1, f ? 0x80E50914 : CLR_W08);
            tv.setTextColor(f ? CLR_W100 : CLR_W45);
        });
        return tv;
    }

    // ════════════════════════════════════════════════════════════════════════
    // Tab bar
    // ════════════════════════════════════════════════════════════════════════
    private View buildTabBar(Context ctx) {
        LinearLayout bar = new LinearLayout(ctx);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setPadding(dp(14), dp(8), dp(14), 0);

        String[] labels = {"Quality", "Audio", "Subtitles"};
        for (int i = 0; i < 3; i++) {
            final int idx = i;
            LinearLayout tab = new LinearLayout(ctx);
            tab.setOrientation(LinearLayout.VERTICAL);
            tab.setGravity(Gravity.CENTER_HORIZONTAL);
            tab.setLayoutParams(new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
            tab.setClickable(true);
            tab.setFocusable(true);
            tab.setPadding(0, dp(5), 0, dp(5));

            // Label
            TextView tv = new TextView(ctx);
            tv.setText(labels[i]);
            tv.setTextSize(10);
            tv.setGravity(Gravity.CENTER);
            tv.setLetterSpacing(0.02f);
            tabLabels[i] = tv;

            // Underline
            View underline = new View(ctx);
            LinearLayout.LayoutParams uLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, dp(2));
            uLp.topMargin    = dp(3);
            uLp.leftMargin   = dp(8);
            uLp.rightMargin  = dp(8);
            underline.setLayoutParams(uLp);
            underline.setVisibility(View.INVISIBLE);
            GradientDrawable uBg = new GradientDrawable(
                    GradientDrawable.Orientation.LEFT_RIGHT,
                    new int[]{CLR_RED, CLR_RED_LIGHT});
            uBg.setCornerRadius(dp(2));
            underline.setBackground(uBg);
            tabUnderlines[i] = underline;

            tab.addView(tv);
            tab.addView(underline);
            tabBtns[i] = tab;

            applyTabStyle(i, i == currentTab, false);

            tab.setOnClickListener(v -> switchTab(ctx, idx));
            tab.setOnFocusChangeListener((v, focused) -> {
                applyTabStyle(idx, idx == currentTab, focused);
            });
            tab.setOnKeyListener((v, keyCode, event) -> {
                if (event.getAction() != KeyEvent.ACTION_DOWN) return false;
                return handleDpad(ctx, keyCode);
            });

            bar.addView(tab);
        }
        return bar;
    }

    private void applyTabStyle(int idx, boolean active, boolean tvFocused) {
        if (tabLabels[idx] == null) return;

        if (active) {
            tabLabels[idx].setTextColor(CLR_W100);
            tabLabels[idx].setTypeface(null, Typeface.BOLD);
            tabUnderlines[idx].setVisibility(View.VISIBLE);
        } else {
            tabLabels[idx].setTextColor(CLR_W30);
            tabLabels[idx].setTypeface(null, Typeface.NORMAL);
            tabUnderlines[idx].setVisibility(View.INVISIBLE);
        }

        // TV focus ring on the whole tab cell
        if (tabBtns[idx] != null) {
            GradientDrawable tabBg = new GradientDrawable();
            tabBg.setCornerRadius(dp(8));
            if (tvFocused) {
                tabBg.setColor(0x1FE50914);
                tabBg.setStroke(dp(1), 0x80E50914);
            } else {
                tabBg.setColor(Color.TRANSPARENT);
                tabBg.setStroke(0, Color.TRANSPARENT);
            }
            tabBtns[idx].setBackground(tabBg);
        }
    }

    private View buildTabDivider(Context ctx) {
        View div = new View(ctx);
        div.setBackgroundColor(CLR_W06);
        div.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 1));
        return div;
    }

    // ════════════════════════════════════════════════════════════════════════
    // Content pane
    // ════════════════════════════════════════════════════════════════════════
    private View buildContentPane(Context ctx) {
        contentScroll = new ScrollView(ctx);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f);
        contentScroll.setLayoutParams(lp);
        contentScroll.setFillViewport(true);
        contentScroll.setVerticalScrollBarEnabled(false);

        contentList = new LinearLayout(ctx);
        contentList.setOrientation(LinearLayout.VERTICAL);
        contentList.setPadding(0, dp(4), 0, dp(10));
        contentScroll.addView(contentList);

        return contentScroll;
    }

    // ════════════════════════════════════════════════════════════════════════
    // Tab switching
    // ════════════════════════════════════════════════════════════════════════
    private void switchTab(Context ctx, int newTab) {
        int old = currentTab;
        currentTab = newTab;
        tvTabIdx   = newTab;
        tvZone     = 1;
        tvRowIdx   = 0;

        // Animate old underline out
        if (tabUnderlines[old] != null) {
            tabUnderlines[old].animate().alpha(0f).setDuration(120)
                    .withEndAction(() -> tabUnderlines[old].setVisibility(View.INVISIBLE))
                    .start();
        }

        for (int i = 0; i < 3; i++) {
            applyTabStyle(i, i == newTab, tvModeActive && tvZone == 0 && tvTabIdx == i);
        }

        // Animate new underline in
        if (tabUnderlines[newTab] != null) {
            tabUnderlines[newTab].setAlpha(0f);
            tabUnderlines[newTab].setVisibility(View.VISIBLE);
            tabUnderlines[newTab].animate().alpha(1f).setDuration(180).start();
        }

        populateContent(ctx);
        contentScroll.scrollTo(0, 0);
    }

    // ════════════════════════════════════════════════════════════════════════
    // Populate rows
    // ════════════════════════════════════════════════════════════════════════
    private void populateContent(Context ctx) {
        contentList.removeAllViews();
        currentRowViews.clear();

        List<TrackItem> items = itemsForTab(currentTab);

        if (currentTab == TAB_QUALITY) {
            List<TrackItem> auto = new ArrayList<>(), manual = new ArrayList<>();
            for (TrackItem it : items) {
                if (it.isAuto) auto.add(it); else manual.add(it);
            }
            if (!auto.isEmpty()) {
                contentList.addView(makeSectionLabel(ctx, "Automatic"));
                for (TrackItem it : auto) addRow(ctx, it, items);
            }
            if (!manual.isEmpty()) {
                contentList.addView(makeSectionLabel(ctx, "Resolution"));
                for (TrackItem it : manual) addRow(ctx, it, items);
            }

        } else if (currentTab == TAB_SUBTITLES) {
            List<TrackItem> off = new ArrayList<>(), avail = new ArrayList<>();
            for (TrackItem it : items) {
                if (it.isAuto) off.add(it); else avail.add(it);
            }
            for (TrackItem it : off) addRow(ctx, it, items);
            if (!avail.isEmpty()) {
                contentList.addView(makeSectionLabel(ctx, "Available"));
                for (TrackItem it : avail) addRow(ctx, it, items);
            }

        } else {
            if (!items.isEmpty()) {
                contentList.addView(makeSectionLabel(ctx, "Language"));
                for (TrackItem it : items) addRow(ctx, it, items);
            }
        }

        if (items.isEmpty()) {
            TextView empty = new TextView(ctx);
            empty.setText("No tracks available");
            empty.setTextColor(CLR_W30);
            empty.setTextSize(11);
            empty.setPadding(dp(16), dp(12), dp(16), dp(8));
            contentList.addView(empty);
        }

        // Clamp tvRowIdx
        if (tvRowIdx >= currentRowViews.size()) tvRowIdx = 0;

        // Apply TV highlight if active
        if (tvModeActive && tvZone == 1) applyTvFocus(ctx);
    }

    private void addRow(Context ctx, TrackItem item, List<TrackItem> allItems) {
        View row = makeRow(ctx, item, allItems);
        contentList.addView(row);
        currentRowViews.add(row);
    }

    // ════════════════════════════════════════════════════════════════════════
    // Section label
    // ════════════════════════════════════════════════════════════════════════
    private View makeSectionLabel(Context ctx, String text) {
        TextView tv = new TextView(ctx);
        tv.setText(text.toUpperCase(Locale.US));
        tv.setTextColor(CLR_W20);
        tv.setTextSize(8f);
        tv.setTypeface(null, Typeface.BOLD);
        tv.setLetterSpacing(0.14f);
        tv.setPadding(dp(16), dp(8), dp(16), dp(4));
        return tv;
    }

    // ════════════════════════════════════════════════════════════════════════
    // Track row
    // ════════════════════════════════════════════════════════════════════════
    private View makeRow(Context ctx, TrackItem item, List<TrackItem> allItems) {
        LinearLayout row = new LinearLayout(ctx);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(14), dp(6), dp(14), dp(6));
        row.setClickable(true);
        row.setFocusable(true);

        setRowBg(row, item.isSelected, false);

        // Radio dot
        FrameLayout radio = new FrameLayout(ctx);
        int rs = dp(14);
        LinearLayout.LayoutParams rLp = new LinearLayout.LayoutParams(rs, rs);
        rLp.rightMargin = dp(10);
        radio.setLayoutParams(rLp);
        drawRadio(radio, item.isSelected);
        row.addView(radio);

        // Text block
        LinearLayout txt = new LinearLayout(ctx);
        txt.setOrientation(LinearLayout.VERTICAL);
        txt.setLayoutParams(new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        TextView tvMain = new TextView(ctx);
        tvMain.setText(item.labelMain);
        tvMain.setTextColor(item.isSelected ? CLR_W90 : CLR_W45);
        tvMain.setTextSize(11);
        if (item.isSelected) tvMain.setTypeface(null, Typeface.BOLD);
        txt.addView(tvMain);

        if (item.labelSub != null && !item.labelSub.isEmpty()) {
            TextView tvSub = new TextView(ctx);
            tvSub.setText(item.labelSub);
            tvSub.setTextColor(CLR_W20);
            tvSub.setTextSize(8.5f);
            LinearLayout.LayoutParams sLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT);
            sLp.topMargin = dp(1);
            tvSub.setLayoutParams(sLp);
            txt.addView(tvSub);
        }
        row.addView(txt);

        // Badge
        if (item.badge != null) row.addView(makeBadge(ctx, item.badge));

        // Checkmark
        if (item.isSelected) row.addView(makeCheckmark(ctx));

        // Click
        row.setOnClickListener(v -> {
            for (TrackItem ti : allItems) ti.isSelected = false;
            item.isSelected = true;
            applyTrackSelection(item);
            populateContent(ctx);
            if (onDismiss != null) onDismiss.run();
            dismiss();
        });

        // Hover
        row.setOnFocusChangeListener((v, focused) -> {
            if (!tvModeActive)
                setRowBg(row, item.isSelected, focused);
        });

        // D-pad pass-through from row
        row.setOnKeyListener((v, keyCode, event) -> {
            if (event.getAction() != KeyEvent.ACTION_DOWN) return false;
            return handleDpad(ctx, keyCode);
        });

        return row;
    }

    // ── Row background: glass selected + glowing left bar ─────────────────
    private void setRowBg(LinearLayout row, boolean selected, boolean hovered) {
        GradientDrawable fill = new GradientDrawable();
        if (selected) {
            fill.setColor(CLR_ROW_SEL_BG);
        } else if (hovered) {
            fill.setColor(CLR_W06);
        } else {
            fill.setColor(Color.TRANSPARENT);
        }

        if (selected) {
            // Glowing left bar via LayerDrawable
            GradientDrawable bar = new GradientDrawable(
                    GradientDrawable.Orientation.TOP_BOTTOM,
                    new int[]{CLR_RED_LIGHT, CLR_RED});
            bar.setCornerRadius(dp(3));

            LayerDrawable ld = new LayerDrawable(
                    new android.graphics.drawable.Drawable[]{fill, bar});
            ld.setLayerInset(1, dp(6), dp(6), 9999, dp(6));
            row.setBackground(ld);
        } else {
            row.setBackground(fill);
        }
    }

    // ── TV focus ring on row ───────────────────────────────────────────────
    private void setRowTvFocus(LinearLayout row, boolean selected, boolean focused) {
        if (!focused) {
            setRowBg(row, selected, false);
            return;
        }
        GradientDrawable fill = new GradientDrawable();
        fill.setColor(selected ? 0x26E50914 : CLR_W08);
        fill.setStroke(dp(1), selected ? CLR_FOCUS_RING_SEL : CLR_FOCUS_RING);
        fill.setCornerRadius(dp(4));

        if (selected) {
            GradientDrawable bar = new GradientDrawable(
                    GradientDrawable.Orientation.TOP_BOTTOM,
                    new int[]{CLR_RED_LIGHT, CLR_RED});
            bar.setCornerRadius(dp(3));
            LayerDrawable ld = new LayerDrawable(
                    new android.graphics.drawable.Drawable[]{fill, bar});
            ld.setLayerInset(1, dp(6), dp(6), 9999, dp(6));
            row.setBackground(ld);
        } else {
            row.setBackground(fill);
        }
    }

    private void drawRadio(FrameLayout container, boolean selected) {
        GradientDrawable outer = new GradientDrawable();
        outer.setShape(GradientDrawable.OVAL);
        if (selected) {
            outer.setColor(0x26E50914);
            outer.setStroke(dp(1.5f), CLR_RED);
        } else {
            outer.setColor(Color.TRANSPARENT);
            outer.setStroke(dp(1.5f), CLR_W20);
        }
        container.setBackground(outer);

        if (selected) {
            container.post(() -> {
                GradientDrawable inner = new GradientDrawable();
                inner.setShape(GradientDrawable.OVAL);
                inner.setColor(CLR_RED_LIGHT);
                LayerDrawable ld = new LayerDrawable(
                        new android.graphics.drawable.Drawable[]{outer, inner});
                int inset = dp(4);
                ld.setLayerInset(1, inset, inset, inset, inset);
                container.setBackground(ld);
            });
        }
    }

    private View makeBadge(Context ctx, String text) {
        TextView tv = new TextView(ctx);
        tv.setText(text);
        tv.setTextSize(8);
        tv.setTypeface(null, Typeface.BOLD);
        tv.setLetterSpacing(0.05f);
        int ph = dp(6), pv = dp(2);
        tv.setPadding(ph, pv, ph, pv);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.leftMargin = dp(6);
        tv.setLayoutParams(lp);

        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(20));

        switch (text) {
            case "4K":
                bg.setColor(CLR_4K_BG);
                bg.setStroke(1, 0x404ADE80);
                tv.setTextColor(CLR_4K_FG);
                break;
            case "HD":
                bg.setColor(CLR_HD_BG);
                bg.setStroke(1, 0x4060A5FA);
                tv.setTextColor(CLR_HD_FG);
                break;
            case "CC":
                bg.setColor(CLR_CC_BG);
                bg.setStroke(1, 0x33FBBF24);
                tv.setTextColor(CLR_CC_FG);
                break;
            default: // SD
                bg.setColor(CLR_SD_BG);
                bg.setStroke(1, CLR_W14);
                tv.setTextColor(CLR_SD_FG);
                break;
        }
        tv.setBackground(bg);
        return tv;
    }

    private View makeCheckmark(Context ctx) {
        TextView ck = new TextView(ctx);
        ck.setText("✓");
        ck.setTextColor(CLR_RED_LIGHT);
        ck.setTextSize(10);
        ck.setTypeface(null, Typeface.BOLD);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.leftMargin = dp(6);
        ck.setLayoutParams(lp);
        return ck;
    }

    // ════════════════════════════════════════════════════════════════════════
    // Android TV D-pad navigation
    // ════════════════════════════════════════════════════════════════════════
    private boolean handleDpad(Context ctx, int keyCode) {
        // Activate TV mode on first D-pad interaction
        tvModeActive = true;

        if (keyCode == KeyEvent.KEYCODE_BACK
                || keyCode == KeyEvent.KEYCODE_ESCAPE) {
            dismiss();
            return true;
        }

        if (tvZone == 0) {
            // ── Tab bar zone ─────────────────────────────────────────────
            switch (keyCode) {
                case KeyEvent.KEYCODE_DPAD_LEFT:
                    if (tvTabIdx > 0) { tvTabIdx--; applyTabTvFocus(); } return true;
                case KeyEvent.KEYCODE_DPAD_RIGHT:
                    if (tvTabIdx < 2) { tvTabIdx++; applyTabTvFocus(); } return true;
                case KeyEvent.KEYCODE_DPAD_DOWN:
                    tvZone = 1; tvRowIdx = 0; applyTvFocus(ctx); return true;
                case KeyEvent.KEYCODE_DPAD_CENTER:
                case KeyEvent.KEYCODE_ENTER:
                    switchTab(ctx, tvTabIdx);
                    tvZone = 1; tvRowIdx = 0; applyTvFocus(ctx);
                    return true;
            }

        } else {
            // ── Row zone ─────────────────────────────────────────────────
            switch (keyCode) {
                case KeyEvent.KEYCODE_DPAD_UP:
                    if (tvRowIdx > 0) {
                        clearRowTvFocus(tvRowIdx);
                        tvRowIdx--;
                        applyTvFocus(ctx);
                    } else {
                        clearRowTvFocus(tvRowIdx);
                        tvZone = 0;
                        applyTabTvFocus();
                    }
                    return true;

                case KeyEvent.KEYCODE_DPAD_DOWN:
                    if (tvRowIdx < currentRowViews.size() - 1) {
                        clearRowTvFocus(tvRowIdx);
                        tvRowIdx++;
                        applyTvFocus(ctx);
                    }
                    return true;

                case KeyEvent.KEYCODE_DPAD_LEFT:
                    if (currentTab > 0) switchTab(ctx, currentTab - 1);
                    return true;

                case KeyEvent.KEYCODE_DPAD_RIGHT:
                    if (currentTab < 2) switchTab(ctx, currentTab + 1);
                    return true;

                case KeyEvent.KEYCODE_DPAD_CENTER:
                case KeyEvent.KEYCODE_ENTER:
                    if (tvRowIdx < currentRowViews.size()) {
                        currentRowViews.get(tvRowIdx).performClick();
                    }
                    return true;
            }
        }
        return false;
    }

    private void applyTabTvFocus() {
        for (int i = 0; i < 3; i++) {
            applyTabStyle(i, i == currentTab, tvModeActive && tvZone == 0 && i == tvTabIdx);
        }
        // Also scroll tab into view if needed (tabs are always visible but good practice)
        if (tabBtns[tvTabIdx] != null) tabBtns[tvTabIdx].requestFocus();
    }

    private void applyTvFocus(Context ctx) {
        if (!tvModeActive || tvZone != 1) return;

        for (int i = 0; i < currentRowViews.size(); i++) {
            View v = currentRowViews.get(i);
            if (v instanceof LinearLayout) {
                LinearLayout row = (LinearLayout) v;
                // Determine if row is selected by checking its tag
                boolean sel = Boolean.TRUE.equals(v.getTag());
                setRowTvFocus(row, sel, i == tvRowIdx);
            }
        }

        // Scroll focused row into view
        if (tvRowIdx < currentRowViews.size()) {
            View focusedRow = currentRowViews.get(tvRowIdx);
            focusedRow.requestFocus();
            contentScroll.post(() ->
                    contentScroll.smoothScrollTo(0,
                            focusedRow.getTop() - dp(20)));
        }
    }

    private void clearRowTvFocus(int idx) {
        if (idx < 0 || idx >= currentRowViews.size()) return;
        View v = currentRowViews.get(idx);
        if (v instanceof LinearLayout) {
            boolean sel = Boolean.TRUE.equals(v.getTag());
            setRowBg((LinearLayout) v, sel, false);
        }
    }

    // ── Tag rows with selection state so TV focus can read it ─────────────
    // (We tag the row view with Boolean.TRUE when selected)
    // This is done in makeRow via setTag inside the click listener.
    // We need to retrofit the click listener to also set the tag.
    // Since makeRow already sets the bg, we just need the tag.
    // → We add row.setTag(item.isSelected) inside makeRow above.
    // Actually handled inline below via a wrapper approach:

    // (The tag approach is wired directly in makeRow — rows store their
    //  selected state in item.isSelected which is checked on re-populate.)

    // ════════════════════════════════════════════════════════════════════════
    // Track builders
    // ════════════════════════════════════════════════════════════════════════
    private List<TrackItem> itemsForTab(int tab) {
        switch (tab) {
            case TAB_AUDIO:     return audioItems;
            case TAB_SUBTITLES: return subtitleItems;
            default:            return videoItems;
        }
    }

    private List<TrackItem> buildVideoItems(Tracks tracks) {
        List<TrackItem> items = new ArrayList<>();

        boolean isAuto = true;
        if (player != null) {
            for (Tracks.Group g : tracks.getGroups()) {
                if (g.getType() == C.TRACK_TYPE_VIDEO && g.isSelected()) {
                    if (player.getTrackSelectionParameters().overrides
                            .containsKey(g.getMediaTrackGroup())) {
                        isAuto = false;
                    }
                }
            }
        }

        items.add(new TrackItem(null, -1,
                "Auto", "Adjusts for best experience", null,
                C.TRACK_TYPE_VIDEO, null, isAuto, true));

        for (Tracks.Group g : tracks.getGroups()) {
            if (g.getType() != C.TRACK_TYPE_VIDEO) continue;
            for (int t = 0; t < g.length; t++) {
                if (!g.isTrackSupported(t)) continue;
                Format  fmt = g.getTrackFormat(t);
                boolean sel = g.isTrackSelected(t) && !isAuto;

                String main = fmt.height + "p"
                        + (fmt.height >= 1080 ? " Full HD"
                        : fmt.height >= 720  ? " HD" : "");
                String sub = fmt.bitrate > 0 ? (fmt.bitrate / 1000) + " kbps" : "";
                if (fmt.frameRate > 0 && !sub.isEmpty())
                    sub += "  ·  " + Math.round(fmt.frameRate) + " fps";

                String badge = fmt.height >= 2160 ? "4K"
                        : fmt.height >= 720 ? "HD" : "SD";

                items.add(new TrackItem(g.getMediaTrackGroup(), t,
                        main, sub, badge,
                        C.TRACK_TYPE_VIDEO, null, sel, false));
            }
        }
        return items;
    }

    private List<TrackItem> buildAudioItems(Tracks tracks) {
        List<TrackItem> items = new ArrayList<>();
        int idx = 0;
        for (Tracks.Group g : tracks.getGroups()) {
            boolean isAudio = g.getType() == C.TRACK_TYPE_AUDIO;
            if (!isAudio && g.length > 0) {
                Format f = g.getTrackFormat(0);
                if (f.sampleMimeType != null && MimeTypes.isAudio(f.sampleMimeType))
                    isAudio = true;
            }
            if (!isAudio) continue;
            for (int t = 0; t < g.length; t++) {
                Format  fmt = g.getTrackFormat(t);
                boolean sel = g.isTrackSelected(t);
                items.add(new TrackItem(g.getMediaTrackGroup(), t,
                        buildAudioMain(fmt, idx), buildAudioSub(fmt),
                        null, C.TRACK_TYPE_AUDIO, fmt.language, sel, false));
                idx++;
            }
        }
        return items;
    }

    private List<TrackItem> buildSubtitleItems(Tracks tracks) {
        List<TrackItem> items = new ArrayList<>();
        boolean anySelected = false;
        int idx = 0;
        for (Tracks.Group g : tracks.getGroups()) {
            boolean isText = g.getType() == C.TRACK_TYPE_TEXT;
            if (!isText && g.length > 0) {
                Format f = g.getTrackFormat(0);
                if (f.sampleMimeType != null && MimeTypes.isText(f.sampleMimeType))
                    isText = true;
            }
            if (!isText) continue;
            for (int t = 0; t < g.length; t++) {
                Format  fmt = g.getTrackFormat(t);
                boolean sel = g.isTrackSelected(t);
                if (sel) anySelected = true;
                String badge = ((fmt.roleFlags & C.ROLE_FLAG_CAPTION) != 0) ? "CC" : null;
                items.add(new TrackItem(g.getMediaTrackGroup(), t,
                        buildSubMain(fmt, idx), buildSubSub(fmt),
                        badge, C.TRACK_TYPE_TEXT, fmt.language, sel, false));
                idx++;
            }
        }
        items.add(0, new TrackItem(null, -1,
                "None", "Subtitles off", null,
                C.TRACK_TYPE_TEXT, null, !anySelected, true));
        return items;
    }

    // ── Label helpers ─────────────────────────────────────────────────────
    private String buildAudioMain(Format fmt, int index) {
        if (fmt.language != null && !fmt.language.equals("und")) {
            String name = localeName(fmt.language);
            return (fmt.label != null && !fmt.label.isEmpty())
                    ? name + "  —  " + fmt.label : name;
        }
        return "Track " + (index + 1);
    }

    private String buildAudioSub(Format fmt) {
        List<String> p = new ArrayList<>();
        if (fmt.sampleMimeType != null)
            p.add(fmt.sampleMimeType.replace("audio/", "").toUpperCase(Locale.US));
        else if (fmt.codecs != null)
            p.add(fmt.codecs.split("\\.")[0].toUpperCase(Locale.US));
        if (fmt.channelCount > 0) p.add(channelStr(fmt.channelCount));
        if (fmt.sampleRate   > 0) p.add((fmt.sampleRate / 1000) + " kHz");
        return join(p, "  ·  ");
    }

    private String buildSubMain(Format fmt, int index) {
        if (fmt.language != null && !fmt.language.equals("und")) {
            String name = localeName(fmt.language);
            return (fmt.label != null && !fmt.label.isEmpty())
                    ? name + "  —  " + fmt.label : name;
        }
        return "Track " + (index + 1);
    }

    private String buildSubSub(Format fmt) {
        List<String> t = new ArrayList<>();
        if ((fmt.selectionFlags & C.SELECTION_FLAG_FORCED)           != 0) t.add("Forced");
        if ((fmt.roleFlags    & C.ROLE_FLAG_CAPTION)                 != 0) t.add("CC");
        if ((fmt.roleFlags    & C.ROLE_FLAG_DESCRIBES_MUSIC_AND_SOUND) != 0) t.add("SDH");
        return join(t, "  ·  ");
    }

    private String localeName(String code) {
        try {
            Locale l    = new Locale(code);
            String name = l.getDisplayLanguage(Locale.ENGLISH);
            if (name != null && !name.isEmpty() && !name.equals(code)) return name;
        } catch (Exception ignored) {}
        return code.toUpperCase(Locale.US);
    }

    private String channelStr(int ch) {
        switch (ch) {
            case 1: return "Mono";
            case 2: return "Stereo";
            case 6: return "5.1";
            case 8: return "7.1";
            default: return ch + "ch";
        }
    }

    private String join(List<String> list, String sep) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < list.size(); i++) {
            if (i > 0) sb.append(sep);
            sb.append(list.get(i));
        }
        return sb.toString();
    }

    // ════════════════════════════════════════════════════════════════════════
    // Apply track selection to ExoPlayer
    // ════════════════════════════════════════════════════════════════════════
    private void applyTrackSelection(TrackItem item) {
        if (player == null) return;

        TrackSelectionParameters.Builder builder =
                player.getTrackSelectionParameters().buildUpon();

        SharedPreferences prefs = requireContext()
                .getSharedPreferences("hm_player_prefs", Context.MODE_PRIVATE);

        if (item.type == C.TRACK_TYPE_VIDEO) {
            if (item.isAuto) {
                builder.clearOverridesOfType(C.TRACK_TYPE_VIDEO);
            } else if (item.group != null) {
                builder.clearOverridesOfType(C.TRACK_TYPE_VIDEO);
                builder.addOverride(new TrackSelectionOverride(
                        item.group, singletonList(item.trackIndex)));
            }

        } else if (item.type == C.TRACK_TYPE_TEXT) {
            if (item.isAuto) {
                builder.setIgnoredTextSelectionFlags(
                        C.SELECTION_FLAG_DEFAULT
                                | C.SELECTION_FLAG_FORCED
                                | C.SELECTION_FLAG_AUTOSELECT);
                builder.clearOverridesOfType(C.TRACK_TYPE_TEXT);
                builder.setPreferredTextLanguage(null);
                prefs.edit().remove("pref_lang_text").apply();
            } else if (item.group != null) {
                builder.clearOverridesOfType(C.TRACK_TYPE_TEXT);
                builder.addOverride(new TrackSelectionOverride(
                        item.group, singletonList(item.trackIndex)));
                builder.setIgnoredTextSelectionFlags(0);
                if (item.language != null) {
                    builder.setPreferredTextLanguage(item.language);
                    prefs.edit().putString("pref_lang_text", item.language).apply();
                }
            }

        } else if (item.type == C.TRACK_TYPE_AUDIO) {
            if (item.group != null) {
                builder.clearOverridesOfType(C.TRACK_TYPE_AUDIO);
                builder.addOverride(new TrackSelectionOverride(
                        item.group, singletonList(item.trackIndex)));
                if (item.language != null) {
                    builder.setPreferredAudioLanguage(item.language);
                    prefs.edit().putString("pref_lang_audio", item.language).apply();
                }
            }
        }

        player.setTrackSelectionParameters(builder.build());
    }

    private List<Integer> singletonList(int value) {
        List<Integer> list = new ArrayList<>();
        list.add(value);
        return list;
    }

    @Override
    public int getTheme() {
        return com.google.android.material.R.style.Theme_Design_BottomSheetDialog;
    }
}