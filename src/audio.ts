// Audio graph: per-track channel (gain → stereo panner) → master gain → limiter → output.
// Every hit gets its own voice gain so choke groups and stop can fade it independently.

import type { SoundKey } from "./kit";
import type { Project } from "./model";
import { perceptualGain, playSound } from "./sounds";

const CHOKE_FADE = 0.005;
const STOP_FADE = 0.01;

interface Channel {
  gain: GainNode;
  pan: StereoPannerNode;
}

interface ActiveVoice {
  start: number;
  end: number;
  gain: GainNode;
  choke: number;
  cut: number; // time the voice is faded out, Infinity if never
}

export interface HitParams {
  time: number;
  trackId: string;
  sound: SoundKey;
  velocity: number;
  semitones: number;
  decay: number;
  choke: number;
}

export class AudioOut {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private channels = new Map<string, Channel>();
  private voices: ActiveVoice[] = [];

  /** Create or resume the context; call from a user gesture. */
  ensure(): AudioContext {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: "interactive" });
      // Limiter: hard knee, high ratio, fast attack.
      const limiter = new DynamicsCompressorNode(ctx, {
        threshold: -3,
        knee: 0,
        ratio: 20,
        attack: 0.003,
        release: 0.1,
      });
      this.master = new GainNode(ctx, { gain: 0.64 });
      this.master.connect(limiter).connect(ctx.destination);
      this.ctx = ctx;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** Output delay between scheduling a time and hearing it. */
  get latency(): number {
    return (this.ctx?.outputLatency ?? 0) + (this.ctx?.baseLatency ?? 0);
  }

  private channel(trackId: string): Channel {
    let ch = this.channels.get(trackId);
    if (!ch) {
      const ctx = this.ensure();
      ch = { gain: new GainNode(ctx), pan: new StereoPannerNode(ctx) };
      ch.gain.connect(ch.pan).connect(this.master);
      this.channels.set(trackId, ch);
    }
    return ch;
  }

  /** Apply master and per-track volume and pan; drop channels of deleted tracks. */
  updateMix(project: Project): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(perceptualGain(project.masterVolume), t, 0.01);
    const live = new Set<string>();
    for (const p of project.patterns) {
      for (const track of p.tracks) {
        live.add(track.id);
        const ch = this.channel(track.id);
        ch.gain.gain.setTargetAtTime(perceptualGain(track.volume), t, 0.01);
        ch.pan.pan.setTargetAtTime(track.pan, t, 0.01);
      }
    }
    for (const [id, ch] of this.channels) {
      if (live.has(id)) continue;
      ch.pan.disconnect();
      this.channels.delete(id);
    }
  }

  private newVoice(start: number, end: number, gain: GainNode, choke: number) {
    const voice: ActiveVoice = { start, end, gain, choke, cut: Infinity };
    if (choke > 0) {
      for (const other of this.voices) {
        if (other.choke !== choke) continue;
        // An earlier voice still sounding is faded at this start; a later one (scheduled out
        // of order, e.g. by negative nudge) fades this voice at its own start.
        if (other.start < start && Math.min(other.end, other.cut) > start)
          this.cutVoice(other, start);
        else if (other.start > start && other.start < end) this.cutVoice(voice, other.start);
      }
    }
    this.voices.push(voice);
    const t = this.now;
    this.voices = this.voices.filter((v) => Math.min(v.end, v.cut + CHOKE_FADE) > t);
  }

  private cutVoice(voice: ActiveVoice, at: number) {
    if (at >= voice.cut) return;
    const g = voice.gain.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(1, at);
    g.linearRampToValueAtTime(0, at + CHOKE_FADE);
    voice.cut = at;
  }

  /** Schedule one drum hit on its track channel. */
  hit(h: HitParams): void {
    const ctx = this.ensure();
    const time = Math.max(h.time, ctx.currentTime);
    const ch = this.channel(h.trackId);
    const gain = new GainNode(ctx, { gain: 1 });
    gain.connect(ch.gain);
    const { end } = playSound(h.sound, ctx, gain, time, {
      velocity: h.velocity,
      semitones: h.semitones,
      decay: h.decay,
    });
    this.newVoice(time, end, gain, h.choke);
  }

  /** Metronome click straight to the master bus; higher and louder on the bar start. */
  click(time: number, accent: boolean): void {
    const ctx = this.ensure();
    time = Math.max(time, ctx.currentTime);
    const gain = new GainNode(ctx, { gain: 1 });
    gain.connect(this.master);
    const osc = new OscillatorNode(ctx, { frequency: accent ? 1600 : 1000 });
    const env = new GainNode(ctx, { gain: 0 });
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(accent ? 0.35 : 0.2, time + 0.002);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
    osc.connect(env).connect(gain);
    osc.start(time);
    osc.stop(time + 0.03);
    this.newVoice(time, time + 0.03, gain, 0);
  }

  /** Fade every sounding and already scheduled voice (transport stop). */
  silence(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const v of this.voices) {
      const g = v.gain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + STOP_FADE);
      v.cut = Math.min(v.cut, t);
    }
    this.voices = [];
  }
}
