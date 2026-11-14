import Foundation
import UIKit
import Capacitor
import AVFoundation
import AVKit

// ─────────────────────────────────────────────────────────
// Custom AVPlayerViewController subclass to intercept dismissal
// ─────────────────────────────────────────────────────────
class ControlledAVPlayerViewController: AVPlayerViewController {
    var onDismiss: (() -> Void)?

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed || (navigationController?.isBeingDismissed ?? false) {
            onDismiss?()
        }
    }
}

// ─────────────────────────────────────────────────────────
// IOSPlayerPlugin: Native AVPlayerViewController Capacitor Plugin
// Uses standard Capacitor CAPPlugin with Objective-C macro registration in IOSPlayerPlugin.m
// ─────────────────────────────────────────────────────────
@objc(IOSPlayerPlugin)
public class IOSPlayerPlugin: CAPPlugin {
    private var playerViewController: ControlledAVPlayerViewController?
    private var player: AVPlayer?
    private var playlist: [[String: Any]] = []
    private var currentIndex: Int = 0
    private var activeCall: CAPPluginCall?
    private var endObserver: NSObjectProtocol?

    // ─────────────────────────────────────────────────────────
    // 1. OPEN PLAYER
    // ─────────────────────────────────────────────────────────
    @objc func openPlayer(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url")?.trimmingCharacters(in: .whitespacesAndNewlines), !urlString.isEmpty else {
            call.reject("URL is missing", "INVALID_ARGUMENT")
            return
        }

        // Magnet links not supported natively
        if urlString.lowercased().hasPrefix("magnet:") {
            call.reject("Magnet links are not supported natively by AVPlayer", "UNSUPPORTED_FORMAT", nil, ["format": "magnet", "fallbackRequired": true])
            return
        }

        guard let mediaURL = URL(string: urlString) else {
            call.reject("Invalid media URL", "MALFORMED_URL")
            return
        }

        let ext = mediaURL.pathExtension.lowercased()
        let isHls = ext == "m3u8" || urlString.contains(".m3u8") || urlString.contains("/hls/")
        let isDirectSupported = ext == "mp4" || ext == "m4v" || ext == "mov"

        if !isHls && !isDirectSupported {
            call.reject("Format '.\(ext)' is not supported natively by iOS AVPlayer", "UNSUPPORTED_FORMAT", nil, ["format": ext, "fallbackRequired": true])
            return
        }

        // Parse and validate playlist
        if let playlistArray = call.getArray("playlist") as? [[String: Any]] {
            self.playlist = playlistArray
        } else {
            self.playlist = []
        }

        let requestedIndex = call.getInt("index") ?? 0
        if !self.playlist.isEmpty {
            self.currentIndex = max(0, min(requestedIndex, self.playlist.count - 1))
        } else {
            self.currentIndex = 0
        }

        self.activeCall = call

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.presentPlayer(with: mediaURL, title: call.getString("title") ?? "")
        }
    }

    // ─────────────────────────────────────────────────────────
    // 2. PRESENTATION & LIFECYCLE
    // ─────────────────────────────────────────────────────────
    private func presentPlayer(with url: URL, title: String) {
        cleanUpPlayer()

        let playerItem = AVPlayerItem(url: url)
        let avPlayer = AVPlayer(playerItem: playerItem)
        self.player = avPlayer

        let controller = ControlledAVPlayerViewController()
        controller.player = avPlayer
        controller.modalPresentationStyle = .fullScreen
        controller.showsPlaybackControls = true

        // Callback invoked when the user taps Done or swipes to dismiss
        controller.onDismiss = { [weak self] in
            guard let self = self else { return }
            self.cleanUpPlayer()
            self.activeCall?.resolve(["completed": true, "lastIndex": self.currentIndex])
            self.activeCall = nil
        }

        // Configure audio session for playback
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("[IOSPlayer] AVAudioSession configuration notice: \(error.localizedDescription)")
        }

        // Observe episode end to handle playlist auto-advance
        attachEndObserver(to: playerItem)

        self.playerViewController = controller

        guard let rootVC = self.bridge?.viewController else {
            activeCall?.reject("Unable to find root view controller", "NO_ROOT_VC")
            activeCall = nil
            return
        }

        rootVC.present(controller, animated: true) { [weak self] in
            self?.player?.play()
        }
    }

    private func attachEndObserver(to item: AVPlayerItem) {
        if let existing = endObserver {
            NotificationCenter.default.removeObserver(existing)
            endObserver = nil
        }
        self.endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            self?.handleEpisodeEnded()
        }
    }

    // ─────────────────────────────────────────────────────────
    // 3. PLAYLIST NAVIGATION (Next / Previous)
    // ─────────────────────────────────────────────────────────
    private func handleEpisodeEnded() {
        if currentIndex < playlist.count - 1 {
            playEpisode(at: currentIndex + 1)
        } else {
            closePlayerInternal()
        }
    }

    @objc func playNextEpisode(_ call: CAPPluginCall) {
        if currentIndex < playlist.count - 1 {
            playEpisode(at: currentIndex + 1)
            call.resolve(["success": true, "index": currentIndex])
        } else {
            call.reject("No next episode in playlist", "INDEX_OUT_OF_BOUNDS")
        }
    }

    @objc func playPreviousEpisode(_ call: CAPPluginCall) {
        if currentIndex > 0 {
            playEpisode(at: currentIndex - 1)
            call.resolve(["success": true, "index": currentIndex])
        } else {
            call.reject("No previous episode in playlist", "INDEX_OUT_OF_BOUNDS")
        }
    }

    private func playEpisode(at index: Int) {
        guard index >= 0 && index < playlist.count else { return }
        let episodeData = playlist[index]
        let link = (episodeData["link"] as? String ?? episodeData["url"] as? String ?? episodeData["episodeLink"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let title = episodeData["title"] as? String ?? episodeData["episodeTitle"] as? String ?? ""

        guard !link.isEmpty, let mediaURL = URL(string: link) else {
            print("[IOSPlayer] Invalid episode URL at index \(index)")
            return
        }

        let ext = mediaURL.pathExtension.lowercased()
        let isHls = ext == "m3u8" || link.contains(".m3u8") || link.contains("/hls/")
        let isDirect = ext == "mp4" || ext == "m4v" || ext == "mov"

        guard isHls || isDirect else {
            print("[IOSPlayer] Episode \(index) format not supported natively: \(ext)")
            closePlayerInternal()
            return
        }

        self.currentIndex = index
        let newItem = AVPlayerItem(url: mediaURL)
        attachEndObserver(to: newItem)

        self.player?.replaceCurrentItem(with: newItem)
        self.player?.play()

        notifyListeners("episodeChanged", data: [
            "index": index,
            "title": title
        ])
    }

    // ─────────────────────────────────────────────────────────
    // 4. ASYNCHRONOUS AUDIO TRACK SELECTION (AVMediaSelectionGroup)
    // ─────────────────────────────────────────────────────────
    @objc func getAudioTracks(_ call: CAPPluginCall) {
        guard let item = player?.currentItem else {
            call.resolve(["tracks": []])
            return
        }

        let asset = item.asset
        if #available(iOS 15.0, *) {
            asset.loadMediaSelectionGroup(for: .audible) { [weak item] group, _ in
                guard let group = group, let currentItem = item else {
                    call.resolve(["tracks": []])
                    return
                }
                var tracks: [[String: Any]] = []
                let selectedOption = currentItem.currentMediaSelection.selectedMediaOption(in: group)
                for (index, option) in group.options.enumerated() {
                    let isSelected = (selectedOption == option)
                    tracks.append([
                        "id": index,
                        "displayName": option.displayName,
                        "locale": option.locale?.identifier ?? "",
                        "isSelected": isSelected
                    ])
                }
                call.resolve(["tracks": tracks])
            }
        } else {
            guard let group = asset.mediaSelectionGroup(forMediaCharacteristic: .audible) else {
                call.resolve(["tracks": []])
                return
            }
            var tracks: [[String: Any]] = []
            let selectedOption = item.currentMediaSelection.selectedMediaOption(in: group)
            for (index, option) in group.options.enumerated() {
                let isSelected = (selectedOption == option)
                tracks.append([
                    "id": index,
                    "displayName": option.displayName,
                    "locale": option.locale?.identifier ?? "",
                    "isSelected": isSelected
                ])
            }
            call.resolve(["tracks": tracks])
        }
    }

    @objc func setAudioTrack(_ call: CAPPluginCall) {
        guard let index = call.getInt("id"),
              let item = player?.currentItem else {
            call.reject("Invalid request or no active media", "INVALID_REQUEST")
            return
        }

        let asset = item.asset
        if #available(iOS 15.0, *) {
            asset.loadMediaSelectionGroup(for: .audible) { [weak item] group, _ in
                guard let group = group, let currentItem = item, index >= 0 && index < group.options.count else {
                    call.reject("Audio track index out of range", "INVALID_INDEX")
                    return
                }
                let option = group.options[index]
                currentItem.select(option, in: group)
                call.resolve(["success": true, "selectedId": index])
            }
        } else {
            guard let group = asset.mediaSelectionGroup(forMediaCharacteristic: .audible),
                  index >= 0 && index < group.options.count else {
                call.reject("Audio track index out of range", "INVALID_INDEX")
                return
            }
            let option = group.options[index]
            item.select(option, in: group)
            call.resolve(["success": true, "selectedId": index])
        }
    }

    // ─────────────────────────────────────────────────────────
    // 5. ASYNCHRONOUS SUBTITLE SELECTION (AVMediaSelectionGroup)
    // ─────────────────────────────────────────────────────────
    @objc func getSubtitleTracks(_ call: CAPPluginCall) {
        guard let item = player?.currentItem else {
            call.resolve(["tracks": []])
            return
        }

        let asset = item.asset
        if #available(iOS 15.0, *) {
            asset.loadMediaSelectionGroup(for: .legible) { [weak item] group, _ in
                guard let group = group, let currentItem = item else {
                    call.resolve(["tracks": []])
                    return
                }
                var tracks: [[String: Any]] = []
                let selectedOption = currentItem.currentMediaSelection.selectedMediaOption(in: group)
                for (index, option) in group.options.enumerated() {
                    let isSelected = (selectedOption == option)
                    tracks.append([
                        "id": index,
                        "displayName": option.displayName,
                        "locale": option.locale?.identifier ?? "",
                        "isSelected": isSelected
                    ])
                }
                call.resolve(["tracks": tracks])
            }
        } else {
            guard let group = asset.mediaSelectionGroup(forMediaCharacteristic: .legible) else {
                call.resolve(["tracks": []])
                return
            }
            var tracks: [[String: Any]] = []
            let selectedOption = item.currentMediaSelection.selectedMediaOption(in: group)
            for (index, option) in group.options.enumerated() {
                let isSelected = (selectedOption == option)
                tracks.append([
                    "id": index,
                    "displayName": option.displayName,
                    "locale": option.locale?.identifier ?? "",
                    "isSelected": isSelected
                ])
            }
            call.resolve(["tracks": tracks])
        }
    }

    @objc func setSubtitleTrack(_ call: CAPPluginCall) {
        guard let item = player?.currentItem else {
            call.reject("No active media item", "NO_ACTIVE_ITEM")
            return
        }

        let index = call.getInt("id") ?? -1
        let asset = item.asset

        if #available(iOS 15.0, *) {
            asset.loadMediaSelectionGroup(for: .legible) { [weak item] group, _ in
                guard let group = group, let currentItem = item else {
                    call.reject("No legible subtitles found", "NO_SUBTITLES")
                    return
                }
                if index < 0 {
                    currentItem.select(nil, in: group)
                    call.resolve(["success": true, "disabled": true])
                } else if index < group.options.count {
                    let option = group.options[index]
                    currentItem.select(option, in: group)
                    call.resolve(["success": true, "selectedId": index])
                } else {
                    call.reject("Invalid subtitle track index", "INVALID_INDEX")
                }
            }
        } else {
            guard let group = asset.mediaSelectionGroup(forMediaCharacteristic: .legible) else {
                call.reject("No legible subtitles found", "NO_SUBTITLES")
                return
            }
            if index < 0 {
                item.select(nil, in: group)
                call.resolve(["success": true, "disabled": true])
            } else if index < group.options.count {
                let option = group.options[index]
                item.select(option, in: group)
                call.resolve(["success": true, "selectedId": index])
            } else {
                call.reject("Invalid subtitle track index", "INVALID_INDEX")
            }
        }
    }

    // ─────────────────────────────────────────────────────────
    // 6. DISMISSAL & TEARDOWN
    // ─────────────────────────────────────────────────────────
    @objc func closePlayer(_ call: CAPPluginCall) {
        closePlayerInternal()
        call.resolve(["closed": true])
    }

    private func closePlayerInternal() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.player?.pause()
            self.playerViewController?.dismiss(animated: true) { [weak self] in
                guard let self = self else { return }
                self.cleanUpPlayer()
                self.activeCall?.resolve(["completed": true, "lastIndex": self.currentIndex])
                self.activeCall = nil
            }
        }
    }

    private func cleanUpPlayer() {
        if let observer = endObserver {
            NotificationCenter.default.removeObserver(observer)
            endObserver = nil
        }
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        player = nil
        playerViewController = nil
    }

    deinit {
        cleanUpPlayer()
    }
}
