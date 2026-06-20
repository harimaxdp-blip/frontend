package com.harimovies.app;

import android.util.Log;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class StreamResolver {
    private static final String TAG = "STREAM_RESOLVED";

    public static boolean isDirectStream(String url) {
        if (url == null) return false;
        String lower = url.toLowerCase();
        return lower.endsWith(".mp4") || lower.endsWith(".mkv") || lower.endsWith(".webm") 
                || lower.endsWith(".avi") || lower.endsWith(".mov") || lower.contains(".mp4?");
    }

    public static boolean isHls(String url) {
        return url != null && url.toLowerCase().contains(".m3u8");
    }

    public static boolean isDash(String url) {
        return url != null && url.toLowerCase().contains(".mpd");
    }

    public static boolean isTelegram(String url) {
        if (url == null) return false;
        return url.contains("telegram-cdn.org") || url.contains("t.me") || url.contains("telegram.me");
    }

    public static boolean isGoogleDrive(String url) {
        return url != null && (url.contains("drive.google.com") || url.contains("docs.google.com"));
    }

    public static boolean isDropbox(String url) {
        return url != null && url.contains("dropbox.com");
    }

    public static boolean isOneDrive(String url) {
        return url != null && url.contains("1drv.ms") || url.contains("onedrive.live.com");
    }

    public static boolean isYouTube(String url) {
        if (url == null) return false;
        return url.contains("youtube.com") || url.contains("youtu.be");
    }

    public static boolean isEmbedPage(String url) {
        if (url == null) return false;
        String lower = url.toLowerCase();
        return lower.contains("streamtape.com") || lower.contains("dood") || lower.contains("filemoon")
                || lower.contains("voe.sx") || lower.contains("vidhide") || lower.contains("streamwish")
                || lower.contains("mixdrop") || lower.contains("mp4upload") || lower.contains("sendvid")
                || lower.contains("jwplayer") || lower.contains("iframe");
    }

    public static String resolveStreamUrl(String url) {
        if (url == null) return null;

        String resolvedUrl = url;

        if (isGoogleDrive(url)) {
            resolvedUrl = resolveGoogleDrive(url);
            Log.d(TAG, "STREAM_TYPE: Google Drive -> " + resolvedUrl);
        } else if (isTelegram(url)) {
            resolvedUrl = resolveTelegram(url);
            Log.d(TAG, "STREAM_TYPE: Telegram -> " + resolvedUrl);
        } else if (isDropbox(url)) {
            resolvedUrl = resolveDropbox(url);
            Log.d(TAG, "STREAM_TYPE: Dropbox -> " + resolvedUrl);
        } else if (isOneDrive(url)) {
            resolvedUrl = resolveOneDrive(url);
            Log.d(TAG, "STREAM_TYPE: OneDrive -> " + resolvedUrl);
        }

        Log.d(TAG, "STREAM_RESOLVED: " + resolvedUrl);
        return resolvedUrl;
    }

    private static String resolveGoogleDrive(String url) {
        // Convert https://drive.google.com/file/d/FILE_ID/view to direct download link
        Pattern pattern = Pattern.compile("d/([^/]+)");
        Matcher matcher = pattern.matcher(url);
        if (matcher.find()) {
            String fileId = matcher.group(1);
            return "https://drive.google.com/uc?export=download&id=" + fileId;
        }
        return url;
    }

    private static String resolveTelegram(String url) {
        // If it's already a direct link or we can't scrape, return as is
        if (!url.contains("t.me/") && !url.contains("telegram.me/")) return url;
        
        // Try to convert t.me/chan/123 to t.me/chan/123?embed=1 for scraping
        String embedUrl = url;
        if (!url.contains("?embed=1")) {
            embedUrl = url + (url.contains("?") ? "&" : "?") + "embed=1";
        }
        return embedUrl;
    }

    private static String resolveDropbox(String url) {
        // Convert dropbox links to direct download by changing dl=0 to dl=1 or raw=1
        if (url.contains("dl=0")) return url.replace("dl=0", "dl=1");
        if (!url.contains("?")) return url + "?dl=1";
        return url;
    }

    private static String resolveOneDrive(String url) {
        // OneDrive direct links usually need specific handling, but for now we try to use them as provided
        return url;
    }
}
