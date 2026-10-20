// Step inspector: every setting of the selected step.

import type { App } from "../app";
import { MAX_CONDITION, MAX_RATCHET, type Step } from "../model";
import { checkbox, pct, range, select, signed } from "./controls";
import { h } from "./dom";

export function inspectorView(app: App): HTMLElement {
  const track = app.track;
  const index = app.ui.step;
  const step = track && index !== null ? track.steps[index] : undefined;
  const body =
    track && step && index !== null
      ? stepFields(app, track.id, index, step)
      : h(
          "p",
          { class: "hint" },
          "Select a step: right-click or long-press a cell, or turn one on.",
        );
  return h(
    "section",
    { class: "panel inspector", "aria-labelledby": "inspector-heading" },
    h(
      "h2",
      { id: "inspector-heading" },
      "Step",
      track && index !== null ? h("span", { class: "sub" }, ` ${index + 1} · ${track.name}`) : null,
    ),
    body,
  );
}

function stepFields(app: App, trackId: string, index: number, s: Step): HTMLElement {
  const set = (change: (s: Step) => void, key: string | null = null) =>
    app.updateTrack(trackId, (t) => change(t.steps[index]), key);
  const conditionOptions = (n: number): [string, string][] =>
    Array.from({ length: n }, (_, i) => [String(i + 1), String(i + 1)]);
  return h(
    "div",
    { class: "fields" },
    checkbox({ id: "step-on", label: "On", checked: s.on, set: (v) => set((x) => (x.on = v)) }),
    checkbox({
      id: "step-flam",
      label: "Flam",
      checked: s.flam,
      set: (v) => set((x) => (x.flam = v)),
    }),
    range(app, {
      id: "step-velocity",
      label: "Velocity",
      min: 0,
      max: 1,
      step: 0.01,
      value: s.velocity,
      format: pct,
      set: (v, key) => set((x) => (x.velocity = v), key),
    }),
    range(app, {
      id: "step-probability",
      label: "Probability",
      min: 0,
      max: 1,
      step: 0.01,
      value: s.probability,
      format: pct,
      set: (v, key) => set((x) => (x.probability = v), key),
    }),
    range(app, {
      id: "step-ratchet",
      label: "Ratchet",
      min: 1,
      max: MAX_RATCHET,
      step: 1,
      value: s.ratchet,
      format: (v) => `×${v}`,
      set: (v, key) => set((x) => (x.ratchet = v), key),
    }),
    range(app, {
      id: "step-nudge",
      label: "Nudge",
      min: -0.5,
      max: 0.5,
      step: 0.01,
      value: s.nudge,
      format: (v) => `${signed(Math.round(v * 100))}% of step`,
      set: (v, key) => set((x) => (x.nudge = v), key),
    }),
    range(app, {
      id: "step-pitch",
      label: "Pitch",
      min: -24,
      max: 24,
      step: 1,
      value: s.pitch,
      format: (v) => `${signed(v)} st`,
      set: (v, key) => set((x) => (x.pitch = v), key),
    }),
    h(
      "div",
      { class: "condition" },
      select({
        id: "step-cond-a",
        label: "Play on loop",
        value: String(s.condition.a),
        options: conditionOptions(s.condition.b),
        set: (v) => set((x) => (x.condition = { ...x.condition, a: Number(v) })),
      }),
      select({
        id: "step-cond-b",
        label: "of every",
        value: String(s.condition.b),
        options: conditionOptions(MAX_CONDITION),
        set: (v) =>
          set((x) => {
            const b = Number(v);
            x.condition = { a: Math.min(x.condition.a, b), b };
          }),
      }),
    ),
  );
}
