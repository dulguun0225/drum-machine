// Synthesized drum voices. Each recipe is a set of oscillators and filtered noise bursts
// with linear-attack / exponential-decay envelopes, parameterised by velocity, tuning and decay.

import type { SoundKey } from "./kit";

export interface VoiceParams {
  velocity: number; // 0–1
  semitones: number; // transposition of every oscillator
  decay: number; // multiplier for envelope and stop times
}

export interface VoiceResult {
  end: number; // audio time after which the voice is silent
}

/**
 * Perceptual gain curve for velocity and volume controls: gain = x².
 * Amplitude follows a square law, so 0.5 sits about 12 dB below 1.0 and a ghost note
 * at 0.3 sits about 21 dB below an accent, while 0 is silent.
 */
export function perceptualGain(x: number): number {
  const v = Math.min(1, Math.max(0, x));
  return v * v;
}

const ATTACK = 0.002; // fixed 2 ms click-free attack; not scaled by the decay multiplier
const FLOOR = 0.001; // exponential decays end at this gain
const NOISE_SECONDS = 2;

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Looping white-noise buffer, one per audio context. */
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    const len = Math.floor(ctx.sampleRate * NOISE_SECONDS);
    buf = new AudioBuffer({ length: len, sampleRate: ctx.sampleRate });
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

interface FilterSpec {
  type: BiquadFilterType;
  frequency: number;
  Q?: number;
}

/** Builds one hit: applies velocity, tuning and decay to every node it creates. */
class Voice {
  end: number;
  readonly t: number;
  private readonly ctx: BaseAudioContext;
  private readonly out: AudioNode;
  private readonly level: number;
  private readonly pitch: number;
  private readonly filterPitch: number;
  private readonly decay: number;

  constructor(ctx: BaseAudioContext, out: AudioNode, t: number, p: VoiceParams) {
    this.ctx = ctx;
    this.out = out;
    this.t = t;
    this.end = t;
    this.level = perceptualGain(p.velocity);
    this.pitch = 2 ** (p.semitones / 12);
    // Noise filters follow the tuning at half the interval, so a retuned snare keeps its body.
    this.filterPitch = 2 ** (p.semitones / 24);
    this.decay = p.decay;
  }

  /** Filter feeding the voice output; shared by several tones (cowbell, hats). */
  filter(spec: FilterSpec): BiquadFilterNode {
    const f = new BiquadFilterNode(this.ctx, {
      type: spec.type,
      frequency: spec.frequency * this.filterPitch,
      Q: spec.Q ?? 1,
    });
    f.connect(this.out);
    return f;
  }

  /** Oscillator with a 2 ms linear attack to `level` and an exponential decay over `decay` seconds. */
  tone(
    time: number,
    freq: number,
    level: number,
    decay: number,
    type: OscillatorType = "sine",
    dest: AudioNode = this.out,
  ): OscillatorNode {
    const stop = time + decay * this.decay;
    const osc = new OscillatorNode(this.ctx, { type, frequency: freq * this.pitch });
    const gain = new GainNode(this.ctx, { gain: 0 });
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(level * this.level, time + ATTACK);
    gain.gain.exponentialRampToValueAtTime(FLOOR, stop);
    osc.connect(gain).connect(dest);
    osc.start(time);
    osc.stop(stop);
    this.end = Math.max(this.end, stop);
    return osc;
  }

  /** Exponential pitch sweep from `from` to `to` Hz (both transposed) over `dur` seconds. */
  sweep(osc: OscillatorNode, time: number, from: number, to: number, dur: number): void {
    osc.frequency.setValueAtTime(from * this.pitch, time);
    osc.frequency.exponentialRampToValueAtTime(to * this.pitch, time + dur * this.decay);
  }

  /** Filtered white noise: optional linear attack, then exponential decay. */
  noise(time: number, spec: FilterSpec, level: number, decay: number, attack = 0): void {
    const peak = time + attack * this.decay;
    const stop = peak + decay * this.decay;
    const src = new AudioBufferSourceNode(this.ctx, { buffer: noiseBuffer(this.ctx), loop: true });
    const filter = new BiquadFilterNode(this.ctx, {
      type: spec.type,
      frequency: spec.frequency * this.filterPitch,
      Q: spec.Q ?? 1,
    });
    const gain = new GainNode(this.ctx, { gain: 0 });
    if (attack > 0) {
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(level * this.level, peak);
    } else {
      gain.gain.setValueAtTime(level * this.level, time);
    }
    gain.gain.exponentialRampToValueAtTime(FLOOR, stop);
    src.connect(filter).connect(gain).connect(this.out);
    src.start(time, Math.random() * (NOISE_SECONDS - 0.1));
    src.stop(stop);
    this.end = Math.max(this.end, stop);
  }
}

/** Inharmonic square-wave partials of the starter hi-hat (ratios of a 40 Hz base). */
const METAL_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];

function hat(v: Voice, decay: number) {
  const hp = v.filter({ type: "highpass", frequency: 7000 });
  for (const ratio of METAL_RATIOS) v.tone(v.t, 40 * ratio, 0.4, decay, "square", hp);
}

function tom(v: Voice, f: number, decay: number) {
  const t = v.t;
  v.sweep(v.tone(t, f * 1.5, 0.75, decay), t, f * 1.5, f, 0.08);
  v.noise(t, { type: "bandpass", frequency: f * 6, Q: 1 }, 0.15, 0.02);
}

const RECIPES: Record<SoundKey, (v: Voice) => void> = {
  // Starter bank (non-accent pitch as the base; kick and snare use the accent level).
  marimba(v) {
    const f = 400;
    v.tone(v.t, f, 0.5, 0.3);
    v.tone(v.t, f * 4, 0.12, 0.06);
    v.tone(v.t, f * 9.9, 0.04, 0.02);
  },
  woodblock(v) {
    const f = 400;
    v.sweep(v.tone(v.t, f * 1.5, 0.6, 0.08), v.t, f * 1.5, f, 0.01);
    v.noise(v.t, { type: "bandpass", frequency: f * 2, Q: 1 }, 0.4, 0.015);
  },
  claves(v) {
    v.tone(v.t, 2500, 0.5, 0.06);
  },
  rim(v) {
    v.tone(v.t, 1700, 0.4, 0.025, "triangle");
    v.noise(v.t, { type: "highpass", frequency: 3000 }, 0.3, 0.02);
  },
  cowbell(v) {
    const bp = v.filter({ type: "bandpass", frequency: 800, Q: 2 });
    v.tone(v.t, 540, 0.3, 0.35, "square", bp);
    v.tone(v.t, 800, 0.3, 0.35, "square", bp);
  },
  closedHat(v) {
    hat(v, 0.05);
  },
  glockenspiel(v) {
    const f = 880;
    v.tone(v.t, f, 0.4, 0.8);
    v.tone(v.t, f * 2.76, 0.15, 0.4);
    v.tone(v.t, f * 5.4, 0.06, 0.15);
  },
  conga(v) {
    const f = 220;
    v.sweep(v.tone(v.t, f * 1.2, 0.7, 0.25), v.t, f * 1.2, f, 0.02);
  },
  kick(v) {
    v.sweep(v.tone(v.t, 150, 0.8, 0.4), v.t, 150, 45, 0.12);
  },
  snare(v) {
    v.tone(v.t, 185, 0.5, 0.1, "triangle");
    v.noise(v.t, { type: "highpass", frequency: 1000 }, 0.5, 0.18);
  },

  // Added kit pieces, same technique. Levels are set so RMS over the first 100 ms sits near the
  // starter sound of the same role: clap near snare, toms near kick/conga, cymbals near the hats.
  openHat(v) {
    hat(v, 0.45);
  },
  clap(v) {
    // Three short band-passed bursts 10 ms apart, then a decaying tail.
    const band = { type: "bandpass" as const, frequency: 1200, Q: 1.5 };
    for (let i = 0; i < 3; i++) v.noise(v.t + i * 0.01, band, 2.4, 0.012);
    v.noise(v.t + 0.03, { ...band, Q: 0.9 }, 1.8, 0.2);
  },
  lowTom(v) {
    tom(v, 90, 0.5);
  },
  midTom(v) {
    tom(v, 135, 0.42);
  },
  highTom(v) {
    tom(v, 190, 0.35);
  },
  crash(v) {
    const hp = v.filter({ type: "highpass", frequency: 5000 });
    for (const ratio of METAL_RATIOS) v.tone(v.t, 60 * ratio, 0.11, 1.3, "square", hp);
    v.noise(v.t, { type: "highpass", frequency: 6000 }, 0.18, 1.6);
  },
  ride(v) {
    const hp = v.filter({ type: "highpass", frequency: 6000 });
    for (const ratio of METAL_RATIOS) v.tone(v.t, 52 * ratio, 0.16, 0.9, "square", hp);
    // Bell partial.
    v.tone(v.t, 2350, 0.07, 0.6, "triangle");
    v.noise(v.t, { type: "highpass", frequency: 8000 }, 0.08, 0.5);
  },
  shaker(v) {
    // High-passed noise with a soft attack.
    v.noise(v.t, { type: "highpass", frequency: 5000 }, 0.22, 0.06, 0.025);
  },
};

/** Play one hit of `sound` into `dest` at audio time `time`. */
export function playSound(
  sound: SoundKey,
  ctx: BaseAudioContext,
  dest: AudioNode,
  time: number,
  params: VoiceParams,
): VoiceResult {
  if (params.velocity <= 0) return { end: time };
  const voice = new Voice(ctx, dest, time, params);
  RECIPES[sound](voice);
  return { end: voice.end };
}
