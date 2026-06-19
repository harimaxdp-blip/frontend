package com.harimovies.app;

import android.app.Dialog;
import android.content.Context;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;

/**
 * Simple modal dialog to show technical details of a track.
 */
public class TrackDetailsDialog extends Dialog {

    private final TrackItem item;

    public static void show(Context context, TrackItem item) {
        new TrackDetailsDialog(context, item).show();
    }

    public TrackDetailsDialog(@NonNull Context context, TrackItem item) {
        super(context);
        this.item = item;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        Context ctx = getContext();
        float density = ctx.getResources().getDisplayMetrics().density;
        int dp24 = (int) (24 * density);
        int dp16 = (int) (16 * density);

        LinearLayout root = new LinearLayout(ctx);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(TvPalette.BG_PANEL);
        root.setPadding(dp24, dp24, dp24, dp24);
        root.setLayoutParams(new ViewGroup.LayoutParams(
                (int) (400 * density), ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = new TextView(ctx);
        title.setText("Technical Details");
        title.setTextColor(TvPalette.TEXT_PRIMARY);
        title.setTextSize(20f);
        title.setTypeface(null, Typeface.BOLD);
        title.setPadding(0, 0, 0, dp16);
        root.addView(title);

        if (item.detailResolution != null) addRow(root, "Resolution", item.detailResolution);
        if (item.detailFps != null) addRow(root, "Frame Rate", item.detailFps);
        if (item.detailBitrate != null) addRow(root, "Bitrate", item.detailBitrate);
        if (item.detailCodec != null) addRow(root, "Codec", item.detailCodec);
        if (item.detailHdrType != null) addRow(root, "HDR Type", item.detailHdrType);
        if (item.detailChannels != null) addRow(root, "Channels", item.detailChannels);
        if (item.detailSampleRate != null) addRow(root, "Sample Rate", item.detailSampleRate);
        if (item.detailFormat != null) addRow(root, "Format", item.detailFormat);
        if (item.language != null) addRow(root, "Language", item.language);

        setContentView(root);

        if (getWindow() != null) {
            getWindow().setBackgroundDrawable(new GradientDrawable() {{
                setColor(TvPalette.BG_PANEL);
                setCornerRadius(12 * density);
            }});
        }
    }

    private void addRow(LinearLayout root, String label, String value) {
        LinearLayout row = new LinearLayout(getContext());
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(0, (int) (4 * getContext().getResources().getDisplayMetrics().density), 0, (int) (4 * getContext().getResources().getDisplayMetrics().density));

        TextView tvLabel = new TextView(getContext());
        tvLabel.setText(label);
        tvLabel.setTextColor(TvPalette.TEXT_SECONDARY);
        tvLabel.setTextSize(14f);
        tvLabel.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        row.addView(tvLabel);

        TextView tvValue = new TextView(getContext());
        tvValue.setText(value);
        tvValue.setTextColor(TvPalette.TEXT_PRIMARY);
        tvValue.setTextSize(14f);
        tvValue.setGravity(Gravity.END);
        row.addView(tvValue);

        root.addView(row);
    }
}
