package com.harimovies.app

import android.net.Uri
import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import org.drinkless.tdlib.TdApi
import java.io.RandomAccessFile
import java.io.IOException

/**
 * Custom Media3 DataSource that bridges ExoPlayer requests to TDLib file downloads.
 * This allows streaming Telegram videos directly into the player buffer.
 */
@UnstableApi
class TdLibDataSource(private val fileId: Int) : BaseDataSource(true) {

    private var file: RandomAccessFile? = null
    private var uri: Uri? = null
    private var bytesRemaining: Long = 0
    private var readPosition: Long = 0
    private var opened = false

    override fun open(dataSpec: DataSpec): Long {
        uri = dataSpec.uri
        readPosition = dataSpec.position
        transferInitializing(dataSpec)

        // Request TDLib to prioritize downloading this file segment
        TelegramManager.send(TdApi.DownloadFile(fileId, 32, dataSpec.position.toInt(), 0, true))

        val tdFile = TelegramManager.getFile(fileId)
        val path = tdFile?.local?.path

        if (!path.isNullOrEmpty()) {
            val f = RandomAccessFile(path, "r")
            f.seek(dataSpec.position)
            this.file = f
        }

        opened = true
        transferStarted(dataSpec)
        
        bytesRemaining = if (dataSpec.length != C.LENGTH_UNSET.toLong()) {
            dataSpec.length
        } else {
            if (tdFile != null && tdFile.size > 0) {
                tdFile.size.toLong() - dataSpec.position
            } else {
                C.LENGTH_UNSET.toLong()
            }
        }

        return bytesRemaining
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (bytesRemaining == 0L) return C.RESULT_END_OF_INPUT

        val readLength = if (bytesRemaining == C.LENGTH_UNSET.toLong()) length 
                         else minOf(length.toLong(), bytesRemaining).toInt()

        try {
            // Read from the physical file on disk that TDLib is populating
            var bytesRead = -1
            
            // Try reading. If file isn't open yet, try opening it.
            if (file == null) {
                val tdFile = TelegramManager.getFile(fileId)
                val path = tdFile?.local?.path
                if (!path.isNullOrEmpty()) {
                    val f = RandomAccessFile(path, "r")
                    f.seek(readPosition)
                    this.file = f
                    Log.d("TdLibDataSource", "Opened file for reading at $readPosition: $path")
                }
            }

            bytesRead = file?.read(buffer, offset, readLength) ?: -1
            
            if (bytesRead == -1) {
                // If we reached the end of what's currently on disk, we wait a bit and return 0
                // to let ExoPlayer know we are still loading.
                Thread.sleep(100)
                return 0 
            }

            if (bytesRemaining != C.LENGTH_UNSET.toLong()) {
                bytesRemaining -= bytesRead
            }
            readPosition += bytesRead
            
            bytesTransferred(bytesRead)
            return bytesRead
        } catch (e: IOException) {
            throw DataSourceException(e, 2000)
        }
    }

    override fun getUri(): Uri? = uri

    override fun close() {
        uri = null
        try {
            file?.close()
        } finally {
            file = null
            if (opened) {
                opened = false
                transferEnded()
            }
        }
    }

    class Factory(private val fileId: Int) : DataSource.Factory {
        override fun createDataSource(): DataSource = TdLibDataSource(fileId)
    }

    private class DataSourceException(cause: IOException, val reason: Int) : IOException(cause)
}
