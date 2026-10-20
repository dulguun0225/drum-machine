// Timing engine: turns the project into timed events. Pure module (no Web Audio), unit-tested.
//
// Positions are in quarter-note beats. A segment is a stretch of the timeline that plays one
// pattern from its start beat; tracks count their steps from the segment start, so a new
// segment resets every track. Pattern mode keeps one open-ended segment while the same pattern
// loops (tracks run freely, polymeter does not reset); a pattern switch ends it at the next
// pattern-length boundary. Song mode gives each song entry its own segment.
//
// The Player scans steps slightly ahead of the audio clock into a pending buffer and converts
// an event to audio time only when it falls inside the lookahead window. Until then it can
// still be discarded (pattern switch, edited song) and follows tempo changes.

import {
  findPattern,
  patternBeats,
  type Pattern,
  type PlayMode,
  type Project,
  type Track,
} from "./model";
import type { SoundKey } from "./kit";

/** Audio scheduled ahead of the current time, in seconds. */
export const LOOKAHEAD = 0.1;
/** Grace hit of a flam, in seconds before the main hit. */
export const FLAM_SECONDS = 0.025;
/** Delay between pressing play and the first beat, in seconds (before early-offset room). */
export const START_DELAY = 0.05;
const EPS = 1e-9;

export type Rng = () => number;

/** Seeded uniform generator in [0, 1) (mulberry32), for reproducible probability tests. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface HitEvent {
  type: "hit";
  at: number; // nominal beat of the step
  beat: number; // hit position including swing, nudge and ratchet offsets
  offset: number; // seconds added after beat→time conversion (negative for a flam grace hit)
  trackId: string;
  patternId: string;
  order: number; // track index in the pattern (choke tie-break)
  step: number;
  velocity: number;
  semitones: number; // track tune + step pitch
  decay: number;
  sound: SoundKey;
  choke: number;
  grace: boolean;
}

/** A step boundary of a track (on or off); drives the playhead. */
export interface StepEvent {
  type: "step";
  at: number;
  beat: number;
  offset: 0;
  trackId: string;
  patternId: string;
  step: number;
}

/** A time-signature beat; drives the metronome and the position readout. */
export interface BeatEvent {
  type: "beat";
  at: number;
  beat: number;
  offset: 0;
  patternId: string;
  entryId: string | null; // song entry id, null in pattern mode
  bar: number; // bar index from the segment start
  beatInBar: number;
}

export type EngineEvent = HitEvent | StepEvent | BeatEvent;
export type TimedEvent = EngineEvent & { time: number };

export interface Segment {
  patternId: string;
  start: number;
  mode: PlayMode;
  /** Song entry id (song mode) and its last known index, used when the entry is deleted. */
  entryId: string | null;
  entry: number;
  /** End chosen when a change was requested; null while none is pending. */
  pendingEnd: number | null;
}

/** Song mode needs at least one entry; otherwise playback falls back to pattern mode. */
export function effectiveMode(project: Project): PlayMode {
  return project.playMode === "song" && project.song.length > 0 ? "song" : "pattern";
}

function targetPatternId(project: Project): string {
  return findPattern(project, project.currentPatternId)
    ? project.currentPatternId
    : project.patterns[0].id;
}

function lengthOf(project: Project, patternId: string): number {
  const p = findPattern(project, patternId);
  return p ? patternBeats(p) : 4;
}

function entryIndex(project: Project, seg: Segment): number {
  return seg.entryId === null ? -1 : project.song.findIndex((e) => e.id === seg.entryId);
}

function segmentFor(project: Project, prev: Segment | null, start: number): Segment {
  const mode = effectiveMode(project);
  if (mode === "song") {
    const n = project.song.length;
    let index = 0;
    if (prev?.mode === "song") {
      const i = entryIndex(project, prev);
      // A deleted entry continues with the entry that now sits at its old position.
      index = i >= 0 ? (i + 1) % n : prev.entry < n ? prev.entry : 0;
    }
    const e = project.song[index];
    return { patternId: e.patternId, start, mode, entryId: e.id, entry: index, pendingEnd: null };
  }
  const patternId = targetPatternId(project);
  return { patternId, start, mode, entryId: null, entry: -1, pendingEnd: null };
}

/** First pattern-length boundary of the segment at or after `beat`. */
function nextBoundary(project: Project, seg: Segment, beat: number): number {
  const len = lengthOf(project, seg.patternId);
  const n = Math.max(0, Math.ceil((beat - seg.start) / len - EPS));
  return seg.start + n * len;
}

/**
 * End beat of the segment. A song entry ends after repeats × pattern length. A change (other
 * pattern or play mode, deleted entry) or a song entry shortened behind the scan position
 * ends the segment at the first pattern-length boundary at or after `limit`, the earliest
 * beat where the timeline can still change.
 */
function segmentEnd(project: Project, seg: Segment, scanned: number, limit: number): number {
  let natural = Infinity;
  let missing = false;
  if (seg.mode === "song") {
    const i = entryIndex(project, seg);
    if (i >= 0) {
      seg.entry = i;
      natural = seg.start + project.song[i].repeats * lengthOf(project, seg.patternId);
    } else {
      missing = true;
    }
  }
  const change =
    missing ||
    effectiveMode(project) !== seg.mode ||
    (seg.mode === "pattern" && targetPatternId(project) !== seg.patternId);
  const behind = natural < scanned - EPS;
  if (!change && !behind) {
    seg.pendingEnd = null;
    return natural;
  }
  seg.pendingEnd ??= nextBoundary(project, seg, limit);
  return behind ? seg.pendingEnd : Math.min(natural, seg.pendingEnd);
}

/** Index of the first multiple of num/den (from `start`) that may be ≥ `from`; callers skip earlier ones. */
function firstIndex(start: number, from: number, num: number, den: number): number {
  return Math.max(0, Math.floor(((from - start) * den) / num) - 1);
}

function skipKey(segStart: number, trackId: string, k: number): string {
  return `${segStart}|${trackId}|${k}`;
}

/** Walks the timeline in nominal beats; every step is emitted exactly once. */
export class Sequencer {
  scanned: number;
  segment: Segment;
  /** Recent segments, newest last, for locating a past beat (live record). */
  readonly history: Segment[] = [];
  /** Steps whose hits are suppressed once (already played live while recording). */
  private readonly skips = new Set<string>();

  constructor(project: Project, startBeat = 0) {
    this.scanned = startBeat;
    this.segment = segmentFor(project, null, startBeat);
    this.history.push(this.segment);
  }

  /** End of the current segment, deciding pending changes at or after `limit`. */
  end(project: Project, limit: number): number {
    return segmentEnd(project, this.segment, this.scanned, limit);
  }

  /** Move the scan position back; the caller discards the events emitted from `beat` on. */
  rewind(beat: number): void {
    this.scanned = Math.min(this.scanned, beat);
  }

  /** Do not play step `k` (counted from the segment start) of the track this time. */
  skipOnce(segment: Segment, trackId: string, k: number): void {
    if (this.skips.size > 256) this.skips.clear();
    this.skips.add(skipKey(segment.start, trackId, k));
  }

  /**
   * Emit all events whose nominal beat lies in [scanned, to). Pending changes take effect at
   * a boundary at or after `limit` (default: the scan position, nothing is retractable).
   */
  advance(project: Project, to: number, rng: Rng, limit = this.scanned): EngineEvent[] {
    const out: EngineEvent[] = [];
    for (let guard = 0; this.scanned < to && guard < 10000; guard++) {
      const end = segmentEnd(project, this.segment, this.scanned, Math.max(limit, this.scanned));
      if (end <= this.scanned) {
        this.segment = segmentFor(project, this.segment, Math.max(end, this.scanned));
        this.history.push(this.segment);
        if (this.history.length > 8) this.history.shift();
        continue;
      }
      const segTo = Math.min(to, end);
      this.emitSegment(project, this.segment, this.scanned, segTo, rng, out);
      this.scanned = segTo;
    }
    return out;
  }

  /** Segment that contains `beat`, if still remembered. */
  segmentAt(beat: number): Segment | undefined {
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].start <= beat + EPS) return this.history[i];
    }
    return undefined;
  }

  /** Patterns that can play next: the current one, the selected one and the next song entry. */
  upcomingPatterns(project: Project): Pattern[] {
    const ids = new Set([this.segment.patternId, targetPatternId(project)]);
    const n = project.song.length;
    if (n) {
      const i = entryIndex(project, this.segment);
      ids.add(
        project.song[i >= 0 ? (i + 1) % n : Math.min(Math.max(0, this.segment.entry), n - 1)]
          .patternId,
      );
    }
    return project.patterns.filter((p) => ids.has(p.id));
  }

  private emitSegment(
    project: Project,
    seg: Segment,
    from: number,
    to: number,
    rng: Rng,
    out: EngineEvent[],
  ) {
    const pattern = findPattern(project, seg.patternId);
    this.emitBeats(seg, pattern, from, to, out);
    if (!pattern) return;
    const anySolo = pattern.tracks.some((t) => t.solo);
    pattern.tracks.forEach((track, order) => {
      const audible = !track.mute && (!anySolo || track.solo);
      this.emitTrack(seg, pattern, track, order, audible, from, to, rng, out);
    });
  }

  private emitBeats(
    seg: Segment,
    pattern: Pattern | undefined,
    from: number,
    to: number,
    out: EngineEvent[],
  ) {
    const den = pattern?.sigDen ?? 4;
    const perBar = pattern?.sigNum ?? 4;
    for (let j = firstIndex(seg.start, from, 4, den); ; j++) {
      const beat = seg.start + (j * 4) / den;
      if (beat >= to) break;
      if (beat < from) continue;
      out.push({
        type: "beat",
        at: beat,
        beat,
        offset: 0,
        patternId: seg.patternId,
        entryId: seg.entryId,
        bar: Math.floor(j / perBar),
        beatInBar: j % perBar,
      });
    }
  }

  private emitTrack(
    seg: Segment,
    pattern: Pattern,
    track: Track,
    order: number,
    audible: boolean,
    from: number,
    to: number,
    rng: Rng,
    out: EngineEvent[],
  ) {
    const { num, den } = track.stepDur;
    const n = track.steps.length;
    const dur = num / den;
    for (let k = firstIndex(seg.start, from, num, den); ; k++) {
      // Exact for whole-beat positions, so tuplets land on the beat without drift.
      const beat = seg.start + (k * num) / den;
      if (beat >= to) break;
      if (beat < from) continue;
      const index = k % n;
      const ids = { trackId: track.id, patternId: pattern.id, step: index };
      out.push({ type: "step", at: beat, beat, offset: 0, ...ids });
      const step = track.steps[index];
      if (!audible || !step.on) continue;
      if (this.skips.delete(skipKey(seg.start, track.id, k))) continue;
      const loop = Math.floor(k / n);
      if (loop % step.condition.b !== step.condition.a - 1) continue;
      if (step.probability < 1 && !(rng() < step.probability)) continue;
      const swing = track.swing && index % 2 === 1 ? ((pattern.swing - 50) / 50) * dur : 0;
      const hitBeat = beat + swing + step.nudge * dur;
      const base = {
        type: "hit" as const,
        at: beat,
        ...ids,
        order,
        velocity: step.velocity,
        semitones: track.tune + step.pitch,
        decay: track.decay,
        sound: track.sound,
        choke: track.choke,
      };
      if (step.flam) {
        out.push({
          ...base,
          beat: hitBeat,
          offset: -FLAM_SECONDS,
          velocity: step.velocity / 2,
          grace: true,
        });
      }
      for (let r = 0; r < step.ratchet; r++) {
        out.push({ ...base, beat: hitBeat + (r * dur) / step.ratchet, offset: 0, grace: false });
      }
    }
  }
}

/**
 * Early room in beats: the largest amount any step that is on plays before its nominal beat
 * (negative nudge × step duration, plus the flam grace time when the step has a flam).
 * Swing, positive nudge and ratchets only delay, so they need no room.
 */
export function earlyRoom(patterns: Pattern[], bpm: number): number {
  const flamBeats = (FLAM_SECONDS * bpm) / 60;
  let room = 0;
  for (const p of patterns) {
    for (const t of p.tracks) {
      const dur = t.stepDur.num / t.stepDur.den;
      for (const s of t.steps) {
        if (s.on) room = Math.max(room, Math.max(0, -s.nudge) * dur + (s.flam ? flamBeats : 0));
      }
    }
  }
  return room;
}

interface Anchor {
  time: number;
  beat: number;
  bpm: number;
}

/** Piecewise-linear beat ↔ time map; a BPM change adds an anchor so time stays continuous. */
export class TempoMap {
  private anchors: Anchor[];

  constructor(time: number, beat: number, bpm: number) {
    this.anchors = [{ time, beat, bpm }];
  }

  get bpm(): number {
    return this.anchors[this.anchors.length - 1].bpm;
  }

  timeAt(beat: number): number {
    let a = this.anchors[0];
    for (const x of this.anchors) if (x.beat <= beat) a = x;
    return a.time + ((beat - a.beat) * 60) / a.bpm;
  }

  beatAt(time: number): number {
    let a = this.anchors[0];
    for (const x of this.anchors) if (x.time <= time) a = x;
    return a.beat + ((time - a.time) * a.bpm) / 60;
  }

  /** Change tempo from `beat` on; beats before it keep their times. */
  setBpm(bpm: number, beat: number): void {
    const last = this.anchors[this.anchors.length - 1];
    if (bpm === last.bpm) return;
    const time = this.timeAt(beat);
    if (beat <= last.beat) {
      last.bpm = bpm;
    } else {
      this.anchors.push({ time, beat, bpm });
      if (this.anchors.length > 16) this.anchors.shift();
    }
  }
}

/** Sequencer plus tempo map and pending buffer: call `tick` every ~25 ms with the audio clock. */
export class Player {
  readonly tempo: TempoMap;
  readonly seq: Sequencer;
  private pending: EngineEvent[] = [];
  /** Beat of the last lookahead horizon; everything before it has been released. */
  private releasedBeat = 0;
  /** Largest nominal beat of any released event; the timeline cannot change before it. */
  private releasedAt = -Infinity;

  constructor(project: Project, startTime: number) {
    this.tempo = new TempoMap(startTime, 0, project.bpm);
    this.seq = new Sequencer(project, 0);
  }

  /** Start far enough in the future that the earliest hit of beat 0 is not late. */
  static start(project: Project, now: number): Player {
    const room = earlyRoom(new Sequencer(project).upcomingPatterns(project), project.bpm);
    return new Player(project, now + START_DELAY + (room * 60) / project.bpm);
  }

  /**
   * Scan ahead by the early room and release the events that fall before `now + LOOKAHEAD`.
   * A hit that would already be in the past (possible only right after an edit moved a step
   * earlier than the scan covered) is skipped rather than played late.
   */
  tick(project: Project, now: number, rng: Rng): TimedEvent[] {
    // Pending events convert with the new tempo; released ones keep their times.
    if (project.bpm !== this.tempo.bpm) this.tempo.setBpm(project.bpm, this.releasedBeat);
    const horizonTime = now + LOOKAHEAD;
    const horizon = this.tempo.beatAt(horizonTime);
    const room = earlyRoom(this.seq.upcomingPatterns(project), project.bpm);
    // A change can start after everything released and late enough that the next segment's
    // earliest hit is still ahead of the clock.
    const limit = Math.max(this.tempo.beatAt(now) + room, this.releasedAt + EPS);
    const end = this.seq.end(project, limit);
    if (end < this.seq.scanned) {
      this.pending = this.pending.filter((e) => e.at < end);
      this.seq.rewind(end);
    }
    for (const e of this.seq.advance(project, horizon + room, rng, limit)) this.pending.push(e);

    const out: TimedEvent[] = [];
    const keep: EngineEvent[] = [];
    for (const e of this.pending) {
      const time = this.tempo.timeAt(e.beat) + e.offset;
      if (time >= horizonTime) {
        keep.push(e);
        continue;
      }
      this.releasedAt = Math.max(this.releasedAt, e.at);
      if (e.type === "hit" && time < now) continue;
      out.push({ ...e, time });
    }
    this.pending = keep;
    this.releasedBeat = Math.max(this.releasedBeat, horizon);
    return out;
  }

  /** Segment and beat playing at audio time `time`. */
  locate(time: number): { segment: Segment; beat: number } | undefined {
    const beat = this.tempo.beatAt(time);
    const segment = this.seq.segmentAt(beat);
    return segment && { segment, beat };
  }

  /**
   * Step of `track` nearest to audio time `time` (live record). `upcoming` is true when the
   * step lies after `time`, i.e. it has not played yet in this loop.
   */
  nearestStep(track: Track, time: number) {
    const at = this.locate(time);
    if (!at) return undefined;
    const dur = track.stepDur.num / track.stepDur.den;
    const k = Math.max(0, Math.round((at.beat - at.segment.start) / dur));
    const n = track.steps.length;
    return { segment: at.segment, k, index: k % n, upcoming: at.segment.start + k * dur > at.beat };
  }

  /** Suppress step `k` of the track once (it was already played live). */
  skipOnce(segment: Segment, trackId: string, k: number): void {
    this.seq.skipOnce(segment, trackId, k);
  }
}
