// Project data model: types, factories, derived lengths and the tolerant JSON parser.
// Every value is JSON-serialisable; a saved project carries `version: 1`.

import { SOUNDS, isSoundKey, type SoundKey } from "./kit";
import { reduce, type Ratio } from "./ratio";

export const MAX_STEPS = 64;
export const MAX_BARS = 64;
export const MAX_RATCHET = 8;
export const MAX_TRACKS = 32;
export const MAX_CONDITION = 16;
export const DEFAULT_VELOCITY = 0.8;
export const SIG_DENOMINATORS = [2, 4, 8, 16] as const;

/** Play only on loop `a` of every `b` loops of the track (1-based). */
export interface Condition {
  a: number;
  b: number;
}

export interface Step {
  on: boolean;
  velocity: number; // 0–1
  probability: number; // 0–1
  ratchet: number; // 1–8 evenly spaced hits within the step
  nudge: number; // −0.5..+0.5 of the step duration
  flam: boolean; // grace hit before the main hit at half velocity
  pitch: number; // semitones, added to the track tune
  condition: Condition;
}

export interface Track {
  id: string;
  name: string;
  sound: SoundKey;
  steps: Step[];
  stepDur: Ratio; // quarter-note beats per step
  volume: number; // 0–1
  pan: number; // −1..+1
  tune: number; // semitones, −24..+24
  decay: number; // envelope time multiplier, 0.25–4
  mute: boolean;
  solo: boolean;
  swing: boolean;
  choke: number; // 0 = none, 1–4
}

export interface Pattern {
  id: string;
  name: string;
  sigNum: number; // 1–32
  sigDen: number; // 2, 4, 8 or 16
  bars: number; // 1–64
  swing: number; // 50–75 %
  tracks: Track[];
}

export type PlayMode = "pattern" | "song";

export interface SongEntry {
  id: string; // stable while entries are moved or deleted during playback
  patternId: string;
  repeats: number; // 1–64
}

export interface Project {
  version: 1;
  name: string;
  bpm: number; // 20–300, one decimal
  masterVolume: number; // 0–1
  metronome: boolean;
  playMode: PlayMode;
  patterns: Pattern[];
  song: SongEntry[];
  currentPatternId: string;
}

let idCounter = 0;

/** Short unique id; does not need a secure context (unlike crypto.randomUUID). */
export function newId(): string {
  idCounter = (idCounter + 1) % 1296;
  return Math.random().toString(36).slice(2, 9) + idCounter.toString(36);
}

export function makeStep(over: Partial<Step> = {}): Step {
  return {
    on: false,
    velocity: DEFAULT_VELOCITY,
    probability: 1,
    ratchet: 1,
    nudge: 0,
    flam: false,
    pitch: 0,
    condition: { a: 1, b: 1 },
    ...over,
  };
}

export function makeSteps(count: number): Step[] {
  return Array.from({ length: count }, () => makeStep());
}

export function makeTrack(sound: SoundKey, over: Partial<Track> = {}): Track {
  return {
    id: newId(),
    name: SOUNDS[sound].name,
    sound,
    steps: makeSteps(16),
    stepDur: { num: 1, den: 4 },
    volume: 0.8,
    pan: 0,
    tune: 0,
    decay: 1,
    mute: false,
    solo: false,
    swing: true,
    choke: 0,
    ...over,
  };
}

export function makePattern(name: string, tracks: Track[] = []): Pattern {
  return { id: newId(), name, sigNum: 4, sigDen: 4, bars: 1, swing: 50, tracks };
}

/** New pattern with the default kit: one empty 16-step track per core sound. */
export function defaultKitPattern(name: string): Pattern {
  const sounds: SoundKey[] = [
    "kick",
    "snare",
    "clap",
    "closedHat",
    "openHat",
    "midTom",
    "crash",
    "shaker",
  ];
  return makePattern(
    name,
    sounds.map((s) => makeTrack(s, { choke: s === "closedHat" || s === "openHat" ? 1 : 0 })),
  );
}

export function makeProject(): Project {
  const pattern = defaultKitPattern("Pattern 1");
  return {
    version: 1,
    name: "Untitled",
    bpm: 120,
    masterVolume: 0.8,
    metronome: false,
    playMode: "pattern",
    patterns: [pattern],
    song: [],
    currentPatternId: pattern.id,
  };
}

// ---- derived values ----

/** Bar length in quarter-note beats (7/8 → 3.5). */
export function barBeats(p: Pattern): number {
  return (p.sigNum * 4) / p.sigDen;
}

export function barRatio(p: Pattern): Ratio {
  return reduce(p.sigNum * 4, p.sigDen);
}

export function patternBeats(p: Pattern): number {
  return p.bars * barBeats(p);
}

export function stepBeats(t: Track): number {
  return t.stepDur.num / t.stepDur.den;
}

/** One loop of a track in beats: steps × step duration. */
export function loopBeats(t: Track): number {
  return (t.steps.length * t.stepDur.num) / t.stepDur.den;
}

export function findPattern(project: Project, id: string): Pattern | undefined {
  return project.patterns.find((p) => p.id === id);
}

export function currentPattern(project: Project): Pattern {
  return findPattern(project, project.currentPatternId) ?? project.patterns[0];
}

export function cloneTrack(t: Track): Track {
  return { ...structuredClone(t), id: newId() };
}

export function clonePattern(p: Pattern, name: string): Pattern {
  return { ...structuredClone(p), id: newId(), name, tracks: p.tracks.map(cloneTrack) };
}

/** Resize a step list, keeping existing steps and appending empty ones. */
export function resizeSteps(steps: Step[], count: number): Step[] {
  const next = steps.slice(0, count);
  while (next.length < count) next.push(makeStep());
  return next;
}

// ---- compact serialisation ----

/** Stored step: 0 = off with defaults, 1 = on with defaults, otherwise only non-default fields. */
export type StoredStep = 0 | 1 | Partial<Step>;

const STEP_DEFAULTS = makeStep();
const SCALAR_FIELDS = ["velocity", "probability", "ratchet", "nudge", "flam", "pitch"] as const;

export function compactStep(s: Step): StoredStep {
  const out: Partial<Step> = {};
  if (s.on) out.on = true;
  for (const k of SCALAR_FIELDS) {
    if (s[k] !== STEP_DEFAULTS[k]) (out as Record<string, unknown>)[k] = s[k];
  }
  if (s.condition.a !== 1 || s.condition.b !== 1) out.condition = { ...s.condition };
  const keys = Object.keys(out);
  if (!keys.length) return 0;
  return keys.length === 1 && out.on ? 1 : out;
}

/**
 * Project JSON with compact steps. `pretty` indents the structure but keeps each step list
 * on one line. The parser reads both this form and the full form.
 */
export function serializeProject(project: Project, pretty = false): string {
  const compact = {
    ...project,
    patterns: project.patterns.map((p) => ({
      ...p,
      tracks: p.tracks.map((t) => ({ ...t, steps: t.steps.map(compactStep) })),
    })),
  };
  if (!pretty) return JSON.stringify(compact);
  const lists: string[] = [];
  const text = JSON.stringify(
    compact,
    (key, value: unknown) =>
      key === "steps" ? `\u0000steps${lists.push(JSON.stringify(value)) - 1}` : value,
    2,
  );
  return text.replace(/"\\u0000steps(\d+)"/g, (_, i: string) => lists[Number(i)]);
}

// ---- tolerant parser ----

export type ParseResult = { ok: true; project: Project } | { ok: false; error: string };

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Number clamped to [min, max]; non-numbers give the default. */
function num(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

function int(v: unknown, def: number, min: number, max: number): number {
  return Math.round(num(v, def, min, max));
}

function bool(v: unknown, def: boolean): boolean {
  return typeof v === "boolean" ? v : def;
}

function str(v: unknown, def: string, max = 40): string {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : def;
}

/** Accepts a full step object, a compact one (missing fields = defaults), or 0/1/true/false. */
function parseStep(v: unknown): Step {
  if (!isObj(v)) return makeStep({ on: v === true || v === 1 });
  const cond = isObj(v.condition) ? v.condition : {};
  const b = int(cond.b, 1, 1, MAX_CONDITION);
  return {
    on: bool(v.on, false),
    velocity: num(v.velocity, DEFAULT_VELOCITY, 0, 1),
    probability: num(v.probability, 1, 0, 1),
    ratchet: int(v.ratchet, 1, 1, MAX_RATCHET),
    nudge: num(v.nudge, 0, -0.5, 0.5),
    flam: bool(v.flam, false),
    pitch: int(v.pitch, 0, -24, 24),
    condition: { a: int(cond.a, 1, 1, b), b },
  };
}

function parseTrack(v: unknown, ids: Set<string>): Track | null {
  if (!isObj(v)) return null;
  const sound = isSoundKey(v.sound) ? v.sound : "kick";
  const rawSteps = Array.isArray(v.steps) ? v.steps.slice(0, MAX_STEPS) : [];
  const steps = rawSteps.length ? rawSteps.map(parseStep) : makeSteps(16);
  const dur = isObj(v.stepDur) ? v.stepDur : {};
  const stepDur = reduce(int(dur.num, 1, 1, 64), int(dur.den, 4, 1, 64));
  return {
    id: uniqueId(v.id, ids),
    name: str(v.name, SOUNDS[sound].name),
    sound,
    steps,
    stepDur,
    volume: num(v.volume, 0.8, 0, 1),
    pan: num(v.pan, 0, -1, 1),
    tune: int(v.tune, 0, -24, 24),
    decay: num(v.decay, 1, 0.25, 4),
    mute: bool(v.mute, false),
    solo: bool(v.solo, false),
    swing: bool(v.swing, true),
    choke: int(v.choke, 0, 0, 4),
  };
}

function uniqueId(v: unknown, ids: Set<string>): string {
  let id = typeof v === "string" && v ? v.slice(0, 40) : newId();
  while (ids.has(id)) id = newId();
  ids.add(id);
  return id;
}

function parsePattern(v: unknown, index: number, ids: Set<string>): Pattern | null {
  if (!isObj(v)) return null;
  const den = int(v.sigDen, 4, 2, 16);
  const tracks = (Array.isArray(v.tracks) ? v.tracks : [])
    .map((t) => parseTrack(t, ids))
    .filter((t): t is Track => t !== null)
    .slice(0, MAX_TRACKS);
  return {
    id: uniqueId(v.id, ids),
    name: str(v.name, `Pattern ${index + 1}`),
    sigNum: int(v.sigNum, 4, 1, 32),
    sigDen: (SIG_DENOMINATORS as readonly number[]).includes(den) ? den : 4,
    bars: int(v.bars, 1, 1, MAX_BARS),
    swing: num(v.swing, 50, 50, 75),
    tracks,
  };
}

/** Validate an unknown value as a project, filling defaults and clamping ranges. */
export function parseProject(input: unknown): ParseResult {
  if (!isObj(input)) return { ok: false, error: "The JSON is not a project object." };
  if (input.version !== undefined && input.version !== 1) {
    return { ok: false, error: `Unsupported project version: ${JSON.stringify(input.version)}.` };
  }
  if (!Array.isArray(input.patterns)) {
    return { ok: false, error: "The project has no patterns array." };
  }
  const ids = new Set<string>();
  const patterns = input.patterns
    .map((p, i) => parsePattern(p, i, ids))
    .filter((p): p is Pattern => p !== null);
  if (!patterns.length) return { ok: false, error: "The project contains no valid pattern." };
  const known = new Set(patterns.map((p) => p.id));
  const song = (Array.isArray(input.song) ? input.song : [])
    .filter(isObj)
    .filter((e) => typeof e.patternId === "string" && known.has(e.patternId))
    .map((e) => ({
      id: uniqueId(e.id, ids),
      patternId: e.patternId as string,
      repeats: int(e.repeats, 1, 1, 64),
    }));
  const current =
    typeof input.currentPatternId === "string" && known.has(input.currentPatternId)
      ? input.currentPatternId
      : patterns[0].id;
  return {
    ok: true,
    project: {
      version: 1,
      name: str(input.name, "Untitled", 60),
      bpm: Math.round(num(input.bpm, 120, 20, 300) * 10) / 10,
      masterVolume: num(input.masterVolume, 0.8, 0, 1),
      metronome: bool(input.metronome, false),
      playMode: input.playMode === "song" ? "song" : "pattern",
      patterns,
      song,
      currentPatternId: current,
    },
  };
}

export function parseProjectText(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${(err as Error).message}` };
  }
  return parseProject(data);
}
