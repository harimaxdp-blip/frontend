package com.harimovies.app;

import android.graphics.Color;

/**
 * Shared color palette for TV-first UI components.
 */
public final class TvPalette {
    public static final int BG_OUTER      = 0xEE060606; // Match var(--bg-deep) with alpha
    public static final int BG_PANEL      = 0xFF0F0F0F; // Match var(--bg-surface)
    public static final int BG_SIDEBAR    = 0xFF141414; // Match var(--bg-card)
    public static final int BORDER        = 0x14FFFFFF; // 8% alpha white for glass-style borders
    public static final int BORDER_COLOR  = 0xFF222222; // Match var(--glass-border)
    public static final int TEXT_PRIMARY  = 0xFFF0f0f0; // Match var(--text-main)
    public static final int TEXT_SECONDARY = 0xFF999999; // Match var(--text-dim)
    public static final int TEXT_MUTED     = 0xFF444444; // Match var(--text-muted)
    public static final int ACCENT_RED    = 0x1AE50914; // Low opacity background highlight tint
    public static final int ACTIVE_RED    = 0xFFE50914; // Solid active monochrome brand tint
}
