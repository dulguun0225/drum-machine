import { describe, expect, it } from "vite-plus/test";
import { keepCurrentPattern, positionText, pruneQueue, recordPlan } from "./app";
import { Player, type BeatEvent, type TimedEvent } from "./engine";
import { makePattern, makeProject, makeStep, makeTrack, type Project } from "./model";

function project(): Project {
  const tracks = ["x...", "x.x.x"].map((cells) =>
    makeTrack("kick", { steps: cells.split("").map((c) => makeStep({ on: c === "x" })) }),
  );
  const a = makePattern("A", tracks);
  const b = makePattern("B", [makeTrack("snare")]);
  return {
    ...makeProject(),
    patterns: [a, b],
    currentPatternId: a.id,
    playMode: "song",
    song: [
      { id: "e1", patternId: a.id, repeats: 2 },
      { id: "e2", patternId: b.id, repeats: 1 },
    ],
  };
}

function beat(over: Partial<BeatEvent>): BeatEvent {
  return {
    type: "beat",
    at: 0,
    beat: 0,
    offset: 0,
    patternId: "",
    entryId: null,
    bar: 0,
    beatInBar: 0,
    ...over,
  };
}

describe("playhead queue", () => {
  it("stays bounded when no frame drains it (hidden tab) and keeps the latest due events", () => {
    const p = project();
    p.playMode = "pattern";
    const player = new Player(p, 0);
    let queue: TimedEvent[] = [];
    let now = 0;
    for (let i = 0; i <= 2400; i++) {
      now = i * 0.025; // 60 s
      for (const e of player.tick(p, now, () => 0)) if (e.type !== "hit") queue.push(e);
      queue = pruneQueue(queue, now);
      expect(queue.length).toBeLessThan(20);
    }
    const due = queue.filter((e) => e.time <= now);
    const latest = (type: string, trackId?: string) =>
      due.filter((e) => e.type === type && (!trackId || ("trackId" in e && e.trackId === trackId)));
    expect(latest("beat")).toHaveLength(1);
    for (const t of p.patterns[0].tracks) expect(latest("step", t.id)).toHaveLength(1);
    // The kept beat is the last one played: no later beat is due.
    expect(latest("beat")[0].time).toBeGreaterThan(now - 0.5);
  });

  it("keeps every future event and the queue order", () => {
    const e = (time: number, trackId: string): TimedEvent => ({
      type: "step",
      at: 0,
      beat: 0,
      offset: 0,
      trackId,
      patternId: "p",
      step: 0,
      time,
    });
    const queue = [e(1, "a"), e(1, "b"), e(2, "a"), e(3, "a"), e(4, "b")];
    expect(pruneQueue(queue, 2.5).map((x) => [x.time, "trackId" in x && x.trackId])).toEqual([
      [1, "b"],
      [2, "a"],
      [3, "a"],
      [4, "b"],
    ]);
  });
});

describe("undo and redo", () => {
  it("keeps the live current pattern when the snapshot still has it", () => {
    const live = project();
    const snapshot = structuredClone(live);
    live.currentPatternId = live.patterns[1].id; // switched after the snapshot
    expect(keepCurrentPattern(snapshot, live).currentPatternId).toBe(live.patterns[1].id);
  });

  it("uses the snapshot's current pattern when the live one does not exist there", () => {
    const snapshot = project();
    const live = structuredClone(snapshot);
    const added = makePattern("C");
    live.patterns.push(added);
    live.currentPatternId = added.id;
    expect(keepCurrentPattern(snapshot, live).currentPatternId).toBe(snapshot.patterns[0].id);
  });
});

describe("song position", () => {
  it("numbers the playing entry by its id, so a moved entry shows its new position", () => {
    const p = project();
    const e = beat({ patternId: p.patterns[0].id, entryId: "e1", bar: 1, beatInBar: 2 });
    expect(positionText(p, e)).toBe("1:2 1.3");
    p.song.reverse();
    expect(positionText(p, e)).toBe("2:2 1.3");
    p.song.splice(1, 1); // deleted while it plays out
    expect(positionText(p, e)).toBe("–:2 1.3");
    expect(positionText(p, beat({ patternId: p.patterns[0].id, beatInBar: 3 }))).toBe("1.4");
  });
});

describe("live record", () => {
  it("sounds a recorded hit once", () => {
    // Upcoming and already on: the scheduled hit plays it.
    expect(recordPlan(true, true)).toEqual({ audition: false, skip: false });
    // Upcoming and off: play it now and skip the scheduled hit once.
    expect(recordPlan(true, false)).toEqual({ audition: true, skip: true });
    // Already passed: play it now; the step plays from the next loop.
    expect(recordPlan(false, false)).toEqual({ audition: true, skip: false });
    expect(recordPlan(false, true)).toEqual({ audition: true, skip: false });
  });
});
