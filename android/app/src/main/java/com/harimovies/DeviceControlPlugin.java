package com.harimovies;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import androidx.browser.customtabs.CustomTabsIntent;
import com.harimovies.app.WebPlayerActivity;
import com.harimovies.app.TorrentPlayerActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import com.getcapacitor.PermissionState;
import com.harimovies.app.MainActivity;
import androidx.media3.common.util.UnstableApi;
import com.harimovies.app.PlayerActivity;
import com.harimovies.app.StreamResolver;

@UnstableApi
@CapacitorPlugin(name = "DeviceControl", permissions = {
    @Permission(strings = {Manifest.permission.RECORD_AUDIO}, alias = "microphone"),
    @Permission(strings = {Manifest.permission.MODIFY_AUDIO_SETTINGS}, alias = "audio")
})
public class DeviceControlPlugin extends Plugin {

    @PluginMethod
    public void setVolume(PluginCall call) {
        float volume = call.getFloat("volume", 1f);
        MainActivity activity = (MainActivity) getActivity();
        if (activity != null) {
            activity.setPlayerVolume(volume);
            call.resolve();
        } else {
            call.reject("Activity is null");
        }
    }

    @PluginMethod
    public void setBrightness(PluginCall call) {
        float brightness = call.getFloat("brightness", 1f);
        MainActivity activity = (MainActivity) getActivity();
        if (activity != null) {
            activity.setScreenBrightness(brightness);
            call.resolve();
        } else {
            call.reject("Activity is null");
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        MainActivity activity = (MainActivity) getActivity();
        if (activity != null) {
            JSObject ret = new JSObject();
            ret.put("volume", activity.getPlayerVolume());
            ret.put("brightness", activity.getScreenBrightness());
            call.resolve(ret);
        } else {
            call.reject("Activity is null");
        }
    }

    @PluginMethod
    public void requestMicrophonePermission(PluginCall call) {
        requestPermissionForAlias("microphone", call, "handleMicrophonePermissionResult");
    }

    @PermissionCallback
    private void handleMicrophonePermissionResult(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            call.resolve();
        } else {
            call.reject("Microphone permission denied");
        }
    }

    @PluginMethod
    public void openExoPlayer(PluginCall call) {
        JSObject data = call.getData();
        String url = data.optString("url");
        String title = data.optString("title");
        String playlist = data.optString("playlist", null);
        int index = data.optInt("index", 0);

        if (url == null || url.isEmpty()) {
            call.reject("URL is missing");
            return;
        }

        // --- SMART ROUTING ---
        // 1. Magnet links
        if (url.startsWith("magnet:") || url.contains(".torrent")) {
            Intent intent = new Intent(getActivity(), TorrentPlayerActivity.class);
            intent.putExtra(TorrentPlayerActivity.EXTRA_MAGNET, url);
            intent.putExtra(TorrentPlayerActivity.EXTRA_TITLE, title);
            getActivity().startActivity(intent);
            call.resolve();
            return;
        }

        // 2. Titles (Forum links) containing spaces or TamilMV keywords
        if (url.contains(" ") || url.toLowerCase().contains("tamilmv")) {
            String targetUrl = url;
            if (url.contains(" ")) {
                // Default to a mirror if it looks like a 1TamilMV title
                targetUrl = "https://www.1TamilMV.cards";
                String[] parts = url.split(" ", 2);
                if (parts.length > 0 && parts[0].contains(".")) targetUrl = "https://" + parts[0];
            }
            
            Intent intent = new Intent(getActivity(), WebPlayerActivity.class);
            intent.putExtra("url", targetUrl);
            intent.putExtra("title", title);
            if (playlist != null) {
                intent.putExtra("playlist", playlist);
                intent.putExtra("index", index);
            }
            getActivity().startActivity(intent);
            call.resolve();
            return;
        }

        // 3. Normal Video Files
        Intent intent = new Intent(getActivity(), PlayerActivity.class);
        intent.putExtra("url", url);
        intent.putExtra("title", title);
        if (playlist != null && !playlist.equals("null") && !playlist.isEmpty()) {
            intent.putExtra("playlist", playlist);
            intent.putExtra("index", index);
        }
        getActivity().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void openWebPlayer(PluginCall call) {
        String url   = call.getString("url", "");
        String title = call.getString("title", "");

        if (url == null || url.isEmpty()) {
            call.reject("URL is missing");
            return;
        }

        // Ensure protocol
        if (!url.startsWith("http") && !url.startsWith("magnet:")) {
            url = "https://" + url;
        }

        // --- SMART ROUTING FOR WEB PLAYER ---
        // If it's a Telegram link, route it to PlayerActivity instead of WebPlayer
        if (StreamResolver.isTelegram(url)) {
            Intent intent = new Intent(getActivity(), PlayerActivity.class);
            intent.putExtra("url", url);
            intent.putExtra("title", title);
            
            String playlistStr = call.getString("playlist");
            if (playlistStr == null) {
                com.getcapacitor.JSArray playlistArr = call.getArray("playlist");
                if (playlistArr != null) playlistStr = playlistArr.toString();
            }
            if (playlistStr != null) {
                intent.putExtra("playlist", playlistStr);
                intent.putExtra("index", call.getInt("index", 0));
            }
            
            getActivity().startActivity(intent);
            call.resolve();
            return;
        }

        Intent intent = new Intent(getActivity(), WebPlayerActivity.class);
        intent.putExtra("url",   url);
        intent.putExtra("title", title != null ? title : "");
        
        String playlistStr = call.getString("playlist");
        if (playlistStr == null) {
            com.getcapacitor.JSArray playlistArr = call.getArray("playlist");
            if (playlistArr != null) playlistStr = playlistArr.toString();
        }
        if (playlistStr != null) {
            intent.putExtra("playlist", playlistStr);
            intent.putExtra("index", call.getInt("index", 0));
        }

        getActivity().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void openTorrentPlayer(PluginCall call) {
        String magnet = call.getString("magnet");
        String title  = call.getString("title", "");
        if (magnet == null || magnet.isEmpty()) {
            call.reject("magnet link is required");
            return;
        }
        Intent intent = new Intent(getContext(), TorrentPlayerActivity.class);
        intent.putExtra(TorrentPlayerActivity.EXTRA_MAGNET, magnet);
        intent.putExtra(TorrentPlayerActivity.EXTRA_TITLE,  title);
        getActivity().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void openChromeTab(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("URL is missing");
            return;
        }
        CustomTabsIntent customTabsIntent = new CustomTabsIntent.Builder().build();
        customTabsIntent.launchUrl(getActivity(), Uri.parse(url));
        call.resolve();
    }
}
