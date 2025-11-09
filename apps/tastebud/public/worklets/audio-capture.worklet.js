// apps/tastebud/public/worklets/audio-capture.worklet.js
/* global AudioWorkletProcessor, registerProcessor */

// Safari may not expose `sampleRate` in worklet scope. Provide a sane fallback.
const WORKLET_INPUT_RATE = (typeof sampleRate !== 'undefined' ? sampleRate : 48000);

// Capture mono input, resample → PCM Int16 @16kHz, emit 20ms frames.
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.targetRate = 16000;        // server expects 16 kHz
    this.frameSamples = 320;        // 20ms @ 16k
    this.inRate = WORKLET_INPUT_RATE;

    // Float32 staging buffer @16k
    this.floatBuf = new Float32Array(this.frameSamples);
    this.floatIdx = 0;

    // Int16 frame to post
    this.i16Buf = new Int16Array(this.frameSamples);

    // For fractional resampling step
    this._frac = 0;
    this._ratio = this.inRate / this.targetRate;

    // Host can reconfigure frame duration
    this.port.onmessage = (e) => {
      const msg = e.data || {};
      if (msg && msg.type === 'configure' && typeof msg.frameMs === 'number') {
        const samples = Math.max(
          160,
          Math.min(
            Math.round(this.targetRate * (msg.frameMs / 1000)),
            16000
          )
        );
        this.frameSamples = samples;
        this.floatBuf = new Float32Array(this.frameSamples);
        this.i16Buf = new Int16Array(this.frameSamples);
        this.floatIdx = 0;
      }
    };
  }

  // Push a mono Float32 chunk through a linear resampler into floatBuf @16k
  _pushResampled(mono) {
    const n = mono.length;
    let pos = this._frac;

    while (pos < n) {
      const i0 = Math.floor(pos);
      const i1 = Math.min(i0 + 1, n - 1);
      const frac = pos - i0;
      const s = mono[i0] + (mono[i1] - mono[i0]) * frac;

      // Clamp to [-1, 1] then stage
      this.floatBuf[this.floatIdx++] = Math.max(-1, Math.min(1, s));

      // If buffer full → convert to Int16 frame and post to main thread
      if (this.floatIdx >= this.floatBuf.length) {
        for (let i = 0; i < this.floatBuf.length; i++) {
          this.i16Buf[i] = (this.floatBuf[i] * 0x7fff) | 0;
        }
        const payload = new Int16Array(this.i16Buf); // copy to detach
        this.port.postMessage(
          { type: 'chunk', samples: payload },
          [payload.buffer]
        );
        this.floatIdx = 0;
      }

      pos += this._ratio;
    }

    // Carry leftover fractional index forward
    this._frac = pos - n;
  }

  /**
   * @param {Float32Array[][]} inputs
   * @returns {boolean}
   */
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    // Mix to mono: average all channels if >1
    const channels = input.length;
    const ch0 = input[0];
    let mono;

    if (channels === 1) {
      mono = ch0;
    } else {
      const frames = ch0.length;
      mono = new Float32Array(frames);
      for (let c = 0; c < channels; c++) {
        const ch = input[c];
        for (let i = 0; i < frames; i++) {
          mono[i] += (ch[i] || 0);
        }
      }
      for (let i = 0; i < frames; i++) {
        mono[i] /= channels;
      }
    }

    if (this.inRate === this.targetRate) {
      // Fast path: already 16k → chunk directly
      for (let i = 0; i < mono.length; i++) {
        this.floatBuf[this.floatIdx++] = Math.max(-1, Math.min(1, mono[i]));
        if (this.floatIdx >= this.floatBuf.length) {
          for (let j = 0; j < this.floatBuf.length; j++) {
            this.i16Buf[j] = (this.floatBuf[j] * 0x7fff) | 0;
          }
          const payload = new Int16Array(this.i16Buf);
          this.port.postMessage(
            { type: 'chunk', samples: payload },
            [payload.buffer]
          );
          this.floatIdx = 0;
        }
      }
    } else {
      // Resample to 16k via linear interpolation
      this._pushResampled(mono);
    }

    return true; // keep processor alive
  }
}

registerProcessor('capture-processor', AudioCaptureProcessor);
