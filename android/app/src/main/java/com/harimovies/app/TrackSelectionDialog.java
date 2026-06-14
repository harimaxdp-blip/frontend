package com.harimovies.app;

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
 * TrackSelectionDialog — Refined landscape-optimised two-panel sheet
 *
 * Design language:
 *  - Near-black surfaces (#0F0F0F outer, #141414 sheet, #0F0F0F sidebar)
 *  - Netflix red (#E50914) as the single accent colour
 *  - 2 dp left-edge bar on selected rows
 *  - Coloured resolution badges: 4K = green, HD = blue, SD = grey, CC = warm
 *  - Circular back/close buttons
 *  - Compact typography (10–14 sp), uppercase micro section labels
 *
 * Supports touch + Android TV D-pad navigation.
 */
@UnstableApi
public class TrackSelectionDialog extends BottomSheetDialogFragment {

    // ── Tab indices ──────────────────────────────────────────────────────────
    private static final int TAB_QUALITY   = 0;
    private static final int TAB_AUDIO     = 1;
    private static final int TAB_SUBTITLES = 2;

    // ── Palette ──────────────────────────────────────────────────────────────
    private static final int CLR_BG_OUTER    = 0xFF0A0A0A;  // scene backdrop
    private static final int CLR_BG_SHEET    = 0xFF141414;  // card surface
    private static final int CLR_BG_HEADER   = 0xFF0F0F0F;  // header / sidebar
    private static final int CLR_BG_SIDEBAR  = 0xFF0F0F0F;
    private static final int CLR_BG_CONTENT  = 0xFF141414;
    private static final int CLR_DIVIDER     = 0xFF1C1C1C;
    private static final int CLR_BORDER      = 0xFF1E1E1E;

    private static final int CLR_RED         = 0xFFE50914;
    private static final int CLR_RED_ROW_BG  = 0x12E50914;  // ~7 % red tint

    private static final int CLR_WHITE       = 0xFFFFFFFF;
    private static final int CLR_W80         = 0xCCFFFFFF;
    private static final int CLR_W55         = 0x8CFFFFFF;
    private static final int CLR_W30         = 0x4DFFFFFF;
    private static final int CLR_W15         = 0x26FFFFFF;
    private static final int CLR_W08         = 0x14FFFFFF;

    // Badge colours
    private static final int CLR_BADGE_4K_BG   = 0xFF1A3A1A;
    private static final int CLR_BADGE_4K_FG   = 0xFF4CAF50;
    private static final int CLR_BADGE_HD_BG   = 0xFF1A1A3A;
    private static final int CLR_BADGE_HD_FG   = 0xFF5C8AF5;
    private static final int CLR_BADGE_SD_BG   = 0xFF252525;
    private static final int CLR_BADGE_SD_FG   = 0xFF555555;
    private static final int CLR_BADGE_CC_BG   = 0xFF2A1A1A;
    private static final int CLR_BADGE_CC_FG   = 0xFF888888;

    // Tab icon bg
    private static final int CLR_ICON_BG_OFF = 0xFF1C1C1C;

    // ── Track item model ─────────────────────────────────────────────────────
    private static class TrackItem {
        final TrackGroup group;
        final int        trackIndex;
        final String     labelMain;
        final String     labelSub;
        final String     badge;      // "4K", "HD", "SD", "CC", or null
        final int        type;
        final String     language;
        boolean          isSelected;
        final boolean    isDisabled;

        TrackItem(TrackGroup group, int trackIndex,
                  String labelMain, String labelSub, String badge,
                  int type, String language,
                  boolean isSelected, boolean isDisabled) {
            this.group       = group;
            this.trackIndex  = trackIndex;
            this.labelMain   = labelMain;
            this.labelSub    = labelSub;
            this.badge       = badge;
            this.type        = type;
            this.language    = language;
            this.isSelected  = isSelected;
            this.isDisabled  = isDisabled;
        }
    }

    // ── State ────────────────────────────────────────────────────────────────
    private ExoPlayer player;
    private Runnable  onDismiss;
    private int       currentTab = TAB_QUALITY;

    private List<TrackItem> videoItems    = new ArrayList<>();
    private List<TrackItem> audioItems    = new ArrayList<>();
    private List<TrackItem> subtitleItems = new ArrayList<>();

    private View[]       tabViews  = new View[3];
    private TextView[]   tabCurTv  = new TextView[3];
    private LinearLayout contentList;
    private ScrollView   contentScroll;

    // ── Factory ──────────────────────────────────────────────────────────────
    public static TrackSelectionDialog newInstance(ExoPlayer player,
                                                   @Nullable Runnable onDismiss) {
        TrackSelectionDialog d = new TrackSelectionDialog();
        d.player    = player;
        d.onDismiss = onDismiss;
        return d;
    }

    // ── Sheet height: 92 % ───────────────────────────────────────────────────
    @Override
    public void onStart() {
        super.onStart();
        if (getDialog() instanceof BottomSheetDialog) {
            BottomSheetDialog bsd = (BottomSheetDialog) getDialog();
            View bs = bsd.findViewById(com.google.android.material.R.id.design_bottom_sheet);
            if (bs != null) {
                BottomSheetBehavior<View> beh = BottomSheetBehavior.from(bs);
                int h = (int) (requireContext().getResources()
                        .getDisplayMetrics().heightPixels * 0.92f);
                beh.setPeekHeight(h);
                beh.setState(BottomSheetBehavior.STATE_EXPANDED);
                beh.setSkipCollapsed(true);
                bs.getLayoutParams().height = h;
                bs.requestLayout();
            }
        }
    }

    // ── dp helper ────────────────────────────────────────────────────────────
    private int dp(float val) {
        return Math.round(val * requireContext().getResources()
                .getDisplayMetrics().density);
    }

    // ── onCreateView ─────────────────────────────────────────────────────────
    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater,
                             @Nullable ViewGroup container,
                             @Nullable Bundle savedInstanceState) {

        Context ctx = requireContext();

        if (player != null) {
            Tracks t  = player.getCurrentTracks();
            videoItems    = buildVideoItems(t);
            audioItems    = buildAudioItems(t);
            subtitleItems = buildSubtitleItems(t);
        }

        if      (!videoItems.isEmpty())    currentTab = TAB_QUALITY;
        else if (!audioItems.isEmpty())    currentTab = TAB_AUDIO;
        else                               currentTab = TAB_SUBTITLES;

        // Root
        LinearLayout root = new LinearLayout(ctx);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(CLR_BG_OUTER);
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        root.addView(buildHeader(ctx));

        // Body row
        LinearLayout body = new LinearLayout(ctx);
        body.setOrientation(LinearLayout.HORIZONTAL);
        body.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        body.addView(buildSidebar(ctx));

        // Right pane
        FrameLayout right = new FrameLayout(ctx);
        right.setBackgroundColor(CLR_BG_CONTENT);
        right.setLayoutParams(new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.MATCH_PARENT, 1f));

        contentScroll = new ScrollView(ctx);
        contentScroll.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        contentScroll.setFillViewport(true);
        contentScroll.setVerticalScrollBarEnabled(false);

        contentList = new LinearLayout(ctx);
        contentList.setOrientation(LinearLayout.VERTICAL);
        contentList.setPadding(0, dp(4), 0, dp(20));
        contentScroll.addView(contentList);
        right.addView(contentScroll);
        body.addView(right);
        root.addView(body);

        populateContent(ctx);
        return root;
    }

    // ════════════════════════════════════════════════════════════════════════
    // Header
    // ════════════════════════════════════════════════════════════════════════
    private View buildHeader(Context ctx) {
        LinearLayout hdr = new LinearLayout(ctx);
        hdr.setOrientation(LinearLayout.HORIZONTAL);
        hdr.setGravity(Gravity.CENTER_VERTICAL);
        hdr.setBackgroundColor(CLR_BG_HEADER);
        hdr.setPadding(dp(14), dp(10), dp(14), dp(10));

        // Circular back button
        hdr.addView(makeCircleButton(ctx, "←", 18, () -> dismiss()));

        // Spacer
        View sp1 = new View(ctx);
        sp1.setLayoutParams(new LinearLayout.LayoutParams(dp(12), 0));
        hdr.addView(sp1);

        // Title block
        LinearLayout meta = new LinearLayout(ctx);
        meta.setOrientation(LinearLayout.VERTICAL);
        meta.setLayoutParams(new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        TextView tvT = new TextView(ctx);
        tvT.setText("Release That Witch");
        tvT.setTextColor(CLR_WHITE);
        tvT.setTextSize(13);
        tvT.setTypeface(null, Typeface.BOLD);
        meta.addView(tvT);

        TextView tvS = new TextView(ctx);
        tvS.setText("Season 1  ·  Episode 1");
        tvS.setTextColor(CLR_W30);
        tvS.setTextSize(10);
        LinearLayout.LayoutParams sLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        sLp.topMargin = dp(2);
        tvS.setLayoutParams(sLp);
        meta.addView(tvS);

        hdr.addView(meta);

        // Circular close button
        hdr.addView(makeCircleButton(ctx, "✕", 13, () -> dismiss()));

        // Bottom divider wrapper
        LinearLayout wrap = new LinearLayout(ctx);
        wrap.setOrientation(LinearLayout.VERTICAL);
        wrap.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));
        wrap.addView(hdr);

        View div = new View(ctx);
        div.setBackgroundColor(CLR_BORDER);
        div.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 1));
        wrap.addView(div);

        return wrap;
    }

    /** Small circle button (back / close). */
    private View makeCircleButton(Context ctx, String symbol,
                                   int textSizeSp, Runnable onClick) {
        int size = dp(28);
        TextView tv = new TextView(ctx);
        tv.setText(symbol);
        tv.setTextColor(CLR_W55);
        tv.setTextSize(textSizeSp);
        tv.setGravity(Gravity.CENTER);
        tv.setLayoutParams(new LinearLayout.LayoutParams(size, size));

        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(CLR_W08);
        tv.setBackground(bg);

        tv.setClickable(true);
        tv.setFocusable(true);
        tv.setOnClickListener(v -> onClick.run());
        tv.setOnFocusChangeListener((v, f) ->
                bg.setColor(f ? CLR_W15 : CLR_W08));
        return tv;
    }

    // ════════════════════════════════════════════════════════════════════════
    // Sidebar
    // ════════════════════════════════════════════════════════════════════════
    private View buildSidebar(Context ctx) {
        LinearLayout sb = new LinearLayout(ctx);
        sb.setOrientation(LinearLayout.VERTICAL);
        sb.setBackgroundColor(CLR_BG_SIDEBAR);
        sb.setLayoutParams(new LinearLayout.LayoutParams(
                dp(82), LinearLayout.LayoutParams.MATCH_PARENT));

        // Right border
        GradientDrawable sbBg = new GradientDrawable();
        sbBg.setColor(CLR_BG_SIDEBAR);
        sbBg.setStroke(1, CLR_BORDER);
        sb.setBackground(sbBg);

        tabViews[TAB_QUALITY]   = buildTabEntry(ctx, TAB_QUALITY,   "HD", "Quality");
        tabViews[TAB_AUDIO]     = buildTabEntry(ctx, TAB_AUDIO,     "♪",  "Audio");
        tabViews[TAB_SUBTITLES] = buildTabEntry(ctx, TAB_SUBTITLES, "CC", "Subtitles");

        sb.addView(tabViews[TAB_QUALITY]);
        sb.addView(tabViews[TAB_AUDIO]);
        sb.addView(tabViews[TAB_SUBTITLES]);

        return sb;
    }

    private View buildTabEntry(Context ctx, int tabIdx,
                                String iconText, String title) {
        LinearLayout entry = new LinearLayout(ctx);
        entry.setOrientation(LinearLayout.VERTICAL);
        entry.setGravity(Gravity.CENTER);
        entry.setPadding(dp(4), dp(12), dp(4), dp(12));
        entry.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(80)));
        entry.setClickable(true);
        entry.setFocusable(true);

        applyTabBg(entry, tabIdx == currentTab);

        // Icon badge
        FrameLayout badge = new FrameLayout(ctx);
        int bs = dp(30);
        LinearLayout.LayoutParams bLp = new LinearLayout.LayoutParams(bs, bs);
        bLp.gravity = Gravity.CENTER_HORIZONTAL;
        bLp.bottomMargin = dp(5);
        badge.setLayoutParams(bLp);

        GradientDrawable badgeBg = new GradientDrawable();
        badgeBg.setCornerRadius(dp(8));
        badgeBg.setColor(tabIdx == currentTab ? CLR_RED : CLR_ICON_BG_OFF);
        badge.setBackground(badgeBg);
        badge.setTag(badgeBg);  // so we can update it

        TextView tvIcon = new TextView(ctx);
        tvIcon.setText(iconText);
        tvIcon.setTextColor(tabIdx == currentTab ? CLR_WHITE : CLR_W30);
        tvIcon.setTextSize(tabIdx == TAB_QUALITY ? 9 : 12);
        tvIcon.setTypeface(null, Typeface.BOLD);
        tvIcon.setGravity(Gravity.CENTER);
        tvIcon.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        tvIcon.setTag("icon");
        badge.addView(tvIcon);
        entry.addView(badge);

        // Tab name
        TextView tvName = new TextView(ctx);
        tvName.setText(title);
        tvName.setTextColor(tabIdx == currentTab ? CLR_W80 : CLR_W30);
        tvName.setTextSize(9.5f);
        tvName.setTypeface(null, Typeface.BOLD);
        tvName.setGravity(Gravity.CENTER);
        tvName.setTag("name");
        entry.addView(tvName);

        // Current selection
        TextView tvCur = new TextView(ctx);
        tvCur.setText(getSidebarCurrent(tabIdx));
        tvCur.setTextColor(CLR_RED);
        tvCur.setTextSize(9f);
        tvCur.setGravity(Gravity.CENTER);
        tvCur.setSingleLine(true);
        LinearLayout.LayoutParams curLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        curLp.topMargin = dp(2);
        tvCur.setLayoutParams(curLp);
        tvCur.setTag("cur");
        tabCurTv[tabIdx] = tvCur;
        entry.addView(tvCur);

        entry.setOnClickListener(v -> switchTab(ctx, tabIdx));

        entry.setOnFocusChangeListener((v, focused) -> {
            if (focused) entry.setBackgroundColor(CLR_W08);
            else         applyTabBg(entry, tabIdx == currentTab);
        });

        entry.setOnKeyListener((v, keyCode, event) -> {
            if (event.getAction() != KeyEvent.ACTION_DOWN) return false;
            if (keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
                if (contentList.getChildCount() > 0)
                    contentList.getChildAt(0).requestFocus();
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER
                    || keyCode == KeyEvent.KEYCODE_ENTER) {
                switchTab(ctx, tabIdx);
                return true;
            }
            return false;
        });

        return entry;
    }

    /** Left red bar + bg for the active tab, transparent for inactive. */
    private void applyTabBg(LinearLayout entry, boolean active) {
        if (active) {
            // Composite: solid bg + 2 dp left red strip via LayerDrawable
            GradientDrawable fill = new GradientDrawable();
            fill.setColor(0xFF1C1C1C);

            GradientDrawable bar = new GradientDrawable();
            bar.setColor(CLR_RED);

            LayerDrawable ld = new LayerDrawable(new android.graphics.drawable.Drawable[]{fill, bar});
            // bar covers only the left 2 dp
            int w = dp(2);
            ld.setLayerInset(1, 0, 0,
                    /* right inset = total width - bar width; use a large number */ 9999, 0);
            entry.setBackground(ld);
        } else {
            entry.setBackgroundColor(Color.TRANSPARENT);
        }
    }

    private String getSidebarCurrent(int tab) {
        List<TrackItem> items = itemsForTab(tab);
        for (TrackItem it : items) if (it.isSelected) return it.labelMain;
        return tab == TAB_SUBTITLES ? "Off" : "Auto";
    }

    // ════════════════════════════════════════════════════════════════════════
    // Tab switching
    // ════════════════════════════════════════════════════════════════════════
    private void switchTab(Context ctx, int newTab) {
        currentTab = newTab;
        for (int i = 0; i < 3; i++) {
            boolean sel = (i == currentTab);
            if (tabViews[i] instanceof LinearLayout) {
                LinearLayout entry = (LinearLayout) tabViews[i];
                applyTabBg(entry, sel);

                // Update icon badge colour
                if (entry.getChildCount() >= 1) {
                    View child0 = entry.getChildAt(0);
                    if (child0 instanceof FrameLayout) {
                        FrameLayout badge = (FrameLayout) child0;
                        if (badge.getTag() instanceof GradientDrawable) {
                            ((GradientDrawable) badge.getTag())
                                    .setColor(sel ? CLR_RED : CLR_ICON_BG_OFF);
                        }
                        // Icon text colour
                        View iconTv = badge.findViewWithTag("icon");
                        if (iconTv instanceof TextView)
                            ((TextView) iconTv).setTextColor(sel ? CLR_WHITE : CLR_W30);
                    }
                }

                // Name colour
                View nameTv = entry.findViewWithTag("name");
                if (nameTv instanceof TextView)
                    ((TextView) nameTv).setTextColor(sel ? CLR_W80 : CLR_W30);
            }
        }
        populateContent(ctx);
        contentScroll.scrollTo(0, 0);
    }

    // ════════════════════════════════════════════════════════════════════════
    // Content area
    // ════════════════════════════════════════════════════════════════════════
    private void populateContent(Context ctx) {
        contentList.removeAllViews();

        List<TrackItem> items = itemsForTab(currentTab);

        if (currentTab == TAB_QUALITY) {
            // Section: Automatic
            List<TrackItem> auto = new ArrayList<>();
            List<TrackItem> manual = new ArrayList<>();
            for (TrackItem it : items) {
                if (it.isDisabled) auto.add(it);
                else               manual.add(it);
            }
            if (!auto.isEmpty()) {
                contentList.addView(makeSectionLabel(ctx, "Automatic"));
                for (int i = 0; i < auto.size(); i++)
                    contentList.addView(makeRow(ctx, auto.get(i), items));
            }
            if (!manual.isEmpty()) {
                contentList.addView(makeDivider(ctx));
                contentList.addView(makeSectionLabel(ctx, "Resolution"));
                for (int i = 0; i < manual.size(); i++)
                    contentList.addView(makeRow(ctx, manual.get(i), items));
            }

        } else if (currentTab == TAB_SUBTITLES) {
            // "None" first, then the rest under "Available"
            List<TrackItem> off = new ArrayList<>();
            List<TrackItem> avail = new ArrayList<>();
            for (TrackItem it : items) {
                if (it.isDisabled) off.add(it);
                else               avail.add(it);
            }
            for (TrackItem it : off)
                contentList.addView(makeRow(ctx, it, items));
            if (!avail.isEmpty()) {
                contentList.addView(makeDivider(ctx));
                contentList.addView(makeSectionLabel(ctx, "Available"));
                for (TrackItem it : avail)
                    contentList.addView(makeRow(ctx, it, items));
            }

        } else {
            // Audio — flat list under "Language"
            if (!items.isEmpty()) {
                contentList.addView(makeSectionLabel(ctx, "Language"));
                for (TrackItem it : items)
                    contentList.addView(makeRow(ctx, it, items));
            }
        }

        if (items.isEmpty()) {
            TextView empty = new TextView(ctx);
            empty.setText("No tracks available");
            empty.setTextColor(CLR_W30);
            empty.setTextSize(12);
            empty.setPadding(dp(16), dp(16), dp(16), dp(8));
            contentList.addView(empty);
        }
    }

    private View makeSectionLabel(Context ctx, String text) {
        TextView tv = new TextView(ctx);
        tv.setText(text.toUpperCase(Locale.US));
        tv.setTextColor(CLR_W15);
        tv.setTextSize(9f);
        tv.setTypeface(null, Typeface.BOLD);
        tv.setLetterSpacing(0.1f);
        tv.setPadding(dp(16), dp(10), dp(16), dp(4));
        return tv;
    }

    private View makeDivider(Context ctx) {
        View v = new View(ctx);
        v.setBackgroundColor(CLR_DIVIDER);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 1);
        lp.topMargin    = dp(3);
        lp.bottomMargin = dp(3);
        v.setLayoutParams(lp);
        return v;
    }

    private View makeRow(Context ctx, TrackItem item, List<TrackItem> allItems) {
        LinearLayout row = new LinearLayout(ctx);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(16), dp(9), dp(16), dp(9));
        row.setClickable(true);
        row.setFocusable(true);

        setRowBg(row, item.isSelected);

        // Radio dot
        FrameLayout radio = new FrameLayout(ctx);
        int rs = dp(16);
        LinearLayout.LayoutParams rLp = new LinearLayout.LayoutParams(rs, rs);
        rLp.rightMargin = dp(12);
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
        tvMain.setTextColor(item.isSelected ? CLR_WHITE : CLR_W55);
        tvMain.setTextSize(12);
        if (item.isSelected) tvMain.setTypeface(null, Typeface.BOLD);
        txt.addView(tvMain);

        if (item.labelSub != null && !item.labelSub.isEmpty()) {
            TextView tvSub = new TextView(ctx);
            tvSub.setText(item.labelSub);
            tvSub.setTextColor(CLR_W15);
            tvSub.setTextSize(10);
            LinearLayout.LayoutParams sLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT);
            sLp.topMargin = dp(1);
            tvSub.setLayoutParams(sLp);
            txt.addView(tvSub);
        }
        row.addView(txt);

        // Badge (4K / HD / SD / CC)
        if (item.badge != null) {
            row.addView(makeBadge(ctx, item.badge));
        }

        // Checkmark
        if (item.isSelected) {
            TextView ck = new TextView(ctx);
            ck.setText("✓");
            ck.setTextColor(CLR_RED);
            ck.setTextSize(11);
            ck.setTypeface(null, Typeface.BOLD);
            LinearLayout.LayoutParams ckLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT);
            ckLp.leftMargin = dp(8);
            ck.setLayoutParams(ckLp);
            row.addView(ck);
        }

        row.setOnClickListener(v -> {
            for (TrackItem ti : allItems) ti.isSelected = false;
            item.isSelected = true;
            applyTrackSelection(item);
            refreshSidebarCurrents();
            populateContent(ctx);
            if (onDismiss != null) onDismiss.run();
            dismiss();
        });

        row.setOnFocusChangeListener((v, focused) -> {
            if (focused) row.setBackgroundColor(CLR_W08);
            else         setRowBg(row, item.isSelected);
        });

        row.setOnKeyListener((v, keyCode, event) -> {
            if (event.getAction() != KeyEvent.ACTION_DOWN) return false;
            if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT) {
                tabViews[currentTab].requestFocus();
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER
                    || keyCode == KeyEvent.KEYCODE_ENTER) {
                row.performClick();
                return true;
            }
            return false;
        });

        return row;
    }

    /** Red-tinted row bg with 2 dp left accent bar when selected. */
    private void setRowBg(LinearLayout row, boolean selected) {
        if (selected) {
            GradientDrawable fill = new GradientDrawable();
            fill.setColor(CLR_RED_ROW_BG);

            GradientDrawable bar = new GradientDrawable();
            bar.setColor(CLR_RED);

            LayerDrawable ld = new LayerDrawable(
                    new android.graphics.drawable.Drawable[]{fill, bar});
            ld.setLayerInset(1, 0, 0, 9999, 0);
            row.setBackground(ld);
        } else {
            row.setBackgroundColor(Color.TRANSPARENT);
        }
    }

    private View makeBadge(Context ctx, String text) {
        TextView tv = new TextView(ctx);
        tv.setText(text);
        tv.setTextSize(9);
        tv.setTypeface(null, Typeface.BOLD);
        tv.setLetterSpacing(0.04f);
        int ph = dp(6), pv = dp(2);
        tv.setPadding(ph, pv, ph, pv);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.leftMargin = dp(8);
        tv.setLayoutParams(lp);

        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(4));

        switch (text) {
            case "4K":
                bg.setColor(CLR_BADGE_4K_BG);
                tv.setTextColor(CLR_BADGE_4K_FG);
                break;
            case "HD":
                bg.setColor(CLR_BADGE_HD_BG);
                tv.setTextColor(CLR_BADGE_HD_FG);
                break;
            case "CC":
                bg.setColor(CLR_BADGE_CC_BG);
                tv.setTextColor(CLR_BADGE_CC_FG);
                break;
            default: // SD
                bg.setColor(CLR_BADGE_SD_BG);
                tv.setTextColor(CLR_BADGE_SD_FG);
                break;
        }
        tv.setBackground(bg);
        return tv;
    }

    private void drawRadio(FrameLayout container, boolean selected) {
        GradientDrawable outer = new GradientDrawable();
        outer.setShape(GradientDrawable.OVAL);
        if (selected) {
            outer.setColor(CLR_RED);
            outer.setStroke(dp(1.5f), CLR_RED);
        } else {
            outer.setColor(Color.TRANSPARENT);
            outer.setStroke(dp(1.5f), CLR_W30);
        }
        container.setBackground(outer);

        if (selected) {
            // Inner white dot
            container.post(() -> {
                GradientDrawable inner = new GradientDrawable();
                inner.setShape(GradientDrawable.OVAL);
                inner.setColor(CLR_WHITE);

                LayerDrawable ld = new LayerDrawable(
                        new android.graphics.drawable.Drawable[]{outer, inner});
                int inset = dp(5);
                ld.setLayerInset(1, inset, inset, inset, inset);
                container.setBackground(ld);
            });
        }
    }

    private void refreshSidebarCurrents() {
        for (int i = 0; i < 3; i++) {
            if (tabCurTv[i] != null)
                tabCurTv[i].setText(getSidebarCurrent(i));
        }
    }

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
                Format fmt  = g.getTrackFormat(t);
                boolean sel = g.isTrackSelected(t) && !isAuto;

                String main  = fmt.height + "p" + (fmt.height >= 1080 ? " Full HD"
                        : fmt.height >= 720 ? " HD" : "");
                String sub   = fmt.bitrate > 0 ? (fmt.bitrate / 1000) + " kbps" : "";
                if (fmt.frameRate > 0 && !sub.isEmpty())
                    sub += "  ·  " + Math.round(fmt.frameRate) + " fps";

                String badge = fmt.height >= 2160 ? "4K"
                        : fmt.height >= 720  ? "HD"
                        : "SD";

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
            boolean isAudio = (g.getType() == C.TRACK_TYPE_AUDIO);
            if (!isAudio && g.length > 0) {
                Format f = g.getTrackFormat(0);
                if (f.sampleMimeType != null && MimeTypes.isAudio(f.sampleMimeType))
                    isAudio = true;
            }
            if (!isAudio) continue;
            for (int t = 0; t < g.length; t++) {
                Format fmt  = g.getTrackFormat(t);
                boolean sel = g.isTrackSelected(t);
                items.add(new TrackItem(g.getMediaTrackGroup(), t,
                        buildAudioMain(fmt, idx),
                        buildAudioSub(fmt),
                        null,
                        C.TRACK_TYPE_AUDIO, fmt.language, sel, false));
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
            boolean isText = (g.getType() == C.TRACK_TYPE_TEXT);
            if (!isText && g.length > 0) {
                Format f = g.getTrackFormat(0);
                if (f.sampleMimeType != null && MimeTypes.isText(f.sampleMimeType))
                    isText = true;
            }
            if (!isText) continue;
            for (int t = 0; t < g.length; t++) {
                Format fmt  = g.getTrackFormat(t);
                boolean sel = g.isTrackSelected(t);
                if (sel) anySelected = true;
                String badge = ((fmt.roleFlags & C.ROLE_FLAG_CAPTION) != 0) ? "CC" : null;
                items.add(new TrackItem(g.getMediaTrackGroup(), t,
                        buildSubMain(fmt, idx),
                        buildSubSub(fmt),
                        badge,
                        C.TRACK_TYPE_TEXT, fmt.language, sel, false));
                idx++;
            }
        }
        items.add(0, new TrackItem(null, -1,
                "None", "Subtitles off", null,
                C.TRACK_TYPE_TEXT, null, !anySelected, true));
        return items;
    }

    // ── Label helpers ─────────────────────────────────────────────────────────
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
        if ((fmt.selectionFlags & C.SELECTION_FLAG_FORCED) != 0) t.add("Forced");
        if ((fmt.roleFlags & C.ROLE_FLAG_CAPTION)                 != 0) t.add("CC");
        if ((fmt.roleFlags & C.ROLE_FLAG_DESCRIBES_MUSIC_AND_SOUND) != 0) t.add("SDH");
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
            case 1:  return "Mono";
            case 2:  return "Stereo";
            case 6:  return "5.1";
            case 8:  return "7.1";
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
            if (item.isDisabled) {
                builder.clearOverridesOfType(C.TRACK_TYPE_VIDEO);
            } else if (item.group != null) {
                builder.clearOverridesOfType(C.TRACK_TYPE_VIDEO);
                builder.addOverride(new TrackSelectionOverride(
                        item.group, singletonList(item.trackIndex)));
            }

        } else if (item.type == C.TRACK_TYPE_TEXT) {
            if (item.isDisabled) {
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