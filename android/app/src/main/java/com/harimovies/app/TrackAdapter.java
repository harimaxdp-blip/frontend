package com.harimovies.app;

import android.content.Context;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;

/**
 * TV-optimized adapter for track items.
 */
public class TrackAdapter extends RecyclerView.Adapter<RecyclerView.ViewHolder> {

    public interface Listener {
        void onTrackChosen(TrackItem item);
        void onTrackLongPressed(TrackItem item);
        void onRowFocused(int position, TrackItem item);
        boolean onRowLeftPressed();
    }

    private final Listener listener;
    private final float density;
    private final List<TrackItem> items = new ArrayList<>();

    public TrackAdapter(Listener listener, float density) {
        this.listener = listener;
        this.density = density;
    }

    public void submitList(List<TrackItem> newList) {
        this.items.clear();
        this.items.addAll(newList);
        notifyDataSetChanged();
    }

    public int indexOfSelected() {
        for (int i = 0; i < items.size(); i++) {
            if (items.get(i).rowType == TrackItem.ROW_TYPE_TRACK && items.get(i).isSelected) {
                return i;
            }
        }
        return -1;
    }

    public int firstSelectableIndex() {
        for (int i = 0; i < items.size(); i++) {
            if (items.get(i).rowType == TrackItem.ROW_TYPE_TRACK) {
                return i;
            }
        }
        return -1;
    }

    private static final class P {
        static final int ROW_IDLE       = 0x00000000;
        static final int ROW_SELECTED   = 0x1AFFFFFF;
        static final int ROW_FOCUSED    = 0x33FFFFFF;
        static final int INK_PRIMARY    = 0xFFFFFFFF;
        static final int INK_SECONDARY  = 0xFF8A8A8E;
        static final int INK_ACCENT     = 0xFFE5141F;
        static final int STROKE_DIVIDER = 0xFF1C1C1F;
    }

    @Override
    public int getItemViewType(int position) {
        return items.get(position).rowType;
    }

    @NonNull
    @Override
    public RecyclerView.ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        Context ctx = parent.getContext();
        if (viewType == TrackItem.ROW_TYPE_HEADER) {
            return new HeaderViewHolder(buildHeaderView(ctx));
        } else if (viewType == TrackItem.ROW_TYPE_DIVIDER) {
            return new DividerViewHolder(buildDividerView(ctx));
        } else {
            return new TrackViewHolder(buildTrackView(ctx));
        }
    }

    @Override
    public void onBindViewHolder(@NonNull RecyclerView.ViewHolder holder, int position) {
        TrackItem item = items.get(position);
        if (holder instanceof TrackViewHolder) {
            ((TrackViewHolder) holder).bind(item);
        } else if (holder instanceof HeaderViewHolder) {
            ((HeaderViewHolder) holder).tv.setText(item.labelMain);
        }
    }

    @Override
    public int getItemCount() {
        return items.size();
    }

    private int dp(float val) {
        return Math.round(val * density);
    }

    // ── View Builders ────────────────────────────────────────────────────────

    private View buildHeaderView(Context ctx) {
        TextView tv = new TextView(ctx);
        tv.setTextColor(P.INK_SECONDARY);
        tv.setTextSize(11f);
        tv.setLetterSpacing(0.08f);
        tv.setAllCaps(true);
        tv.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        tv.setPadding(dp(24), dp(16), dp(24), dp(4));
        tv.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return tv;
    }

    private View buildDividerView(Context ctx) {
        View v = new View(ctx);
        v.setBackgroundColor(P.STROKE_DIVIDER);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(1));
        lp.setMargins(dp(24), dp(6), dp(24), dp(6));
        v.setLayoutParams(lp);
        return v;
    }

    private View buildTrackView(Context ctx) {
        LinearLayout root = new LinearLayout(ctx);
        root.setOrientation(LinearLayout.HORIZONTAL);
        root.setGravity(Gravity.CENTER_VERTICAL);
        root.setPadding(dp(24), dp(12), dp(24), dp(12));
        root.setFocusable(true);
        root.setClickable(true);
        root.setLayoutParams(new RecyclerView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // Selection dot / icon
        FrameLayout iconWrap = new FrameLayout(ctx);
        iconWrap.setLayoutParams(new LinearLayout.LayoutParams(dp(24), dp(24)));
        root.addView(iconWrap);

        // Text content
        LinearLayout textWrap = new LinearLayout(ctx);
        textWrap.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams textLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        textLp.leftMargin = dp(16);
        textWrap.setLayoutParams(textLp);

        TextView tvMain = new TextView(ctx);
        tvMain.setTextColor(P.INK_PRIMARY);
        tvMain.setTextSize(16f);
        tvMain.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        textWrap.addView(tvMain);

        TextView tvSub = new TextView(ctx);
        tvSub.setTextColor(P.INK_SECONDARY);
        tvSub.setTextSize(12f);
        textWrap.addView(tvSub);

        root.addView(textWrap);

        // Badges
        LinearLayout badgeWrap = new LinearLayout(ctx);
        badgeWrap.setOrientation(LinearLayout.HORIZONTAL);
        badgeWrap.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        root.addView(badgeWrap);

        return root;
    }

    // ── ViewHolders ─────────────────────────────────────────────────────────

    static class HeaderViewHolder extends RecyclerView.ViewHolder {
        final TextView tv;
        HeaderViewHolder(View v) { super(v); tv = (TextView) v; }
    }

    static class DividerViewHolder extends RecyclerView.ViewHolder {
        DividerViewHolder(View v) { super(v); }
    }

    class TrackViewHolder extends RecyclerView.ViewHolder {
        final FrameLayout iconWrap;
        final TextView tvMain;
        final TextView tvSub;
        final LinearLayout badgeWrap;

        TrackViewHolder(View v) {
            super(v);
            iconWrap = (FrameLayout) ((ViewGroup) v).getChildAt(0);
            LinearLayout textWrap = (LinearLayout) ((ViewGroup) v).getChildAt(1);
            tvMain = (TextView) textWrap.getChildAt(0);
            tvSub = (TextView) textWrap.getChildAt(1);
            badgeWrap = (LinearLayout) ((ViewGroup) v).getChildAt(2);

            v.setOnFocusChangeListener((view, focused) -> {
                TvFocusAnimator.animate(view, focused, density);
                if (focused) {
                    v.setBackgroundColor(P.ROW_FOCUSED);
                    listener.onRowFocused(getAdapterPosition(), items.get(getAdapterPosition()));
                } else {
                    TrackItem item = items.get(getAdapterPosition());
                    v.setBackgroundColor(item.isSelected ? P.ROW_SELECTED : P.ROW_IDLE);
                }
            });

            v.setOnClickListener(view -> listener.onTrackChosen(items.get(getAdapterPosition())));
            v.setOnLongClickListener(view -> {
                listener.onTrackLongPressed(items.get(getAdapterPosition()));
                return true;
            });

            v.setOnKeyListener((view, keyCode, event) -> {
                if (event.getAction() == KeyEvent.ACTION_DOWN && keyCode == KeyEvent.KEYCODE_DPAD_LEFT) {
                    return listener.onRowLeftPressed();
                }
                return false;
            });
        }

        void bind(TrackItem item) {
            tvMain.setText(item.labelMain);
            tvSub.setText(item.labelSub);
            tvSub.setVisibility(item.labelSub != null && !item.labelSub.isEmpty() ? View.VISIBLE : View.GONE);

            // Style highlight
            if (item.isSelected) {
                tvMain.setTextColor(P.INK_ACCENT);
                tvMain.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
                tvSub.setTextColor(P.INK_ACCENT);
                if (!itemView.isFocused()) {
                    itemView.setBackgroundColor(P.ROW_SELECTED);
                }
            } else {
                tvMain.setTextColor(P.INK_PRIMARY);
                tvMain.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
                tvSub.setTextColor(P.INK_SECONDARY);
                if (!itemView.isFocused()) {
                    itemView.setBackgroundColor(P.ROW_IDLE);
                }
            }

            iconWrap.removeAllViews();
            if (item.isSelected) {
                ImageView check = new ImageView(itemView.getContext());
                check.setImageResource(R.drawable.ic_check);
                check.setColorFilter(P.INK_ACCENT);
                FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(dp(18), dp(18));
                lp.gravity = Gravity.CENTER;
                check.setLayoutParams(lp);
                iconWrap.addView(check);
            }

            badgeWrap.removeAllViews();
            for (String b : item.badges) {
                badgeWrap.addView(buildBadge(itemView.getContext(), b));
            }
        }

        private View buildBadge(Context ctx, String text) {
            TextView tv = new TextView(ctx);
            tv.setText(text);
            tv.setTextColor(P.INK_SECONDARY);
            tv.setTextSize(10f);
            tv.setPadding(dp(6), dp(2), dp(6), dp(2));
            GradientDrawable gd = new GradientDrawable();
            gd.setCornerRadius(dp(4));
            gd.setStroke(dp(1), P.STROKE_DIVIDER);
            tv.setBackground(gd);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.leftMargin = dp(8);
            tv.setLayoutParams(lp);
            return tv;
        }
    }
}
