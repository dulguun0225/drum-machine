import "./style.css";

const ctx = new AudioContext();

const PARTIALS: [ratio: number, level: number, decay: number][] = [
  [1, 1, 0.3],
  [4, 0.25, 0.06],
  [9.9, 0.08, 0.02],
];

function playMarimba(time: number, freq = 200) {
  for (const [ratio, level, decay] of PARTIALS) {
    const osc = new OscillatorNode(ctx, { type: "sine", frequency: freq * ratio });
    const gain = new GainNode(ctx, { gain: 0 });
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.5 * level, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + decay);
  }
}

const noiseBuffer = (() => {
  const len = Math.floor(ctx.sampleRate * 0.02);
  const buf = new AudioBuffer({ length: len, sampleRate: ctx.sampleRate });
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
})();

function playWoodblock(time: number, freq = 400) {
  const dur = 0.08;
  const osc = new OscillatorNode(ctx, { type: "sine" });
  osc.frequency.setValueAtTime(freq * 1.5, time);
  osc.frequency.exponentialRampToValueAtTime(freq, time + 0.01);
  const body = new GainNode(ctx, { gain: 0 });
  body.gain.setValueAtTime(0, time);
  body.gain.linearRampToValueAtTime(0.6, time + 0.001);
  body.gain.exponentialRampToValueAtTime(0.001, time + dur);
  osc.connect(body).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + dur);

  const noise = new AudioBufferSourceNode(ctx, { buffer: noiseBuffer });
  const filter = new BiquadFilterNode(ctx, { type: "bandpass", frequency: freq * 2, Q: 1 });
  const click = new GainNode(ctx, { gain: 0 });
  click.gain.setValueAtTime(0.4, time);
  click.gain.exponentialRampToValueAtTime(0.001, time + 0.015);
  noise.connect(filter).connect(click).connect(ctx.destination);
  noise.start(time);
  noise.stop(time + 0.015);
}

const LOOKAHEAD_MS = 25;     // how often the scheduler runs
const SCHEDULE_AHEAD = 0.1;  // seconds of audio scheduled in advance
let bpm = 120;
let nextNoteTime = 0;
let timerId: number | undefined;

function playSine(time: number, freq = 880, dur = 0.05) {
  const osc = new OscillatorNode(ctx, { type: "sine", frequency: freq });
  const gain = new GainNode(ctx, { gain: 0 });
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(0.8, time + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + dur);
}

function scheduler() {
  while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD) {
    playWoodblock(nextNoteTime);
    nextNoteTime += 60 / bpm;
  }
  timerId = window.setTimeout(scheduler, LOOKAHEAD_MS);
}

async function start() {
  await ctx.resume(); // must be called from a user gesture (click/keydown)
  nextNoteTime = ctx.currentTime + 0.05;
  scheduler();
}

function stop() {
  clearTimeout(timerId);
}

start();

setTimeout(stop, 60_000);

// setInterval(() => {

// console.log(ctx.currentTime);
// }, 1000);