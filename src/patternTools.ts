// Pattern operations without side effects: Euclidean rhythms, rotation and realignment length.

import { barRatio, type Pattern, type Step } from "./model";
import { lcmRatio, ratioValue, reduce, type Ratio } from "./ratio";

/**
 * Euclidean rhythm E(hits, steps) by Bjorklund's algorithm, rotated right by `rotation`.
 * E(3, 8) = x..x..x. and E(5, 8) = x.xx.xx.
 */
export function euclid(hits: number, steps: number, rotation = 0): boolean[] {
  steps = Math.max(0, Math.floor(steps));
  hits = Math.min(steps, Math.max(0, Math.floor(hits)));
  let pattern: boolean[];
  if (hits === 0 || hits === steps) {
    pattern = Array.from({ length: steps }, () => hits > 0);
  } else {
    // Repeatedly append the remainder groups to the leading groups until at most one remainder is left.
    let groups: boolean[][] = Array.from({ length: hits }, () => [true]);
    let rest: boolean[][] = Array.from({ length: steps - hits }, () => [false]);
    while (rest.length > 1) {
      const n = Math.min(groups.length, rest.length);
      const merged = groups.slice(0, n).map((g, i) => [...g, ...rest[i]]);
      rest = groups.length > n ? groups.slice(n) : rest.slice(n);
      groups = merged;
    }
    pattern = [...groups, ...rest].flat();
  }
  return rotate(pattern, rotation);
}

/** Rotate a list right by `amount` (positive moves items later). */
export function rotate<T>(items: T[], amount: number): T[] {
  const n = items.length;
  if (!n) return items.slice();
  const r = ((Math.round(amount) % n) + n) % n;
  return [...items.slice(n - r), ...items.slice(0, n - r)];
}

/** Apply an on/off list to steps, keeping each step's other settings. */
export function applyOnOff(steps: Step[], onOff: boolean[]): Step[] {
  return steps.map((s, i) => ({ ...s, on: onOff[i] ?? false }));
}

/**
 * Number of bars after which every track loop and the bar line coincide again,
 * or null when the number exceeds the safe integer range.
 */
export function realignBars(p: Pattern): number | null {
  const bar = barRatio(p);
  let period: Ratio = bar;
  for (const t of p.tracks) {
    period = lcmRatio(period, reduce(t.stepDur.num * t.steps.length, t.stepDur.den));
    if (!Number.isSafeInteger(period.num) || period.num > 1e12) return null;
  }
  return Math.round(ratioValue(period) / ratioValue(bar));
}
