import { describe, expect, it } from "vite-plus/test";
import { demoProject } from "./demo";
import {
  compactStep,
  makeProject,
  makeStep,
  makeTrack,
  parseProject,
  parseProjectText,
  serializeProject,
  type Project,
} from "./model";
import { applyOnOff, euclid, realignBars, rotate } from "./patternTools";
import { RATE_PRESETS, presetFor, rateLabel, tuplet } from "./presets";

const show = (p: boolean[]) => p.map((x) => (x ? "x" : ".")).join("");

describe("Euclidean generator", () => {
  it("matches Bjorklund's canonical rhythms", () => {
    expect(show(euclid(3, 8))).toBe("x..x..x.");
    expect(show(euclid(5, 8))).toBe("x.xx.xx.");
    expect(show(euclid(4, 12))).toBe("x..x..x..x..");
    expect(show(euclid(2, 5))).toBe("x.x..");
    expect(show(euclid(7, 12))).toBe("x.xx.x.xx.x.");
  });

  it("handles empty, full and out-of-range input", () => {
    expect(show(euclid(0, 4))).toBe("....");
    expect(show(euclid(4, 4))).toBe("xxxx");
    expect(show(euclid(9, 4))).toBe("xxxx");
    expect(euclid(3, 0)).toEqual([]);
  });

  it("rotates right by the rotation amount", () => {
    expect(show(euclid(3, 8, 1))).toBe(".x..x..x");
    expect(show(euclid(3, 8, -1))).toBe("..x..x.x");
    expect(rotate([1, 2, 3], 4)).toEqual([3, 1, 2]);
  });

  it("keeps step settings when applying an on/off list", () => {
    const t = makeTrack("snare");
    t.steps[1].velocity = 0.3;
    const next = applyOnOff(t.steps, euclid(8, 16));
    expect(next[1]).toMatchObject({ on: false, velocity: 0.3 });
    expect(next[0].on).toBe(true);
  });
});

describe("rates and realignment", () => {
  it("maps presets and custom tuplets to step durations", () => {
    expect(presetFor({ num: 1, den: 6 })?.label).toBe("1/16T");
    expect(tuplet(3, 4)).toEqual({ num: 4, den: 3 });
    expect(tuplet(6, 4)).toEqual({ num: 2, den: 3 });
    expect(rateLabel({ num: 4, den: 5 })).toBe("5 in 4 beats");
    expect(new Set(RATE_PRESETS.map((p) => p.id)).size).toBe(RATE_PRESETS.length);
  });

  it("computes the bar count where track loops realign", () => {
    const p = makeProject().patterns[0];
    const sizes = [16, 7, 5, 3];
    p.tracks = sizes.map((n) => {
      const t = makeTrack("kick");
      t.steps = t.steps.slice(0, n);
      return t;
    });
    expect(realignBars(p)).toBe(105);
    const tuplets = makeProject().patterns[0];
    tuplets.tracks = [
      makeTrack("kick", {
        stepDur: { num: 4, den: 3 },
        steps: makeTrack("kick").steps.slice(0, 3),
      }),
    ];
    expect(realignBars(tuplets)).toBe(1);
    tuplets.sigNum = 7;
    tuplets.sigDen = 8; // 3.5-beat bar vs 4-beat loop → 8 bars
    expect(realignBars(tuplets)).toBe(8);
  });
});

describe("project import", () => {
  it("rejects invalid input with a message", () => {
    expect(parseProjectText("{nope")).toMatchObject({ ok: false });
    expect(parseProject(42)).toMatchObject({ ok: false });
    expect(parseProject({ version: 2, patterns: [{}] })).toMatchObject({
      ok: false,
      error: expect.stringContaining("version"),
    });
    expect(parseProject({ patterns: "x" })).toMatchObject({ ok: false });
    expect(parseProject({ patterns: [1, null] })).toMatchObject({ ok: false });
  });

  it("fills defaults and clamps ranges", () => {
    const result = parseProject({
      bpm: 999.97,
      patterns: [
        {
          id: "a",
          sigDen: 5,
          bars: 100,
          swing: 10,
          tracks: [
            {
              sound: "nonsense",
              stepDur: { num: 2, den: 8 },
              steps: [
                { on: true, velocity: 3, ratchet: 20, nudge: -2, condition: { a: 9, b: 4 } },
                true,
              ],
            },
          ],
        },
      ],
      song: [
        { patternId: "a", repeats: 0 },
        { patternId: "missing", repeats: 2 },
      ],
      currentPatternId: "missing",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { project } = result;
    expect(project).toMatchObject({
      version: 1,
      bpm: 300,
      playMode: "pattern",
      currentPatternId: "a",
    });
    expect(project.patterns[0]).toMatchObject({ sigDen: 4, bars: 64, swing: 50, sigNum: 4 });
    const t = project.patterns[0].tracks[0];
    expect(t).toMatchObject({ sound: "kick", stepDur: { num: 1, den: 4 }, volume: 0.8, choke: 0 });
    expect(t.steps[0]).toMatchObject({
      on: true,
      velocity: 1,
      ratchet: 8,
      nudge: -0.5,
      condition: { a: 4, b: 4 },
    });
    expect(t.steps[1]).toMatchObject({ on: true, velocity: 0.8, probability: 1 });
    expect(project.song).toEqual([{ id: expect.any(String), patternId: "a", repeats: 1 }]);
  });

  it("replaces duplicate ids", () => {
    const result = parseProject({
      patterns: [
        { id: "x", tracks: [{ id: "x" }, { id: "t" }] },
        { id: "x", tracks: [{ id: "t" }] },
      ],
    });
    if (!result.ok) throw new Error(result.error);
    const ids = result.project.patterns.flatMap((p) => [p.id, ...p.tracks.map((t) => t.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("round-trips the demo project through the compact export unchanged", () => {
    const demo: Project = demoProject();
    for (const text of [serializeProject(demo), serializeProject(demo, true)]) {
      expect(parseProjectText(text)).toEqual({ ok: true, project: demo });
    }
    expect(serializeProject(demo).length).toBeLessThan(JSON.stringify(demo).length / 3);
    expect(demo.patterns.length).toBeGreaterThanOrEqual(8);
    expect(demo.song.length).toBeGreaterThan(3);
  });

  it("still imports the full form (every step field written out)", () => {
    const demo: Project = demoProject();
    expect(parseProjectText(JSON.stringify(demo))).toEqual({ ok: true, project: demo });
    expect(parseProjectText(JSON.stringify(demo, null, 2))).toEqual({ ok: true, project: demo });
  });

  it("stores steps minimally", () => {
    expect(compactStep(makeStep())).toBe(0);
    expect(compactStep(makeStep({ on: true }))).toBe(1);
    expect(compactStep(makeStep({ velocity: 0.3 }))).toEqual({ velocity: 0.3 });
    expect(compactStep(makeStep({ on: true, condition: { a: 4, b: 4 }, flam: true }))).toEqual({
      on: true,
      flam: true,
      condition: { a: 4, b: 4 },
    });
  });
});
