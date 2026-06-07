package com.harimovies;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import androidx.browser.customtabs.CustomTabsIntent;
import com.harimovies.app.WebPlayerActivity;
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

@UnstableApi
@CapacitorPlugin(name = "DeviceControl", permissions = {
    @Permission(strings = {Manifest.permission.RECORD_AUDIO}, alias = "microphone"),
    @Permission(strings = {Manifest.permission.MODIFY_AUDIO_SETTINGS}, alias = "audio")
})
public class DeviceControlPlugin extends Plugin {

    @PluginMethod
    public void setVolume(PluginCall call) {

        Log.d("DeviceControl", "Plugin setVolume called");

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

        Log.d("DeviceControl", "Plugin setBrightness called");

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
        Log.d("DeviceControl", "requestMicrophonePermission called");
        requestPermissionForAlias("microphone", call, "handleMicrophonePermissionResult");
    }

    @PermissionCallback
    private void handleMicrophonePermissionResult(PluginCall call) {
        Log.d("DeviceControl", "handleMicrophonePermissionResult called");
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            call.resolve();
        } else {
            call.reject("Microphone permission denied");
        }
    }

    @PluginMethod
    public void openExoPlayer(PluginCall call) {

        String url   = call.getString("url");
        String title = call.getString("title");

        if (url == null || url.isEmpty()) {
            call.reject("URL is missing");
            return;
        }

        // Fallback to filename if title is missing to ensure "each card" has a unique key
        if (title == null || title.isEmpty()) {
            try {
                Uri uri = Uri.parse(url);
                title = uri.getLastPathSegment();
            } catch (Exception ignored) {}
        }
        if (title == null) title = "";

        Intent intent = new Intent(
                getActivity(),
                PlayerActivity.class
        );

        intent.putExtra("url",   url);
        intent.putExtra("title", title);

        // Handle playlist for series
        if (call.getData().has("playlist")) {
            intent.putExtra("playlist", call.getArray("playlist").toString());
            intent.putExtra("index", call.getInt("currentIndex", 0));
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

    Intent intent = new Intent(getActivity(), WebPlayerActivity.class);
    intent.putExtra("url",   url);
    intent.putExtra("title", title != null ? title : "");
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

        CustomTabsIntent customTabsIntent =
                new CustomTabsIntent.Builder().build();

        customTabsIntent.launchUrl(
                getActivity(),
                Uri.parse(url)
        );

        call.resolve();
    }
}