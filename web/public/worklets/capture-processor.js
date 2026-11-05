// AudioWorklet: recibe el micrófono (entrada 0) y el audio del sistema (entrada 1), los remuestrea a
// 16 kHz mono por canal y envía bloques de ~100 ms al hilo principal junto con el nivel (RMS).
// El audio nunca sale de la página salvo hacia el puente local en 127.0.0.1.

const TARGET_RATE = 16000;
const BLOCK = 1600; // 100 ms a 16 kHz

class Resampler {
  constructor(inRate) {
    this.ratio = inRate / TARGET_RATE;
    this.pos = 0;
    this.prev = 0;
    this.out = new Float32Array(BLOCK);
    this.n = 0;
  }

  /** Interpolación lineal; devuelve bloques completos de BLOCK muestras. */
  push(input, emit) {
    let pos = this.pos;
    while (pos < input.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const a = i === 0 ? this.prev : input[i - 1];
      const b = input[i];
      this.out[this.n++] = a + (b - a) * frac;
      if (this.n === BLOCK) {
        emit(this.out);
        this.out = new Float32Array(BLOCK);
        this.n = 0;
      }
      pos += this.ratio;
    }
    this.pos = pos - input.length;
    this.prev = input[input.length - 1];
  }
}

function mono(channels) {
  if (!channels || channels.length === 0) return null;
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return out;
}

function rms(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.resamplers = [new Resampler(sampleRate), new Resampler(sampleRate)];
    this.running = true;
    this.port.onmessage = (e) => {
      if (e.data === "stop") this.running = false;
    };
  }

  process(inputs) {
    if (!this.running) return false;
    for (let ch = 0; ch < 2; ch++) {
      const data = mono(inputs[ch]);
      if (!data) continue;
      this.resamplers[ch].push(data, (block) => {
        this.port.postMessage({ channel: ch, pcm: block, level: rms(block) }, [block.buffer]);
      });
    }
    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
