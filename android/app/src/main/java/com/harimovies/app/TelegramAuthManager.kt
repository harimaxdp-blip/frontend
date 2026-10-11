package com.harimovies.app

import org.drinkless.tdlib.TdApi

/**
 * Manages the Telegram authentication state machine.
 */
class TelegramAuthManager(private val onStateChanged: (AuthState) -> Unit) {
    
    enum class AuthState { 
        WAIT_PARAMETERS, 
        WAIT_PHONE, 
        WAIT_CODE, 
        WAIT_PASSWORD, 
        READY, 
        LOGGING_OUT, 
        CLOSING, 
        CLOSED 
    }

    fun handleUpdate(state: TdApi.AuthorizationState) {
        when (state) {
            is TdApi.AuthorizationStateWaitTdlibParameters -> onStateChanged(AuthState.WAIT_PARAMETERS)
            is TdApi.AuthorizationStateWaitEncryptionKey -> {
                // For modern TDLib, we send an empty key if not using database encryption
                TelegramManager.send(TdApi.CheckDatabaseEncryptionKey())
            }
            is TdApi.AuthorizationStateWaitPhoneNumber -> onStateChanged(AuthState.WAIT_PHONE)
            is TdApi.AuthorizationStateWaitCode -> onStateChanged(AuthState.WAIT_CODE)
            is TdApi.AuthorizationStateWaitPassword -> onStateChanged(AuthState.WAIT_PASSWORD)
            is TdApi.AuthorizationStateReady -> onStateChanged(AuthState.READY)
            is TdApi.AuthorizationStateLoggingOut -> onStateChanged(AuthState.LOGGING_OUT)
            is TdApi.AuthorizationStateClosing -> onStateChanged(AuthState.CLOSING)
            is TdApi.AuthorizationStateClosed -> onStateChanged(AuthState.CLOSED)
        }
    }

    fun setPhoneNumber(phone: String) {
        TelegramManager.send(TdApi.SetAuthenticationPhoneNumber(phone, null))
    }

    fun checkCode(code: String) {
        TelegramManager.send(TdApi.CheckAuthenticationCode(code))
    }
}
