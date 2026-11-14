#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(IOSPlayerPlugin, "IOSPlayer",
    CAP_PLUGIN_METHOD(openPlayer, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(playNextEpisode, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(playPreviousEpisode, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(closePlayer, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getAudioTracks, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(setAudioTrack, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getSubtitleTracks, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(setSubtitleTrack, CAPPluginReturnPromise);
)
