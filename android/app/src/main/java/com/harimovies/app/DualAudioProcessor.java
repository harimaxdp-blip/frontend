package com.harimovies.app;

import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.util.UnstableApi;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * DualAudioProcessor
 *
 * Handles streams where two languages are muxed into a single multi-channel
 * audio track (common on Indian streaming sources):
 *
 *   Channel layout examples:
 *     4-channel:  ch0+ch1 = Language A,  ch2+ch3 = Language B
 *     6-channel:  ch0+ch1 = Language A,  ch2+ch3 = Language B,  ch4+ch5 = LFE/surround (ignored)
 *
 * Mode 0 = Language A (left pair)   — default
 * Mode 1 = Language B (right pair)
 * Mode 2 = Pass-through (all channels → downmix to stereo, both languages)
 */
@UnstableApi
public class DualAudioProcessor implements AudioProcessor {

    public static final int MODE_LANG_A     = 0;  // ch0+ch1
    public static final int MODE_LANG_B     = 1;  // ch2+ch3
    public static final int MODE_PASSTHROUGH = 2; // original (no extraction)

    private int mode = MODE_LANG_A;

    private AudioFormat inputFormat  = AudioFormat.NOT_SET;
    private AudioFormat outputFormat = AudioFormat.NOT_SET;
    private boolean isActive = false;

    private ByteBuffer outputBuffer = EMPTY_BUFFER;
    private boolean inputEnded = false;

    public void setMode(int mode) {
        this.mode = mode;
    }

    public int getMode() {
        return mode;
    }

    /**
     * Returns true if the source has enough channels for dual-audio extraction.
     * Call this after configure() to decide whether to show the dual-audio UI.
     */
    public boolean isDualAudioStream() {
        return inputFormat != AudioFormat.NOT_SET && inputFormat.channelCount >= 4;
    }

    @Override
    public AudioFormat configure(AudioFormat inputAudioFormat) throws UnhandledAudioFormatException {
        this.inputFormat = inputAudioFormat;

        // Only activate for 4+ channel PCM streams
        if (inputAudioFormat.encoding != androidx.media3.common.C.ENCODING_PCM_16BIT) {
            isActive = false;
            outputFormat = inputAudioFormat;
            return inputAudioFormat;
        }

        if (inputAudioFormat.channelCount < 4 || mode == MODE_PASSTHROUGH) {
            isActive = false;
            outputFormat = inputAudioFormat;
            return inputAudioFormat;
        }

        // Output is always stereo (2 channels) — we extract one pair
        isActive = true;
        outputFormat = new AudioFormat(
                inputAudioFormat.sampleRate,
                2,  // stereo output
                androidx.media3.common.C.ENCODING_PCM_16BIT
        );
        return outputFormat;
    }

    @Override
    public boolean isActive() {
        return isActive;
    }

    @Override
    public void queueInput(ByteBuffer inputBuffer) {
        if (!isActive || !inputBuffer.hasRemaining()) return;

        int inputChannels = inputFormat.channelCount;
        int bytesPerSample = 2; // PCM_16BIT
        int inputFrameSize  = inputChannels * bytesPerSample;
        int outputFrameSize = 2 * bytesPerSample; // stereo

        int frameCount = inputBuffer.remaining() / inputFrameSize;
        if (frameCount == 0) return;

        // Determine which channel pair to extract
        int ch0, ch1;
        if (mode == MODE_LANG_B) {
            ch0 = 2; ch1 = 3;  // second pair
        } else {
            ch0 = 0; ch1 = 1;  // first pair (default)
        }

        ByteBuffer out = ByteBuffer.allocate(frameCount * outputFrameSize)
                .order(ByteOrder.nativeOrder());

        for (int frame = 0; frame < frameCount; frame++) {
            int base = inputBuffer.position() + frame * inputFrameSize;

            // Read desired channel pair as signed 16-bit samples
            short sampleL = inputBuffer.getShort(base + ch0 * bytesPerSample);
            short sampleR = inputBuffer.getShort(base + ch1 * bytesPerSample);

            out.putShort(sampleL);
            out.putShort(sampleR);
        }

        // Advance input buffer past all consumed frames
        inputBuffer.position(inputBuffer.position() + frameCount * inputFrameSize);

        out.flip();
        outputBuffer = out;
    }

    @Override
    public void queueEndOfStream() {
        inputEnded = true;
    }

    @Override
    public ByteBuffer getOutput() {
        ByteBuffer out = outputBuffer;
        outputBuffer = EMPTY_BUFFER;
        return out;
    }

    @Override
    public boolean isEnded() {
        return inputEnded && outputBuffer == EMPTY_BUFFER;
    }

    @Override
    public void flush() {
        outputBuffer = EMPTY_BUFFER;
        inputEnded   = false;
    }

    @Override
    public void reset() {
        flush();
        inputFormat  = AudioFormat.NOT_SET;
        outputFormat = AudioFormat.NOT_SET;
        isActive     = false;
        mode         = MODE_LANG_A;
    }
}