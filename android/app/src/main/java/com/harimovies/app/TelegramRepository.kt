package com.harimovies.app

import org.drinkless.tdlib.TdApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

/**
 * High-level repository for fetching Telegram data.
 */
class TelegramRepository {

    /**
     * Resolves a public t.me link to a video file ID.
     */
    suspend fun resolveLinkToFileId(url: String): Int? = suspendCoroutine { continuation ->
        // 1. Extract username and message ID from URL
        // Format: https://t.me/username/123
        val parts = url.split("/")
        if (parts.size < 4) {
            continuation.resume(null)
            return@suspendCoroutine
        }
        
        val username = parts[3]
        val messageId = parts.getOrNull(4)?.replace(Regex("[^0-9]"), "")?.toLongOrNull() ?: 0L

        // 2. Search for the public chat
        TelegramManager.send(TdApi.SearchPublicChat(username)) { chatObj ->
            if (chatObj is TdApi.Chat) {
                // 3. Get the specific message
                TelegramManager.send(TdApi.GetMessage(chatObj.id, messageId)) { msgObj ->
                    if (msgObj is TdApi.Message) {
                        // 4. Extract video from message content
                        val fileId = when (val content = msgObj.content) {
                            is TdApi.MessageVideo -> content.video.video.id
                            is TdApi.MessageDocument -> {
                                if (content.document.mimeType.startsWith("video/")) {
                                    content.document.document.id
                                } else null
                            }
                            else -> null
                        }
                        continuation.resume(fileId)
                    } else {
                        continuation.resume(null)
                    }
                }
            } else {
                continuation.resume(null)
            }
        }
    }

    /**
     * Java-friendly version of resolveLinkToFileId.
     */
    fun resolveLinkToFileIdAsync(url: String, callback: (Int?) -> Unit) {
        GlobalScope.launch(Dispatchers.Main) {
            val fileId = resolveLinkToFileId(url)
            callback(fileId)
        }
    }
}
