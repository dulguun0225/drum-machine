// Step-rate presets. A step duration is a rational number of quarter-note beats;
// tuplets and polyrhythms come from durations such as 4/3 or 1/5.

import { reduce, sameRatio, type Ratio } from "./ratio";

export interface RatePreset {
  id: string;
  label: string;
  dur: Ratio;
}

export const RATE_PRESETS: RatePreset[] = [
  { id: "1/1", label: "1/1", dur: { num: 4, den: 1 } },
  { id: "1/2", label: "1/2", dur: { num: 2, den: 1 } },
  { id: "1/4", label: "1/4", dur: { num: 1, den: 1 } },
  { id: "1/8", label: "1/8", dur: { num: 1, den: 2 } },
  { id: "1/16", label: "1/16", dur: { num: 1, den: 4 } },
  { id: "1/32", label: "1/32", dur: { num: 1, den: 8 } },
  { id: "1/8d", label: "Dotted 1/8", dur: { num: 3, den: 4 } },
  { id: "1/16d", label: "Dotted 1/16", dur: { num: 3, den: 8 } },
  { id: "1/4t", label: "1/4T", dur: { num: 2, den: 3 } },
  { id: "1/8t", label: "1/8T", dur: { num: 1, den: 3 } },
  { id: "1/16t", label: "1/16T", dur: { num: 1, den: 6 } },
  { id: "1/32t", label: "1/32T", dur: { num: 1, den: 12 } },
  { id: "1/16q", label: "1/16 quintuplet", dur: { num: 1, den: 5 } },
  { id: "1/16s", label: "1/16 septuplet", dur: { num: 1, den: 7 } },
];

export function presetFor(dur: Ratio): RatePreset | undefined {
  return RATE_PRESETS.find((p) => sameRatio(p.dur, dur));
}

/** Step duration of a tuplet: `steps` evenly spaced steps across `beats` quarter-note beats. */
export function tuplet(steps: number, beats: number): Ratio {
  return reduce(beats, steps);
}

/** Text for a duration: the preset label, or "N in M beats" for any other tuplet. */
export function rateLabel(dur: Ratio): string {
  const preset = presetFor(dur);
  if (preset) return preset.label;
  return `${dur.den} in ${dur.num} ${dur.num === 1 ? "beat" : "beats"}`;
}
