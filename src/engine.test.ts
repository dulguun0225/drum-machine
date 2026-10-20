import { describe, expect, it } from "vite-plus/test";
import {
  FLAM_SECONDS,
  Player,
  Sequencer,
  type BeatEvent,
  TempoMap,
  seededRng,
  type EngineEvent,
  type HitEvent,
  type StepEvent,
  type TimedEvent,
} from "./engine";
import {
  makePattern,
  makeProject,
  makeStep,
  makeTrack,
  type Pattern,
  type Project,
  type Step,
  type Track,
} from "./model";
import type { Ratio } from "./ratio";

const SIXTEENTH: Ratio = { num: 1, den: 4 };

/** Track from a string: "x" on, "." off. */
function track(cells: string, stepDur: Ratio = SIXTEENTH, over: Partial<Track> = {}): Track {
  const steps = cells.split("").map((c) => makeStep({ on: c === "x" }));
  return makeTrack("kick", { steps, stepDur, swing: false, ...over });
}

function pattern(tracks: Track[], over: Partial<Pattern> = {}): Pattern {
  return { ...makePattern("P", tracks), ...over };
}

function project(patterns: Pattern[], over: Partial<Project> = {}): Project {
  return { ...makeProject(), patterns, currentPatternId: patterns[0].id, bpm: 120, ...over };
}

const rng = () => 0;
const hits = (events: EngineEvent[], trackId?: string) =>
  events.filter((e): e is HitEvent => e.type === "hit" && (!trackId || e.trackId === trackId));
const steps = (events: EngineEvent[], trackId: string) =>
  events.filter((e): e is StepEvent => e.type === "step" && e.trackId === trackId);

/** Tick a player every 25 ms from `from` to `to` (audio clock), collecting released events. */
function ticks(player: Player, p: Project, from: number, to: number): TimedEvent[] {
  const out: TimedEvent[] = [];
  for (let now = from; now < to; now += 0.025) out.push(...player.tick(p, now, rng));
  return out;
}

/** Clock driving a player in 25 ms ticks; `until(beat)` runs it until the playhead reaches `beat`. */
function clock(player: Player, p: Project, start = 0) {
  let now = start;
  return {
    get now() {
      return now;
    },
    until(beat: number): TimedEvent[] {
      const out: TimedEvent[] = [];
      while (player.tempo.beatAt(now) < beat) {
        out.push(...player.tick(p, now, rng));
        now += 0.025;
      }
      return out;
    },
  };
}

/** Song entry id at the start of each 4-beat bar, as the beat events report it. */
const barEntries = (events: EngineEvent[]) =>
  events
    .filter((e): e is BeatEvent => e.type === "beat" && e.beatInBar === 0)
    .map((e) => e.entryId);

function setStep(t: Track, i: number, over: Partial<Step>) {
  t.steps[i] = { ...t.steps[i], on: true, ...over };
}

describe("step timing", () => {
  it("plays straight 16ths at 0.125 s spacing at 120 BPM", () => {
    const t = track("x".repeat(16));
    const p = project([pattern([t])]);
    const player = new Player(p, 10);
    const events = ticks(player, p, 9.9, 11.9);
    const times = hits(events)
      .slice(0, 16)
      .map((e) => (e as TimedEvent).time);
    times.forEach((time, i) => expect(time).toBeCloseTo(10 + i * 0.125, 9));
    expect(
      hits(events)
        .slice(0, 16)
        .map((e) => e.beat),
    ).toEqual(Array.from({ length: 16 }, (_, i) => i / 4));
  });

  it("lands triplets exactly on every beat", () => {
    const t = track("x".repeat(12), { num: 1, den: 3 });
    const seq = new Sequencer(project([pattern([t])]));
    const beats = hits(seq.advance(project([pattern([t])]), 4, rng)).map((e) => e.beat);
    expect(beats).toHaveLength(12);
    for (let b = 0; b < 4; b++) expect(beats[b * 3]).toBe(b);
  });

  it("lines up arbitrary tuplets with the beat (5 in 4, 7 in 3)", () => {
    const five = track("x".repeat(5), { num: 4, den: 5 });
    const seven = track("x".repeat(7), { num: 3, den: 7 });
    const p = project([pattern([five, seven])]);
    const events = new Sequencer(p).advance(p, 12.5, rng);
    const fiveStarts = steps(events, five.id)
      .filter((e) => e.step === 0)
      .map((e) => e.beat);
    const sevenStarts = steps(events, seven.id)
      .filter((e) => e.step === 0)
      .map((e) => e.beat);
    expect(fiveStarts).toEqual([0, 4, 8, 12]);
    expect(sevenStarts).toEqual([0, 3, 6, 9, 12]);
    expect(steps(events, five.id)[1].beat).toBeCloseTo(0.8, 12);
  });
});

describe("polymeter and pattern switching", () => {
  it("does not reset a 5-step track at the pattern boundary in pattern mode", () => {
    const sixteen = track("x".repeat(16));
    const five = track("x....");
    const p = project([pattern([sixteen, five])]);
    const events = new Sequencer(p).advance(p, 8, rng);
    const atBar2 = steps(events, five.id).find((e) => e.beat === 4);
    expect(atBar2?.step).toBe(16 % 5);
    // 32 sixteenths → the 5-step track starts its loop at 0, 1.25, 2.5, ... (every 5th step).
    expect(hits(events, five.id).map((e) => e.beat)).toEqual([0, 1.25, 2.5, 3.75, 5, 6.25, 7.5]);
  });

  it("switches a queued pattern at the next pattern-length boundary and resets tracks", () => {
    const a = pattern([track("x...", { num: 1, den: 1 })], { bars: 1 });
    const bTrack = track("x..", { num: 1, den: 1 });
    const b = pattern([bTrack]);
    const p = project([a, b]);
    const seq = new Sequencer(p);
    seq.advance(p, 1.5, rng);
    p.currentPatternId = b.id; // chosen during playback
    const events = seq.advance(p, 10, rng);
    const bSteps = steps(events, bTrack.id);
    expect(bSteps[0]).toMatchObject({ beat: 4, step: 0 });
    expect(bSteps.map((e) => e.step)).toEqual([0, 1, 2, 0, 1, 2]);
    expect(events.filter((e) => e.patternId === a.id && e.beat >= 4)).toEqual([]);
  });

  it("cancels a queued switch when the playing pattern is chosen again", () => {
    const a = pattern([track("xxxx", { num: 1, den: 1 })]);
    const b = pattern([track("x", { num: 1, den: 1 })]);
    const p = project([a, b]);
    const seq = new Sequencer(p);
    seq.advance(p, 1, rng);
    p.currentPatternId = b.id;
    seq.advance(p, 2, rng);
    p.currentPatternId = a.id;
    const events = seq.advance(p, 8, rng);
    expect(events.every((e) => e.patternId === a.id)).toBe(true);
  });

  it("plays song entries in order, resets tracks at each entry and loops", () => {
    const aTrack = track("x..", { num: 1, den: 1 }); // 3 steps against a 4-beat bar
    const bTrack = track("xx", { num: 1, den: 1 });
    const a = pattern([aTrack]);
    const b = pattern([bTrack]);
    const p = project([a, b], {
      playMode: "song",
      song: [
        { id: `e-a-2`, patternId: a.id, repeats: 2 },
        { id: `e-b-1`, patternId: b.id, repeats: 1 },
      ],
    });
    const events = new Sequencer(p).advance(p, 16, rng);
    const aSteps = steps(events, aTrack.id);
    // Within the 2 repeats of A the track keeps running (beat 4 is step 1, not 0).
    expect(aSteps.find((e) => e.beat === 4)?.step).toBe(1);
    expect(aSteps.filter((e) => e.beat >= 8 && e.beat < 12)).toEqual([]);
    // B starts at beat 8; the song loops to A at beat 12 with A reset to step 0.
    expect(steps(events, bTrack.id)[0]).toMatchObject({ beat: 8, step: 0 });
    expect(aSteps.find((e) => e.beat === 12)?.step).toBe(0);
    const beatEvents = events.filter((e) => e.type === "beat");
    expect(beatEvents.find((e) => e.beat === 8)).toMatchObject({
      entryId: "e-b-1",
      bar: 0,
      beatInBar: 0,
    });
    expect(beatEvents.find((e) => e.beat === 12)).toMatchObject({ entryId: "e-a-2", bar: 0 });
    expect(beatEvents.find((e) => e.beat === 5)).toMatchObject({
      entryId: "e-a-2",
      bar: 1,
      beatInBar: 1,
    });
  });

  it("switches from pattern mode to song mode at the next pattern boundary", () => {
    const a = pattern([track("x", { num: 1, den: 1 })]);
    const b = pattern([track("x", { num: 1, den: 1 })]);
    const p = project([a, b]);
    const seq = new Sequencer(p);
    seq.advance(p, 5, rng); // second loop of A
    p.playMode = "song";
    p.song = [{ id: `e-b-1`, patternId: b.id, repeats: 1 }];
    const beats = seq.advance(p, 12, rng).filter((e) => e.type === "beat");
    expect(beats.find((e) => e.beat === 7)).toMatchObject({ patternId: a.id, entryId: null });
    expect(beats.find((e) => e.beat === 8)).toMatchObject({
      patternId: b.id,
      entryId: "e-b-1",
      bar: 0,
    });
  });

  it("uses the time signature for beat events (7/8)", () => {
    const p = project([pattern([track("x", { num: 1, den: 2 })], { sigNum: 7, sigDen: 8 })]);
    const beats = new Sequencer(p).advance(p, 3.5, rng).filter((e) => e.type === "beat");
    expect(beats.map((e) => e.beat)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
    const next = new Sequencer(p);
    next.advance(p, 3.5, rng);
    expect(next.advance(p, 4, rng).find((e) => e.type === "beat")).toMatchObject({
      beat: 3.5,
      bar: 1,
      beatInBar: 0,
    });
  });
});

describe("step modifiers", () => {
  it("delays odd steps of swing-enabled tracks by (swing − 50)/50 × step", () => {
    const swung = track("xxxx", SIXTEENTH, { swing: true });
    const straight = track("xxxx", SIXTEENTH, { swing: false });
    const p = project([pattern([swung, straight], { swing: 66 })]);
    const events = new Sequencer(p).advance(p, 1, rng);
    const swungBeats = hits(events, swung.id).map((e) => e.beat);
    expect(swungBeats[0]).toBe(0);
    expect(swungBeats[1]).toBeCloseTo(0.25 + 0.32 * 0.25, 12);
    expect(swungBeats[2]).toBe(0.5);
    expect(swungBeats[3]).toBeCloseTo(0.75 + 0.08, 12);
    expect(hits(events, straight.id).map((e) => e.beat)).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it("applies nudge as a fraction of the step duration", () => {
    const t = track("....", { num: 1, den: 2 });
    setStep(t, 1, { nudge: -0.5 });
    setStep(t, 2, { nudge: 0.25 });
    const p = project([pattern([t])]);
    const beats = hits(new Sequencer(p).advance(p, 2, rng)).map((e) => e.beat);
    expect(beats).toEqual([0.25, 1.125]);
  });

  it("spaces ratchets evenly within the step", () => {
    const t = track("..", { num: 1, den: 2 });
    setStep(t, 1, { ratchet: 4 });
    const p = project([pattern([t])]);
    const beats = hits(new Sequencer(p).advance(p, 1, rng)).map((e) => e.beat);
    expect(beats).toEqual([0.5, 0.625, 0.75, 0.875]);
  });

  it("adds a flam grace hit 25 ms earlier at half velocity", () => {
    const t = track("....");
    setStep(t, 0, { flam: true, velocity: 0.8 });
    const p = project([pattern([t])]);
    const events = hits(ticks(Player.start(p, 5), p, 5, 5.2)) as (HitEvent & TimedEvent)[];
    expect(events).toHaveLength(2);
    const [grace, main] = events;
    expect(grace).toMatchObject({ grace: true, velocity: 0.4 });
    expect(main).toMatchObject({ grace: false, velocity: 0.8 });
    expect(main.time - grace.time).toBeCloseTo(FLAM_SECONDS, 12);
  });

  it("plays a step only on loop a of every b loops (condition a:b)", () => {
    const t = track("....", { num: 1, den: 1 });
    setStep(t, 0, { condition: { a: 2, b: 3 } });
    const p = project([pattern([t])]);
    const beats = hits(new Sequencer(p).advance(p, 4 * 9, rng)).map((e) => e.beat);
    // Loops 0..8; plays on loops 1, 4, 7.
    expect(beats).toEqual([4, 16, 28]);
  });

  it("applies probability with an injected seeded RNG", () => {
    const t = track("x".repeat(16));
    t.steps = t.steps.map((s) => ({ ...s, probability: 0.5 }));
    const always = track("x".repeat(16));
    const never = track("x".repeat(16));
    never.steps = never.steps.map((s) => ({ ...s, probability: 0 }));
    const p = project([pattern([t, always, never])]);
    const run = (seed: number) =>
      hits(new Sequencer(p).advance(p, 400, seededRng(seed)), t.id).map((e) => e.beat);
    const first = run(42);
    expect(run(42)).toEqual(first); // reproducible
    expect(run(7)).not.toEqual(first);
    expect(first.length).toBeGreaterThan(700);
    expect(first.length).toBeLessThan(900);
    const all = new Sequencer(p).advance(p, 4, seededRng(1));
    expect(hits(all, always.id)).toHaveLength(16);
    expect(hits(all, never.id)).toHaveLength(0);
  });

  it("silences muted tracks and non-solo tracks when a solo exists", () => {
    const a = track("x");
    const b = track("x", SIXTEENTH, { solo: true });
    const c = track("x", SIXTEENTH, { solo: true, mute: true });
    const p = project([pattern([a, b, c])]);
    const events = new Sequencer(p).advance(p, 1, rng);
    expect(hits(events).map((e) => e.trackId)).toEqual(Array(4).fill(b.id));
  });
});

describe("tempo and scheduling", () => {
  it("keeps time continuous across a BPM change", () => {
    const map = new TempoMap(0, 0, 120);
    expect(map.timeAt(4)).toBe(2);
    map.setBpm(60, 4);
    expect(map.timeAt(4)).toBe(2);
    expect(map.timeAt(3)).toBe(1.5); // before the anchor: old tempo
    expect(map.timeAt(5)).toBe(3);
    expect(map.beatAt(3)).toBe(5);
  });

  it("changes step spacing at the scheduled horizon without a jump", () => {
    const t = track("x".repeat(16));
    const p = project([pattern([t])]);
    const player = new Player(p, 0);
    const times: number[] = [];
    for (let now = 0; now < 4; now += 0.025) {
      if (now > 1.5) p.bpm = 60;
      for (const e of player.tick(p, now, rng)) if (e.type === "hit") times.push(e.time);
    }
    const gaps = times.slice(1).map((x, i) => x - times[i]);
    expect(gaps.every((g) => g > 0.12 && g < 0.26)).toBe(true);
    expect(gaps.some((g) => Math.abs(g - 0.125) < 1e-9)).toBe(true);
    expect(gaps.at(-1)).toBeCloseTo(0.25, 9);
  });

  it("never schedules a hit in the past, even with negative nudge, flam and swing", () => {
    const slow = track("xxxx", { num: 1, den: 1 });
    slow.steps = slow.steps.map((s) => ({ ...s, nudge: -0.5, flam: true }));
    const fast = track("x".repeat(16), SIXTEENTH, { swing: true });
    fast.steps = fast.steps.map((s, i) => ({
      ...s,
      nudge: i % 3 ? -0.5 : 0.5,
      ratchet: 3,
      flam: true,
    }));
    const p = project([pattern([slow, fast], { swing: 75 })], { bpm: 173 });
    const player = Player.start(p, 0);
    const rand = seededRng(3);
    let count = 0;
    for (let now = 0; now < 20; now += 0.025 + rand() * 0.03) {
      for (const e of player.tick(p, now, rand)) {
        if (e.type !== "hit") continue;
        count++;
        expect(e.time).toBeGreaterThanOrEqual(now);
      }
    }
    expect(count).toBeGreaterThan(1000);
  });

  it("locates the segment playing at a given time", () => {
    const p = project([pattern([track("x")])]);
    const player = new Player(p, 1);
    player.tick(p, 1, rng);
    const at = player.locate(1.25);
    expect(at?.beat).toBeCloseTo(0.5, 12);
    expect(at?.segment.patternId).toBe(p.patterns[0].id);
  });
});

describe("start and queued switches", () => {
  it("starts a 1/1 track at 60 BPM within 0.1 s of Play", () => {
    const p = project([pattern([track("xxxx", { num: 1, den: 1 })])], { bpm: 60 });
    const first = hits(ticks(Player.start(p, 5), p, 5, 6))[0] as TimedEvent;
    expect(first.time - 5).toBeLessThanOrEqual(0.1);
  });

  it("lands a switch chosen at beat 2.05 of a 4-beat pattern at beat 4 with a 1/1 track", () => {
    const a = pattern([track("xxxx", { num: 1, den: 1 })]);
    const b = pattern([track("xxxx", { num: 1, den: 1 })]);
    const p = project([a, b], { bpm: 60 });
    const run = clock(Player.start(p, 0), p);
    const before = run.until(2.05);
    p.currentPatternId = b.id;
    const events = [...before, ...run.until(12)];
    expect(events.find((e) => e.patternId === b.id)).toMatchObject({ type: "beat", at: 4 });
    expect(events.filter((e) => e.patternId === a.id && e.at >= 4)).toEqual([]);
  });
});

describe("edits during playback", () => {
  it("keeps ratchets in order before the next step across a 60 → 240 BPM change", () => {
    const t = track("xxxx", { num: 1, den: 1 });
    t.steps = t.steps.map((s) => ({ ...s, ratchet: 4 }));
    const p = project([pattern([t])], { bpm: 60 });
    const player = new Player(p, 0);
    const played: TimedEvent[] = [];
    for (let now = 0; now < 6; now += 0.025) {
      if (now >= 2.2) p.bpm = 240;
      played.push(...hits(player.tick(p, now, rng)).map((e) => e as TimedEvent));
    }
    const byBeat = played.toSorted((x, y) => x.beat - y.beat);
    expect(byBeat.slice(0, 40).map((e) => e.beat)).toEqual(
      Array.from({ length: 40 }, (_, i) => i / 4),
    );
    byBeat.slice(1).forEach((e, i) => expect(e.time).toBeGreaterThan(byBeat[i].time));
  });

  it("skips a hit that a grown step duration would make late, then plays on", () => {
    const t = track("x".repeat(16));
    t.steps = t.steps.map((s) => ({ ...s, nudge: -0.5 }));
    const p = project([pattern([t])]);
    const player = Player.start(p, 0);
    const played: TimedEvent[] = [];
    let changed = false;
    for (let now = 0; now < 8; now += 0.025) {
      if (!changed && player.tempo.beatAt(now) >= 2.5) {
        t.stepDur = { num: 4, den: 1 }; // nudge −0.5 now moves hits 2 beats early
        changed = true;
      }
      for (const e of hits(player.tick(p, now, rng)) as (HitEvent & TimedEvent)[]) {
        expect(e.time).toBeGreaterThanOrEqual(now);
        played.push(e);
      }
    }
    const after = played.filter((e) => e.at >= 4).map((e) => e.at);
    expect(after).not.toContain(4); // its hit at beat 2 was already in the past
    expect(after.slice(0, 2)).toEqual([8, 12]);
  });
});

describe("song edits during playback", () => {
  const songProject = (ids: string[]) => {
    const patterns = ids.map(() => pattern([track("x", { num: 1, den: 1 })]));
    return project(patterns, {
      playMode: "song",
      song: ids.map((id, i) => ({ id, patternId: patterns[i].id, repeats: 1 })),
    });
  };

  it("continues with the entry now at the old position when the playing entry is deleted", () => {
    const p = songProject(["a", "b", "c"]);
    const run = clock(new Player(p, 0), p);
    const events = run.until(1);
    p.song.splice(0, 1);
    events.push(...run.until(20));
    expect(barEntries(events).slice(0, 5)).toEqual(["a", "b", "c", "b", "c"]);
  });

  it("plays the entry after a deleted one that was not playing", () => {
    const p = songProject(["a", "b", "c"]);
    const run = clock(new Player(p, 0), p);
    const events = run.until(1);
    p.song.splice(1, 1);
    events.push(...run.until(20));
    expect(barEntries(events).slice(0, 5)).toEqual(["a", "c", "a", "c", "a"]);
  });

  it("follows the playing entry to its new position when entries are moved", () => {
    const p = songProject(["a", "b", "c"]);
    const run = clock(new Player(p, 0), p);
    const events = run.until(1);
    [p.song[0], p.song[1]] = [p.song[1], p.song[0]]; // a moves down: b, a, c
    events.push(...run.until(5));
    [p.song[2], p.song[1]] = [p.song[1], p.song[2]]; // c moves up while c plays: b, c, a
    events.push(...run.until(20));
    expect(barEntries(events).slice(0, 6)).toEqual(["a", "c", "a", "b", "c", "a"]);
  });

  it("applies changed repeats of the playing entry at a pattern boundary", () => {
    const p = songProject(["a", "b"]);
    const run = clock(new Player(p, 0), p);
    const events = run.until(1);
    p.song[0].repeats = 3; // longer: plays on
    events.push(...run.until(9));
    p.song[0].repeats = 1; // now behind the playhead: ends after the current repeat
    events.push(...run.until(13));
    p.song[1].repeats = 2;
    events.push(...run.until(28));
    expect(barEntries(events).slice(0, 7)).toEqual(["a", "a", "a", "b", "b", "a", "b"]);
  });
});

describe("live record", () => {
  it("skips the hit of an upcoming step once when it was played live", () => {
    const t = track("....", { num: 1, den: 1 });
    const p = project([pattern([t])]);
    const player = new Player(p, 0);
    const run = clock(player, p);
    const events = run.until(1.6); // step 2 (beat 2) is nearest and not scanned yet
    const near = player.nearestStep(t, run.now);
    expect(near).toMatchObject({ k: 2, index: 2, upcoming: true });
    if (!near) return;
    setStep(t, near.index, {});
    player.skipOnce(near.segment, t.id, near.k);
    events.push(...run.until(12));
    expect(hits(events).map((e) => e.at)).toEqual([6, 10]);
  });

  it("reports a step that has just played as not upcoming", () => {
    const t = track("....", { num: 1, den: 1 });
    const p = project([pattern([t])]);
    const player = new Player(p, 0);
    const run = clock(player, p);
    run.until(2.1);
    expect(player.nearestStep(t, run.now)).toMatchObject({ k: 2, upcoming: false });
  });
});
