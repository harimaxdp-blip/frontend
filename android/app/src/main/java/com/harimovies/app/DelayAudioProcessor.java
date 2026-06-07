package com.harimovies.app;

import androidx.annotation.NonNull;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.C;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayDeque;

/**
 * An AudioProcessor that delays audio output by a configurable number of microseconds.
 *
 * Positive delayUs  → audio plays later   (audio was arriving early / ahead of video)
 * Negative delayUs  → audio plays earlier  (audio was arriving late / behind video)
 *
 * Negative delay is implemented by silently DROPPING the first |delayUs| worth of audio,
 * which advances audio relative to video. Positive delay pads silence at the start.
 *
 * Usage: pass an instance to ExoPlayer.Builder via DefaultRenderersFactory, then call
 * setDelayUs() to update at runtime — the change takes effect on the next audio flush.
 */
public final class DelayAudioProcessor implements AudioProcessor {

    private static final int SILENCE_CHUNK_US = 10_000; // 10 ms chunks of silence

    private AudioFormat inputFormat  = AudioFormat.NOT_SET;
    private AudioFormat outputFormat = AudioFormat.NOT_SET;

    private volatile long pendingDelayUs = 0L;
    private long           activeDelayUs  = 0L;

    // Silence padding queue (positive delay)
    private final ArrayDeque<ByteBuffer> silenceQueue = new ArrayDeque<>();

    // How many bytes still to drop (negative delay)
    private long bytesToDrop = 0L;

    private ByteBuffer outputBuffer = EMPTY_BUFFER;
    private boolean inputEnded = false;

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Set a new delay. Takes effect after the next call to flush().
     * @param delayUs microseconds; positive = audio later, negative = audio earlier
     */
    public void setDelayUs(long delayUs) {
        pendingDelayUs = delayUs;
    }

    public long getDelayUs() {
        return activeDelayUs;
    }

    // ── AudioProcessor ────────────────────────────────────────────────────────

    @NonNull
    @Override
    public AudioFormat configure(@NonNull AudioFormat inputAudioFormat)
            throws UnhandledAudioFormatException {
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT &&
            inputAudioFormat.encoding != C.ENCODING_PCM_FLOAT) {
            throw new UnhandledAudioFormatException(inputAudioFormat);
        }
        this.inputFormat  = inputAudioFormat;
        this.outputFormat = inputAudioFormat; // pass-through format; we only delay
        return outputFormat;
    }

    @Override
    public boolean isActive() {
        return inputFormat != AudioFormat.NOT_SET;
    }

    @Override
    public void queueInput(@NonNull ByteBuffer inputBuffer) {
        if (!inputBuffer.hasRemaining()) return;

        // Drop bytes for negative delay
        if (bytesToDrop > 0) {
            long canDrop = Math.min(bytesToDrop, inputBuffer.remaining());
            inputBuffer.position(inputBuffer.position() + (int) canDrop);
            bytesToDrop -= canDrop;
            if (!inputBuffer.hasRemaining()) return;
        }

        // Drain any silence from the queue first (positive delay)
        if (!silenceQueue.isEmpty()) {
            outputBuffer = silenceQueue.poll();
            return;
        }

        // Normal passthrough
        outputBuffer = inputBuffer;
        inputBuffer.position(inputBuffer.limit());
    }

    @Override
    public void queueEndOfStream() {
        inputEnded = true;
    }

    @NonNull
    @Override
    public ByteBuffer getOutput() {
        ByteBuffer buf = outputBuffer;
        outputBuffer = EMPTY_BUFFER;
        return buf;
    }

    @Override
    public boolean isEnded() {
        return inputEnded && outputBuffer == EMPTY_BUFFER && silenceQueue.isEmpty();
    }

    @Override
    public void flush() {
        activeDelayUs = pendingDelayUs;
        silenceQueue.clear();
        bytesToDrop = 0;
        outputBuffer = EMPTY_BUFFER;
        inputEnded = false;

        if (activeDelayUs == 0 || inputFormat == AudioFormat.NOT_SET) return;

        if (activeDelayUs > 0) {
            // Positive delay → prepend silence
            long silenceBytes = usToPcmBytes(activeDelayUs);
            while (silenceBytes > 0) {
                int chunkBytes = (int) Math.min(silenceBytes,
                        usToPcmBytes(SILENCE_CHUNK_US));
                chunkBytes -= chunkBytes % frameSize(); // align to frame boundary
                ByteBuffer silence = ByteBuffer.allocateDirect(chunkBytes)
                        .order(ByteOrder.nativeOrder());
                silence.position(chunkBytes);
                silence.flip();
                silenceQueue.add(silence);
                silenceBytes -= chunkBytes;
            }
        } else {
            // Negative delay → drop leading bytes
            bytesToDrop = usToPcmBytes(-activeDelayUs);
        }
    }

    @Override
    public void reset() {
        inputFormat   = AudioFormat.NOT_SET;
        outputFormat  = AudioFormat.NOT_SET;
        activeDelayUs = 0L;
        pendingDelayUs = 0L;
        silenceQueue.clear();
        bytesToDrop = 0;
        outputBuffer = EMPTY_BUFFER;
        inputEnded = false;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private int frameSize() {
        if (inputFormat == AudioFormat.NOT_SET) return 4;
        int bytesPerSample = inputFormat.encoding == C.ENCODING_PCM_FLOAT ? 4 : 2;
        return bytesPerSample * inputFormat.channelCount;
    }

    private long usToPcmBytes(long us) {
        if (inputFormat == AudioFormat.NOT_SET || inputFormat.sampleRate <= 0) return 0;
        long frames = (us * inputFormat.sampleRate) / 1_000_000L;
        return frames * frameSize();
    }
}
