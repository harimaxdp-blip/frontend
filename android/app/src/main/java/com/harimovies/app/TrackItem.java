package com.harimovies.app;

import androidx.media3.common.TrackGroup;

import java.util.ArrayList;
import java.util.List;

/**
 * TrackItem — kept for backwards compatibility with any other code that
 * references it, but TrackSelectionDialog no longer uses it directly.
 * The dialog now uses its own internal TrackOption class.
 */
public class TrackItem {

    public static final int ROW_TYPE_HEADER  = 0;
    public static final int ROW_TYPE_DIVIDER = 1;
    public static final int ROW_TYPE_TRACK   = 2;

    public final int     rowType;
    public       boolean isSelected;
    public       boolean isDisabledOption;
    public final String  labelMain;
    public final String  labelSub;
    public final int     trackType;
    public final TrackGroup group;
    public final int     trackIndex;
    public final String  language;
    public final List<String> badges;

    public final String detailResolution;
    public final String detailFps;
    public final String detailBitrate;
    public final String detailCodec;
    public final String detailHdrType;
    public final String detailChannels;
    public final String detailSampleRate;
    public final String detailFormat;

    private TrackItem(Builder b) {
        this.rowType        = b.rowType;
        this.isSelected     = b.selected;
        this.isDisabledOption = b.disabledOption;
        this.labelMain      = b.labelMain;
        this.labelSub       = b.labelSub;
        this.trackType      = b.trackType;
        this.group          = b.group;
        this.trackIndex     = b.trackIndex;
        this.language       = b.language;
        this.badges         = new ArrayList<>(b.badges);
        this.detailResolution = b.detailResolution;
        this.detailFps      = b.detailFps;
        this.detailBitrate  = b.detailBitrate;
        this.detailCodec    = b.detailCodec;
        this.detailHdrType  = b.detailHdrType;
        this.detailChannels = b.detailChannels;
        this.detailSampleRate = b.detailSampleRate;
        this.detailFormat   = b.detailFormat;
    }

    public static TrackItem header(String text) {
        return new Builder(ROW_TYPE_HEADER, 0).labelMain(text).build();
    }

    public static TrackItem divider() {
        return new Builder(ROW_TYPE_DIVIDER, 0).build();
    }

    public static Builder track(int trackType) {
        return new Builder(ROW_TYPE_TRACK, trackType);
    }

    public String stableId() {
        if (group != null) return group.id + ":" + trackIndex;
        return labelMain != null ? labelMain : "";
    }

    public static class Builder {
        int rowType; int trackType;
        boolean selected; boolean disabledOption;
        String labelMain = ""; String labelSub = "";
        TrackGroup group; int trackIndex; String language;
        List<String> badges = new ArrayList<>();
        // detail fields (unused by dialog but kept for API compat)
        String detailResolution, detailFps, detailBitrate, detailCodec, detailHdrType, detailChannels, detailSampleRate, detailFormat;

        Builder(int rowType, int trackType) { this.rowType = rowType; this.trackType = trackType; }
        public Builder labelMain(String v)      { labelMain = v; return this; }
        public Builder labelSub(String v)       { labelSub  = v; return this; }
        public Builder selected(boolean v)      { selected  = v; return this; }
        public Builder disabledOption(boolean v){ disabledOption = v; return this; }
        public Builder group(TrackGroup v)      { group      = v; return this; }
        public Builder trackIndex(int v)        { trackIndex = v; return this; }
        public Builder language(String v)       { language   = v; return this; }
        public Builder badge(String v)          { if (v!=null) badges.add(v); return this; }
        public Builder detailResolution(String v){ detailResolution=v; return this; }
        public Builder detailFps(String v)       { detailFps=v; return this; }
        public Builder detailBitrate(String v)   { detailBitrate=v; return this; }
        public Builder detailCodec(String v)     { detailCodec=v; return this; }
        public Builder detailHdrType(String v)   { detailHdrType=v; return this; }
        public Builder detailChannels(String v)  { detailChannels=v; return this; }
        public Builder detailSampleRate(String v){ detailSampleRate=v; return this; }
        public Builder detailFormat(String v)    { detailFormat=v; return this; }
        public TrackItem build() { return new TrackItem(this); }
    }
}