package com.harimovies.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
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
 * TrackSelectionDialog — Netflix-style two-panel layout
 *
 * Left panel: sidebar with Quality / Audio / Subtitles tab icons
 * Right panel: scrollable track list for the selected tab
 *
 * Supports:
 *  - Touch interaction (click rows and tab icons)
 *  - Android TV D-pad remote navigation (left/right between panels,
 *    up/down within panel, DPAD_CENTER / ENTER to select)
 */
@UnstableApi
public class TrackSelectionDialog extends BottomSheetDialogFragment {

    // ─── Constants ───────────────────────────────────────────────────────────
    private static final int TAB_QUALITY   = 0;
    private static final int TAB_AUDIO     = 1;
    private static final int TAB_SUBTITLES = 2;

    // ─── Colors ───────────────────────────────────────────────────────────────
    private static final int CLR_BG_DARK      = 0xFF0F0F0F;   // outer dialog bg
    private static final int CLR_BG_PANEL     = 0xFF1A1A1A;   // left sidebar
    private static final int CLR_BG_CONTENT   = 0xFF121212;   // right content
    private static final int CLR_RED          = 0xFFE50914;   // Netflix red accent
    private static final int CLR_RED_BG       = 0x1AE50914;   // selected row tint
    private static final int CLR_WHITE        = 0xFFFFFFFF;
    private static final int CLR_WHITE_60     = 0x99FFFFFF;
    private static final int CLR_WHITE_40     = 0x66FFFFFF;
    private static final int CLR_WHITE_20     = 0x33FFFFFF;
    private static final int CLR_WHITE_10     = 0x1AFFFFFF;
    private static final int CLR_TAB_SELECTED_BG = 0xFF1F1F1F;

    // ─── Track item model ────────────────────────────────────────────────────
    private static class TrackItem {
        final TrackGroup group;
        final int trackIndex;
        final String labelMain;
        final String labelSub;   // second line (bitrate / codec etc.)
        final int type;
        final String language;
        boolean isSelected;
        final boolean isDisabled; // "Auto" / "Off" sentinel

        TrackItem(TrackGroup group, int trackIndex,
                  String labelMain, String labelSub,
                  int type, String language,
                  boolean isSelected, boolean isDisabled) {
            this.group       = group;
            this.trackIndex  = trackIndex;
            this.labelMain   = labelMain;
            this.labelSub    = labelSub;
            this.type        = type;
            this.language    = language;
            this.isSelected  = isSelected;
            this.isDisabled  = isDisabled;
        }
    }

    // ─── State ───────────────────────────────────────────────────────────────
    private ExoPlayer player;
    private Runnable  onDismiss;
    private int       currentTab = TAB_QUALITY;

    private List<TrackItem> videoItems    = new ArrayList<>();
    private List<TrackItem> audioItems    = new ArrayList<>();
    private List<TrackItem> subtitleItems = new ArrayList<>();

    // UI references for tab highlight + content swap
    private View[]    tabButtons   = new View[3];
    private TextView[] tabLabels   = new TextView[3];
    private ImageView[] tabIcons   = new ImageView[3];
    private LinearLayout contentList;
    private ScrollView   contentScroll;

    // ─── Factory ─────────────────────────────────────────────────────────────
    public static TrackSelectionDialog newInstance(ExoPlayer player, @Nullable Runnable onDismiss) {
        TrackSelectionDialog d = new TrackSelectionDialog();
        d.player    = player;
        d.onDismiss = onDismiss;
        return d;
    }

    // ─── Expand to 90 % screen height ────────────────────────────────────────
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

    // ─── dp helper ───────────────────────────────────────────────────────────
    private int dp(int val) {
        return Math.round(val * requireContext().getResources().getDisplayMetrics().density);
    }

    // ─── onCreateView ────────────────────────────────────────────────────────
    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater,
                             @Nullable ViewGroup container,
                             @Nullable Bundle savedInstanceState) {

        Context ctx = requireContext();

        // Pre-build track lists
        if (player != null) {
            Tracks tracks = player.getCurrentTracks();
            videoItems    = buildVideoItems(tracks);
            audioItems    = buildAudioItems(tracks);
            subtitleItems = buildSubtitleItems(tracks);
        }

        // Detect current tab from first selected type
        if (!videoItems.isEmpty())    currentTab = TAB_QUALITY;
        else if (!audioItems.isEmpty()) currentTab = TAB_AUDIO;
        else                            currentTab = TAB_SUBTITLES;

        // ── Root: horizontal two-panel layout ─────────────────────────────
        LinearLayout root = new LinearLayout(ctx);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(CLR_BG_DARK);
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        // ── Header bar ────────────────────────────────────────────────────
        root.addView(makeHeader(ctx));

        // ── Body: sidebar + content ───────────────────────────────────────
        LinearLayout body = new LinearLayout(ctx);
        body.setOrientation(LinearLayout.HORIZONTAL);
        body.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        body.addView(makeSidebar(ctx));

        // Right content
        FrameLayout rightPane = new FrameLayout(ctx);
        rightPane.setBackgroundColor(CLR_BG_CONTENT);
        LinearLayout.LayoutParams rpLp = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.MATCH_PARENT, 1f);
        rightPane.setLayoutParams(rpLp);

        contentScroll = new ScrollView(ctx);
        contentScroll.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        contentScroll.setFillViewport(true);

        contentList = new LinearLayout(ctx);
        contentList.setOrientation(LinearLayout.VERTICAL);
        contentList.setPadding(0, dp(8), 0, dp(24));
        contentScroll.addView(contentList);
        rightPane.addView(contentScroll);
        body.addView(rightPane);

        root.addView(body);

        // Populate initial tab
        populateContent(ctx);

        return root;
    }

    // ─── Header ───────────────────────────────────────────────────────────────
    private View makeHeader(Context ctx) {
        LinearLayout header = new LinearLayout(ctx);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setBackgroundColor(CLR_BG_DARK);
        header.setPadding(dp(20), dp(14), dp(20), dp(14));

        // Back arrow
        TextView tvBack = new TextView(ctx);
        tvBack.setText("←");
        tvBack.setTextColor(CLR_WHITE);
        tvBack.setTextSize(20);
        tvBack.setPadding(0, 0, dp(16), 0);
        tvBack.setOnClickListener(v -> dismiss());
        makeFocusable(tvBack, false);
        header.addView(tvBack);

        // Title block
        LinearLayout titleBlock = new LinearLayout(ctx);
        titleBlock.setOrientation(LinearLayout.VERTICAL);
        titleBlock.setLayoutParams(new LinearLayout.LayoutParams(0,
                LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        TextView tvTitle = new TextView(ctx);
        tvTitle.setText("Release That Witch");
        tvTitle.setTextColor(CLR_WHITE);
        tvTitle.setTextSize(16);
        tvTitle.setTypeface(null, Typeface.BOLD);
        titleBlock.addView(tvTitle);

        TextView tvSub = new TextView(ctx);
        tvSub.setText("Season 1 • Episode 1");
        tvSub.setTextColor(CLR_WHITE_60);
        tvSub.setTextSize(12);
        titleBlock.addView(tvSub);

        header.addView(titleBlock);

        // Close button
        TextView tvClose = new TextView(ctx);
        tvClose.setText("✕");
        tvClose.setTextColor(CLR_WHITE_60);
        tvClose.setTextSize(18);
        tvClose.setGravity(Gravity.CENTER);
        int pad = dp(8);
        tvClose.setPadding(pad, pad, pad, pad);
        tvClose.setOnClickListener(v -> dismiss());
        makeFocusable(tvClose, false);
        header.addView(tvClose);

        // Thin bottom divider
        LinearLayout wrapper = new LinearLayout(ctx);
        wrapper.setOrientation(LinearLayout.VERTICAL);
        wrapper.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));
        wrapper.addView(header);

        View divider = new View(ctx);
        divider.setBackgroundColor(CLR_WHITE_10);
        divider.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 1));
        wrapper.addView(divider);

        return wrapper;
    }

    // ─── Left Sidebar ─────────────────────────────────────────────────────────
    private View makeSidebar(Context ctx) {
        LinearLayout sidebar = new LinearLayout(ctx);
        sidebar.setOrientation(LinearLayout.VERTICAL);
        sidebar.setBackgroundColor(CLR_BG_PANEL);
        int sidebarWidth = dp(140);
        sidebar.setLayoutParams(new LinearLayout.LayoutParams(
                sidebarWidth, LinearLayout.LayoutParams.MATCH_PARENT));

        // Quality tab
        tabButtons[TAB_QUALITY]   = makeTabEntry(ctx, TAB_QUALITY,
                "HD", "hd_badge", "Quality",
                getSidebarSubtitle(TAB_QUALITY));
        // Audio tab
        tabButtons[TAB_AUDIO]     = makeTabEntry(ctx, TAB_AUDIO,
                "♪", "music_note", "Audio",
                getSidebarSubtitle(TAB_AUDIO));
        // Subtitles tab
        tabButtons[TAB_SUBTITLES] = makeTabEntry(ctx, TAB_SUBTITLES,
                "CC", "cc_badge", "Subtitles",
                getSidebarSubtitle(TAB_SUBTITLES));

        for (View tab : tabButtons) sidebar.addView(tab);
        return sidebar;
    }

    private String getSidebarSubtitle(int tab) {
        switch (tab) {
            case TAB_QUALITY:
                // Show currently selected quality
                for (TrackItem item : videoItems) {
                    if (item.isSelected) return item.labelMain + (item.isDisabled ? "" : " • Best");
                }
                return "Auto";
            case TAB_AUDIO:
                for (TrackItem item : audioItems) {
                    if (item.isSelected) return item.labelMain;
                }
                return "—";
            case TAB_SUBTITLES:
                for (TrackItem item : subtitleItems) {
                    if (item.isSelected) return item.labelMain;
                }
                return "Off";
        }
        return "";
    }

    private View makeTabEntry(Context ctx, int tabIndex,
                               String iconText, String iconTag,
                               String title, String subtitle) {
        LinearLayout entry = new LinearLayout(ctx);
        entry.setOrientation(LinearLayout.VERTICAL);
        entry.setGravity(Gravity.CENTER);
        entry.setPadding(dp(12), dp(16), dp(12), dp(16));
        int h = dp(88);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, h);
        entry.setLayoutParams(lp);
        entry.setClickable(true);
        entry.setFocusable(true);

        // Icon badge square
        FrameLayout iconBadge = new FrameLayout(ctx);
        int badgeSize = dp(36);
        LinearLayout.LayoutParams badgeLp = new LinearLayout.LayoutParams(badgeSize, badgeSize);
        badgeLp.gravity = Gravity.CENTER_HORIZONTAL;
        badgeLp.bottomMargin = dp(6);
        iconBadge.setLayoutParams(badgeLp);
        GradientDrawable badgeBg = new GradientDrawable();
        badgeBg.setColor(CLR_RED);
        badgeBg.setCornerRadius(dp(6));
        iconBadge.setBackground(badgeBg);

        TextView tvIcon = new TextView(ctx);
        tvIcon.setText(iconText);
        tvIcon.setTextColor(CLR_WHITE);
        tvIcon.setTextSize(tabIndex == TAB_QUALITY ? 10 : 13);
        tvIcon.setTypeface(null, Typeface.BOLD);
        tvIcon.setGravity(Gravity.CENTER);
        tvIcon.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        iconBadge.addView(tvIcon);
        entry.addView(iconBadge);

        // Title
        TextView tvTitle = new TextView(ctx);
        tvTitle.setText(title);
        tvTitle.setTextColor(CLR_WHITE);
        tvTitle.setTextSize(13);
        tvTitle.setTypeface(null, Typeface.BOLD);
        tvTitle.setGravity(Gravity.CENTER);
        entry.addView(tvTitle);
        tabLabels[tabIndex] = tvTitle;

        // Subtitle (current selection)
        TextView tvSub = new TextView(ctx);
        tvSub.setText(subtitle);
        tvSub.setTextColor(CLR_RED);
        tvSub.setTextSize(11);
        tvSub.setGravity(Gravity.CENTER);
        tvSub.setSingleLine(true);
        LinearLayout.LayoutParams subLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        tvSub.setLayoutParams(subLp);
        entry.addView(tvSub);
        tabIcons[tabIndex] = null; // not using ImageView, using FrameLayout

        // Bottom red underline for selected tab
        updateTabHighlight(entry, tabIndex == currentTab);

        entry.setOnClickListener(v -> switchTab(ctx, tabIndex));

        // TV focus highlight
        entry.setOnFocusChangeListener((v, focused) -> {
            if (focused) {
                entry.setBackgroundColor(0x22E50914);
            } else {
                updateTabHighlight(entry, tabIndex == currentTab);
            }
        });

        // D-pad: right arrow moves to content list
        entry.setOnKeyListener((v, keyCode, event) -> {
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                if (keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
                    if (contentList.getChildCount() > 0) {
                        contentList.getChildAt(0).requestFocus();
                        return true;
                    }
                }
                if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER
                        || keyCode == KeyEvent.KEYCODE_ENTER) {
                    switchTab(ctx, tabIndex);
                    return true;
                }
            }
            return false;
        });

        return entry;
    }

    private void updateTabHighlight(View tabView, boolean selected) {
        tabView.setBackgroundColor(selected ? CLR_TAB_SELECTED_BG : Color.TRANSPARENT);
        // Left red bar for selected
        if (selected) {
            GradientDrawable bar = new GradientDrawable();
            bar.setColor(CLR_RED);
            // We fake a left border by adding a 4dp wide colored strip as start padding
            // (pure-code approach without custom drawables)
        }
    }

    // ─── Tab switching ────────────────────────────────────────────────────────
    private void switchTab(Context ctx, int newTab) {
        currentTab = newTab;
        // Update sidebar highlights
        for (int i = 0; i < 3; i++) {
            boolean sel = (i == currentTab);
            tabButtons[i].setBackgroundColor(sel ? CLR_TAB_SELECTED_BG : Color.TRANSPARENT);
        }
        // Repopulate content
        populateContent(ctx);
        contentScroll.scrollTo(0, 0);
    }

    // ─── Content area ─────────────────────────────────────────────────────────
    private void populateContent(Context ctx) {
        contentList.removeAllViews();

        List<TrackItem> items;
        String sectionTitle;

        switch (currentTab) {
            case TAB_AUDIO:
                items        = audioItems;
                sectionTitle = "Audio Track";
                break;
            case TAB_SUBTITLES:
                items        = subtitleItems;
                sectionTitle = "Subtitles / Captions";
                break;
            default:
                items        = videoItems;
                sectionTitle = "Quality";
                break;
        }

        // Section header row (icon + title + optional "Best" pill)
        contentList.addView(makeContentHeader(ctx, sectionTitle));

        if (items.isEmpty()) {
            TextView empty = new TextView(ctx);
            empty.setText("No tracks available");
            empty.setTextColor(CLR_WHITE_40);
            empty.setTextSize(13);
            empty.setPadding(dp(20), dp(16), dp(20), dp(8));
            contentList.addView(empty);
            return;
        }

        for (int i = 0; i < items.size(); i++) {
            TrackItem item = items.get(i);
            final int idx  = i;
            View row = makeContentRow(ctx, item, items, idx);
            contentList.addView(row);
        }
    }

    private View makeContentHeader(Context ctx, String title) {
        LinearLayout header = new LinearLayout(ctx);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(20), dp(16), dp(20), dp(10));

        // Red icon badge (small)
        FrameLayout badge = new FrameLayout(ctx);
        int bs = dp(28);
        LinearLayout.LayoutParams bLp = new LinearLayout.LayoutParams(bs, bs);
        bLp.rightMargin = dp(10);
        badge.setLayoutParams(bLp);
        GradientDrawable badgeBg = new GradientDrawable();
        badgeBg.setColor(CLR_RED);
        badgeBg.setCornerRadius(dp(5));
        badge.setBackground(badgeBg);

        TextView tvIcon = new TextView(ctx);
        tvIcon.setText(currentTab == TAB_QUALITY ? "HD"
                : currentTab == TAB_AUDIO ? "♪" : "CC");
        tvIcon.setTextColor(CLR_WHITE);
        tvIcon.setTextSize(currentTab == TAB_QUALITY ? 8 : 11);
        tvIcon.setTypeface(null, Typeface.BOLD);
        tvIcon.setGravity(Gravity.CENTER);
        tvIcon.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        badge.addView(tvIcon);
        header.addView(badge);

        // Title text
        TextView tvTitle = new TextView(ctx);
        tvTitle.setText(title);
        tvTitle.setTextColor(CLR_WHITE);
        tvTitle.setTextSize(15);
        tvTitle.setTypeface(null, Typeface.BOLD);
        tvTitle.setLayoutParams(new LinearLayout.LayoutParams(0,
                LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        header.addView(tvTitle);

        // "Best ▾" pill for Quality tab
        if (currentTab == TAB_QUALITY) {
            TextView pill = new TextView(ctx);
            pill.setText("Best  ▾");
            pill.setTextColor(CLR_WHITE);
            pill.setTextSize(12);
            pill.setTypeface(null, Typeface.BOLD);
            int ph = dp(8), pv = dp(5);
            pill.setPadding(ph, pv, ph, pv);
            GradientDrawable pillBg = new GradientDrawable();
            pillBg.setColor(CLR_RED);
            pillBg.setCornerRadius(dp(4));
            pill.setBackground(pillBg);
            header.addView(pill);
        }

        // Right chevron for Audio / Subtitles
        if (currentTab != TAB_QUALITY) {
            TextView chevron = new TextView(ctx);
            chevron.setText("›");
            chevron.setTextColor(CLR_WHITE_60);
            chevron.setTextSize(22);
            chevron.setPadding(dp(8), 0, 0, 0);
            header.addView(chevron);
        }

        return header;
    }

    private View makeContentRow(Context ctx, TrackItem item,
                                 List<TrackItem> allItems, int myIndex) {
        LinearLayout row = new LinearLayout(ctx);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(20), dp(14), dp(20), dp(14));
        row.setClickable(true);
        row.setFocusable(true);

        applyRowBackground(row, item.isSelected);

        // Radio button
        View radio = new View(ctx);
        int rs = dp(20);
        LinearLayout.LayoutParams rLp = new LinearLayout.LayoutParams(rs, rs);
        rLp.rightMargin = dp(16);
        radio.setLayoutParams(rLp);
        drawRadio(radio, item.isSelected);
        row.addView(radio);

        // Text block
        LinearLayout textBlock = new LinearLayout(ctx);
        textBlock.setOrientation(LinearLayout.VERTICAL);
        textBlock.setLayoutParams(new LinearLayout.LayoutParams(0,
                LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        TextView tvMain = new TextView(ctx);
        tvMain.setText(item.labelMain);
        tvMain.setTextColor(item.isSelected ? CLR_WHITE : CLR_WHITE_60);
        tvMain.setTextSize(14);
        if (item.isSelected) tvMain.setTypeface(null, Typeface.BOLD);
        textBlock.addView(tvMain);

        if (item.labelSub != null && !item.labelSub.isEmpty()) {
            TextView tvSub = new TextView(ctx);
            tvSub.setText(item.labelSub);
            tvSub.setTextColor(CLR_WHITE_40);
            tvSub.setTextSize(12);
            LinearLayout.LayoutParams sLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT);
            sLp.topMargin = dp(2);
            tvSub.setLayoutParams(sLp);
            textBlock.addView(tvSub);
        }

        row.addView(textBlock);

        // Checkmark on selected
        if (item.isSelected) {
            TextView check = new TextView(ctx);
            check.setText("✓");
            check.setTextColor(CLR_RED);
            check.setTextSize(18);
            check.setTypeface(null, Typeface.BOLD);
            row.addView(check);
        }

        // Click
        row.setOnClickListener(v -> {
            for (TrackItem ti : allItems) ti.isSelected = false;
            item.isSelected = true;
            applyTrackSelection(item);
            // Refresh sidebar subtitle
            refreshSidebarSubtitles(ctx);
            // Refresh content rows
            populateContent(ctx);
            if (onDismiss != null) onDismiss.run();
            dismiss();
        });

        // TV focus
        row.setOnFocusChangeListener((v, focused) -> {
            if (focused) {
                row.setBackgroundColor(0x33FFFFFF);
            } else {
                applyRowBackground(row, item.isSelected);
            }
        });

        // D-pad left → focus goes back to sidebar
        row.setOnKeyListener((v, keyCode, event) -> {
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT) {
                    tabButtons[currentTab].requestFocus();
                    return true;
                }
                if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER
                        || keyCode == KeyEvent.KEYCODE_ENTER) {
                    row.performClick();
                    return true;
                }
            }
            return false;
        });

        return row;
    }

    private void applyRowBackground(View row, boolean selected) {
        row.setBackgroundColor(selected ? CLR_RED_BG : Color.TRANSPARENT);
    }

    private void drawRadio(View dot, boolean selected) {
        GradientDrawable gd = new GradientDrawable();
        gd.setShape(GradientDrawable.OVAL);
        if (selected) {
            // Filled red outer ring with white inner dot illusion via stroke
            gd.setColor(CLR_RED);
            gd.setStroke(dp(2), CLR_RED);
        } else {
            gd.setColor(Color.TRANSPARENT);
            gd.setStroke(dp(2), CLR_WHITE_40);
        }
        dot.setBackground(gd);

        if (selected) {
            // Inner white dot as overlay
            dot.post(() -> {
                // Create inner white dot using padding illusion — handled by
                // a layered drawable approach
                GradientDrawable outer = new GradientDrawable();
                outer.setShape(GradientDrawable.OVAL);
                outer.setColor(CLR_RED);
                outer.setStroke(dp(2), CLR_RED);

                // Use a LayerDrawable for the inner white circle
                android.graphics.drawable.Drawable[] layers = {
                        outer,
                        createOvalDrawable(CLR_WHITE, dp(5))
                };
                android.graphics.drawable.LayerDrawable ld =
                        new android.graphics.drawable.LayerDrawable(layers);
                int inset = dp(5);
                ld.setLayerInset(1, inset, inset, inset, inset);
                dot.setBackground(ld);
            });
        }
    }

    private GradientDrawable createOvalDrawable(int color, int cornerRadius) {
        GradientDrawable gd = new GradientDrawable();
        gd.setShape(GradientDrawable.OVAL);
        gd.setColor(color);
        return gd;
    }

    private void makeFocusable(View v, boolean needsBackground) {
        v.setClickable(true);
        v.setFocusable(true);
        v.setFocusableInTouchMode(false);
        if (needsBackground) {
            v.setOnFocusChangeListener((view, focused) ->
                    view.setBackgroundColor(focused ? 0x22FFFFFF : Color.TRANSPARENT));
        }
    }

    private void refreshSidebarSubtitles(Context ctx) {
        for (int i = 0; i < 3; i++) {
            String sub = getSidebarSubtitle(i);
            // The subtitle TextView is the 3rd child in each tab entry (index 2)
            if (tabButtons[i] instanceof LinearLayout) {
                LinearLayout tabEntry = (LinearLayout) tabButtons[i];
                if (tabEntry.getChildCount() >= 3) {
                    View child = tabEntry.getChildAt(2);
                    if (child instanceof TextView) {
                        ((TextView) child).setText(sub);
                    }
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Track builders
    // ─────────────────────────────────────────────────────────────────────────

    private List<TrackItem> buildVideoItems(Tracks tracks) {
        List<TrackItem> items = new ArrayList<>();

        boolean isAutoSelected = true;
        if (player != null) {
            for (Tracks.Group group : tracks.getGroups()) {
                if (group.getType() == C.TRACK_TYPE_VIDEO && group.isSelected()) {
                    if (player.getTrackSelectionParameters().overrides
                            .containsKey(group.getMediaTrackGroup())) {
                        isAutoSelected = false;
                    }
                }
            }
        }

        items.add(new TrackItem(null, -1,
                "Auto (Best)", "Adjusts to give you the best experience",
                C.TRACK_TYPE_VIDEO, null, isAutoSelected, true));

        for (Tracks.Group group : tracks.getGroups()) {
            if (group.getType() != C.TRACK_TYPE_VIDEO) continue;
            for (int t = 0; t < group.length; t++) {
                if (!group.isTrackSupported(t)) continue;
                Format fmt   = group.getTrackFormat(t);
                boolean isSel = group.isTrackSelected(t) && !isAutoSelected;
                String main  = fmt.height + "p";
                String sub   = fmt.bitrate > 0 ? (fmt.bitrate / 1000) + " kbps" : "";
                if (fmt.frameRate > 0 && !sub.isEmpty())
                    sub += " • " + Math.round(fmt.frameRate) + " fps";
                items.add(new TrackItem(group.getMediaTrackGroup(), t,
                        main, sub, C.TRACK_TYPE_VIDEO, null, isSel, false));
            }
        }
        return items;
    }

    private List<TrackItem> buildAudioItems(Tracks tracks) {
        List<TrackItem> items = new ArrayList<>();
        int idx = 0;
        for (Tracks.Group group : tracks.getGroups()) {
            boolean isAudio = (group.getType() == C.TRACK_TYPE_AUDIO);
            if (!isAudio && group.length > 0) {
                Format f = group.getTrackFormat(0);
                if (f.sampleMimeType != null && MimeTypes.isAudio(f.sampleMimeType))
                    isAudio = true;
            }
            if (!isAudio) continue;
            for (int t = 0; t < group.length; t++) {
                Format fmt   = group.getTrackFormat(t);
                boolean isSel = group.isTrackSelected(t);
                String main  = buildAudioMainLabel(fmt, idx);
                String sub   = buildAudioSubLabel(fmt);
                items.add(new TrackItem(group.getMediaTrackGroup(), t,
                        main, sub, C.TRACK_TYPE_AUDIO, fmt.language, isSel, false));
                idx++;
            }
        }
        return items;
    }

    private List<TrackItem> buildSubtitleItems(Tracks tracks) {
        List<TrackItem> items = new ArrayList<>();
        boolean anySelected = false;
        int idx = 0;
        for (Tracks.Group group : tracks.getGroups()) {
            boolean isText = (group.getType() == C.TRACK_TYPE_TEXT);
            if (!isText && group.length > 0) {
                Format f = group.getTrackFormat(0);
                if (f.sampleMimeType != null && MimeTypes.isText(f.sampleMimeType))
                    isText = true;
            }
            if (!isText) continue;
            for (int t = 0; t < group.length; t++) {
                Format fmt   = group.getTrackFormat(t);
                boolean isSel = group.isTrackSelected(t);
                if (isSel) anySelected = true;
                String main = buildSubtitleMainLabel(fmt, idx);
                String sub  = buildSubtitleSubLabel(fmt);
                items.add(new TrackItem(group.getMediaTrackGroup(), t,
                        main, sub, C.TRACK_TYPE_TEXT, fmt.language, isSel, false));
                idx++;
            }
        }
        items.add(0, new TrackItem(null, -1,
                "No subtitles", "Off",
                C.TRACK_TYPE_TEXT, null, !anySelected, true));
        return items;
    }

    // ─── Label helpers ────────────────────────────────────────────────────────
    private String buildAudioMainLabel(Format fmt, int index) {
        if (fmt.language != null && !fmt.language.equals("und")) {
            String name = localeName(fmt.language);
            if (fmt.label != null && !fmt.label.isEmpty())
                return name + " — " + fmt.label;
            return name;
        }
        return "Track " + (index + 1);
    }

    private String buildAudioSubLabel(Format fmt) {
        List<String> parts = new ArrayList<>();
        if (fmt.sampleMimeType != null) {
            String codec = fmt.sampleMimeType.replace("audio/", "").toUpperCase(Locale.US);
            parts.add(codec);
        } else if (fmt.codecs != null) {
            parts.add(fmt.codecs.split("\\.")[0].toUpperCase(Locale.US));
        }
        if (fmt.channelCount > 0) parts.add(channelStr(fmt.channelCount));
        if (fmt.sampleRate > 0)   parts.add(fmt.sampleRate / 1000 + " kHz");
        return join(parts, "  ·  ");
    }

    private String buildSubtitleMainLabel(Format fmt, int index) {
        if (fmt.language != null && !fmt.language.equals("und")) {
            String name = localeName(fmt.language);
            if (fmt.label != null && !fmt.label.isEmpty())
                return name + " — " + fmt.label;
            return name;
        }
        return "Track " + (index + 1);
    }

    private String buildSubtitleSubLabel(Format fmt) {
        List<String> tags = new ArrayList<>();
        if (fmt.selectionFlags != 0 && (fmt.selectionFlags & C.SELECTION_FLAG_FORCED) != 0)
            tags.add("Forced");
        if (fmt.roleFlags != 0) {
            if ((fmt.roleFlags & C.ROLE_FLAG_CAPTION) != 0)                   tags.add("CC");
            if ((fmt.roleFlags & C.ROLE_FLAG_DESCRIBES_MUSIC_AND_SOUND) != 0) tags.add("SDH");
        }
        return join(tags, "  ·  ");
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

    // ─── Apply selection to ExoPlayer ─────────────────────────────────────────
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
                        C.SELECTION_FLAG_DEFAULT | C.SELECTION_FLAG_FORCED | C.SELECTION_FLAG_AUTOSELECT);
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

    private java.util.List<Integer> singletonList(int value) {
        java.util.List<Integer> list = new ArrayList<>();
        list.add(value);
        return list;
    }

    @Override
    public int getTheme() {
        return com.google.android.material.R.style.Theme_Design_BottomSheetDialog;
    }
}