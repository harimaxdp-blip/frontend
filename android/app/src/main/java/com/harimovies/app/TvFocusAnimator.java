package com.harimovies.app;

import android.view.View;
import android.view.animation.AccelerateDecelerateInterpolator;

/**
 * Helper to scale views on focus for TV navigation feedback.
 */
public final class TvFocusAnimator {

    private static final float SCALE_FACTOR = 1.15f;
    private static final int DURATION = 200;

    public static void animate(View v, boolean focused, float density) {
        float targetScale = focused ? SCALE_FACTOR : 1.0f;
        float targetZ = focused ? 8 * density : 0;

        v.animate()
                .scaleX(targetScale)
                .scaleY(targetScale)
                .translationZ(targetZ)
                .setDuration(DURATION)
                .setInterpolator(new AccelerateDecelerateInterpolator())
                .start();
                
        // Toggle elevation/translationZ for shadow effect on focused items if supported
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
            v.setZ(targetZ);
        }
    }

    private TvFocusAnimator() {}
}
