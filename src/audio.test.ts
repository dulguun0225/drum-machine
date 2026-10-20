import { describe, expect, it } from "vite-plus/test";
import { cuts, type VoiceSpan } from "./audio";

const voice = (start: number, order: number, end = start + 1): VoiceSpan => ({
  start,
  end,
  cut: Infinity,
  order,
});

describe("choke groups", () => {
  it("lets a later voice cut an earlier one that still sounds", () => {
    expect(cuts(voice(0.5, 0), voice(0, 1))).toBe(true);
    expect(cuts(voice(0, 1), voice(0.5, 0))).toBe(false);
    expect(cuts(voice(2, 0), voice(0, 1))).toBe(false); // already ended
    expect(cuts(voice(0.5, 0), { ...voice(0, 1), cut: 0.2 })).toBe(false); // already cut
  });

  it("lets the later track cut the others when hits share a time", () => {
    const [low, high] = [voice(1, 0), voice(1, 3)];
    expect(cuts(high, low)).toBe(true);
    expect(cuts(low, high)).toBe(false);
    // Independent of the order in which the hits were scheduled.
    const survivors = (a: VoiceSpan, b: VoiceSpan) =>
      [a, b].filter((v) => !cuts(v === a ? b : a, v)).map((v) => v.order);
    expect(survivors(low, high)).toEqual([3]);
    expect(survivors(high, low)).toEqual([3]);
  });
});
