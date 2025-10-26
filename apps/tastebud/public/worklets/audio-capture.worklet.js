// apps/tastebud/public/worklets/audio-capture.worklet.js
/* global AudioWorkletProcessor, registerProcessor */

// Some browsers (like Safari) don't expose `sampleRate` globally in AudioWorklet scope.
// This ensures we have a fallback so TypeScript and runtime both stay happy.
// @ts-ignore
const globalSampleRate = typeof sampleRate !== 'undefined' ? sampleRate : 48000;

// Resample input (device rate) → PCM Int16 @16kHz, 20ms frames (320 samples)
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Target output sample rate / frame size
    this.targetRate = 16000;
    this.frameSamples = 320; // 20ms @ 16k

    // Ring buffer of float32 at target rate before packing into Int16
    this.floatBuf = new Float32Array(this.frameSamples);
    this.floatIdx = 0;

    // Int16 output buffer for a single frame
    this.i16Buf = new Int16Array(this.frameSamples);

    // Keep residual fractional position for resampling
    this._resampleFrac = 0;

    // Input device / context rate (available globally in worklet)
    this.inputRate = globalSampleRate || 48000; // Safari/iOS often 48000

    // Precompute ratio: input -> target
    this.ratio = this.inputRate / this.targetRate;
  }

  // Very small linear resampler from input chunk → push to floatBuf@16k
  _pushResampled(chunk) {
    // chunk: Float32Array of one channel
    const inLen = chunk.length;

    // Position in input space (fractional)
    let pos = this._resampleFrac;
    while (pos < inLen) {
      // Linear sample around pos
      const i0 = Math.floor(pos);
      const i1 = Math.min(i0 + 1, inLen - 1);
      const frac = pos - i0;
      const s = chunk[i0] + (chunk[i1] - chunk[i0]) * frac;

      // Clip to [-1,1] and push to float buffer
      const clamped = Math.max(-1, Math.min(1, s));
      this.floatBuf[this.floatIdx++] = clamped;

      // When full 20ms frame collected, pack and post
      if (this.floatIdx >= this.floatBuf.length) {
        for (let i = 0; i < this.floatBuf.length; i++) {
          this.i16Buf[i] = (this.floatBuf[i] * 0x7fff) | 0;
        }
        const ab = this.i16Buf.buffer.slice(0); // copy
        this.port.postMessage(ab, [ab]);
        this.floatIdx = 0;
      }

      pos += this.ratio;
    }

    // Save leftover fractional position
    this._resampleFrac = pos - inLen;
  }

  /**
   * @param {Float32Array[][]} inputs
   * @returns {boolean}
   */
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    // Mono only: use first channel
    const ch0 = input[0];

    // Fast path if inputRate already 16kHz
    if (this.inputRate === this.targetRate) {
      for (let n = 0; n < ch0.length; n++) {
        const s = Math.max(-1, Math.min(1, ch0[n]));
        this.floatBuf[this.floatIdx++] = s;
        if (this.floatIdx >= this.floatBuf.length) {
          for (let i = 0; i < this.floatBuf.length; i++) {
            this.i16Buf[i] = (this.floatBuf[i] * 0x7fff) | 0;
          }
          const ab = this.i16Buf.buffer.slice(0);
          this.port.postMessage(ab, [ab]);
          this.floatIdx = 0;
        }
      }
      return true;
    }

    // Otherwise resample → 16kHz
    this._pushResampled(ch0);
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
