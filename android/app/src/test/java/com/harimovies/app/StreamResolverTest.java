package com.harimovies.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class StreamResolverTest {
    @Test
    public void recognizesDirectMediaWithSignedQueryStrings() {
        assertTrue(StreamResolver.isSupportedMediaUrl(
                "https://cdn.example/video.mp4?token=temporary"));
        assertTrue(StreamResolver.isHls(
                "https://cdn.example/master.m3u8?signature=temporary"));
        assertTrue(StreamResolver.isDash(
                "https://cdn.example/manifest.mpd?token=temporary"));
    }

    @Test
    public void rejectsPagesBlobsAndUnsupportedFormats() {
        assertFalse(StreamResolver.isSupportedMediaUrl(
                "https://dub.onestream.today/stream/video/101471"));
        assertFalse(StreamResolver.isSupportedMediaUrl(
                "https://provider.example/player.html"));
        assertFalse(StreamResolver.isSupportedMediaUrl(
                "https://provider.example/manifest.json"));
        assertFalse(StreamResolver.isSupportedMediaUrl(
                "blob:https://provider.example/video"));
    }

    @Test
    public void validatesHttpUrlsAndMediaTypeHints() {
        assertTrue(StreamResolver.isHttpUrl("https://provider.example/watch/101471"));
        assertFalse(StreamResolver.isHttpUrl("javascript:alert(1)"));
        assertFalse(StreamResolver.isHttpUrl("https://user:pass@provider.example/video.mp4"));
        assertTrue(StreamResolver.isSupportedMediaType("hls"));
        assertFalse(StreamResolver.isSupportedMediaType("text/html"));
        assertTrue(StreamResolver.isSupportedMediaTypeForUrl(
                "https://dub.uptodub.ch/download.php?signature=fixture", "mp4"));
        assertFalse(StreamResolver.isSupportedMediaTypeForUrl(
                "https://dub.uptodub.ch/player.html", "mp4"));
        assertFalse(StreamResolver.isSupportedMediaTypeForUrl(
                "https://dub.onestream.today/stream/video/101471", "mp4"));
    }
}
