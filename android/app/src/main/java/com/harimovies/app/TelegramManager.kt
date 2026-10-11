package com.harimovies.app

import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import org.drinkless.tdlib.Client
import org.drinkless.tdlib.TdApi

/**
 * Singleton manager for TDLib (Telegram Database Library) lifecycle and communication.
 * Handles the low-level JNI client, authorization states, and background message processing.
 */
object TelegramManager {
    private const val TAG = "TelegramManager"
    
    private var client: Client? = null
    
    // Observable flow for authorization changes (UI can react to this)
    val authState = MutableStateFlow<TdApi.AuthorizationState?>(null)

    // Track downloaded files: fileId -> TdApi.File
    private val files = mutableMapOf<Int, TdApi.File>()

    /**
     * Initialize the TDLib client.
     * @param dbPath The directory where Telegram will store its database and session.
     */
    fun init(dbPath: String) {
        if (client != null) return
        
        Log.d(TAG, "Initializing TDLib...")

        try {
            System.loadLibrary("tdjni")
        } catch (e: UnsatisfiedLinkError) {
            Log.e(TAG, "Failed to load tdjni library", e)
            return
        }
        
        client = Client.create({ update ->
            when (update) {
                is TdApi.UpdateAuthorizationState -> {
                    Log.d(TAG, "Auth State Update: ${update.authorizationState}")
                    authState.value = update.authorizationState
                }
                is TdApi.UpdateFile -> {
                    files[update.file.id] = update.file
                }
            }
        }, null, null)

        // Basic Parameters for TDLib
        send(TdApi.SetTdlibParameters(TdApi.TdlibParameters().apply {
            databaseDirectory = dbPath
            useMessageDatabase = true
            useSecretChats = false
            apiId = 1234567 // TODO: Replace with your actual API ID from my.telegram.org
            apiHash = "YOUR_API_HASH" // TODO: Replace with your actual API Hash
            systemLanguageCode = "en"
            deviceModel = "Android TV"
            systemVersion = "10"
            applicationVersion = "1.0"
        }))
    }

    /**
     * Send a query to TDLib.
     * @param query The TDLib function to execute.
     * @param callback Optional result callback.
     */
    fun send(query: TdApi.Function, callback: (TdApi.Object) -> Unit = {}) {
        Log.d(TAG, "Sending query: ${query::class.java.simpleName}")
        client?.send(query) { obj ->
            if (obj is TdApi.Error) {
                Log.e(TAG, "TDLib Error: ${obj.code} - ${obj.message} | Query: ${query::class.java.simpleName}")
            } else {
                Log.d(TAG, "Received response for ${query::class.java.simpleName}: ${obj::class.java.simpleName}")
            }
            callback(obj)
        }
    }

    /**
     * Gracefully shutdown the TDLib client.
     */
    fun close() {
        send(TdApi.Close())
        client = null
    }

    fun getFile(fileId: Int): TdApi.File? = files[fileId]

    fun isReady(): Boolean = authState.value is TdApi.AuthorizationStateReady
}
